import { describe, expect, it } from "vitest";
import {
  createProjectDocument,
  type ProjectDocument,
  type ProjectWorkspaceDocument,
} from "../../../src/core/io/projectSchema";
import { projectDocumentToWorkspaceDocument } from "../../../src/core/io/workspaceSerde";
import { openProjectFromLegacyWorkspace } from "../../../src/core/io/legacyWorkspace";
import { diffWorkspaceConflict } from "../../../src/core/io/workspaceConflictDiff";
import {
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import type { Project } from "../../../src/core/model/project";
import type { ProjectFileDamage } from "../../../src/core/io/projectFiles";
import { addPathToProject } from "../../../src/core/model/projectOperations";
import {
  createBrowserAutosaveRecoveryJournal,
  createAutosaveCoordinator,
  createProjectAutosaveCoordinator,
  installDurableAutosaveCloseHandler,
  restoreAutosaveRecoveryJournal,
} from "../../../src/state/autosave";
import {
  createHistoryStore,
  type HistoryCommand,
} from "../../../src/state/historyStore";
import {
  activePathForProjectStore,
  createProjectStore,
  isStorageConflict,
  type ProjectStore,
} from "../../../src/state/projectStore";
import {
  ProjectPersistenceDamageError,
  StorageConflictError,
} from "../../../src/storage";
import {
  createSelectionStore,
  normalizeElementSelection,
  normalizeRangedConstraintSelection,
} from "../../../src/state/selectionStore";
import type {
  DeleteWorkspaceResult,
  LegacyProjectViewMigration,
  ProjectIoCapabilities,
  ProjectIoService,
  ProjectImportOptions,
  ProjectImportResult,
} from "../../../src/platform/projectIo";
import type {
  LegacyProjectMigrationPreparation,
  ProjectWorkspaceSummary,
  WriteResult,
} from "../../../src/storage";

describe("history store", () => {
  it("executes commands and supports undo/redo", () => {
    const history = createHistoryStore<number>();
    const increment: HistoryCommand<number> = {
      description: "increment",
      apply: (value) => value + 1,
      revert: (value) => value - 1,
    };

    let value = history.getState().execute(0, increment);

    expect(value).toBe(1);
    expect(history.getState()).toMatchObject({
      canUndo: true,
      canRedo: false,
    });

    value = history.getState().undo(value).value;

    expect(value).toBe(0);
    expect(history.getState()).toMatchObject({
      canUndo: false,
      canRedo: true,
    });

    value = history.getState().redo(value).value;

    expect(value).toBe(1);
    expect(history.getState()).toMatchObject({
      canUndo: true,
      canRedo: false,
    });
  });
});

describe("project store", () => {
  it("records one atomic structural edit and skips rejected or no-op history", async () => {
    const { store } = await initializedProjectStore(exampleTwoPathWorkspace());
    const [firstPath, secondPath] = requireWorkspace(store).paths;
    const beforeLength = firstPath.path.path_elements.length;

    const applied = store.getState().applyPathStructureEdit(
      {
        kind: "insert",
        index: 1,
        element: createTranslationTarget({ x_meters: 2, y_meters: 2 }),
      },
      { pathId: firstPath.path_id, selectedElementIndex: 0 },
    );

    expect(applied.status).toBe("applied");
    expect(store.getState().history.getState().undoStack).toHaveLength(1);
    expect(store.getState().activePathId).toBe(firstPath.path_id);
    expect(
      requireWorkspace(store).paths.find(
        (path) => path.path_id === firstPath.path_id,
      )?.path.path_elements,
    ).toHaveLength(beforeLength + 1);

    const noop = store
      .getState()
      .applyPathStructureEdit(
        { kind: "reorder", fromIndex: 0, toIndex: 0 },
        { pathId: firstPath.path_id, selectedElementIndex: 0 },
      );
    const rejected = store
      .getState()
      .applyPathStructureEdit(
        { kind: "remove", index: 99 },
        { pathId: firstPath.path_id, selectedElementIndex: 0 },
      );
    expect(noop.status).toBe("noop");
    expect(rejected.status).toBe("rejected");
    expect(store.getState().history.getState().undoStack).toHaveLength(1);

    store.getState().setActivePath(secondPath.path_id);
    store.getState().undo();
    expect(store.getState().activePathId).toBe(firstPath.path_id);
    expect(
      requireWorkspace(store).paths.find(
        (path) => path.path_id === firstPath.path_id,
      )?.path.path_elements,
    ).toHaveLength(beforeLength);
  });

  it("records linked geometry as one atomic edit and focuses its source Path on undo", async () => {
    const workspace = exampleTwoPathWorkspace();
    workspace.linked_targets = [
      {
        target_id: "shared",
        display_name: "Shared",
        kind: "translation",
        x_meters: 0,
        y_meters: 1,
      },
    ];
    for (const path of workspace.paths) {
      path.path.path_elements[0] = createTranslationTarget({
        x_meters: 0,
        y_meters: 1,
        linked_target_id: "shared",
      });
    }
    const { store } = await initializedProjectStore(workspace);
    const [firstPath, secondPath] = requireWorkspace(store).paths;

    const result = store.getState().applyPathElementEdit(
      {
        kind: "position",
        index: 0,
        position: { x_meters: 4, y_meters: 5 },
      },
      { pathId: firstPath.path_id },
    );

    expect(result.status).toBe("applied");
    expect(store.getState().history.getState().undoStack).toHaveLength(1);
    expect(requireWorkspace(store).linked_targets[0]).toMatchObject({
      x_meters: 4,
      y_meters: 5,
    });
    for (const path of requireWorkspace(store).paths) {
      expect(path.path.path_elements[0]).toMatchObject({
        x_meters: 4,
        y_meters: 5,
      });
    }

    const noop = store.getState().applyPathElementEdit(
      {
        kind: "position",
        index: 0,
        position: { x_meters: 4, y_meters: 5 },
      },
      { pathId: firstPath.path_id },
    );
    const rejected = store.getState().applyPathElementEdit(
      {
        kind: "position",
        index: 99,
        position: { x_meters: 4, y_meters: 5 },
      },
      { pathId: firstPath.path_id },
    );
    expect(noop.status).toBe("noop");
    expect(rejected.status).toBe("rejected");
    expect(store.getState().history.getState().undoStack).toHaveLength(1);

    store.getState().updateLinkedTarget("shared", { x_meters: 4, y_meters: 5 });
    expect(store.getState().history.getState().undoStack).toHaveLength(1);

    store.getState().setActivePath(secondPath.path_id);
    store.getState().undo();
    expect(store.getState().activePathId).toBe(firstPath.path_id);
    expect(requireWorkspace(store).linked_targets[0]).toMatchObject({
      x_meters: 0,
      y_meters: 1,
    });

    store.getState().redo();
    expect(store.getState().activePathId).toBe(firstPath.path_id);
    expect(requireWorkspace(store).linked_targets[0]).toMatchObject({
      x_meters: 4,
      y_meters: 5,
    });
    for (const path of requireWorkspace(store).paths) {
      expect(path.path.path_elements[0]).toMatchObject({
        x_meters: 4,
        y_meters: 5,
      });
    }
  });

  it("applies Path metadata edits and keeps undo/redo state", async () => {
    const store = createProjectStore();
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const io = new RecordingIo(workspace);

    store.getState().setProjectIoService(io);
    await store.getState().initializeWorkspace();
    renameActivePath(store, "Beta");

    expect(activePathForProjectStore(store.getState())?.display_name).toBe(
      "Beta",
    );
    expect(store.getState().project?.paths[0].display_name).toBe("Beta");
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().history.getState().canUndo).toBe(true);

    store.getState().undo();

    expect(activePathForProjectStore(store.getState())?.display_name).toBe(
      "Alpha",
    );
    expect(store.getState().history.getState().canRedo).toBe(true);

    store.getState().redo();

    expect(activePathForProjectStore(store.getState())?.display_name).toBe(
      "Beta",
    );
  });

  it("loads and saves through the configured IO service", async () => {
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const io = new RecordingIo(workspace);
    const initialWrite = await io.saveWorkspace(workspace);
    const store = createProjectStore();

    store.getState().setProjectIoService(io);
    await store.getState().initializeWorkspace();

    expect(store.getState()).toMatchObject({
      version: initialWrite.version,
      dirty: false,
      status: "idle",
      lastSavedAt: initialWrite.updatedAt,
    });

    renameActivePath(store, "Beta");
    const secondWrite = await store.getState().saveWorkspace();

    expect(secondWrite).toMatchObject({ version: "v2" });
    expect(io.writes.at(-1)).toMatchObject({
      expectedVersion: initialWrite.version,
      pathName: "Beta",
    });
    expect(store.getState()).toMatchObject({
      version: "v2",
      dirty: false,
      status: "idle",
    });
  });

  it("keeps a newer Project revision dirty until its queued save completes", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    io.deferWrites();

    renameActivePath(store, "Beta");
    const firstSave = store.getState().saveWorkspace();
    await Promise.resolve();

    expect(store.getState()).toMatchObject({
      revision: 1,
      dirty: true,
      status: "saving",
    });

    renameActivePath(store, "Gamma");
    expect(store.getState()).toMatchObject({
      revision: 2,
      dirty: true,
      saveQueued: true,
    });

    io.completeNextWrite();
    await firstSave;
    await Promise.resolve();

    expect(io.writes).toHaveLength(2);
    expect(io.writes[1]).toMatchObject({
      pathName: "Gamma",
      expectedVersion: "v1",
    });
    expect(store.getState()).toMatchObject({
      dirty: true,
      version: "v1",
      status: "saving",
    });

    io.completeNextWrite();
    await waitForSaveQueue();

    expect(store.getState()).toMatchObject({
      revision: 2,
      dirty: false,
      version: "v2",
      status: "idle",
      activeSave: null,
      saveQueued: false,
    });
  });

  it("adopts a migration version before saving edits made during migration", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    io.legacyMigrationResult = {
      version: "migration-v1",
      updatedAt: "2026-04-23T15:45:00.000Z",
    };
    io.deferWrites();
    renameActivePath(store, "Edited During Migration");

    const projectSessionId = requireProjectSessionId(store);
    const migration = legacyMigration("project-a");
    await store
      .getState()
      .prepareLegacyProjectMigration(projectSessionId, migration);
    await store
      .getState()
      .completeLegacyProjectMigration(projectSessionId, migration);
    await Promise.resolve();

    expect(store.getState()).toMatchObject({
      version: "migration-v1",
      dirty: true,
      status: "saving",
    });
    expect(io.writes.at(-1)).toMatchObject({
      pathName: "Edited During Migration",
      expectedVersion: "migration-v1",
    });

    io.completeNextWrite();
    await waitForSaveQueue();
    expect(store.getState()).toMatchObject({ dirty: false, status: "idle" });
  });

  it("keeps dirty edits pending until legacy cleanup finishes", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    io.legacyPrepareResult = {
      version: "prepared-v1",
      updatedAt: "2026-04-23T15:44:00.000Z",
    };
    io.legacyMigrationResult = {
      version: "clean-v2",
      updatedAt: "2026-04-23T15:45:00.000Z",
    };
    io.deferWrites();
    renameActivePath(store, "Edited During Migration");

    const projectSessionId = requireProjectSessionId(store);
    const migration = legacyMigration("project-a");
    await store
      .getState()
      .prepareLegacyProjectMigration(projectSessionId, migration);

    expect(store.getState()).toMatchObject({
      version: "prepared-v1",
      dirty: true,
      status: "idle",
      legacyMigrationPhase: "prepared",
    });
    expect(io.writes).toHaveLength(0);
    await expect(store.getState().saveWorkspace()).resolves.toBeNull();
    expect(io.writes).toHaveLength(0);

    await store
      .getState()
      .completeLegacyProjectMigration(projectSessionId, migration);

    expect(store.getState()).toMatchObject({
      version: "clean-v2",
      dirty: true,
      status: "saving",
    });
    expect(io.writes.at(-1)).toMatchObject({
      pathName: "Edited During Migration",
      expectedVersion: "clean-v2",
    });

    io.completeNextWrite();
    await waitForSaveQueue();
    expect(store.getState()).toMatchObject({ dirty: false, status: "idle" });
  });

  it("creates the first Project from an empty editor session", async () => {
    const store = createProjectStore();
    const io = new RecordingIo();
    store.getState().setProjectIoService(io);
    await expect(store.getState().initializeWorkspace()).resolves.toBeNull();

    await store
      .getState()
      .createWorkspace(exampleWorkspace("project-a", "Alpha", 1));

    expect(store.getState()).toMatchObject({
      project: { project_id: "project-a" },
      dirty: false,
      status: "idle",
    });
  });

  it("rejects editor mutations while Project-changing IO owns the session", async () => {
    const operations: Array<{
      name: string;
      run(store: ProjectStore): Promise<unknown>;
    }> = [
      {
        name: "createWorkspace",
        run: (store) =>
          store
            .getState()
            .createWorkspace(exampleWorkspace("project-b", "Beta", 1)),
      },
      {
        name: "openWorkspace",
        run: (store) => store.getState().openWorkspace("project-b"),
      },
      {
        name: "deleteWorkspace",
        run: (store) => store.getState().deleteWorkspace("project-a"),
      },
      {
        name: "switchWorkspace",
        run: (store) => store.getState().switchWorkspace("project-b"),
      },
      {
        name: "importPath",
        run: (store) =>
          store.getState().importPath(
            new File(
              [JSON.stringify({ display_name: "Imported" })],
              "path.json",
              {
                type: "application/json",
              },
            ),
          ),
      },
      {
        name: "importConfig",
        run: (store) =>
          store
            .getState()
            .importConfig(
              new File(["{}"], "config.json", { type: "application/json" }),
            ),
      },
      {
        name: "importProjectFolder",
        run: (store) => store.getState().importProjectFolder([]),
      },
      {
        name: "importProjectArchive",
        run: (store) =>
          store
            .getState()
            .importProjectArchive(
              new File(["{}"], "project.json", { type: "application/json" }),
            ),
      },
    ];

    for (const operation of operations) {
      const { store, io } = await initializedProjectStore(
        exampleWorkspace("project-a", "Alpha", 1),
      );
      io.deferTransitions();

      const transition = operation.run(store);
      await waitForTransitionCall(io, operation.name);
      const before = store.getState();
      expect(before.projectTransitionInProgress, operation.name).toBe(true);

      expect(
        () => renameActivePath(store, "Edit that would otherwise be lost"),
        operation.name,
      ).toThrow(/temporarily unavailable while changing Projects/);
      expect(store.getState(), operation.name).toMatchObject({
        projectSessionId: before.projectSessionId,
        revision: before.revision,
        project: {
          project_id: "project-a",
          paths: [{ display_name: "Alpha" }],
        },
      });

      io.completeNextTransition();
      await transition;
      expect(store.getState().projectTransitionInProgress, operation.name).toBe(
        false,
      );
    }
  });

  it("keeps the current Project until required imported Field migration succeeds", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    const importedProject = exampleWorkspace("project-b", "Beta", 1);
    io.importResult = {
      project: importedProject,
      legacySelectedFieldId: "legacy-field",
      legacyFieldBackgrounds: [
        {
          field: {
            id: "legacy-field",
            name: "Legacy Field",
            asset_id: "legacy.png",
            file_name: "legacy.png",
            mime_type: "image/png",
            size_bytes: 3,
            created_at: "2026-08-22T14:00:00.000Z",
            geometry: {
              length_meters: 12,
              width_meters: 6,
              coordinate_offset_meters: 0,
            },
          },
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
    };
    const file = new File(["{}"], "legacy-project.json", {
      type: "application/json",
    });

    await expect(
      store.getState().importProjectArchive(file, {
        migrateLegacyFieldBackgrounds: async () => {
          throw new Error("User Data migration failed");
        },
      }),
    ).rejects.toThrow("User Data migration failed");
    expect(requireWorkspace(store).project_id).toBe("project-a");

    let projectDuringMigration: string | undefined;
    await store.getState().importProjectArchive(file, {
      migrateLegacyFieldBackgrounds: async () => {
        projectDuringMigration = store.getState().project?.project_id;
        return { rollback: async () => {} };
      },
    });
    expect(projectDuringMigration).toBe("project-a");
    expect(requireWorkspace(store).project_id).toBe("project-b");
  });

  it("preserves the current session and undo/redo when deleting another Project", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    renameActivePath(store, "First edit");
    renameActivePath(store, "Second edit");
    store.getState().undo();
    io.deleteChangesCurrent = false;
    const before = store.getState();
    const undoCount = before.history.getState().undoStack.length;
    const redoCount = before.history.getState().redoStack.length;

    await store.getState().deleteWorkspace("project-b", "project-b-v1");

    expect(store.getState()).toMatchObject({
      projectSessionId: before.projectSessionId,
      revision: before.revision,
      project: {
        project_id: "project-a",
        paths: [{ display_name: "First edit" }],
      },
    });
    expect(store.getState().history.getState().undoStack).toHaveLength(
      undoCount,
    );
    expect(store.getState().history.getState().redoStack).toHaveLength(
      redoCount,
    );
  });

  it("aborts Import Path when an edit arrives during its save barrier", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    io.deferWrites();
    renameActivePath(store, "Beta");

    const importing = store.getState().importPath(
      new File([JSON.stringify({ display_name: "Imported" })], "path.json", {
        type: "application/json",
      }),
    );
    const rejectedImport = expect(importing).rejects.toThrow(
      /must be saved before changing Projects/,
    );
    await waitForWriteCount(io, 1);
    renameActivePath(store, "Gamma");

    io.completeNextWrite();
    await waitForWriteCount(io, 2);
    io.completeNextWrite();
    await rejectedImport;

    expect(io.transitionCalls).not.toContain("importPath");
    expect(requireWorkspace(store).paths).toHaveLength(1);
    expect(requireWorkspace(store).paths[0]?.display_name).toBe("Gamma");
    store.getState().undo();
    expect(requireWorkspace(store).paths).toHaveLength(1);
    expect(requireWorkspace(store).paths[0]?.display_name).toBe("Beta");
  });

  it("blocks Project-changing operations while dirty migration edits are locked", async () => {
    const operations: Array<{
      name: string;
      run(store: ProjectStore): Promise<unknown>;
    }> = [
      {
        name: "createWorkspace",
        run: (store) =>
          store
            .getState()
            .createWorkspace(exampleWorkspace("project-b", "Beta", 1)),
      },
      {
        name: "openWorkspace",
        run: (store) => store.getState().openWorkspace("project-b"),
      },
      {
        name: "deleteWorkspace",
        run: (store) => store.getState().deleteWorkspace("project-a"),
      },
      {
        name: "switchWorkspace",
        run: (store) => store.getState().switchWorkspace("project-b"),
      },
      {
        name: "importPath",
        run: (store) =>
          store
            .getState()
            .importPath(
              new File(["{}"], "path.json", { type: "application/json" }),
            ),
      },
      {
        name: "importConfig",
        run: (store) =>
          store
            .getState()
            .importConfig(
              new File(["{}"], "config.json", { type: "application/json" }),
            ),
      },
      {
        name: "importProjectFolder",
        run: (store) => store.getState().importProjectFolder([]),
      },
      {
        name: "importProjectArchive",
        run: (store) =>
          store
            .getState()
            .importProjectArchive(
              new File(["{}"], "project.json", { type: "application/json" }),
            ),
      },
    ];

    for (const operation of operations) {
      const { store, io } = await initializedProjectStore(
        exampleWorkspace("project-a", "Alpha", 1),
      );
      const projectSessionId = requireProjectSessionId(store);
      await store
        .getState()
        .prepareLegacyProjectMigration(
          projectSessionId,
          legacyMigration("project-a"),
        );
      renameActivePath(store, "Unsaved Migration Edit");
      const before = store.getState();

      await expect(operation.run(store), operation.name).rejects.toThrow(
        /finishes migrating/,
      );
      expect(io.transitionCalls, operation.name).toEqual([]);
      expect(io.writes, operation.name).toHaveLength(0);
      expect(store.getState(), operation.name).toMatchObject({
        projectSessionId: before.projectSessionId,
        revision: before.revision,
        dirty: true,
        project: {
          project_id: "project-a",
          paths: [{ display_name: "Unsaved Migration Edit" }],
        },
      });
      expect(
        store.getState().history.getState().undoStack,
        operation.name,
      ).toHaveLength(1);
    }
  });

  it("keeps a null cleanup retryable and flushes edits after confirmed cleanup", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    const projectSessionId = requireProjectSessionId(store);
    const migration = legacyMigration("project-a");
    await store
      .getState()
      .prepareLegacyProjectMigration(projectSessionId, migration);
    renameActivePath(store, "Edited During Retry");

    await expect(
      store
        .getState()
        .completeLegacyProjectMigration(projectSessionId, migration),
    ).rejects.toThrow("cleanup could not be confirmed");
    expect(store.getState()).toMatchObject({
      dirty: true,
      legacyMigrationProjectSessionId: projectSessionId,
    });
    await expect(store.getState().saveWorkspace()).resolves.toBeNull();
    expect(io.writes).toHaveLength(0);

    store.getState().markSaveError(new Error("migration failed"));
    io.legacyMigrationResult = {
      version: "clean-v1",
      updatedAt: "2026-04-23T15:45:00.000Z",
    };
    io.deferWrites();
    await store
      .getState()
      .completeLegacyProjectMigration(projectSessionId, migration);

    expect(store.getState()).toMatchObject({
      dirty: true,
      status: "saving",
      error: null,
      legacyMigrationProjectSessionId: null,
    });
    expect(io.writes.at(-1)).toMatchObject({
      pathName: "Edited During Retry",
      expectedVersion: "clean-v1",
    });
    io.completeNextWrite();
    await waitForSaveQueue();
    expect(store.getState()).toMatchObject({ dirty: false, status: "idle" });
  });

  it("releases the migration lock when preparation is explicitly rejected", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    io.legacyPrepareRejected = true;

    const result = await store
      .getState()
      .prepareLegacyProjectMigration(
        requireProjectSessionId(store),
        legacyMigration("project-a"),
      );

    expect(result).toEqual({ status: "rejected" });
    expect(store.getState().legacyMigrationProjectSessionId).toBeNull();
  });

  it("rejects cleanup until the active Project session has prepared migration", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    io.legacyMigrationResult = {
      version: "must-not-clean",
      updatedAt: "2026-04-23T15:45:00.000Z",
    };

    await expect(
      store
        .getState()
        .completeLegacyProjectMigration(
          requireProjectSessionId(store),
          legacyMigration("project-a"),
        ),
    ).rejects.toThrow("must be prepared before cleanup");
    expect(io.legacyMigrationResult).not.toBeNull();
  });

  it("does not treat an in-flight migration preparation as cleanup proof", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    let resolvePreparation!: (
      result: LegacyProjectMigrationPreparation,
    ) => void;
    io.prepareLegacyProjectMigration = async () =>
      new Promise((resolve) => {
        resolvePreparation = resolve;
      });
    const projectSessionId = requireProjectSessionId(store);
    const migration = legacyMigration("project-a");

    const preparation = store
      .getState()
      .prepareLegacyProjectMigration(projectSessionId, migration);
    expect(store.getState()).toMatchObject({
      legacyMigrationProjectSessionId: projectSessionId,
      legacyMigrationPhase: "preparing",
    });
    await expect(
      store
        .getState()
        .completeLegacyProjectMigration(projectSessionId, migration),
    ).rejects.toThrow("must be prepared before cleanup");

    resolvePreparation({
      status: "prepared",
      version: "prepared-v1",
      updatedAt: "2026-04-23T15:44:00.000Z",
    });
    await preparation;
    expect(store.getState().legacyMigrationPhase).toBe("prepared");
  });

  it("does not clear an unrelated error when migration cleanup succeeds", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    const projectSessionId = requireProjectSessionId(store);
    const migration = legacyMigration("project-a");
    await store
      .getState()
      .prepareLegacyProjectMigration(projectSessionId, migration);
    store.getState().markLegacyMigrationError(new Error("migration failed"));
    store.getState().markSaveError(new Error("export failed"));
    io.legacyMigrationResult = {
      version: "clean-v1",
      updatedAt: "2026-04-23T15:45:00.000Z",
    };

    await store
      .getState()
      .completeLegacyProjectMigration(projectSessionId, migration);

    expect(store.getState()).toMatchObject({
      status: "error",
      error: "export failed",
      legacyMigrationError: null,
      legacyMigrationProjectSessionId: null,
    });
  });

  it("does not adopt a delayed legacy prepare after switching Project sessions", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    const projectSessionId = requireProjectSessionId(store);
    const migration = legacyMigration("project-a");
    let prepareCalls = 0;
    let resolvePrepare!: (result: LegacyProjectMigrationPreparation) => void;
    io.prepareLegacyProjectMigration = async () => {
      prepareCalls += 1;
      return new Promise((resolve) => {
        resolvePrepare = resolve;
      });
    };

    const pending = store
      .getState()
      .prepareLegacyProjectMigration(projectSessionId, migration);
    await Promise.resolve();
    await store
      .getState()
      .createWorkspace(exampleWorkspace("project-b", "Beta", 1));

    resolvePrepare({
      status: "prepared",
      version: "prepared-project-a",
      updatedAt: "2026-04-23T15:46:00.000Z",
    });
    await pending;

    expect(store.getState()).toMatchObject({
      project: { project_id: "project-b" },
      version: "v0",
      dirty: false,
    });
    await expect(
      store
        .getState()
        .prepareLegacyProjectMigration(projectSessionId, migration),
    ).resolves.toEqual({ status: "rejected" });
    expect(prepareCalls).toBe(1);
  });

  it("does not adopt or repeat delayed legacy cleanup after switching Project sessions", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    const projectSessionId = requireProjectSessionId(store);
    const migration = legacyMigration("project-a");
    let cleanupCalls = 0;
    let resolveCleanup!: (result: WriteResult) => void;
    io.completeLegacyProjectMigration = async () => {
      cleanupCalls += 1;
      return new Promise((resolve) => {
        resolveCleanup = resolve;
      });
    };

    await store
      .getState()
      .prepareLegacyProjectMigration(projectSessionId, migration);

    const pending = store
      .getState()
      .completeLegacyProjectMigration(projectSessionId, migration);
    await Promise.resolve();
    await store
      .getState()
      .createWorkspace(exampleWorkspace("project-b", "Beta", 1));

    resolveCleanup({
      version: "cleaned-project-a",
      updatedAt: "2026-04-23T15:47:00.000Z",
    });
    await pending;

    expect(store.getState()).toMatchObject({
      project: { project_id: "project-b" },
      version: "v0",
      dirty: false,
    });
    await expect(
      store
        .getState()
        .completeLegacyProjectMigration(projectSessionId, migration),
    ).resolves.toBeNull();
    expect(cleanupCalls).toBe(1);
  });

  it("ignores a save completion after its Project session is closed", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    io.deferWrites();
    renameActivePath(store, "Beta");
    const save = store.getState().saveWorkspace();
    await Promise.resolve();

    store.getState().reset();
    io.completeNextWrite();
    await save;

    expect(store.getState()).toMatchObject({
      project: null,
      projectSessionId: null,
      version: undefined,
      dirty: false,
      status: "idle",
      lastSavedAt: null,
    });
  });

  it("exports the current unsaved Project without clearing dirty state", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    renameActivePath(store, "Unsaved Name");

    await store.getState().exportProjectFolder();

    expect(io.exportedProjectNames).toEqual(["Unsaved Name"]);
    expect(io.writes).toHaveLength(0);
    expect(store.getState()).toMatchObject({
      dirty: true,
      revision: 1,
      version: io.initialVersion,
    });
  });

  it("keeps the Project dirty when a one-off export fails", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    renameActivePath(store, "Unsaved Name");
    io.failExports = true;

    await expect(store.getState().exportProjectFolder()).rejects.toThrow(
      "export failed",
    );

    expect(io.writes).toHaveLength(0);
    expect(store.getState()).toMatchObject({
      dirty: true,
      revision: 1,
      version: io.initialVersion,
    });
  });

  it("tracks path collection edits through undo and redo", async () => {
    const { store } = await initializedProjectStore(exampleTwoPathWorkspace());
    const firstPathId = requireWorkspace(store).paths[0].path_id;
    const secondPathId = requireWorkspace(store).paths[1].path_id;

    store.getState().createPathGroup({
      displayName: "Score Autos",
      pathIds: [firstPathId],
      makeActive: true,
    });
    const groupId = requireWorkspace(store).active_path_group_id ?? "";
    expect(groupId).not.toBe("");
    expect(requireWorkspace(store).path_groups).toHaveLength(1);

    store.getState().undo();
    expect(requireWorkspace(store).path_groups).toHaveLength(0);
    expect(store.getState().history.getState().canRedo).toBe(true);

    store.getState().redo();
    expect(requireWorkspace(store).path_groups[0]).toMatchObject({
      group_id: groupId,
      display_name: "Score Autos",
      path_ids: [firstPathId],
    });

    store.getState().renamePathGroup(groupId, "Speaker Autos");
    expect(requireWorkspace(store).path_groups[0].display_name).toBe(
      "Speaker Autos",
    );
    store.getState().undo();
    expect(requireWorkspace(store).path_groups[0].display_name).toBe(
      "Score Autos",
    );
    store.getState().redo();

    store.getState().addPathsToGroup(groupId, [secondPathId]);
    expect(requireWorkspace(store).path_groups[0].path_ids).toEqual([
      firstPathId,
      secondPathId,
    ]);
    store.getState().undo();
    expect(requireWorkspace(store).path_groups[0].path_ids).toEqual([
      firstPathId,
    ]);
    store.getState().redo();

    store.getState().removePathsFromGroup(groupId, [firstPathId]);
    expect(requireWorkspace(store).path_groups[0].path_ids).toEqual([
      secondPathId,
    ]);
    store.getState().undo();
    expect(requireWorkspace(store).path_groups[0].path_ids).toEqual([
      firstPathId,
      secondPathId,
    ]);
    store.getState().redo();

    store.getState().deletePathGroup(groupId);
    expect(requireWorkspace(store).path_groups).toHaveLength(0);
    store.getState().undo();
    expect(requireWorkspace(store).path_groups[0]).toMatchObject({
      group_id: groupId,
      display_name: "Speaker Autos",
      path_ids: [secondPathId],
    });
  });

  it("tracks path document edits through undo and redo", async () => {
    const { store } = await initializedProjectStore(exampleTwoPathWorkspace());
    const firstPathId = requireWorkspace(store).paths[0].path_id;
    const secondPathId = requireWorkspace(store).paths[1].path_id;

    store.getState().createPath({ displayName: "Third Path" });
    const createdPathId = requireWorkspace(store).active_path_id;
    expect(requireWorkspace(store).paths).toHaveLength(3);
    store.getState().undo();
    expect(
      requireWorkspace(store).paths.some(
        (path) => path.path_id === createdPathId,
      ),
    ).toBe(false);
    store.getState().redo();
    expect(requireWorkspace(store).active_path_id).toBe(createdPathId);

    store.getState().renamePath(secondPathId, "Beta Renamed");
    expect(
      requireWorkspace(store).paths.find(
        (path) => path.path_id === secondPathId,
      )?.display_name,
    ).toBe("Beta Renamed");
    store.getState().undo();
    expect(
      requireWorkspace(store).paths.find(
        (path) => path.path_id === secondPathId,
      )?.display_name,
    ).toBe("Beta");
    store.getState().redo();

    store.getState().duplicatePath(secondPathId, "Beta Copy");
    const duplicatePathId = requireWorkspace(store).active_path_id;
    expect(
      requireWorkspace(store).paths.find(
        (path) => path.path_id === duplicatePathId,
      )?.display_name,
    ).toBe("Beta Copy");
    store.getState().undo();
    expect(
      requireWorkspace(store).paths.some(
        (path) => path.path_id === duplicatePathId,
      ),
    ).toBe(false);
    store.getState().redo();
    expect(requireWorkspace(store).active_path_id).toBe(duplicatePathId);

    store.getState().deletePaths([firstPathId, duplicatePathId ?? ""]);
    expect(
      requireWorkspace(store).paths.some(
        (path) => path.path_id === firstPathId,
      ),
    ).toBe(false);
    store.getState().undo();
    expect(requireWorkspace(store).paths.map((path) => path.path_id)).toContain(
      firstPathId,
    );
    expect(requireWorkspace(store).paths.map((path) => path.path_id)).toContain(
      duplicatePathId,
    );
  });

  it("coalesces new path membership adds with the created path undo step", async () => {
    const { store } = await initializedProjectStore(exampleTwoPathWorkspace());
    const firstPathId = requireWorkspace(store).paths[0].path_id;
    const secondPathId = requireWorkspace(store).paths[1].path_id;

    store.getState().createPathGroup({
      displayName: "Temp Autos",
      pathIds: [firstPathId],
      makeActive: true,
    });
    const groupId = requireWorkspace(store).active_path_group_id ?? "";

    store.getState().duplicatePath(secondPathId, "Beta Copy");
    const duplicatePathId = requireWorkspace(store).active_path_id ?? "";
    store.getState().addPathsToGroup(groupId, [duplicatePathId]);

    expect(requireWorkspace(store).path_groups[0].path_ids).toEqual([
      firstPathId,
      duplicatePathId,
    ]);

    store.getState().undo();

    expect(requireWorkspace(store).path_groups[0].path_ids).toEqual([
      firstPathId,
    ]);
    expect(
      requireWorkspace(store).paths.some(
        (path) => path.path_id === duplicatePathId,
      ),
    ).toBe(false);

    store.getState().redo();

    expect(requireWorkspace(store).path_groups[0].path_ids).toEqual([
      firstPathId,
      duplicatePathId,
    ]);
    expect(
      requireWorkspace(store).paths.some(
        (path) => path.path_id === duplicatePathId,
      ),
    ).toBe(true);
  });

  it("tracks imported paths through undo and redo with IO metadata", async () => {
    const { store } = await initializedProjectStore(
      exampleWorkspace("a", "A", 1),
    );
    const file = new File(
      [
        JSON.stringify({
          path: createPathModel(),
          display_name: "Imported Auto",
        }),
      ],
      "imported-auto.json",
      { type: "application/json" },
    );

    await store.getState().importPath(file);

    expect(store.getState()).toMatchObject({
      dirty: false,
      version: "v1",
      lastSavedAt: "2026-04-23T15:41:00.000Z",
    });
    expect(requireWorkspace(store).paths).toHaveLength(2);
    expect(store.getState().history.getState().canUndo).toBe(true);

    store.getState().undo();
    expect(requireWorkspace(store).paths).toHaveLength(1);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().history.getState().canRedo).toBe(true);

    store.getState().redo();
    expect(requireWorkspace(store).paths).toHaveLength(2);
    expect(requireWorkspace(store).paths[1].display_name).toBe("Imported Auto");
    expect(store.getState().dirty).toBe(true);
  });

  it("keeps path navigation outside save state while preserving undo history", async () => {
    const { store } = await initializedProjectStore(exampleTwoPathWorkspace());
    const firstPathId = requireWorkspace(store).paths[0].path_id;

    store.getState().setActivePath(firstPathId);
    expect(requireWorkspace(store).active_path_id).toBe(firstPathId);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().history.getState().canUndo).toBe(false);

    store.getState().createPath({ displayName: "Third Path" });
    expect(store.getState().history.getState().canUndo).toBe(true);

    store.getState().setActivePath(firstPathId);

    expect(requireWorkspace(store).active_path_id).toBe(firstPathId);
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().history.getState().canUndo).toBe(true);

    store.getState().undo();
    expect(requireWorkspace(store).paths).toHaveLength(2);
  });

  it("undoes and redoes an edit on its original Path after navigation", async () => {
    const { store } = await initializedProjectStore(exampleTwoPathWorkspace());
    const [firstPath, secondPath] = requireWorkspace(store).paths;

    store.getState().setActivePath(firstPath.path_id);
    store.getState().renamePath(secondPath.path_id, "Beta Edited");

    expect(requireWorkspace(store).active_path_id).toBe(firstPath.path_id);

    store.getState().undo();
    expect(requireWorkspace(store).active_path_id).toBe(secondPath.path_id);
    expect(requireWorkspace(store).paths[1].display_name).toBe("Beta");

    store.getState().setActivePath(firstPath.path_id);
    store.getState().redo();
    expect(requireWorkspace(store).active_path_id).toBe(secondPath.path_id);
    expect(requireWorkspace(store).paths[1].display_name).toBe("Beta Edited");
  });

  it("continues undoing membership edits after restoring a deleted collection and member paths", async () => {
    const { store } = await initializedProjectStore(
      exampleThreePathWorkspace(),
    );
    const [firstPathId, secondPathId, thirdPathId] = requireWorkspace(
      store,
    ).paths.map((path) => path.path_id);

    store.getState().createPathGroup({
      displayName: "Temp Autos",
      pathIds: [firstPathId],
      makeActive: true,
    });
    const groupId = requireWorkspace(store).active_path_group_id ?? "";

    store.getState().addPathsToGroup(groupId, [secondPathId]);
    store.getState().addPathsToGroup(groupId, [thirdPathId]);
    expect(requireWorkspace(store).path_groups[0].path_ids).toEqual([
      firstPathId,
      secondPathId,
      thirdPathId,
    ]);

    store.getState().deletePathGroup(groupId, { deleteMemberPaths: true });
    expect(requireWorkspace(store).path_groups).toHaveLength(0);
    expect(
      requireWorkspace(store).paths.some(
        (path) => path.path_id === secondPathId,
      ),
    ).toBe(false);

    store.getState().undo();
    expect(requireWorkspace(store).path_groups[0].path_ids).toEqual([
      firstPathId,
      secondPathId,
      thirdPathId,
    ]);
    expect(requireWorkspace(store).paths.map((path) => path.path_id)).toEqual([
      firstPathId,
      secondPathId,
      thirdPathId,
    ]);

    store.getState().undo();
    expect(requireWorkspace(store).path_groups[0].path_ids).toEqual([
      firstPathId,
      secondPathId,
    ]);

    store.getState().undo();
    expect(requireWorkspace(store).path_groups[0].path_ids).toEqual([
      firstPathId,
    ]);
  });
});

describe("selection store", () => {
  it("normalizes selected element indexes against the current project", () => {
    const store = createSelectionStore();
    const threeElements = exampleProject("project-a", "Alpha", 3);
    const oneElement = exampleProject("project-a", "Alpha", 1);
    const empty = exampleProject("project-a", "Alpha", 0);

    store.getState().selectElement(2, threeElements.path);
    expect(store.getState().selectedElementIndex).toBe(2);

    store.getState().reconcilePath(oneElement.path);
    expect(store.getState().selectedElementIndex).toBe(0);

    store.getState().reconcilePath(empty.path);
    expect(store.getState().selectedElementIndex).toBeNull();

    expect(normalizeElementSelection(threeElements.path, -1)).toBeNull();
  });

  it("tracks ranged constraint selection separately from element selection", () => {
    const store = createSelectionStore();
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createTranslationTarget({ x_meters: 2, y_meters: 2 }),
        ],
        ranged_constraints: [
          {
            key: "max_velocity_meters_per_sec",
            value: 2,
            start_ordinal: 1,
            end_ordinal: 2,
          },
        ],
      }),
    });

    store.getState().selectRangedConstraint(
      {
        key: "max_velocity_meters_per_sec",
        index: 0,
        startOrdinal: 0,
        endOrdinal: 2,
      },
      project.path,
    );

    expect(store.getState().selectedElementIndex).toBeNull();
    expect(store.getState().selectedRangedConstraint).toEqual({
      key: "max_velocity_meters_per_sec",
      index: 0,
      startOrdinal: 1,
      endOrdinal: 2,
    });

    store.getState().selectElement(1, project.path);
    expect(store.getState().selectedElementIndex).toBe(1);
    expect(store.getState().selectedRangedConstraint).toBeNull();

    expect(
      normalizeRangedConstraintSelection(project.path, {
        key: "max_acceleration_meters_per_sec2",
        index: 0,
        startOrdinal: 1,
        endOrdinal: 1,
      }),
    ).toBeNull();

    store.getState().selectRangedConstraint({
      key: "max_velocity_meters_per_sec",
      index: 0,
      startOrdinal: 0,
      endOrdinal: 1,
    });
    expect(store.getState().selectedRangedConstraint?.startOrdinal).toBe(0);
  });
});

describe("autosave coordinator", () => {
  it("writes the current dirty workspace and marks the project store saved", async () => {
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const io = new RecordingIo(workspace);
    const store = createProjectStore();
    store.getState().setProjectIoService(io);
    await store.getState().initializeWorkspace();
    renameActivePath(store, "Beta");
    const coordinator = createProjectAutosaveCoordinator(store);

    const result = await coordinator.flush();

    expect(result).toMatchObject({ version: "v1" });
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]).toMatchObject({
      workspaceId: "project-a",
      expectedVersion: io.initialVersion,
    });
    expect(store.getState()).toMatchObject({
      dirty: false,
      version: "v1",
      status: "idle",
    });
  });

  it("skips clean snapshots and supports debounced scheduling", async () => {
    const io = new RecordingIo(exampleWorkspace("project-a", "Alpha", 1));
    const scheduler = new ManualScheduler();
    const coordinator = createAutosaveCoordinator({
      io,
      delayMs: 25,
      scheduler,
      getSnapshot: () => ({
        project: openProjectFromLegacyWorkspace(
          exampleWorkspace("project-a", "Alpha", 1),
        ).project,
        expectedVersion: "v0",
        dirty: false,
      }),
    });

    coordinator.schedule();

    expect(coordinator.pending).toBe(true);
    expect(scheduler.delayMs).toBe(25);

    await scheduler.runPending();

    expect(io.writes).toHaveLength(0);
    expect(coordinator.status).toBe("idle");
  });

  it("defers pending writes while autosave is temporarily blocked", async () => {
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const io = new RecordingIo(workspace);
    const scheduler = new ManualScheduler();
    let shouldDefer = true;
    const coordinator = createAutosaveCoordinator({
      io,
      delayMs: 25,
      scheduler,
      shouldDefer: () => shouldDefer,
      getSnapshot: () => ({
        project: openProjectFromLegacyWorkspace(workspace).project,
        expectedVersion: "v0",
        dirty: true,
      }),
    });

    coordinator.schedule();
    await scheduler.runPending();

    expect(io.writes).toHaveLength(0);
    expect(coordinator.pending).toBe(false);
    expect(coordinator.status).toBe("pending");

    shouldDefer = false;
    coordinator.schedule();
    await scheduler.runPending();

    expect(io.writes).toHaveLength(1);
    expect(coordinator.status).toBe("idle");
  });

  it("synchronously checkpoints a recent edit and preserves it when cancelled", () => {
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const project = openProjectFromLegacyWorkspace(workspace).project;
    const storage = new MapStorage();
    const journal = createBrowserAutosaveRecoveryJournal(storage);
    const coordinator = createAutosaveCoordinator({
      io: new RecordingIo(workspace),
      scheduler: new ManualScheduler(),
      recoveryJournal: journal,
      getSnapshot: () => ({ project, expectedVersion: "v0", dirty: true }),
    });

    coordinator.schedule();
    coordinator.cancel();

    expect(journal.read()).toMatchObject({
      project: { project_id: "project-a" },
      expectedVersion: "v0",
      dirty: true,
    });
  });

  it("flushes a close-time edit and clears recovery", async () => {
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const project = openProjectFromLegacyWorkspace(workspace).project;
    const io = new RecordingIo(workspace);
    const journal = createBrowserAutosaveRecoveryJournal(new MapStorage());
    const coordinator = createAutosaveCoordinator({
      io,
      recoveryJournal: journal,
      getSnapshot: () => ({ project, expectedVersion: "v0", dirty: true }),
    });
    const close = new RecordingCloseTarget();

    coordinator.checkpoint();
    await installDurableAutosaveCloseHandler(close, coordinator);
    await close.requestClose();

    expect(close.prevented).toBe(true);
    expect(close.destroyed).toBe(true);
    expect(io.writes).toHaveLength(1);
    expect(journal.read()).toBeNull();
  });

  it("keeps the window open while autosave is deliberately deferred", async () => {
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const project = openProjectFromLegacyWorkspace(workspace).project;
    const coordinator = createAutosaveCoordinator({
      io: new RecordingIo(workspace),
      shouldDefer: () => true,
      getSnapshot: () => ({ project, expectedVersion: "v0", dirty: true }),
    });
    const close = new RecordingCloseTarget();

    await installDurableAutosaveCloseHandler(close, coordinator);
    await close.requestClose();

    expect(close.prevented).toBe(true);
    expect(close.destroyed).toBe(false);
    expect(coordinator.status).toBe("pending");
  });

  it("retains the recovery checkpoint when a forced flush fails", async () => {
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const project = openProjectFromLegacyWorkspace(workspace).project;
    const io = new RecordingIo(workspace);
    io.simulateExternalEdit();
    const journal = createBrowserAutosaveRecoveryJournal(new MapStorage());
    const coordinator = createAutosaveCoordinator({
      io,
      recoveryJournal: journal,
      getSnapshot: () => ({ project, expectedVersion: "v0", dirty: true }),
    });
    const close = new RecordingCloseTarget();

    await installDurableAutosaveCloseHandler(close, coordinator);
    await close.requestClose();

    expect(close.prevented).toBe(true);
    expect(close.destroyed).toBe(false);
    expect(journal.read()?.project?.project_id).toBe("project-a");
  });

  it("keeps the window open when the close-time flush exceeds its bound", async () => {
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const project = openProjectFromLegacyWorkspace(workspace).project;
    const io = new RecordingIo(workspace);
    io.deferWrites();
    const coordinator = createAutosaveCoordinator({
      io,
      getSnapshot: () => ({ project, expectedVersion: "v0", dirty: true }),
    });
    const close = new RecordingCloseTarget();

    await installDurableAutosaveCloseHandler(close, coordinator, 0);
    await close.requestClose();

    expect(close.prevented).toBe(true);
    expect(close.destroyed).toBe(false);
    io.completeNextWrite();
  });

  it("restores a browser recovery checkpoint before the workspace is reopened", async () => {
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const recovered = openProjectFromLegacyWorkspace(workspace).project;
    recovered.display_name = "Recovered Alpha";
    const io = new RecordingIo(workspace);
    const journal = createBrowserAutosaveRecoveryJournal(new MapStorage());
    journal.write({ project: recovered, expectedVersion: "v0", dirty: true });

    await expect(restoreAutosaveRecoveryJournal(io, journal)).resolves.toBe(
      true,
    );

    expect((await io.getWorkspace())?.display_name).toBe("Recovered Alpha");
    expect(journal.read()).toBeNull();
  });

  it("preserves a conflicted browser recovery as a separate workspace", async () => {
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const recovered = openProjectFromLegacyWorkspace(workspace).project;
    recovered.display_name = "Recovered Alpha";
    const io = new RecordingIo(workspace);
    io.simulateExternalEdit();
    const journal = createBrowserAutosaveRecoveryJournal(new MapStorage());
    journal.write({ project: recovered, expectedVersion: "v0", dirty: true });

    await expect(restoreAutosaveRecoveryJournal(io, journal)).resolves.toBe(
      true,
    );

    expect((await io.getWorkspace())?.display_name).toBe(
      "Recovered Alpha (Recovered)",
    );
    expect((await io.getWorkspace())?.project_id).toContain(
      "project-a-recovered-",
    );
    expect(journal.read()).toBeNull();
  });

  it("keeps a failed browser recovery checkpoint for a later retry", async () => {
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const recovered = openProjectFromLegacyWorkspace(workspace).project;
    recovered.display_name = "Recovered Alpha";
    const journal = createBrowserAutosaveRecoveryJournal(new MapStorage());
    journal.write({ project: recovered, expectedVersion: "v0", dirty: true });

    await expect(
      restoreAutosaveRecoveryJournal(
        {
          async initialize() {
            return recovered;
          },
          async getWorkspace() {
            return recovered;
          },
          async saveWorkspace() {
            throw new Error("IndexedDB unavailable");
          },
          async createWorkspace() {
            throw new Error("Unexpected recovery copy");
          },
        },
        journal,
      ),
    ).rejects.toThrow(/IndexedDB unavailable/);

    expect(journal.read()?.project?.display_name).toBe("Recovered Alpha");
  });
});

describe("save conflict recovery", () => {
  it("surfaces a recoverable conflict without discarding the user's work", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    renameActivePath(store, "Beta");
    expect(store.getState().dirty).toBe(true);

    // An external tool changes the project on disk; the store still holds the old
    // version token, so the next save conflicts.
    io.simulateExternalEdit();

    await expect(store.getState().saveWorkspace()).rejects.toBeInstanceOf(
      StorageConflictError,
    );

    const state = store.getState();
    expect(state.status).toBe("conflict");
    // The unsaved edits are preserved — nothing is lost, the user gets to choose.
    expect(state.dirty).toBe(true);
    expect(activePathForProjectStore(state)?.display_name).toBe("Beta");
  });

  it("does not wedge: autosave defers instead of erroring in a loop", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    renameActivePath(store, "Beta");
    io.simulateExternalEdit();

    const coordinator = createProjectAutosaveCoordinator(store, {
      shouldDefer: () => store.getState().status === "conflict",
    });

    // First flush hits the conflict and routes the store into the conflict state.
    await expect(coordinator.flush()).rejects.toBeInstanceOf(
      StorageConflictError,
    );
    expect(store.getState().status).toBe("conflict");
    const writesAfterConflict = io.writes.length;

    // Subsequent autosave attempts must NOT keep firing failed writes.
    await coordinator.flush();
    await coordinator.flush();
    expect(io.writes.length).toBe(writesAfterConflict);
    expect(coordinator.status).toBe("pending");
  });

  it("overwriteConflict force-saves the in-memory work and clears the conflict", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    renameActivePath(store, "Beta");
    io.simulateExternalEdit();
    await expect(store.getState().saveWorkspace()).rejects.toBeInstanceOf(
      StorageConflictError,
    );

    const result = await store.getState().overwriteConflict();

    expect(result).not.toBeNull();
    const forcedWrite = io.writes.at(-1);
    // A forced overwrite sends no expected version (skips the disk version check).
    expect(forcedWrite?.expectedVersion).toBeUndefined();
    const state = store.getState();
    expect(state.status).toBe("idle");
    expect(state.dirty).toBe(false);
    expect(state.version).toBe(result?.version);
    // The forced write carried the user's in-memory rename to disk.
    expect(activePathForProjectStore(state)?.display_name).toBe("Beta");
  });

  it("reloadFromDisk drops in-memory edits and adopts the on-disk version", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    renameActivePath(store, "Beta");

    // Disk now holds a different, externally-edited workspace.
    const diskWorkspace = exampleWorkspace("project-a", "External Edit", 1);
    io.simulateExternalEdit(diskWorkspace);
    await expect(store.getState().saveWorkspace()).rejects.toBeInstanceOf(
      StorageConflictError,
    );
    expect(store.getState().status).toBe("conflict");

    const reloaded = await store.getState().reloadFromDisk();

    expect(reloaded?.display_name).toBe("External Edit");
    const state = store.getState();
    expect(state.status).toBe("idle");
    expect(state.dirty).toBe(false);
    expect(state.version).toBe(io.getCurrentVersion());
    expect(requireWorkspace(store).display_name).toBe("External Edit");
  });

  it("reloadFromDisk owns the session before awaiting disk IO", async () => {
    const { store, io } = await initializedProjectStore(
      exampleWorkspace("project-a", "Alpha", 1),
    );
    const diskWorkspace = exampleWorkspace("project-a", "External Edit", 1);
    let resolveReload!: (project: Project) => void;
    io.reloadCurrentProject = async () =>
      new Promise((resolve) => {
        resolveReload = resolve;
      });
    renameActivePath(store, "Unsaved Before Reload");

    const reloading = store.getState().reloadFromDisk();

    expect(store.getState().projectTransitionInProgress).toBe(true);
    expect(() => renameActivePath(store, "Lost Edit")).toThrow(
      /temporarily unavailable while changing Projects/,
    );
    await Promise.resolve();
    resolveReload(diskWorkspace);
    await reloading;

    expect(store.getState()).toMatchObject({
      projectTransitionInProgress: false,
      dirty: false,
      project: { display_name: "External Edit" },
    });
  });
});

describe("Project IO service ownership", () => {
  it("does not let delayed initialization from a replaced service adopt state", async () => {
    const firstIo = new RecordingIo(exampleWorkspace("project-a", "Alpha", 1));
    let resolveFirst!: (project: Project | null) => void;
    firstIo.initialize = async () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      });
    const secondIo = new RecordingIo(exampleWorkspace("project-b", "Beta", 1));
    const store = createProjectStore();

    store.getState().setProjectIoService(firstIo);
    const firstInitialization = store.getState().initializeWorkspace();
    expect(store.getState().projectTransitionInProgress).toBe(true);

    store.getState().setProjectIoService(secondIo);
    const secondInitialization = store.getState().initializeWorkspace();
    await secondInitialization;
    resolveFirst(exampleWorkspace("project-a", "Alpha", 1));
    await expect(firstInitialization).rejects.toThrow(
      /active Project changed before the operation finished/,
    );

    expect(store.getState()).toMatchObject({
      io: secondIo,
      projectTransitionInProgress: false,
      project: { project_id: "project-b", display_name: "Beta" },
    });
  });
});

describe("damaged Project metadata recovery", () => {
  it("keeps runtime content editable but requires explicit metadata replacement", async () => {
    const io = new RecordingIo(exampleWorkspace("project-a", "Alpha", 1));
    io.damage = {
      sourcePath: "project.json",
      message: "Invalid project.json document",
      rawText: "{<<<<<<< HEAD\n",
    };
    const store = createProjectStore();
    store.getState().setProjectIoService(io);

    await store.getState().initializeWorkspace();
    expect(store.getState()).toMatchObject({
      status: "damaged",
      dirty: false,
      persistenceDamage: { sourcePath: "project.json" },
    });

    renameActivePath(store, "Recovered Auto");
    expect(store.getState().status).toBe("damaged");
    await expect(store.getState().saveWorkspace()).rejects.toBeInstanceOf(
      ProjectPersistenceDamageError,
    );

    const result = await store.getState().replaceDamagedProject();
    expect(result).not.toBeNull();
    expect(store.getState()).toMatchObject({
      status: "idle",
      dirty: false,
      persistenceDamage: null,
    });
    expect(activePathForProjectStore(store.getState())?.display_name).toBe(
      "Recovered Auto",
    );
  });

  it("keeps edits made during metadata replacement dirty until a newer save completes", async () => {
    const io = new RecordingIo(exampleWorkspace("project-a", "Alpha", 1));
    io.damage = {
      sourcePath: "project.json",
      message: "Invalid project.json document",
      rawText: "{<<<<<<< HEAD\n",
    };
    const store = createProjectStore();
    store.getState().setProjectIoService(io);
    await store.getState().initializeWorkspace();
    io.deferWrites();

    renameActivePath(store, "Recovered Auto");
    const replacement = store.getState().replaceDamagedProject();
    await Promise.resolve();
    renameActivePath(store, "Newest Auto");

    io.completeNextWrite();
    await replacement;
    await Promise.resolve();

    expect(store.getState()).toMatchObject({
      dirty: true,
      version: "v1",
      status: "saving",
      persistenceDamage: null,
    });
    expect(io.writes.at(-1)).toMatchObject({
      pathName: "Newest Auto",
      expectedVersion: "v1",
    });

    io.completeNextWrite();
    await waitForSaveQueue();
    expect(store.getState()).toMatchObject({
      dirty: false,
      version: "v2",
      status: "idle",
    });
  });
});

describe("workspace conflict diff", () => {
  it("reports no changes when disk matches the in-memory workspace", () => {
    const mine = exampleTwoPathWorkspace();
    const theirs = exampleTwoPathWorkspace();

    const diff = diffWorkspaceConflict(mine, theirs);

    expect(diff.hasChanges).toBe(false);
    expect(diff.addedPaths).toEqual([]);
    expect(diff.removedPaths).toEqual([]);
    expect(diff.changedPaths).toEqual([]);
  });

  it("classifies added, removed and changed paths and config drift", () => {
    // Disk = Alpha + Beta. Mine = Alpha (edited) + Gamma (new), Beta dropped.
    const disk = exampleTwoPathWorkspace();
    const mine = addPathForTest(
      {
        ...exampleWorkspace("project-a", "Alpha", 1),
        // Edit Alpha's contents so it counts as "changed".
        paths: exampleWorkspace("project-a", "Alpha", 3).paths,
        active_path_id: exampleWorkspace("project-a", "Alpha", 3)
          .active_path_id,
      },
      { display_name: "Gamma", file_name: "gamma.json", makeActive: false },
    );

    const diff = diffWorkspaceConflict(mine, disk);

    expect(diff.hasChanges).toBe(true);
    expect(diff.addedPaths).toContain("Gamma");
    expect(diff.removedPaths).toContain("Beta");
    expect(diff.changedPaths).toContain("Alpha");
  });

  it("treats a null on-disk workspace as no computable changes", () => {
    const diff = diffWorkspaceConflict(exampleTwoPathWorkspace(), null);
    expect(diff.hasChanges).toBe(false);
  });
});

describe("isStorageConflict", () => {
  it("recognizes the browser StorageConflictError despite its different message", () => {
    const error = new StorageConflictError(
      "Workspace version does not match expected version",
      "v1",
      "v2",
    );
    // Guard the exact regression: the message alone would not match.
    expect(error.message).not.toContain("storage-conflict");
    expect(isStorageConflict(error)).toBe(true);
  });

  it("does not couple state to a raw native conflict string", () => {
    expect(
      isStorageConflict("storage-conflict: workspace version mismatch"),
    ).toBe(false);
  });

  it("does not flag unrelated errors as conflicts", () => {
    expect(isStorageConflict(new Error("disk full"))).toBe(false);
    expect(isStorageConflict("some other failure")).toBe(false);
    expect(isStorageConflict(null)).toBe(false);
  });
});

function exampleProject(
  project_id: string,
  display_name: string,
  elementCount: number,
): ProjectDocument {
  return createProjectDocument({
    project_id,
    display_name,
    path: createPathModel({
      path_elements: Array.from({ length: elementCount }, (_, index) =>
        createTranslationTarget({ x_meters: index, y_meters: index + 1 }),
      ),
    }),
  });
}

function exampleWorkspace(
  project_id: string,
  display_name: string,
  elementCount: number,
): ProjectWorkspaceDocument {
  return projectDocumentToWorkspaceDocument(
    exampleProject(project_id, display_name, elementCount),
  );
}

function exampleTwoPathWorkspace(): ProjectWorkspaceDocument {
  return addPathForTest(exampleWorkspace("project-a", "Alpha", 1), {
    display_name: "Beta",
    file_name: "beta.json",
    makeActive: false,
  });
}

function exampleThreePathWorkspace(): ProjectWorkspaceDocument {
  return addPathForTest(exampleTwoPathWorkspace(), {
    display_name: "Gamma",
    file_name: "gamma.json",
    makeActive: false,
  });
}

function addPathForTest(
  project: ProjectWorkspaceDocument,
  input: Parameters<typeof addPathToProject>[1] & { makeActive?: boolean },
): ProjectWorkspaceDocument {
  const added = addPathToProject(project, input).project;
  return {
    ...added,
    active_path_id: input.makeActive
      ? (added.paths.at(-1)?.path_id ?? project.active_path_id)
      : project.active_path_id,
    active_path_group_id: project.active_path_group_id,
  };
}

async function initializedProjectStore(
  workspace: ProjectWorkspaceDocument,
): Promise<{ store: ProjectStore; io: RecordingIo }> {
  const store = createProjectStore();
  const io = new RecordingIo(workspace);

  store.getState().setProjectIoService(io);
  await store.getState().initializeWorkspace();

  return { store, io };
}

function requireWorkspace(store: ProjectStore): ProjectWorkspaceDocument {
  const state = store.getState();
  if (!state.project) {
    throw new Error("Expected project store to have an active workspace");
  }
  return {
    ...structuredClone(state.project),
    active_path_id: state.activePathId,
    active_path_group_id: state.activePathGroupId,
  };
}

function renameActivePath(store: ProjectStore, nextName: string): void {
  const pathId = store.getState().activePathId;
  if (!pathId) {
    throw new Error("Expected an active Path");
  }
  store.getState().renamePath(pathId, nextName);
}

function requireProjectSessionId(store: ProjectStore): string {
  const projectSessionId = store.getState().projectSessionId;
  if (!projectSessionId) {
    throw new Error("Expected an open Project session");
  }
  return projectSessionId;
}

function legacyMigration(projectId: string): LegacyProjectViewMigration {
  return {
    legacyProjectId: `legacy-${projectId}`,
    stableProjectId: projectId,
    pathIdByLegacyReference: {},
  };
}

class RecordingIo implements ProjectIoService {
  readonly capabilities: ProjectIoCapabilities = {
    shellLabel: "Test",
    autosaveTargetLabel: "Test storage",
    directFileAutosave: false,
    browserPersistentAutosave: true,
    supportsProjectFolders: false,
    supportsAutosFolderImportExport: true,
    supportsWorkspaceList: true,
    supportsPortableImportExport: true,
    supportsUrlSharing: false,
    supportsRemoteSync: false,
    primaryToolbarActions: ["save"],
  };
  readonly initialVersion = "v0";
  readonly writes: Array<{
    workspaceId: string;
    pathName: string;
    expectedVersion: string | undefined;
  }> = [];
  readonly exportedProjectNames: string[] = [];
  readonly transitionCalls: string[] = [];
  failExports = false;
  damage: ProjectFileDamage | null = null;
  legacyPrepareResult: WriteResult | null = null;
  legacyPrepareRejected = false;
  legacyMigrationResult: WriteResult | null = null;
  importResult: ProjectImportResult | null = null;
  deleteChangesCurrent = true;

  private workspace: Project | null;
  private version: string | undefined = this.initialVersion;
  private updatedAt: string | null = "2026-04-23T15:40:00.000Z";
  private armConflict = false;
  private externalCounter = 0;
  private writesDeferred = false;
  private transitionsDeferred = false;
  private readonly pendingWrites: Array<{
    workspace: Project;
    resolve: (result: WriteResult) => void;
  }> = [];
  private readonly pendingTransitionResumes: Array<() => void> = [];

  /**
   * Simulate an external process (git / gradle / cloud sync) editing the project on
   * disk: the disk version advances but the caller still holds the stale one, so the
   * next version-checked save conflicts. Optionally swaps in modified disk content.
   */
  simulateExternalEdit(modified?: Project): void {
    this.externalCounter += 1;
    this.version = `external-v${this.externalCounter}`;
    this.updatedAt = `2026-04-23T16:0${this.externalCounter}:00.000Z`;
    if (modified) {
      this.workspace = structuredClone(modified);
    }
    this.armConflict = true;
  }

  deferWrites(): void {
    this.writesDeferred = true;
  }

  deferTransitions(): void {
    this.transitionsDeferred = true;
  }

  completeNextWrite(): void {
    const pending = this.pendingWrites.shift();
    if (!pending) {
      throw new Error("No deferred write is pending");
    }
    pending.resolve(this.commitWrite(pending.workspace));
  }

  completeNextTransition(): void {
    const resume = this.pendingTransitionResumes.shift();
    if (!resume) {
      throw new Error("No deferred transition is pending");
    }
    resume();
  }

  constructor(workspace: ProjectWorkspaceDocument | null = null) {
    this.workspace = workspace ? structuredClone(workspace) : null;
  }

  async initialize(): Promise<Project | null> {
    return this.getWorkspace();
  }

  async getWorkspace(): Promise<Project | null> {
    return this.workspace ? structuredClone(this.workspace) : null;
  }

  async peekWorkspace(): Promise<Project | null> {
    return this.workspace ? structuredClone(this.workspace) : null;
  }

  getCurrentVersion(): string | undefined {
    return this.version;
  }

  getLastSavedAt(): string | null {
    return this.updatedAt;
  }

  getCurrentWorkspaceSummary(): ProjectWorkspaceSummary | null {
    return this.workspace
      ? {
          id: this.workspace.project_id,
          displayName: this.workspace.display_name,
          version: this.version ?? "",
          updatedAt: this.updatedAt ?? "",
        }
      : null;
  }

  getPersistenceDamage() {
    return this.damage;
  }

  getLegacyProjectViewMigration() {
    return null;
  }

  async prepareLegacyProjectMigration(): Promise<LegacyProjectMigrationPreparation> {
    if (this.legacyPrepareRejected) {
      return { status: "rejected" };
    }
    const result = this.legacyPrepareResult;
    if (result) {
      this.version = result.version;
      this.updatedAt = result.updatedAt;
      this.legacyPrepareResult = null;
    }
    return result
      ? { status: "prepared", ...result }
      : {
          status: "already-prepared",
          version: this.version ?? this.initialVersion,
          updatedAt: this.updatedAt ?? "2026-04-23T15:40:00.000Z",
        };
  }

  async completeLegacyProjectMigration(): Promise<WriteResult | null> {
    const result = this.legacyMigrationResult;
    if (result) {
      this.version = result.version;
      this.updatedAt = result.updatedAt;
      this.legacyMigrationResult = null;
    }
    return result;
  }

  async createWorkspace(input: { project?: Project } = {}) {
    this.transitionCalls.push("createWorkspace");
    await this.waitForTransition();
    if (!input.project) {
      throw new Error("Test createWorkspace requires a workspace");
    }
    this.workspace = structuredClone(input.project);
    return structuredClone(input.project);
  }

  async openWorkspace(): Promise<Project | null> {
    this.transitionCalls.push("openWorkspace");
    await this.waitForTransition();
    return this.getWorkspace();
  }

  async reloadCurrentProject(): Promise<Project | null> {
    return this.getWorkspace();
  }

  async deleteWorkspace(): Promise<DeleteWorkspaceResult> {
    this.transitionCalls.push("deleteWorkspace");
    await this.waitForTransition();
    if (!this.deleteChangesCurrent) {
      return { project: await this.getWorkspace(), changedCurrent: false };
    }
    this.workspace = null;
    this.version = undefined;
    this.updatedAt = null;
    return { project: null, changedCurrent: true };
  }

  async saveWorkspace(
    workspace: Project,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    if (this.damage) {
      throw new ProjectPersistenceDamageError(this.damage);
    }
    if (
      this.armConflict &&
      expectedVersion !== undefined &&
      expectedVersion !== this.version
    ) {
      throw new StorageConflictError(
        "Workspace version mismatch",
        expectedVersion,
        this.version,
      );
    }
    // A version-agnostic (forced) write or a matching version resolves the conflict.
    this.armConflict = false;

    this.writes.push({
      workspaceId: workspace.project_id,
      pathName: workspace.paths[0]?.display_name ?? "",
      expectedVersion,
    });

    if (this.writesDeferred) {
      return new Promise((resolve) => {
        this.pendingWrites.push({
          workspace: structuredClone(workspace),
          resolve,
        });
      });
    }

    return this.commitWrite(workspace);
  }

  async replaceDamagedProject(
    project: Project,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    this.damage = null;
    return this.saveWorkspace(project, expectedVersion);
  }

  private commitWrite(workspace: Project): WriteResult {
    const version = `v${this.writes.length}`;
    const updatedAt = `2026-04-23T15:4${this.writes.length}:00.000Z`;
    this.workspace = structuredClone(workspace);
    this.version = version;
    this.updatedAt = updatedAt;

    return { version, updatedAt };
  }

  async listWorkspaces(): Promise<ProjectWorkspaceSummary[]> {
    return this.workspace
      ? [
          {
            id: this.workspace.project_id,
            displayName: this.workspace.display_name,
            updatedAt: this.updatedAt ?? "",
            version: this.version ?? "",
          },
        ]
      : [];
  }

  async switchWorkspace(): Promise<Project | null> {
    this.transitionCalls.push("switchWorkspace");
    await this.waitForTransition();
    return this.getWorkspace();
  }

  async importPath(file: File): Promise<Project> {
    this.transitionCalls.push("importPath");
    await this.waitForTransition();
    const parsed = JSON.parse(await file.text()) as {
      display_name?: unknown;
    };
    const displayName =
      typeof parsed.display_name === "string"
        ? parsed.display_name
        : "Imported Path";
    const { project: nextWorkspace } = addPathToProject(
      this.requireWorkspace(),
      {
        display_name: displayName,
        file_name: file.name,
        path: createPathModel(),
      },
    );
    await this.saveWorkspace(nextWorkspace, this.version);
    return nextWorkspace;
  }

  async exportPath(): Promise<Blob> {
    return new Blob([]);
  }

  async importConfig(): Promise<Project> {
    this.transitionCalls.push("importConfig");
    await this.waitForTransition();
    return this.requireWorkspace();
  }

  async exportConfig(): Promise<Blob> {
    return new Blob([]);
  }

  async importProjectFolder(
    _files?: readonly File[],
    options?: ProjectImportOptions,
  ) {
    this.transitionCalls.push("importProjectFolder");
    await this.waitForTransition();
    return this.commitImport(options);
  }

  async exportProjectFolder(project: Project) {
    if (this.failExports) {
      throw new Error("export failed");
    }
    this.exportedProjectNames.push(project.paths[0]?.display_name ?? "");
    return {
      folderName: "autos",
      files: [],
    };
  }

  async importProjectArchive(_file?: File, options?: ProjectImportOptions) {
    this.transitionCalls.push("importProjectArchive");
    await this.waitForTransition();
    return this.commitImport(options);
  }

  async exportProjectArchive(): Promise<Blob> {
    return new Blob([]);
  }

  async readLegacyFieldImageAsset(): Promise<Blob | null> {
    return null;
  }

  async deleteLegacyFieldImageAsset(): Promise<void> {}

  private async commitImport(
    options?: ProjectImportOptions,
  ): Promise<ProjectImportResult> {
    const result =
      this.importResult ?? emptyImportResult(this.requireWorkspace());
    if (result.legacyFieldBackgrounds.length > 0) {
      if (!options?.migrateLegacyFieldBackgrounds) {
        throw new Error("Legacy Field Background migration is required");
      }
      await options.migrateLegacyFieldBackgrounds(result);
    }
    this.workspace = structuredClone(result.project);
    return structuredClone(result);
  }

  private async waitForTransition(): Promise<void> {
    if (!this.transitionsDeferred) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.pendingTransitionResumes.push(resolve);
    });
  }

  private requireWorkspace(): Project {
    if (!this.workspace) {
      throw new Error("No workspace");
    }
    return structuredClone(this.workspace);
  }
}

function emptyImportResult(project: Project) {
  return {
    project,
    legacySelectedFieldId: null,
    legacyFieldBackgrounds: [],
  };
}

async function waitForTransitionCall(
  io: RecordingIo,
  operation: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (io.transitionCalls.includes(operation)) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for ${operation}`);
}

async function waitForWriteCount(
  io: RecordingIo,
  expectedCount: number,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (io.writes.length >= expectedCount) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for ${expectedCount} Project writes`);
}

async function waitForSaveQueue(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Promise.resolve();
  }
}

class ManualScheduler {
  delayMs: number | null = null;
  private callback: (() => void) | null = null;

  setTimeout(callback: () => void, delayMs: number): number {
    this.callback = callback;
    this.delayMs = delayMs;
    return 1;
  }

  clearTimeout(): void {
    this.callback = null;
  }

  async runPending(): Promise<void> {
    this.callback?.();
    await Promise.resolve();
  }
}

class MapStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class RecordingCloseTarget {
  prevented = false;
  destroyed = false;
  private handler:
    | ((event: { preventDefault(): void }) => void | Promise<void>)
    | null = null;

  async onCloseRequested(
    handler: (event: { preventDefault(): void }) => void | Promise<void>,
  ): Promise<() => void> {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
  }

  async requestClose(): Promise<void> {
    await this.handler?.({
      preventDefault: () => {
        this.prevented = true;
      },
    });
  }
}

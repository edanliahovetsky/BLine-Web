import { describe, expect, it } from "vitest";
import {
  createProjectDocument,
  type ProjectDocument,
  type ProjectWorkspaceDocument,
} from "../../../src/core/io/projectSchema";
import { projectDocumentToWorkspaceDocument } from "../../../src/core/io/workspaceSerde";
import {
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import {
  createAutosaveCoordinator,
  createProjectAutosaveCoordinator,
} from "../../../src/state/autosave";
import {
  createHistoryStore,
  type HistoryCommand,
} from "../../../src/state/historyStore";
import { createProjectStore } from "../../../src/state/projectStore";
import {
  createSelectionStore,
  normalizeElementSelection,
  normalizeRangedConstraintSelection,
} from "../../../src/state/selectionStore";
import type {
  ProjectIoCapabilities,
  ProjectIoService,
} from "../../../src/platform/projectIo";
import type {
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
  it("applies active-path commands and keeps undo/redo state", async () => {
    const store = createProjectStore();
    const workspace = exampleWorkspace("project-a", "Alpha", 1);
    const io = new RecordingIo(workspace);

    store.getState().setProjectIoService(io);
    await store.getState().initializeWorkspace();
    store.getState().applyCommand(renameCommand("Beta", "Alpha"));

    expect(store.getState().project?.display_name).toBe("Beta");
    expect(store.getState().workspace?.paths[0].display_name).toBe("Beta");
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().history.getState().canUndo).toBe(true);

    store.getState().undo();

    expect(store.getState().project?.display_name).toBe("Alpha");
    expect(store.getState().history.getState().canRedo).toBe(true);

    store.getState().redo();

    expect(store.getState().project?.display_name).toBe("Beta");
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

    store.getState().applyCommand(renameCommand("Beta", "Alpha"));
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
});

describe("selection store", () => {
  it("normalizes selected element indexes against the current project", () => {
    const store = createSelectionStore();
    const threeElements = exampleProject("project-a", "Alpha", 3);
    const oneElement = exampleProject("project-a", "Alpha", 1);
    const empty = exampleProject("project-a", "Alpha", 0);

    store.getState().selectElement(2, threeElements);
    expect(store.getState().selectedElementIndex).toBe(2);

    store.getState().reconcileProject(oneElement);
    expect(store.getState().selectedElementIndex).toBe(0);

    store.getState().reconcileProject(empty);
    expect(store.getState().selectedElementIndex).toBeNull();

    expect(normalizeElementSelection(threeElements, -1)).toBeNull();
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
      project,
    );

    expect(store.getState().selectedElementIndex).toBeNull();
    expect(store.getState().selectedRangedConstraint).toEqual({
      key: "max_velocity_meters_per_sec",
      index: 0,
      startOrdinal: 1,
      endOrdinal: 2,
    });

    store.getState().selectElement(1, project);
    expect(store.getState().selectedElementIndex).toBe(1);
    expect(store.getState().selectedRangedConstraint).toBeNull();

    expect(
      normalizeRangedConstraintSelection(project, {
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
    store.getState().applyCommand(renameCommand("Beta", "Alpha"));
    const coordinator = createProjectAutosaveCoordinator(store, io);

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
        workspace: exampleWorkspace("project-a", "Alpha", 1),
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
        workspace,
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

function renameCommand(
  nextName: string,
  previousName: string,
): HistoryCommand<ProjectDocument> {
  return {
    description: `Rename project to ${nextName}`,
    apply: (project) => ({
      ...project,
      display_name: nextName,
    }),
    revert: (project) => ({
      ...project,
      display_name: previousName,
    }),
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

  private workspace: ProjectWorkspaceDocument | null;
  private version: string | undefined = this.initialVersion;
  private updatedAt: string | null = "2026-04-23T15:40:00.000Z";

  constructor(workspace: ProjectWorkspaceDocument | null = null) {
    this.workspace = workspace ? structuredClone(workspace) : null;
  }

  async initialize(): Promise<ProjectWorkspaceDocument | null> {
    return this.getWorkspace();
  }

  async getWorkspace(): Promise<ProjectWorkspaceDocument | null> {
    return this.workspace ? structuredClone(this.workspace) : null;
  }

  getCurrentVersion(): string | undefined {
    return this.version;
  }

  getLastSavedAt(): string | null {
    return this.updatedAt;
  }

  async createWorkspace(input: { workspace?: ProjectWorkspaceDocument } = {}) {
    if (!input.workspace) {
      throw new Error("Test createWorkspace requires a workspace");
    }
    this.workspace = structuredClone(input.workspace);
    return structuredClone(input.workspace);
  }

  async openWorkspace(): Promise<ProjectWorkspaceDocument | null> {
    return this.getWorkspace();
  }

  async deleteWorkspace(): Promise<ProjectWorkspaceDocument | null> {
    this.workspace = null;
    this.version = undefined;
    this.updatedAt = null;
    return null;
  }

  async saveWorkspace(
    workspace: ProjectWorkspaceDocument,
    expectedVersion?: string,
  ): Promise<WriteResult> {
    this.writes.push({
      workspaceId: workspace.project_id,
      pathName: workspace.paths[0]?.display_name ?? "",
      expectedVersion,
    });

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

  async switchWorkspace(): Promise<ProjectWorkspaceDocument | null> {
    return this.getWorkspace();
  }

  async setActivePath(): Promise<ProjectWorkspaceDocument> {
    return this.requireWorkspace();
  }

  async createPath(): Promise<ProjectWorkspaceDocument> {
    return this.requireWorkspace();
  }

  async renamePath(): Promise<ProjectWorkspaceDocument> {
    return this.requireWorkspace();
  }

  async duplicatePath(): Promise<ProjectWorkspaceDocument> {
    return this.requireWorkspace();
  }

  async deletePaths(): Promise<ProjectWorkspaceDocument> {
    return this.requireWorkspace();
  }

  async importPath(): Promise<ProjectWorkspaceDocument> {
    return this.requireWorkspace();
  }

  async exportPath(): Promise<Blob> {
    return new Blob([]);
  }

  async importConfig(): Promise<ProjectWorkspaceDocument> {
    return this.requireWorkspace();
  }

  async exportConfig(): Promise<Blob> {
    return new Blob([]);
  }

  async importProjectFolder(): Promise<ProjectWorkspaceDocument> {
    return this.requireWorkspace();
  }

  async exportProjectFolder() {
    return {
      folderName: "autos",
      files: [],
    };
  }

  async importProjectArchive(): Promise<ProjectWorkspaceDocument> {
    return this.requireWorkspace();
  }

  async exportProjectArchive(): Promise<Blob> {
    return new Blob([]);
  }

  async writeFieldImageAsset(): Promise<never> {
    throw new Error("Field image assets are not configured for this test");
  }

  async readFieldImageAsset(): Promise<Blob | null> {
    return null;
  }

  async deleteFieldImageAsset(): Promise<void> {}

  private requireWorkspace(): ProjectWorkspaceDocument {
    if (!this.workspace) {
      throw new Error("No workspace");
    }
    return structuredClone(this.workspace);
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

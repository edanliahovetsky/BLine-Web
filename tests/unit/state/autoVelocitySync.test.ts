import { afterEach, describe, expect, it, vi } from "vitest";
import { seedHandoffRadii } from "../../../src/core/bend/autoSeedHandoffRadii";
import {
  autoVelocityRefreshRequest,
  refreshAutoVelocityConstraints,
} from "../../../src/core/constraints/autoVelocityApply";
import {
  requestAutoRadiiAndCaps,
  resetAutoVelocityRunner,
} from "../../../src/platform/autoVelocityRunner";
import {
  createProjectDocument,
  type ProjectDocument,
  type ProjectWorkspaceDocument,
} from "../../../src/core/io/projectSchema";
import { projectDocumentToWorkspaceDocument } from "../../../src/core/io/workspaceSerde";
import { openProjectFromLegacyWorkspace } from "../../../src/core/io/legacyWorkspace";
import {
  createPathModel,
  createTranslationTarget,
  getHandoffRadiusSource,
  isTranslationTarget,
  type PathElement,
  type PathModel,
} from "../../../src/core/model/path";
import { addPathToProject } from "../../../src/core/model/projectOperations";
import { createAutoVelocityStore } from "../../../src/state/autoVelocityStore";
import { startAutomaticConstraintSync } from "../../../src/state/automaticConstraints";
import {
  activePathForProjectStore,
  createProjectStore,
  type ProjectStore,
} from "../../../src/state/projectStore";
import type {
  ProjectIoCapabilities,
  ProjectIoService,
} from "../../../src/platform/projectIo";
import type { WriteResult } from "../../../src/storage";
import { createSetHandoffRadiusCommand } from "../../../src/canvas/modelSync";

const syncDelayMs = 5;

afterEach(() => {
  resetAutoVelocityRunner();
});

describe("auto velocity sync", () => {
  it("regenerates stale caps after the path settles", async () => {
    const { store, stop, status } = await startedSync();

    moveSecondAnchor(store, 3.2);
    expect(generatedValues(store)).toEqual(staleValuesBeforeMove);
    expect(status.getState().phase).toBe("pending");

    await waitForIdle(status);

    expect(generatedValues(store)).toEqual(
      generatedValues(refreshedStore(store)),
    );
    expect(generatedValues(store)).not.toEqual(staleValuesBeforeMove);
    stop();
  });

  it("regenerates caps after a handoff radius is pinned", async () => {
    const { store, stop, status } = await startedSync();

    store
      .getState()
      .applyPathCommand(
        createSetHandoffRadiusCommand(
          1,
          { radiusMeters: 0.35, source: null },
          { radiusMeters: 0.7, source: "manual" },
        ),
      );
    expect(status.getState().phase).toBe("pending");

    await waitForIdle(status);

    expect(generatedValues(store)).toEqual(
      generatedValues(refreshedStore(store)),
    );
    expect(generatedValues(store)).not.toEqual(staleValuesBeforeMove);
    stop();
  });

  it("regenerates handoff radii alongside the caps", async () => {
    const { store, stop, status } = await startedSync({
      workspace: generatedRadiiWorkspace(),
    });
    const radiusBefore = secondAnchorRadius(store);
    expect(radiusBefore).not.toBeNull();

    // A shorter incoming leg means a smaller seed for the same corner.
    moveSecondAnchor(store, 0.6);
    await waitForIdle(status);

    expect(secondAnchorRadius(store)).toBeLessThan(radiusBefore ?? 0);
    expect(
      getHandoffRadiusSource(
        activeDocument(store)?.path.path_elements[1] as PathElement,
      ),
    ).toBe("auto");
    expect(generatedValues(store)).not.toEqual(staleValuesBeforeMove);
    stop();
  });

  it("keeps auto radii synced when every velocity cap is manual", async () => {
    const { store, stop, status } = await startedSync({
      workspace: generatedRadiiOnlyWorkspace(),
    });
    const radiusBefore = secondAnchorRadius(store);
    expect(radiusBefore).not.toBeNull();
    expect(generatedValues(store)).toEqual([]);

    moveSecondAnchor(store, 0.6);
    await waitForIdle(status);

    expect(secondAnchorRadius(store)).toBeLessThan(radiusBefore ?? 0);
    expect(
      getHandoffRadiusSource(
        activeDocument(store)?.path.path_elements[1] as PathElement,
      ),
    ).toBe("auto");
    expect(generatedValues(store)).toEqual([]);
    stop();
  });

  it("clears a generated radius when an edited corner becomes straight", async () => {
    const { store, stop, status } = await startedSync({
      workspace: generatedRadiiWorkspace(),
    });
    expect(secondAnchorRadius(store)).not.toBeNull();

    store.getState().applyPathCommand({
      description: "Straighten anchor",
      apply: (path) => ({
        ...path,
        path_elements: path.path_elements.map((element, index) =>
          index === 1 && isTranslationTarget(element)
            ? { ...element, x_meters: 0.8, y_meters: 0.4 }
            : element,
        ),
      }),
      revert: (path) => ({
        ...path,
        path_elements: path.path_elements.map((element, index) =>
          index === 1 && isTranslationTarget(element)
            ? { ...element, x_meters: 1, y_meters: 0 }
            : element,
        ),
      }),
    });
    await waitForIdle(status);

    expect(secondAnchorRadius(store)).toBeNull();
    expect(
      getHandoffRadiusSource(
        activeDocument(store)?.path.path_elements[1] as PathElement,
      ),
    ).toBeNull();
    stop();
  });

  it("regenerates a structural edit and folds it into that edit", async () => {
    const { store, stop, status } = await startedSync();
    const before = structuredClone(store.getState().project);

    const result = store.getState().applyPathStructureEdit({
      kind: "insert-many",
      index: 1,
      elements: [
        createTranslationTarget({ x_meters: 1.2, y_meters: 0.2 }),
        createTranslationTarget({ x_meters: 1.8, y_meters: 0.5 }),
      ],
    });
    expect(result.status).toBe("applied");
    expect(status.getState().phase).toBe("pending");
    await waitForIdle(status);
    const after = structuredClone(store.getState().project);

    expect(store.getState().history.getState().undoStack).toHaveLength(1);
    expect(activeDocument(store)?.path.path_elements).toHaveLength(6);
    expect(generatedValues(store)).not.toEqual(staleValuesBeforeMove);
    store.getState().undo();
    expect(store.getState().project).toEqual(before);
    store.getState().redo();
    expect(store.getState().project).toEqual(after);
    stop();
  });

  it("does not attach a source-only baseline refresh to an unrelated edit", async () => {
    const workspace: ProjectWorkspaceDocument = {
      ...exampleWorkspace(true),
      paths: exampleWorkspace(true).paths.map((path) => ({
        ...path,
        path: {
          ...path.path,
          ranged_constraints: path.path.ranged_constraints.map(
            (constraint) => ({ ...constraint, auto_velocity: null }),
          ),
        },
      })),
    };
    const store = await initializedStore(workspace);
    const status = createAutoVelocityStore();
    const request = vi.fn(requestAutoRadiiAndCaps);
    const stop = startAutomaticConstraintSync({
      projects: store,
      status,
      delayMs: syncDelayMs,
      request,
    });
    const pathId = store.getState().activePathId!;

    store.getState().renamePath(pathId, "Renamed only");
    await new Promise((resolve) => setTimeout(resolve, syncDelayMs * 3));

    expect(request).not.toHaveBeenCalled();
    expect(status.getState().phase).toBe("idle");
    expect(
      store
        .getState()
        .project!.paths[0].path.ranged_constraints.every(
          (constraint) => constraint.auto_velocity === null,
        ),
    ).toBe(true);
    stop();
  });

  it("regenerates the edited Path even while another Path is active", async () => {
    const firstWorkspace = exampleWorkspace(true);
    const workspace: ProjectWorkspaceDocument = {
      ...addPathToProject(firstWorkspace, {
        display_name: "Second",
        file_name: "second.json",
        path: structuredClone(firstWorkspace.paths[0].path),
      }).project,
      active_path_id: firstWorkspace.active_path_id,
      active_path_group_id: firstWorkspace.active_path_group_id,
    };
    const store = await initializedStore(workspace);
    const status = createAutoVelocityStore();
    const [firstPath, secondPath] = store.getState().project!.paths;
    const firstBefore = structuredClone(firstPath.path);
    const secondBefore = structuredClone(secondPath.path.ranged_constraints);
    const stop = startAutomaticConstraintSync({
      projects: store,
      status,
      delayMs: syncDelayMs,
    });

    store.getState().applyPathCommand(
      {
        description: "Move inactive anchor",
        apply: (path) => withSecondAnchorX(path, 3.2),
        revert: (path) => withSecondAnchorX(path, 2.4),
      },
      secondPath.path_id,
    );
    await waitForIdle(status);

    expect(store.getState().activePathId).toBe(firstPath.path_id);
    expect(store.getState().project!.paths[0].path).toEqual(firstBefore);
    expect(
      store.getState().project!.paths[1].path.ranged_constraints,
    ).not.toEqual(secondBefore);
    stop();
  });

  it("regenerates every affected Path into one config history entry", async () => {
    const firstWorkspace = exampleWorkspace(true);
    const workspace: ProjectWorkspaceDocument = {
      ...addPathToProject(firstWorkspace, {
        display_name: "Second",
        file_name: "second.json",
        path: structuredClone(firstWorkspace.paths[0].path),
      }).project,
      active_path_id: firstWorkspace.active_path_id,
      active_path_group_id: firstWorkspace.active_path_group_id,
    };
    const store = await initializedStore(workspace);
    const status = createAutoVelocityStore();
    const request = vi.fn(requestAutoRadiiAndCaps);
    const stop = startAutomaticConstraintSync({
      projects: store,
      status,
      delayMs: syncDelayMs,
      request,
    });
    const before = structuredClone(store.getState().project);
    const previousConfig = structuredClone(store.getState().project!.config);

    store.getState().applyConfigCommand({
      description: "Change merge tolerance",
      apply: (config) => ({
        ...config,
        kinematic_constraints: {
          ...config.kinematic_constraints,
          default_auto_velocity_merge_tolerance_meters_per_sec: 0.31,
        },
      }),
      revert: () => previousConfig,
    });
    await waitForIdle(status);
    const after = structuredClone(store.getState().project);

    expect(request).toHaveBeenCalledTimes(2);
    expect(
      store
        .getState()
        .project!.paths.every(
          (path) =>
            autoVelocityRefreshRequest(
              path.path,
              store.getState().project!.config,
            )?.stale === false,
        ),
    ).toBe(true);
    expect(store.getState().history.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().project).toEqual(before);
    store.getState().redo();
    expect(store.getState().project).toEqual(after);
    stop();
  });

  it("folds regeneration into the triggering edit for exact Undo and Redo", async () => {
    const { store, stop, status } = await startedSync();
    const history = store.getState().history;
    const depthBefore = history.getState().undoStack.length;
    const before = structuredClone(store.getState().project);

    moveSecondAnchor(store, 3.6);
    const editRevision = store.getState().revision;
    await waitForIdle(status);
    const after = structuredClone(store.getState().project);

    expect(history.getState().undoStack.length).toBe(depthBefore + 1);
    expect(history.getState().undoStack.at(-1)?.description).toBe(
      "Move anchor",
    );
    expect(store.getState().revision).toBe(editRevision + 1);

    store.getState().undo();
    expect(store.getState().project).toEqual(before);
    store.getState().redo();
    expect(store.getState().project).toEqual(after);
    stop();
  });

  it("discards an in-flight result after Undo", async () => {
    const store = await initializedStore(exampleWorkspace(true));
    const status = createAutoVelocityStore();
    const controlled = gatedRequest();
    const stop = startAutomaticConstraintSync({
      projects: store,
      status,
      delayMs: syncDelayMs,
      request: controlled.request,
    });
    const before = structuredClone(store.getState().project);

    moveSecondAnchor(store, 3.2);
    await vi.waitFor(() => expect(status.getState().phase).toBe("running"));
    store.getState().undo();
    controlled.release();
    await vi.waitFor(() => expect(status.getState().phase).toBe("idle"));

    expect(store.getState().project).toEqual(before);
    expect(store.getState().history.getState().undoStack).toHaveLength(0);
    expect(status.getState().lastError).toBeNull();
    stop();
  });

  it("discards an in-flight result when Keep in Sync is disabled", async () => {
    const store = await initializedStore(exampleWorkspace(true));
    const status = createAutoVelocityStore();
    const controlled = gatedRequest();
    const stop = startAutomaticConstraintSync({
      projects: store,
      status,
      delayMs: syncDelayMs,
      request: controlled.request,
    });

    moveSecondAnchor(store, 3.2);
    const edited = structuredClone(store.getState().project);
    await vi.waitFor(() => expect(status.getState().phase).toBe("running"));
    status.getState().setAutoSyncEnabled(false);
    controlled.release();
    await vi.waitFor(() => expect(status.getState().phase).toBe("idle"));

    expect(store.getState().project).toEqual(edited);
    expect(store.getState().history.getState().undoStack).toHaveLength(1);
    expect(status.getState().lastError).toBeNull();
    stop();
  });

  it("discards an in-flight result after reopening the same stable Project", async () => {
    const workspace = exampleWorkspace(true);
    const store = await initializedStore(workspace);
    const reopenedBaseline = structuredClone(store.getState().project);
    const status = createAutoVelocityStore();
    const controlled = gatedRequest();
    const stop = startAutomaticConstraintSync({
      projects: store,
      status,
      delayMs: syncDelayMs,
      request: controlled.request,
    });

    moveSecondAnchor(store, 3.2);
    await vi.waitFor(() => expect(status.getState().phase).toBe("running"));
    const previousSession = store.getState().projectSessionId;
    await store.getState().initializeWorkspace();
    expect(store.getState().projectSessionId).not.toBe(previousSession);
    controlled.release();
    await vi.waitFor(() => expect(status.getState().phase).toBe("idle"));

    expect(store.getState().project).toEqual(reopenedBaseline);
    expect(store.getState().history.getState().undoStack).toHaveLength(0);
    expect(status.getState().lastError).toBeNull();
    stop();
  });

  it("leaves a path with no generated caps alone", async () => {
    const { store, stop, status } = await startedSync({ generated: false });

    moveSecondAnchor(store, 3.9);
    await waitForIdle(status);

    expect(activeDocument(store)?.path.ranged_constraints).toEqual([]);
    expect(status.getState().phase).toBe("idle");
    stop();
  });

  it("stops regenerating once the toggle is off", async () => {
    const { store, stop, status } = await startedSync();
    status.getState().setAutoSyncEnabled(false);

    moveSecondAnchor(store, 4.4);
    await vi.waitFor(() => {
      expect(status.getState().phase).toBe("idle");
    });

    expect(generatedValues(store)).toEqual(staleValuesBeforeMove);
    stop();
  });

  it("yields a queued refresh to manual generation, then resumes afterward", async () => {
    const { store, stop, status } = await startedSync();

    moveSecondAnchor(store, 3.2);
    expect(status.getState().phase).toBe("pending");
    status.getState().setPhase("running", "manual");
    await new Promise((resolve) => setTimeout(resolve, syncDelayMs * 3));

    expect(status.getState()).toMatchObject({
      phase: "running",
      runSource: "manual",
    });
    expect(generatedValues(store)).toEqual(staleValuesBeforeMove);

    status.getState().setPhase("idle");
    await waitForIdle(status);
    expect(generatedValues(store)).toEqual(
      generatedValues(refreshedStore(store)),
    );
    stop();
  });

  it("applies an in-flight solve to its originating Path after navigation", async () => {
    const firstWorkspace = exampleWorkspace(true);
    const workspace: ProjectWorkspaceDocument = {
      ...addPathToProject(firstWorkspace, {
        display_name: "Second",
        file_name: "second.json",
        path: structuredClone(firstWorkspace.paths[0].path),
      }).project,
      active_path_id: firstWorkspace.active_path_id,
      active_path_group_id: firstWorkspace.active_path_group_id,
    };
    const store = await initializedStore(workspace);
    const status = createAutoVelocityStore();
    const [firstPath, secondPath] = store.getState().project!.paths;
    const secondBefore = structuredClone(secondPath.path.ranged_constraints);
    let releaseRequest!: () => void;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const request = vi.fn(
      async (...args: Parameters<typeof requestAutoRadiiAndCaps>) => {
        const result = await requestAutoRadiiAndCaps(...args);
        await requestGate;
        return result;
      },
    );
    const stop = startAutomaticConstraintSync({
      projects: store,
      status,
      delayMs: syncDelayMs,
      request,
    });

    moveSecondAnchor(store, 3.2);
    await vi.waitFor(() => expect(status.getState().phase).toBe("running"));
    store.getState().setActivePath(secondPath.path_id);
    releaseRequest();
    await waitForIdle(status);

    expect(request).toHaveBeenCalledOnce();
    expect(
      store
        .getState()
        .project!.paths.find((path) => path.path_id === secondPath.path_id)!
        .path.ranged_constraints,
    ).toEqual(secondBefore);
    expect(
      store
        .getState()
        .project!.paths.find((path) => path.path_id === firstPath.path_id)!.path
        .ranged_constraints,
    ).not.toEqual(firstWorkspace.paths[0].path.ranged_constraints);
    const applied = structuredClone(store.getState().project);
    store.getState().undo();
    expect(store.getState().activePathId).toBe(firstPath.path_id);
    expect(
      store
        .getState()
        .project!.paths.find((path) => path.path_id === firstPath.path_id)!
        .path,
    ).toEqual(firstWorkspace.paths[0].path);
    store.getState().redo();
    expect(store.getState().activePathId).toBe(firstPath.path_id);
    expect(store.getState().project).toEqual(applied);
    stop();
  });
});

let staleValuesBeforeMove: number[] = [];

function gatedRequest() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release,
    request: vi.fn(
      async (...args: Parameters<typeof requestAutoRadiiAndCaps>) => {
        const result = await requestAutoRadiiAndCaps(...args);
        await gate;
        return result;
      },
    ),
  };
}

async function startedSync(
  options: {
    generated?: boolean;
    workspace?: ProjectWorkspaceDocument;
  } = {},
) {
  const store = await initializedStore(
    options.workspace ?? exampleWorkspace(options.generated ?? true),
  );
  const status = createAutoVelocityStore();
  const stop = startAutomaticConstraintSync({
    projects: store,
    status,
    delayMs: syncDelayMs,
  });

  staleValuesBeforeMove = generatedValues(store);
  return { store, status, stop };
}

async function waitForIdle(
  status: ReturnType<typeof createAutoVelocityStore>,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(status.getState().phase).toBe("idle");
      expect(status.getState().lastError).toBeNull();
    },
    { timeout: 20_000, interval: 10 },
  );
}

function moveSecondAnchor(store: ProjectStore, xMeters: number): void {
  store.getState().applyPathCommand({
    description: "Move anchor",
    apply: (path) => withSecondAnchorX(path, xMeters),
    revert: (path) => withSecondAnchorX(path, 2.4),
  });
}

function withSecondAnchorX(path: PathModel, xMeters: number): PathModel {
  return {
    ...path,
    path_elements: path.path_elements.map((element, index) =>
      index === 1 && isTranslationTarget(element)
        ? { ...element, x_meters: xMeters }
        : element,
    ),
  };
}

function secondAnchorRadius(store: ProjectStore): number | null {
  const element = activeDocument(store)?.path.path_elements[1];
  return element && isTranslationTarget(element)
    ? element.intermediate_handoff_radius_meters
    : null;
}

function generatedValues(store: ProjectStore): number[] {
  return (activeDocument(store)?.path.ranged_constraints ?? [])
    .filter((constraint) => constraint.source === "auto_velocity")
    .map((constraint) => constraint.value);
}

/** The same refresh the sync performs, applied inline for comparison. */
function refreshedStore(store: ProjectStore): ProjectStore {
  const project = activeDocument(store);
  if (!project) {
    throw new Error("Expected an active project");
  }

  const refreshed = createProjectStore();
  const opened = openProjectFromLegacyWorkspace(
    projectDocumentToWorkspaceDocument({
      ...project,
      path: refreshAutoVelocityConstraints(project.path, project.config, {
        whenPresentOnly: true,
      }),
    }),
  );
  refreshed.setState({
    project: opened.project,
    activePathId: opened.navigation.activePathId,
    activePathGroupId: opened.navigation.activePathGroupId,
  });
  return refreshed;
}

function activeDocument(store: ProjectStore): ProjectDocument | null {
  const state = store.getState();
  const path = activePathForProjectStore(state);
  return state.project && path
    ? {
        schema_version: state.project.schema_version,
        project_id: path.path_id,
        display_name: path.display_name,
        path_file_name: path.file_name,
        config: state.project.config,
        path: path.path,
      }
    : null;
}

async function initializedStore(
  workspace: ProjectWorkspaceDocument,
): Promise<ProjectStore> {
  const store = createProjectStore();
  // The sync only loads and saves, so the double covers that slice of the
  // service rather than all twenty-odd import/export entry points.
  store
    .getState()
    .setProjectIoService(
      new MemoryIo(workspace) as unknown as ProjectIoService,
    );
  await store.getState().initializeWorkspace();
  return store;
}

function exampleWorkspace(generated: boolean): ProjectWorkspaceDocument {
  const path = createPathModel({
    path_elements: [
      createTranslationTarget({ x_meters: 0, y_meters: 0 }),
      createTranslationTarget({
        x_meters: 2.4,
        y_meters: 0.6,
        intermediate_handoff_radius_meters: 0.35,
      }),
      createTranslationTarget({
        x_meters: 4.1,
        y_meters: -0.4,
        intermediate_handoff_radius_meters: 0.3,
      }),
      createTranslationTarget({ x_meters: 6.0, y_meters: 0.5 }),
    ],
  });
  const project = createProjectDocument({
    project_id: "sync-project",
    display_name: "Sync",
    path,
  });

  return projectDocumentToWorkspaceDocument(
    generated
      ? {
          ...project,
          path: refreshAutoVelocityConstraints(project.path, project.config, {
            whenPresentOnly: false,
          }),
        }
      : project,
  );
}

/** Short legs, so a moved anchor visibly moves the generated radius. */
function generatedRadiiWorkspace(): ProjectWorkspaceDocument {
  const project = createProjectDocument({
    project_id: "sync-radii-project",
    display_name: "Sync Radii",
    path: seedHandoffRadii(
      createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 0, y_meters: 0 }),
          createTranslationTarget({ x_meters: 1, y_meters: 0 }),
          createTranslationTarget({ x_meters: 1.6, y_meters: 0.8 }),
          createTranslationTarget({ x_meters: 3, y_meters: 0.8 }),
        ],
      }),
    ).path,
  });

  return projectDocumentToWorkspaceDocument({
    ...project,
    path: refreshAutoVelocityConstraints(project.path, project.config, {
      whenPresentOnly: false,
    }),
  });
}

function generatedRadiiOnlyWorkspace(): ProjectWorkspaceDocument {
  const workspace = generatedRadiiWorkspace();
  return {
    ...workspace,
    paths: workspace.paths.map((path) => ({
      ...path,
      path: {
        ...path.path,
        ranged_constraints: path.path.ranged_constraints.map((constraint) =>
          constraint.key === "max_velocity_meters_per_sec"
            ? {
                ...constraint,
                source: "manual",
                auto_velocity: null,
              }
            : constraint,
        ),
      },
    })),
  };
}

class MemoryIo {
  readonly capabilities: ProjectIoCapabilities = {
    shellLabel: "Test",
    autosaveTargetLabel: "Test storage",
    directFileAutosave: false,
    browserPersistentAutosave: true,
    supportsProjectFolders: false,
    supportsAutosFolderImportExport: false,
    supportsWorkspaceList: false,
    supportsPortableImportExport: false,
    supportsUrlSharing: false,
    supportsRemoteSync: false,
    primaryToolbarActions: ["save"],
  };

  private workspace: ProjectWorkspaceDocument;

  constructor(workspace: ProjectWorkspaceDocument) {
    this.workspace = structuredClone(workspace);
  }

  async initialize(): Promise<ProjectWorkspaceDocument> {
    return structuredClone(this.workspace);
  }

  async getWorkspace(): Promise<ProjectWorkspaceDocument> {
    return structuredClone(this.workspace);
  }

  getCurrentVersion(): string | undefined {
    return "v0";
  }

  getLastSavedAt(): string | null {
    return null;
  }

  async saveWorkspace(
    workspace: ProjectWorkspaceDocument,
  ): Promise<WriteResult> {
    this.workspace = structuredClone(workspace);
    return { version: "v1", updatedAt: "2026-07-26T00:00:00.000Z" };
  }
}

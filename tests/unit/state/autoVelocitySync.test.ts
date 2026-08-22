import { afterEach, describe, expect, it, vi } from "vitest";
import { seedHandoffRadii } from "../../../src/core/bend/autoSeedHandoffRadii";
import { refreshAutoVelocityConstraints } from "../../../src/core/constraints/autoVelocityApply";
import { resetAutoVelocityRunner } from "../../../src/platform/autoVelocityRunner";
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
} from "../../../src/core/model/path";
import { createAutoVelocityStore } from "../../../src/state/autoVelocityStore";
import { startAutoVelocitySync } from "../../../src/state/autoVelocitySync";
import {
  activePathDocumentForProjectStore,
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
      .applyCommand(
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

    store.getState().applyCommand({
      description: "Straighten anchor",
      apply: (project) => ({
        ...project,
        path: {
          ...project.path,
          path_elements: project.path.path_elements.map((element, index) =>
            index === 1 && isTranslationTarget(element)
              ? { ...element, x_meters: 0.8, y_meters: 0.4 }
              : element,
          ),
        },
      }),
      revert: (project) => project,
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

  it("keeps the regeneration off the undo stack", async () => {
    const { store, stop, status } = await startedSync();
    const history = store.getState().history;
    const depthBefore = history.getState().undoStack.length;

    moveSecondAnchor(store, 3.6);
    await waitForIdle(status);

    // The move is the only thing the user should have to undo.
    expect(history.getState().undoStack.length).toBe(depthBefore + 1);
    expect(history.getState().undoStack.at(-1)?.description).toBe(
      "Move anchor",
    );
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
});

let staleValuesBeforeMove: number[] = [];

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
  const stop = startAutoVelocitySync({
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
  store.getState().applyCommand({
    description: "Move anchor",
    apply: (project) => withSecondAnchorX(project, xMeters),
    revert: (project) => withSecondAnchorX(project, 2.4),
  });
}

function withSecondAnchorX(
  project: ProjectDocument,
  xMeters: number,
): ProjectDocument {
  return {
    ...project,
    path: {
      ...project.path,
      path_elements: project.path.path_elements.map((element, index) =>
        index === 1 && isTranslationTarget(element)
          ? { ...element, x_meters: xMeters }
          : element,
      ),
    },
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
  return activePathDocumentForProjectStore(store.getState());
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

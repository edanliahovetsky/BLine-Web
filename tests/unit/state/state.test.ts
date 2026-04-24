import { describe, expect, it } from "vitest";
import { createProjectDocument, type ProjectDocument } from "../../../src/core/io/projectSchema";
import { createPathModel, createTranslationTarget } from "../../../src/core/model/path";
import { createAutosaveCoordinator, createProjectAutosaveCoordinator } from "../../../src/state/autosave";
import { createHistoryStore, type HistoryCommand } from "../../../src/state/historyStore";
import { createProjectStore } from "../../../src/state/projectStore";
import {
  createSelectionStore,
  normalizeElementSelection
} from "../../../src/state/selectionStore";
import type {
  ImportResult,
  ProjectSummary,
  StorageAdapter,
  WriteResult
} from "../../../src/storage";

describe("history store", () => {
  it("executes commands and supports undo/redo", () => {
    const history = createHistoryStore<number>();
    const increment: HistoryCommand<number> = {
      description: "increment",
      apply: (value) => value + 1,
      revert: (value) => value - 1
    };

    let value = history.getState().execute(0, increment);

    expect(value).toBe(1);
    expect(history.getState()).toMatchObject({
      canUndo: true,
      canRedo: false
    });

    value = history.getState().undo(value).value;

    expect(value).toBe(0);
    expect(history.getState()).toMatchObject({
      canUndo: false,
      canRedo: true
    });

    value = history.getState().redo(value).value;

    expect(value).toBe(1);
    expect(history.getState()).toMatchObject({
      canUndo: true,
      canRedo: false
    });
  });
});

describe("project store", () => {
  it("applies project commands and keeps undo/redo state", () => {
    const store = createProjectStore();
    const project = exampleProject("project-a", "Alpha", 1);

    store.getState().createProject(project);
    store.getState().applyCommand(renameCommand("Beta", "Alpha"));

    expect(store.getState().project?.display_name).toBe("Beta");
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().history.getState().canUndo).toBe(true);

    store.getState().undo();

    expect(store.getState().project?.display_name).toBe("Alpha");
    expect(store.getState().history.getState().canRedo).toBe(true);

    store.getState().redo();

    expect(store.getState().project?.display_name).toBe("Beta");
  });

  it("loads and saves through the configured storage adapter", async () => {
    const storage = new RecordingStorage();
    const project = exampleProject("project-a", "Alpha", 1);
    const initialWrite = await storage.writeProject(project);
    const store = createProjectStore();

    store.getState().setStorageAdapter(storage);
    await store.getState().loadProject("project-a");

    expect(store.getState()).toMatchObject({
      version: initialWrite.version,
      dirty: false,
      status: "idle",
      lastSavedAt: initialWrite.updatedAt
    });

    store.getState().applyCommand(renameCommand("Beta", "Alpha"));
    const secondWrite = await store.getState().saveProject();

    expect(secondWrite).toMatchObject({ version: "v2" });
    expect(storage.writes.at(-1)).toMatchObject({
      expectedVersion: initialWrite.version,
      projectName: "Beta"
    });
    expect(store.getState()).toMatchObject({
      version: "v2",
      dirty: false,
      status: "idle"
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
});

describe("autosave coordinator", () => {
  it("writes the current dirty project and marks the project store saved", async () => {
    const storage = new RecordingStorage();
    const store = createProjectStore();
    store.getState().createProject(exampleProject("project-a", "Alpha", 1));
    const coordinator = createProjectAutosaveCoordinator(store, storage);

    const result = await coordinator.flush();

    expect(result).toMatchObject({ version: "v1" });
    expect(storage.writes).toHaveLength(1);
    expect(storage.writes[0]).toMatchObject({
      projectId: "project-a",
      expectedVersion: undefined
    });
    expect(store.getState()).toMatchObject({
      dirty: false,
      version: "v1",
      status: "idle"
    });
  });

  it("skips clean snapshots and supports debounced scheduling", async () => {
    const storage = new RecordingStorage();
    const scheduler = new ManualScheduler();
    const coordinator = createAutosaveCoordinator({
      storage,
      delayMs: 25,
      scheduler,
      getSnapshot: () => ({
        project: exampleProject("project-a", "Alpha", 1),
        expectedVersion: "v0",
        dirty: false
      })
    });

    coordinator.schedule();

    expect(coordinator.pending).toBe(true);
    expect(scheduler.delayMs).toBe(25);

    await scheduler.runPending();

    expect(storage.writes).toHaveLength(0);
    expect(coordinator.status).toBe("idle");
  });
});

function exampleProject(
  project_id: string,
  display_name: string,
  elementCount: number
): ProjectDocument {
  return createProjectDocument({
    project_id,
    display_name,
    path: createPathModel({
      path_elements: Array.from({ length: elementCount }, (_, index) =>
        createTranslationTarget({ x_meters: index, y_meters: index + 1 })
      )
    })
  });
}

function renameCommand(
  nextName: string,
  previousName: string
): HistoryCommand<ProjectDocument> {
  return {
    description: `Rename project to ${nextName}`,
    apply: (project) => ({
      ...project,
      display_name: nextName
    }),
    revert: (project) => ({
      ...project,
      display_name: previousName
    })
  };
}

class RecordingStorage implements StorageAdapter {
  readonly writes: Array<{
    projectId: string;
    projectName: string;
    expectedVersion: string | undefined;
  }> = [];

  private readonly projects = new Map<string, ProjectDocument>();
  private readonly versions = new Map<string, ProjectSummary>();

  async listProjects(): Promise<ProjectSummary[]> {
    return [...this.versions.values()];
  }

  async readProject(id: string): Promise<ProjectDocument> {
    const project = this.projects.get(id);
    if (!project) {
      throw new Error(`Missing project ${id}`);
    }
    return structuredClone(project);
  }

  async writeProject(
    project: ProjectDocument,
    expectedVersion?: string
  ): Promise<WriteResult> {
    this.writes.push({
      projectId: project.project_id,
      projectName: project.display_name,
      expectedVersion
    });

    const version = `v${this.writes.length}`;
    const updatedAt = `2026-04-23T15:4${this.writes.length}:00.000Z`;
    this.projects.set(project.project_id, structuredClone(project));
    this.versions.set(project.project_id, {
      id: project.project_id,
      displayName: project.display_name,
      updatedAt,
      version
    });

    return { version, updatedAt };
  }

  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
    this.versions.delete(id);
  }

  async exportBundle(): Promise<Blob> {
    throw new Error("Not implemented in test storage");
  }

  async importBundle(): Promise<ImportResult> {
    throw new Error("Not implemented in test storage");
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

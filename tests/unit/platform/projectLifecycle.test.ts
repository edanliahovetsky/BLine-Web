import { describe, expect, it, vi } from "vitest";
import { createPathModel } from "../../../src/core/model/path";
import { createProject } from "../../../src/core/model/project";
import {
  createBrowserAutosaveRecoveryJournal,
  createProjectRecoveryLifecycle,
  installBrowserProjectUnloadHandler,
  installDurableProjectCloseHandler,
  restoreAutosaveRecoveryJournal,
} from "../../../src/platform/projectLifecycle";
import { createProjectStore } from "../../../src/state/projectStore";
import { createSelectionStore } from "../../../src/state/selectionStore";
import { createTourSessionController } from "../../../src/ui/tours/tourSession";
import { createTourStore } from "../../../src/ui/tours/tourStore";

describe("Project platform lifecycle", () => {
  it("does not clear a clean startup journal until recovery initialization completes", () => {
    const storage = new MapStorage();
    const journal = createBrowserAutosaveRecoveryJournal(storage);
    const lifecycle = createProjectRecoveryLifecycle(journal);
    journal.write({ project: project("startup"), dirty: true });

    lifecycle.clearIfReady();
    expect(journal.read()?.project?.project_id).toBe("startup");

    lifecycle.completeInitialization();
    lifecycle.clearIfReady();
    expect(journal.read()).toBeNull();
  });

  it("does not treat an unnormalized native string as a recovery conflict", async () => {
    const journal = createBrowserAutosaveRecoveryJournal(new MapStorage());
    const recovered = project("raw-conflict");
    const createWorkspace = vi.fn();
    journal.write({ project: recovered, expectedVersion: "v1", dirty: true });

    await expect(
      restoreAutosaveRecoveryJournal(
        {
          initialize: async () => recovered,
          getWorkspace: async () => recovered,
          saveWorkspace: async () => {
            throw "storage-conflict: unnormalized backend failure";
          },
          createWorkspace,
        },
        journal,
      ),
    ).rejects.toBe("storage-conflict: unnormalized backend failure");

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(journal.read()?.project).toEqual(recovered);
  });

  it("restores and checkpoints the exact dirty session when closing during a Tour", () => {
    const storage = new MapStorage();
    const journal = createBrowserAutosaveRecoveryJournal(storage);
    const lifecycle = createProjectRecoveryLifecycle(journal);
    lifecycle.completeInitialization();
    const projects = createProjectStore();
    const selections = createSelectionStore();
    const tours = createTourStore();
    const original = project("tour-project");
    projects.setState({
      project: original,
      activePathId: "path-tour-project",
      projectSessionId: "original-session",
      version: "v7",
      dirty: true,
    });
    const controller = createTourSessionController({
      projects,
      selections,
      tours,
      resolveTour: (id) =>
        id === "tour"
          ? {
              id: "tour",
              title: "Tour",
              summary: "Tour",
              steps: [{ title: "Step", body: "Body" }],
              practicePath: createPathModel,
            }
          : null,
      captureView: () => null,
      showPracticeView: () => {},
      restoreView: () => {},
      protectCapturedSession: (state) =>
        lifecycle.protectSnapshot({
          project: state.project,
          expectedVersion: state.version,
          dirty: state.dirty,
        }),
      releaseCapturedSession: lifecycle.releaseSnapshotProtection,
    });
    const unload = new RecordingUnloadTarget();
    installBrowserProjectUnloadHandler(unload, {
      prepareClose: controller.restore,
      checkpoint: () => {
        const state = projects.getState();
        return lifecycle.checkpoint({
          project: state.project,
          expectedVersion: state.version,
          dirty: state.dirty,
        });
      },
    });

    expect(controller.start("tour")).toBe(true);
    expect(projects.getState().dirty).toBe(false);
    lifecycle.clearIfReady();
    expect(journal.read()?.project).toEqual(original);

    unload.dispatch("pagehide");

    expect(projects.getState().project).toBe(original);
    expect(projects.getState().dirty).toBe(true);
    expect(tours.getState().activeTourId).toBeNull();
    expect(journal.read()).toMatchObject({
      project: original,
      expectedVersion: "v7",
      dirty: true,
    });
  });

  it("awaits a deferred User Data flush before destroying the desktop window", async () => {
    const close = new RecordingCloseTarget();
    const userData = deferred<void>();
    await installDurableProjectCloseHandler(close, {
      getProjectState: () => ({
        dirty: false,
        activeSave: null,
        blocked: false,
      }),
      flushProject: vi.fn(),
      flushUserData: () => userData.promise,
    });

    const closing = close.requestClose();
    await Promise.resolve();
    expect(close.prevented).toBe(true);
    expect(close.destroyed).toBe(false);

    userData.resolve();
    await closing;
    expect(close.destroyed).toBe(true);
  });

  it("drains a Project mutation that arrives during the first close-time save", async () => {
    const close = new RecordingCloseTarget();
    const firstSave = deferred<void>();
    let revision = 1;
    let savedRevision = 0;
    let saving = false;
    let flushCount = 0;
    await installDurableProjectCloseHandler(close, {
      getProjectState: () => ({
        dirty: revision !== savedRevision,
        activeSave: saving ? { revision } : null,
        blocked: false,
      }),
      async flushProject() {
        flushCount += 1;
        const savingRevision = revision;
        saving = true;
        if (flushCount === 1) {
          await firstSave.promise;
        }
        savedRevision = savingRevision;
        saving = false;
      },
      flushUserData: async () => {},
    });

    const closing = close.requestClose();
    await Promise.resolve();
    revision = 2;
    firstSave.resolve();
    await closing;

    expect(flushCount).toBe(2);
    expect(savedRevision).toBe(2);
    expect(close.destroyed).toBe(true);
  });

  it("keeps the desktop window open while Project persistence is guarded", async () => {
    const close = new RecordingCloseTarget();
    const flushProject = vi.fn();
    await installDurableProjectCloseHandler(close, {
      getProjectState: () => ({ dirty: true, activeSave: null, blocked: true }),
      flushProject,
      flushUserData: async () => {},
    });

    await close.requestClose();

    expect(close.prevented).toBe(true);
    expect(close.destroyed).toBe(false);
    expect(flushProject).not.toHaveBeenCalled();
  });
});

function project(id: string) {
  return createProject({
    project_id: id,
    display_name: id,
    paths: [
      {
        path_id: `path-${id}`,
        display_name: "Path",
        file_name: "path.json",
        path: createPathModel(),
      },
    ],
  });
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

class RecordingUnloadTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: "beforeunload" | "pagehide"): Event {
    const event = new Event(type, { cancelable: true });
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
    return event;
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

import { describe, expect, it, vi } from "vitest";
import { createPathModel } from "../../../src/core/model/path";
import { createProject, type Project } from "../../../src/core/model/project";
import type {
  ProjectIoWorkspace,
  ProjectIoWriteOutcome,
} from "../../../src/platform/projectIo";
import {
  type BrowserRecoveryLockManager,
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
  it("acquires a browser journal lease lazily and only once", async () => {
    const locks = new TestLockManager();
    const journal = createBrowserAutosaveRecoveryJournal(new MapStorage(), {
      ownerId: "lazy-owner",
      lockManager: locks,
    });

    expect(locks.requestCount).toBe(0);
    const firstReady = journal.ready?.();
    const secondReady = journal.ready?.();
    await Promise.all([firstReady, secondReady]);
    expect(locks.requestCount).toBe(1);
    journal.releaseOwnership?.();
  });

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

  it("allows a successful retry to clear a journal after initialization failed", () => {
    const storage = new MapStorage();
    const journal = createBrowserAutosaveRecoveryJournal(storage);
    const lifecycle = createProjectRecoveryLifecycle(journal);
    journal.write({ project: project("retry"), dirty: true });

    lifecycle.markInitializationFailed();
    lifecycle.clearIfReady();
    expect(journal.read()?.project?.project_id).toBe("retry");

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
          initialize: async () => recoveryWorkspace(recovered, "v1"),
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

  it("isolates tab checkpoints and only recovers an owner after its lease ends", async () => {
    const storage = new MapStorage();
    const locks = new TestLockManager();
    const first = createBrowserAutosaveRecoveryJournal(storage, {
      ownerId: "tab-first",
      lockManager: locks,
    });
    const second = createBrowserAutosaveRecoveryJournal(storage, {
      ownerId: "tab-second",
      lockManager: locks,
    });
    await Promise.all([first.ready?.(), second.ready?.()]);
    first.write({ project: project("first-dirty"), dirty: true });

    const secondLifecycle = createProjectRecoveryLifecycle(second);
    secondLifecycle.completeInitialization();
    secondLifecycle.clearIfReady();
    expect(first.read()?.project?.project_id).toBe("first-dirty");

    const initialWorkspace = recoveryWorkspace(project("first-dirty"), "v1");
    const saveWorkspace = vi.fn(
      async (
        _current: ProjectIoWorkspace,
        recovered: Project,
      ): Promise<ProjectIoWriteOutcome> =>
        recoveryWriteOutcome(recoveryWorkspace(recovered, "v2")),
    );
    const io = {
      initialize: async () => initialWorkspace,
      saveWorkspace,
      createWorkspace: vi.fn(async () =>
        recoveryWorkspace(project("recovered-copy"), "v1"),
      ),
    };
    await expect(restoreAutosaveRecoveryJournal(io, second)).resolves.toBe(
      false,
    );
    expect(saveWorkspace).not.toHaveBeenCalled();

    first.releaseOwnership?.();
    await locks.settled();
    await expect(restoreAutosaveRecoveryJournal(io, second)).resolves.toBe(
      true,
    );
    expect(saveWorkspace).toHaveBeenCalledTimes(1);
    expect(storage.length).toBe(0);
  });

  it("surfaces duplicate live ownership instead of writing without a lease", async () => {
    const storage = new MapStorage();
    const locks = new TestLockManager();
    const first = createBrowserAutosaveRecoveryJournal(storage, {
      ownerId: "duplicated-tab",
      lockManager: locks,
    });
    await first.ready?.();
    const duplicate = createBrowserAutosaveRecoveryJournal(storage, {
      ownerId: "duplicated-tab",
      lockManager: locks,
    });

    await expect(duplicate.ready?.()).rejects.toThrow("already active");
    expect(() =>
      duplicate.write({ project: project("unsafe"), dirty: true }),
    ).toThrow("already active");
    expect(storage.length).toBe(0);
    first.releaseOwnership?.();
  });

  it("allocates a fresh owner when a duplicated tab inherits a live session owner", async () => {
    const storage = new MapStorage();
    const firstSession = new MapStorage();
    const duplicateSession = new MapStorage();
    firstSession.setItem("bline.autosave-recovery.owner.v1", "inherited-owner");
    duplicateSession.setItem(
      "bline.autosave-recovery.owner.v1",
      "inherited-owner",
    );
    const locks = new TestLockManager();
    const first = createBrowserAutosaveRecoveryJournal(storage, {
      sessionStorage: firstSession,
      lockManager: locks,
    });
    await first.ready?.();
    const duplicate = createBrowserAutosaveRecoveryJournal(storage, {
      sessionStorage: duplicateSession,
      lockManager: locks,
    });

    await expect(duplicate.ready?.()).resolves.toBeUndefined();
    expect(
      duplicateSession.getItem("bline.autosave-recovery.owner.v1"),
    ).not.toBe("inherited-owner");
    first.write({ project: project("first-tab"), dirty: true });
    duplicate.write({ project: project("duplicate-tab"), dirty: true });
    expect(storage.length).toBe(2);
    first.releaseOwnership?.();
    duplicate.releaseOwnership?.();
  });

  it("surfaces browsers that cannot prove journal ownership", async () => {
    const journal = createBrowserAutosaveRecoveryJournal(new MapStorage(), {
      ownerId: "no-lock-support",
      lockManager: null,
    });

    await expect(journal.ready?.()).rejects.toThrow("exclusive");
    expect(() =>
      journal.write({ project: project("unsafe"), dirty: true }),
    ).toThrow("exclusive");
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

  it("retries User Data persistence on a later close request", async () => {
    const close = new RecordingCloseTarget();
    const flushUserData = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("metadata write failed"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    await installDurableProjectCloseHandler(close, {
      getProjectState: () => ({
        dirty: false,
        activeSave: null,
        blocked: false,
      }),
      flushProject: vi.fn(),
      flushUserData,
      onError,
    });

    await close.requestClose();
    expect(close.destroyed).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    await close.requestClose();
    expect(flushUserData).toHaveBeenCalledTimes(2);
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
    const onError = vi.fn();
    await installDurableProjectCloseHandler(close, {
      getProjectState: () => ({ dirty: true, activeSave: null, blocked: true }),
      flushProject,
      flushUserData: async () => {},
      onError,
    });

    await close.requestClose();

    expect(close.prevented).toBe(true);
    expect(close.destroyed).toBe(false);
    expect(flushProject).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
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

function recoveryWorkspace(
  project: Project,
  version: string,
): ProjectIoWorkspace {
  const savedAt = "2026-08-22T12:00:00.000Z";
  return {
    project,
    handle: { storageId: project.project_id },
    version,
    lastSavedAt: savedAt,
    summary: {
      id: project.project_id,
      displayName: project.display_name,
      version,
      updatedAt: savedAt,
    },
    persistenceDamage: null,
    legacyMigration: null,
  };
}

function recoveryWriteOutcome(
  workspace: ProjectIoWorkspace,
): ProjectIoWriteOutcome {
  const result = {
    version: workspace.version ?? "v1",
    updatedAt: workspace.lastSavedAt ?? "2026-08-22T12:00:00.000Z",
  };
  return { result, workspace };
}

class MapStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

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

class TestLockManager implements BrowserRecoveryLockManager {
  requestCount = 0;
  private readonly active = new Set<string>();
  private readonly requests = new Set<Promise<unknown>>();

  request<T>(
    name: string,
    _options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: { name: string } | null) => Promise<T> | T,
  ): Promise<T> {
    this.requestCount += 1;
    if (this.active.has(name)) {
      return Promise.resolve(callback(null));
    }
    this.active.add(name);
    const request = Promise.resolve(callback({ name })).finally(() => {
      this.active.delete(name);
      this.requests.delete(request);
    });
    this.requests.add(request);
    return request;
  }

  async settled(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

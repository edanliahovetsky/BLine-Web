import type { Project } from "../core/model/project";
import { isProjectIoConflict, type ProjectIoService } from "./projectIo";

export interface ProjectRecoverySnapshot {
  project: Project | null;
  expectedVersion?: string;
  dirty?: boolean;
}

export interface AutosaveRecoveryJournal {
  read(): ProjectRecoverySnapshot | null;
  write(snapshot: ProjectRecoverySnapshot): void;
  clear(): void;
}

export interface ProjectRecoveryLifecycle {
  checkpoint(snapshot: ProjectRecoverySnapshot): boolean;
  protectSnapshot(snapshot: ProjectRecoverySnapshot): boolean;
  releaseSnapshotProtection(): void;
  completeInitialization(): void;
  markInitializationFailed(): void;
  clearIfReady(): void;
}

export interface DurableCloseTarget {
  onCloseRequested(
    handler: (event: { preventDefault(): void }) => void | Promise<void>,
  ): Promise<() => void>;
  destroy(): Promise<void>;
}

export interface ProjectCloseState {
  dirty: boolean;
  activeSave: unknown | null;
  blocked: boolean;
}

export interface DurableProjectCloseOptions {
  prepareClose?(): void;
  getProjectState(): ProjectCloseState;
  flushProject(): Promise<unknown>;
  flushUserData(): Promise<void>;
  timeoutMs?: number;
}

interface AutosaveRecoveryRecord {
  format: 1;
  project: Project;
  expectedVersion?: string;
}

interface BrowserUnloadTarget {
  addEventListener(
    type: "beforeunload" | "pagehide",
    listener: EventListener,
  ): void;
  removeEventListener(
    type: "beforeunload" | "pagehide",
    listener: EventListener,
  ): void;
}

const browserRecoveryJournalKey = "bline.autosave-recovery.v1";

export function createBrowserAutosaveRecoveryJournal(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage,
): AutosaveRecoveryJournal {
  return {
    read() {
      let raw: string | null;
      try {
        raw = storage.getItem(browserRecoveryJournalKey);
      } catch {
        return null;
      }
      if (!raw) {
        return null;
      }

      try {
        const record = JSON.parse(raw) as Partial<AutosaveRecoveryRecord>;
        if (
          record.format !== 1 ||
          !record.project ||
          typeof record.project !== "object" ||
          typeof record.project.project_id !== "string"
        ) {
          throw new Error("Invalid autosave recovery journal");
        }
        return {
          project: record.project,
          expectedVersion: record.expectedVersion,
          dirty: true,
        };
      } catch {
        try {
          storage.removeItem(browserRecoveryJournalKey);
        } catch {
          // Storage may be unavailable in privacy modes.
        }
        return null;
      }
    },
    write(snapshot) {
      if (!snapshot.project || snapshot.dirty === false) {
        return;
      }
      storage.setItem(
        browserRecoveryJournalKey,
        JSON.stringify({
          format: 1,
          project: snapshot.project,
          expectedVersion: snapshot.expectedVersion,
        } satisfies AutosaveRecoveryRecord),
      );
    },
    clear() {
      storage.removeItem(browserRecoveryJournalKey);
    },
  };
}

export function createProjectRecoveryLifecycle(
  journal: AutosaveRecoveryJournal | null,
): ProjectRecoveryLifecycle {
  let initialized = false;
  let initializationFailed = false;
  let protectedSnapshots = 0;

  const checkpoint = (snapshot: ProjectRecoverySnapshot) => {
    if (!journal || !snapshot.project || snapshot.dirty === false) {
      return !journal || snapshot.dirty === false;
    }
    try {
      journal.write(snapshot);
      return true;
    } catch {
      return false;
    }
  };

  return {
    checkpoint,
    protectSnapshot(snapshot) {
      if (!checkpoint(snapshot)) {
        return false;
      }
      protectedSnapshots += 1;
      return true;
    },
    releaseSnapshotProtection() {
      protectedSnapshots = Math.max(0, protectedSnapshots - 1);
    },
    completeInitialization() {
      initialized = true;
    },
    markInitializationFailed() {
      initialized = true;
      initializationFailed = true;
    },
    clearIfReady() {
      if (
        !journal ||
        !initialized ||
        initializationFailed ||
        protectedSnapshots > 0
      ) {
        return;
      }
      try {
        journal.clear();
      } catch {
        // A durable Project remains authoritative if stale recovery cannot clear.
      }
    },
  };
}

export async function restoreAutosaveRecoveryJournal(
  io: Pick<
    ProjectIoService,
    "initialize" | "getWorkspace" | "saveWorkspace" | "createWorkspace"
  >,
  journal: AutosaveRecoveryJournal,
): Promise<boolean> {
  await io.initialize();
  const snapshot = journal.read();
  if (!snapshot?.project) {
    return false;
  }

  const currentProject = await io.getWorkspace();
  if (currentProject?.project_id === snapshot.project.project_id) {
    try {
      await io.saveWorkspace(snapshot.project, snapshot.expectedVersion);
      journal.clear();
      return true;
    } catch (error) {
      if (!isProjectIoConflict(error)) {
        throw error;
      }
    }
  }

  const recoveredProject = {
    ...snapshot.project,
    project_id: `${snapshot.project.project_id}-recovered-${crypto.randomUUID()}`,
    display_name: `${snapshot.project.display_name} (Recovered)`,
  };
  await io.createWorkspace({ project: recoveredProject });
  journal.clear();
  return true;
}

export function installBrowserProjectUnloadHandler(
  target: BrowserUnloadTarget,
  options: {
    prepareClose?(): void;
    checkpoint(): boolean;
  },
): () => void {
  const checkpoint = () => {
    options.prepareClose?.();
    options.checkpoint();
  };
  const checkpointBeforeUnload = (event: Event) => {
    options.prepareClose?.();
    if (!options.checkpoint()) {
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = "";
    }
  };
  target.addEventListener("beforeunload", checkpointBeforeUnload);
  target.addEventListener("pagehide", checkpoint);
  return () => {
    target.removeEventListener("beforeunload", checkpointBeforeUnload);
    target.removeEventListener("pagehide", checkpoint);
  };
}

export function installDurableProjectCloseHandler(
  target: DurableCloseTarget,
  options: DurableProjectCloseOptions,
): Promise<() => void> {
  let closing = false;
  return target.onCloseRequested(async (event) => {
    event.preventDefault();
    if (closing) {
      return;
    }
    closing = true;
    try {
      options.prepareClose?.();
      await withTimeout(
        Promise.all([drainProject(options), options.flushUserData()]),
        options.timeoutMs ?? 5_000,
      );
      const state = options.getProjectState();
      if (state.blocked || state.dirty || state.activeSave) {
        throw new Error("Project persistence is not safe to close");
      }
      await target.destroy();
    } catch {
      closing = false;
    }
  });
}

async function drainProject(
  options: DurableProjectCloseOptions,
): Promise<void> {
  while (true) {
    const state = options.getProjectState();
    if (state.blocked) {
      throw new Error("Project persistence is blocked");
    }
    if (!state.dirty && !state.activeSave) {
      return;
    }
    await options.flushProject();
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Close-time persistence timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

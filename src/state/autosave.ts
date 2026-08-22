import type { Project } from "../core/model/project";
import type { ProjectIoService, WriteResult } from "../platform/projectIo";
import type { ProjectStore } from "./projectStore";

export type AutosaveStatus = "idle" | "pending" | "saving" | "error";

export interface AutosaveSnapshot {
  project: Project | null;
  expectedVersion?: string;
  dirty?: boolean;
}

export interface AutosaveScheduler<TimerHandle = unknown> {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface AutosaveCoordinatorOptions<TimerHandle = unknown> {
  io: Pick<ProjectIoService, "saveWorkspace">;
  getSnapshot: () => AutosaveSnapshot;
  delayMs?: number;
  scheduler?: AutosaveScheduler<TimerHandle>;
  onStatusChange?: (status: AutosaveStatus) => void;
  onSaved?: (result: WriteResult) => void;
  onError?: (error: unknown) => void;
  shouldDefer?: () => boolean;
  recoveryJournal?: AutosaveRecoveryJournal;
}

export interface AutosaveCoordinator {
  readonly status: AutosaveStatus;
  readonly pending: boolean;
  schedule(): void;
  checkpoint(): boolean;
  clearCheckpoint(): void;
  flush(): Promise<WriteResult | null>;
  cancel(): void;
}

export interface AutosaveRecoveryJournal {
  read(): AutosaveSnapshot | null;
  write(snapshot: AutosaveSnapshot): void;
  clear(): void;
}

export interface DurableCloseTarget {
  onCloseRequested(
    handler: (event: { preventDefault(): void }) => void | Promise<void>,
  ): Promise<() => void>;
  destroy(): Promise<void>;
}

interface AutosaveRecoveryRecord {
  format: 1;
  project: Project;
  expectedVersion?: string;
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
          // Storage may be unavailable in privacy modes; there is nothing to read.
        }
        return null;
      }
    },
    write(snapshot) {
      if (!snapshot.project || snapshot.dirty === false) {
        return;
      }
      const record: AutosaveRecoveryRecord = {
        format: 1,
        project: snapshot.project,
        expectedVersion: snapshot.expectedVersion,
      };
      storage.setItem(browserRecoveryJournalKey, JSON.stringify(record));
    },
    clear() {
      storage.removeItem(browserRecoveryJournalKey);
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
      if (!isSaveConflict(error)) {
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

function isSaveConflict(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "StorageConflictError") ||
    String(error).includes("storage-conflict")
  );
}

export function installDurableAutosaveCloseHandler(
  target: DurableCloseTarget,
  coordinator: AutosaveCoordinator,
  flushTimeoutMs = 5_000,
): Promise<() => void> {
  let closing = false;
  return target.onCloseRequested(async (event) => {
    event.preventDefault();
    if (closing) {
      return;
    }
    closing = true;
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          coordinator.flush(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Close-time autosave timed out")),
              flushTimeoutMs,
            );
          }),
        ]);
        if (result === null && coordinator.status === "pending") {
          throw new Error("Close-time autosave is temporarily blocked");
        }
      } finally {
        clearTimeout(timeout);
      }
      await target.destroy();
    } catch {
      closing = false;
    }
  });
}

export function createAutosaveCoordinator<
  TimerHandle = ReturnType<typeof setTimeout>,
>(options: AutosaveCoordinatorOptions<TimerHandle>): AutosaveCoordinator {
  const delayMs = options.delayMs ?? 750;
  const scheduler = options.scheduler ?? defaultScheduler<TimerHandle>();
  let timer: TimerHandle | null = null;
  let status: AutosaveStatus = "idle";
  let checkpointGeneration = 0;

  const setStatus = (nextStatus: AutosaveStatus) => {
    status = nextStatus;
    options.onStatusChange?.(nextStatus);
  };

  const checkpoint = () => {
    const snapshot = options.getSnapshot();
    if (!snapshot.project || snapshot.dirty === false) {
      return false;
    }

    checkpointGeneration += 1;
    try {
      options.recoveryJournal?.write(snapshot);
      return true;
    } catch (error) {
      options.onError?.(error);
      return false;
    }
  };

  return {
    get status() {
      return status;
    },
    get pending() {
      return timer !== null;
    },
    schedule() {
      if (timer !== null) {
        scheduler.clearTimeout(timer);
      }

      setStatus("pending");
      checkpoint();
      timer = scheduler.setTimeout(() => {
        // Fire-and-forget: flush() rejects on save failure (including conflicts),
        // but the error is already surfaced via onError. Swallow it here so the
        // timer callback doesn't produce an unhandled promise rejection.
        void this.flush().catch(() => {});
      }, delayMs);
    },
    checkpoint,
    clearCheckpoint() {
      try {
        options.recoveryJournal?.clear();
      } catch {
        // A missing or unavailable browser journal needs no further cleanup.
      }
    },
    async flush() {
      if (timer !== null) {
        scheduler.clearTimeout(timer);
        timer = null;
      }

      if (options.shouldDefer?.()) {
        setStatus("pending");
        return null;
      }

      const snapshot = options.getSnapshot();
      if (!snapshot.project || snapshot.dirty === false) {
        setStatus("idle");
        return null;
      }

      checkpoint();
      const savingGeneration = checkpointGeneration;
      setStatus("saving");

      try {
        const result = await options.io.saveWorkspace(
          snapshot.project,
          snapshot.expectedVersion,
        );
        setStatus("idle");
        if (savingGeneration === checkpointGeneration) {
          try {
            options.recoveryJournal?.clear();
          } catch {
            // The durable save succeeded. A stale recovery copy is harmless.
          }
        }
        options.onSaved?.(result);
        return result;
      } catch (error) {
        setStatus("error");
        options.onError?.(error);
        throw error;
      }
    },
    cancel() {
      if (timer !== null) {
        scheduler.clearTimeout(timer);
        timer = null;
      }

      setStatus("idle");
    },
  };
}

export function createProjectAutosaveCoordinator(
  projectStore: ProjectStore,
  options: Omit<
    AutosaveCoordinatorOptions,
    "io" | "getSnapshot" | "onError"
  > = {},
): AutosaveCoordinator {
  return createAutosaveCoordinator({
    ...options,
    io: {
      async saveWorkspace() {
        const result = await projectStore.getState().saveWorkspace();
        if (!result) {
          throw new Error("No dirty Project is open");
        }
        return result;
      },
    },
    getSnapshot: () => {
      const state = projectStore.getState();
      return {
        project: state.project,
        expectedVersion: state.version,
        dirty: state.dirty,
      };
    },
  });
}

function defaultScheduler<TimerHandle>(): AutosaveScheduler<TimerHandle> {
  return {
    setTimeout(callback, delayMs) {
      return globalThis.setTimeout(callback, delayMs) as TimerHandle;
    },
    clearTimeout(handle) {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}

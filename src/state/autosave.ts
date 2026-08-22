import type { Project } from "../core/model/project";
import type { WriteResult } from "../platform/projectIo";
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
  io: {
    saveWorkspace(
      project: Project,
      expectedVersion?: string,
    ): Promise<WriteResult>;
  };
  getSnapshot: () => AutosaveSnapshot;
  delayMs?: number;
  scheduler?: AutosaveScheduler<TimerHandle>;
  onStatusChange?: (status: AutosaveStatus) => void;
  onSaved?: (result: WriteResult) => void;
  onError?: (error: unknown) => void;
  shouldDefer?: () => boolean;
  onCheckpoint?: (snapshot: AutosaveSnapshot) => void;
}

export interface AutosaveCoordinator {
  readonly status: AutosaveStatus;
  readonly pending: boolean;
  schedule(): void;
  checkpoint(): boolean;
  flush(): Promise<WriteResult | null>;
  cancel(): void;
}

export function createAutosaveCoordinator<
  TimerHandle = ReturnType<typeof setTimeout>,
>(options: AutosaveCoordinatorOptions<TimerHandle>): AutosaveCoordinator {
  const delayMs = options.delayMs ?? 750;
  const scheduler = options.scheduler ?? defaultScheduler<TimerHandle>();
  let timer: TimerHandle | null = null;
  let status: AutosaveStatus = "idle";

  const setStatus = (nextStatus: AutosaveStatus) => {
    status = nextStatus;
    options.onStatusChange?.(nextStatus);
  };

  const checkpoint = () => {
    const snapshot = options.getSnapshot();
    if (!snapshot.project || snapshot.dirty === false) {
      return false;
    }

    try {
      options.onCheckpoint?.(snapshot);
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
      setStatus("saving");

      try {
        const result = await options.io.saveWorkspace(
          snapshot.project,
          snapshot.expectedVersion,
        );
        setStatus("idle");
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

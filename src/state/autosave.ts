import type { ProjectWorkspaceDocument } from "../core/io/projectSchema";
import type { ProjectIoService } from "../platform/projectIo";
import type { WriteResult } from "../storage/adapter";
import type { ProjectStore } from "./projectStore";

export type AutosaveStatus = "idle" | "pending" | "saving" | "error";

export interface AutosaveSnapshot {
  workspace: ProjectWorkspaceDocument | null;
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
}

export interface AutosaveCoordinator {
  readonly status: AutosaveStatus;
  readonly pending: boolean;
  schedule(): void;
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
      timer = scheduler.setTimeout(() => {
        // Fire-and-forget: flush() rejects on save failure (including conflicts),
        // but the error is already surfaced via onError. Swallow it here so the
        // timer callback doesn't produce an unhandled promise rejection.
        void this.flush().catch(() => {});
      }, delayMs);
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
      if (!snapshot.workspace || snapshot.dirty === false) {
        setStatus("idle");
        return null;
      }

      setStatus("saving");

      try {
        const result = await options.io.saveWorkspace(
          snapshot.workspace,
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
  io: ProjectIoService,
  options: Omit<
    AutosaveCoordinatorOptions,
    "io" | "getSnapshot" | "onSaved" | "onError"
  > = {},
): AutosaveCoordinator {
  return createAutosaveCoordinator({
    ...options,
    io,
    getSnapshot: () => {
      const state = projectStore.getState();
      return {
        workspace: state.workspace,
        expectedVersion: state.version,
        dirty: state.dirty,
      };
    },
    onSaved: (result) => projectStore.getState().markSaved(result),
    onError: (error) => projectStore.getState().markSaveError(error),
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

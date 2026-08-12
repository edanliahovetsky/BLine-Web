import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  JointAutoConstraintSolveStats,
  JointAutoConstraintSolveStatus,
} from "../core/constraints/autoVelocityConstraints";

/**
 * `pending` covers the quiet period after an edit, before the solve starts.
 * `running` means the optimizer is actually working. Both read as "busy" to
 * the user, but only `running` costs CPU.
 */
export type AutoVelocityPhase = "idle" | "pending" | "running";
export type AutoVelocityRunSource = "manual" | "sync";

export interface AutoVelocityRunSummary {
  elapsedMs: number;
  inputSignature: string | null;
  projectId: string;
  stats: JointAutoConstraintSolveStats;
  status: JointAutoConstraintSolveStatus;
}

export interface AutoVelocityState {
  phase: AutoVelocityPhase;
  runSource: AutoVelocityRunSource | null;
  /** False once the user turns off keeping generated constraints in sync. */
  autoSyncEnabled: boolean;
  lastError: string | null;
  lastRun: AutoVelocityRunSummary | null;
  setPhase(
    phase: AutoVelocityPhase,
    source?: AutoVelocityRunSource | null,
  ): void;
  setAutoSyncEnabled(enabled: boolean): void;
  setLastError(message: string | null): void;
  setLastRun(run: AutoVelocityRunSummary | null): void;
  reset(): void;
}

export type AutoVelocityStore = StoreApi<AutoVelocityState>;

const autoSyncStorageKey = "bline.autoVelocity.autoSync";

export function createAutoVelocityStore(): AutoVelocityStore {
  // Subscribers drive the sync loop, so a write that changes nothing must not
  // notify: an idempotent setPhase would otherwise reschedule the debounce
  // that is trying to fire.
  return createStore<AutoVelocityState>((set, get) => ({
    phase: "idle",
    runSource: null,
    autoSyncEnabled: readStoredAutoSync(),
    lastError: null,
    lastRun: null,
    setPhase(phase, source = null) {
      const runSource = phase === "idle" ? null : source;
      if (get().phase !== phase || get().runSource !== runSource) {
        set({ phase, runSource });
      }
    },
    setAutoSyncEnabled(enabled) {
      if (get().autoSyncEnabled === enabled) {
        return;
      }
      writeStoredAutoSync(enabled);
      set({ autoSyncEnabled: enabled });
    },
    setLastError(message) {
      if (get().lastError !== message) {
        set({ lastError: message });
      }
    },
    setLastRun(run) {
      set({ lastRun: run });
    },
    reset() {
      if (
        get().phase !== "idle" ||
        get().runSource !== null ||
        get().lastError !== null ||
        get().lastRun !== null
      ) {
        set({
          phase: "idle",
          runSource: null,
          lastError: null,
          lastRun: null,
        });
      }
    },
  }));
}

export function autoVelocityIsBusy(state: AutoVelocityState): boolean {
  return state.phase !== "idle";
}

function readStoredAutoSync(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.localStorage.getItem(autoSyncStorageKey) !== "off";
  } catch {
    return true;
  }
}

function writeStoredAutoSync(enabled: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(autoSyncStorageKey, enabled ? "on" : "off");
  } catch {
    // A blocked storage quota should not stop the toggle from working.
  }
}

export const autoVelocityStore = createAutoVelocityStore();

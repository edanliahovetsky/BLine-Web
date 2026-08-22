import { createStore, type StoreApi } from "zustand/vanilla";
import { rememberAutomaticGenerationKeepInSync } from "../userData";

/**
 * `pending` covers the quiet period after an edit, before the solve starts.
 * `running` means the optimizer is actually working. Both read as "busy" to
 * the user, but only `running` costs CPU.
 */
export type AutoVelocityPhase = "idle" | "pending" | "running";
export type AutoVelocityRunSource = "manual" | "sync";

export interface AutoVelocityState {
  phase: AutoVelocityPhase;
  runSource: AutoVelocityRunSource | null;
  /** False once the user turns off keeping generated constraints in sync. */
  autoSyncEnabled: boolean;
  lastError: string | null;
  setPhase(
    phase: AutoVelocityPhase,
    source?: AutoVelocityRunSource | null,
  ): void;
  setAutoSyncEnabled(enabled: boolean): void;
  setLastError(message: string | null): void;
  reset(): void;
}

export type AutoVelocityStore = StoreApi<AutoVelocityState>;

export interface AutoVelocityStoreOptions {
  initialAutoSyncEnabled?: boolean;
  onAutoSyncChange?(enabled: boolean): void;
}

export function createAutoVelocityStore(
  options: AutoVelocityStoreOptions = {},
): AutoVelocityStore {
  // Subscribers drive the sync loop, so a write that changes nothing must not
  // notify: an idempotent setPhase would otherwise reschedule the debounce
  // that is trying to fire.
  return createStore<AutoVelocityState>((set, get) => ({
    phase: "idle",
    runSource: null,
    autoSyncEnabled: options.initialAutoSyncEnabled ?? true,
    lastError: null,
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
      options.onAutoSyncChange?.(enabled);
      set({ autoSyncEnabled: enabled });
    },
    setLastError(message) {
      if (get().lastError !== message) {
        set({ lastError: message });
      }
    },
    reset() {
      if (
        get().phase !== "idle" ||
        get().runSource !== null ||
        get().lastError !== null
      ) {
        set({
          phase: "idle",
          runSource: null,
          lastError: null,
        });
      }
    },
  }));
}

export function autoVelocityIsBusy(state: AutoVelocityState): boolean {
  return state.phase !== "idle";
}

export const autoVelocityStore = createAutoVelocityStore({
  onAutoSyncChange: rememberAutomaticGenerationKeepInSync,
});

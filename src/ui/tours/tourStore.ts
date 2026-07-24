import { createStore, type StoreApi } from "zustand/vanilla";

export type TourPlacement = "above" | "below" | "left" | "right";

export interface TourStep {
  /**
   * Value of the `data-tour` attribute this step points at. Steps without a
   * target are concept cards: they explain an idea over the dimmed editor
   * instead of spotlighting a control.
   */
  target?: string;
  title: string;
  body: string;
  /** Keys worth showing as caps beneath the body. */
  keys?: readonly string[];
  placement?: TourPlacement;
  /**
   * Optional state the editor must be in before the step runs, so a tour never
   * points at something that is collapsed or on another inspector tab.
   */
  prepare?: TourStepPreparation;
  /**
   * When present the step advances on its own as soon as this returns true,
   * letting the user learn by doing instead of reading.
   */
  completeWhen?(): boolean;
}

export interface TourStepPreparation {
  inspector?: "open";
}

export interface TourDefinition {
  id: string;
  title: string;
  summary: string;
  steps: readonly TourStep[];
}

export interface TourState {
  activeTourId: string | null;
  stepIndex: number;
  completedTourIds: readonly string[];
  start(tourId: string): void;
  goTo(stepIndex: number): void;
  next(stepCount: number): void;
  back(): void;
  finish(): void;
  exit(): void;
}

const storageKey = "bline-web:tours:v1";

export function readCompletedTourIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function writeCompletedTourIds(ids: readonly string[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...ids]));
  } catch {
    // Tour history is a convenience; the editor works without it.
  }
}

export function createTourStore(): StoreApi<TourState> {
  return createStore<TourState>((set, get) => ({
    activeTourId: null,
    stepIndex: 0,
    completedTourIds: readCompletedTourIds(),
    start(tourId) {
      set({ activeTourId: tourId, stepIndex: 0 });
    },
    goTo(stepIndex) {
      set({ stepIndex: Math.max(0, stepIndex) });
    },
    next(stepCount) {
      const { stepIndex } = get();
      if (stepIndex >= stepCount - 1) {
        get().finish();
        return;
      }
      set({ stepIndex: stepIndex + 1 });
    },
    back() {
      set({ stepIndex: Math.max(0, get().stepIndex - 1) });
    },
    finish() {
      const { activeTourId, completedTourIds } = get();
      if (activeTourId && !completedTourIds.includes(activeTourId)) {
        const nextCompleted = [...completedTourIds, activeTourId];
        writeCompletedTourIds(nextCompleted);
        set({ completedTourIds: nextCompleted });
      }
      set({ activeTourId: null, stepIndex: 0 });
    },
    exit() {
      set({ activeTourId: null, stepIndex: 0 });
    },
  }));
}

export const tourStore = createTourStore();

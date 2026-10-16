import { createStore, type StoreApi } from "zustand/vanilla";
import type { PathModel } from "../../core/model/path";
import type {
  ProjectConfig,
  ProjectPath,
  ProjectPathGroup,
  LinkedTarget,
} from "../../core/model/project";
import { rememberCompletedTourIds } from "../../userData";
import { readLessonResume, rememberLessonResume } from "./lessonResume";

export interface TourMarker {
  id: string;
  label: string;
  kind: "zone" | "structure" | "game-piece" | "callout" | "pose";
  xMeters: number;
  yMeters: number;
  widthMeters?: number;
  heightMeters?: number;
  rotationDegrees?: number;
}

export interface TourFeedback {
  complete: boolean;
  message: string;
  /** Live results for a step's named sub-checks, in checklist order. */
  items?: readonly TourCheckResult[];
}
export interface TourCheckResult {
  label: string;
  complete: boolean;
  /** What to fix, shown under an unmet requirement. */
  hint: string;
}
/** One named requirement of a step that asks for several things. */
export interface TourSubCheck {
  label: string;
  /**
   * Leave the waiting message empty: the label already says what to do. Use
   * the message for a near miss, such as the wrong cell or a case typo.
   */
  check(): TourFeedback;
  /** Where "Show me" points while this is the first unmet requirement. */
  showMe?: TourShowMe;
}
/** One place "Show me" can point at. */
export interface TourPointer {
  /** A `data-tour` id, or a lesson cue such as `lesson-segment`. */
  target: string;
  /** A second place to outline, such as the stretch of path a cell covers. */
  echo?: string;
  /** True once this stop is no longer needed, such as a tool already chosen. */
  done?(): boolean;
}
/**
 * Stops in the order the learner reaches them. Show me points at the first
 * stop that is not done, so it always shows the next action.
 */
export type TourShowMe = readonly (string | TourPointer)[];
export type TourAction =
  | "play"
  | "finishRun"
  | "scrub"
  | "replay"
  | "inspectConfig"
  | "inspectProject"
  | "inspectPath"
  | "export"
  | "import"
  | "exportFolder"
  | "importFolder"
  | "keepCopy";
/** A failed lesson file transfer, shown in the lesson card for its own step. */
export interface TourTransferError {
  attemptId: number;
  stepIndex: number;
  message: string;
}
export interface TourStep {
  /** Optional scenario cues for a new exercise within this lesson. */
  markers?: readonly TourMarker[];
  canvasLesson?:
    | "handoff-approach"
    | "handoff-crossing"
    | "handoff-departure"
    | "low-acceleration";
  /** Keep the fixed tuning exercise's positions, headings and ordering intact. */
  lockGeometry?: true;
  /** Explicit Generate remains available while background generation is paused. */
  autoGenerate?: false;
  /**
   * Value of the `data-tour` attribute this step points at. Steps without a
   * target are concept cards: they explain an idea over the dimmed editor
   * instead of spotlighting a control.
   */
  target?: string;
  title: string;
  /**
   * At most about 35 words, and none for a task the headline already says.
   * Wrap event keys in backticks to render them as insertable key chips.
   */
  body?: string;
  /** Background detail kept behind the card's "Why?" toggle. */
  why?: string;
  /** Keep Settings open with edits applied to the isolated practice project. */
  settingsSection?:
    | "robot"
    | "path-defaults"
    | "field"
    | "optimizer"
    | "event-triggers";
  /** Start on another section when the learner must navigate to this one. */
  settingsNavigateFrom?: TourStep["settingsSection"];
  /** Optional further reading shown inside the lesson card. */
  resource?: { label: string; href: string };
  phase?: "Build" | "Observe" | "Experiment" | "Challenge" | "Review";
  /** Visible context is independent of the controls permitted for interaction. */
  visible?: readonly string[];
  check?(): TourFeedback;
  /** Requirements shown as a live checklist; all must pass, along with `check`. */
  checks?: readonly TourSubCheck[];
  /**
   * The card's headline: what the learner does now. Steps without a task are
   * read-only and lead with their title instead.
   */
  task?: string;
  /**
   * Where "Show me" points. Steps with a checklist can give each requirement
   * its own stops instead. A list of plain ids with no stop conditions is an
   * older tour of the area that pulses each id in turn. `lesson-segment` and
   * `lesson-element` are the canvas cues named by `segment` and `element`.
   */
  showMe?: TourShowMe;
  /** Keys worth showing as key caps on the card. */
  keys?: readonly string[];
  /** Element indexes bounding the path segment `lesson-segment` outlines. */
  segment?(path: PathModel): readonly [number, number] | null;
  /** The path element `lesson-element` outlines on the canvas. */
  element?(path: PathModel): number | null;
  /**
   * `data-tour` ids the user may interact with during this step. Everything
   * else is shielded so a stray click cannot derail the lesson. Steps without
   * a list only allow the tour card itself.
   */
  interact?: readonly string[];
  /**
   * Optional state the editor must be in before the step runs, so a tour never
   * points at something that is collapsed or on another inspector tab.
   */
  prepare?: TourStepPreparation;
  /**
   * Stop editor interaction after the required action completes. Use this for
   * one-shot actions such as placing exactly one path element.
   */
  lockInteractionOnComplete?: true;
}

export interface TourStepPreparation {
  practicePath?(): PathModel;
  autoPlay?: boolean;
  closeMenus?: true;
  inspector?: "open" | "closed";
  inspectorTab?: "elements" | "constraints";
  /** Reset to the Select tool, e.g. right after a placement step. */
  tool?: "select";
  /** Clear an existing selection before asking the learner to choose one. */
  clearSelection?: true;
  /**
   * Select the path element at this index first. Canvas placement inserts
   * after the selection, so a bend step selects the first waypoint to make
   * the new element land between the existing ones.
   */
  selectElement?: number | ((path: PathModel) => number | null);
  /** Select the speed cell containing this approach without relying on its array index. */
  selectSpeed?: number;
  /** Move the simulated robot before the step begins. */
  simulation?: "start" | "end";
  /** Close Path Health after its open-state action has been completed. */
  pathHealth?: "closed";
  navigator?: "open" | "closed";
  showGhostPaths?: boolean;
  /** Fit the whole path in view once the step's layout settles. */
  view?: "frame-path";
}

export interface TourDefinition {
  id: string;
  title: string;
  summary: string;
  durationMinutes: number;
  /** Two or three short lines shown when the lesson is finished. */
  recap: readonly string[];
  /** Lib Keys registered in the practice project so lessons never ask for unknown keys. */
  eventKeys?: readonly string[];
  /** Scenario cues drawn over the practice field for this lesson only. */
  markers?: readonly TourMarker[];
  /**
   * The geometry this lesson starts from. The practice path is recreated
   * from this seed on every start so each lesson opens in the state its
   * steps assume — a straight line to bend, a sharp corner to constrain.
   */
  practicePath(): PathModel;
  /** Multiple practice paths for lessons about project organization. */
  practicePaths?(): ProjectPath[];
  practiceGroups?(): ProjectPathGroup[];
  practiceLinkedTargets?(): LinkedTarget[];
  practiceConfig?(): ProjectConfig;
  steps: readonly TourStep[];
}

/** Where a learner left a lesson, so reopening it can offer to resume. */
export interface TourResumePoint {
  tourId: string;
  stepIndex: number;
  furthestStepIndex: number;
  actions: Partial<Record<TourAction, number>>;
}

export interface TourState {
  activeTourId: string | null;
  stepIndex: number;
  attemptId: number;
  furthestStepIndex: number;
  completedStepIndexes: readonly number[];
  actions: Partial<Record<TourAction, number>>;
  transferError: TourTransferError | null;
  completedTourIds: readonly string[];
  /** The lesson most recently left before its end. */
  suspended: TourResumePoint | null;
  /** The lesson just finished, shown as a recap until dismissed. */
  finishedTourId: string | null;
  start(tourId: string, resume?: TourResumePoint): void;
  goTo(stepIndex: number): void;
  next(stepCount: number): void;
  back(): void;
  setStepComplete(index: number, complete: boolean): void;
  restartAt(index: number): void;
  recordAction(action: TourAction): void;
  reportTransferError(message: string | null): void;
  hydrateCompleted(ids: readonly string[]): void;
  finish(): void;
  /** Leave the lesson, keeping the step reached for a later resume. */
  exit(): void;
  dismissRecap(): void;
  forgetSuspended(): void;
}

export interface TourStoreOptions {
  completedTourIds?: readonly string[];
  suspended?: TourResumePoint | null;
  onCompletedChange?(ids: readonly string[]): void;
}

export function createTourStore(
  options: TourStoreOptions = {},
): StoreApi<TourState> {
  return createStore<TourState>((set, get) => ({
    activeTourId: null,
    stepIndex: 0,
    attemptId: 0,
    furthestStepIndex: 0,
    completedStepIndexes: [],
    actions: {},
    transferError: null,
    completedTourIds: [...new Set(options.completedTourIds ?? [])],
    suspended: options.suspended ?? null,
    finishedTourId: null,
    start(tourId, resume) {
      const resumed = resume?.tourId === tourId ? resume : null;
      set({
        activeTourId: tourId,
        stepIndex: resumed?.stepIndex ?? 0,
        furthestStepIndex: resumed?.furthestStepIndex ?? 0,
        completedStepIndexes: resumed
          ? Array.from({ length: resumed.stepIndex }, (_, index) => index)
          : [],
        actions: { ...resumed?.actions },
        attemptId: get().attemptId + 1,
        suspended: null,
        finishedTourId: null,
      });
    },
    goTo(stepIndex) {
      set({
        stepIndex: Math.max(0, Math.min(stepIndex, get().furthestStepIndex)),
      });
    },
    next(stepCount) {
      const { stepIndex } = get();
      if (stepIndex >= stepCount - 1) {
        get().finish();
        return;
      }
      set({
        stepIndex: stepIndex + 1,
        furthestStepIndex: Math.max(get().furthestStepIndex, stepIndex + 1),
      });
    },
    back() {
      set({ stepIndex: Math.max(0, get().stepIndex - 1) });
    },
    setStepComplete(index, complete) {
      const completed = get().completedStepIndexes;
      if (completed.includes(index) === complete) return;
      set({
        completedStepIndexes: complete
          ? [...completed, index]
          : completed.filter((candidate) => candidate !== index),
      });
    },
    restartAt(index) {
      set({
        stepIndex: index,
        furthestStepIndex: index,
        completedStepIndexes: get().completedStepIndexes.filter(
          (candidate) => candidate < index,
        ),
        attemptId: get().attemptId + 1,
        ...(index === 0 ? { actions: {} } : {}),
      });
    },
    recordAction(action) {
      if (!get().activeTourId) return;
      set({
        actions: {
          ...get().actions,
          [action]: (get().actions[action] ?? 0) + 1,
        },
      });
    },
    reportTransferError(message) {
      const { activeTourId, attemptId, stepIndex } = get();
      if (!activeTourId) return;
      set({
        transferError:
          message === null ? null : { attemptId, stepIndex, message },
      });
    },
    hydrateCompleted(ids) {
      set({ completedTourIds: [...new Set(ids)] });
    },
    finish() {
      const { activeTourId, completedTourIds } = get();
      if (activeTourId && !completedTourIds.includes(activeTourId)) {
        const nextCompleted = [...completedTourIds, activeTourId];
        options.onCompletedChange?.(nextCompleted);
        set({ completedTourIds: nextCompleted });
      }
      set({
        activeTourId: null,
        stepIndex: 0,
        finishedTourId: activeTourId,
        suspended:
          get().suspended?.tourId === activeTourId ? null : get().suspended,
      });
    },
    exit() {
      const { activeTourId, stepIndex, furthestStepIndex, actions } = get();
      set({
        activeTourId: null,
        stepIndex: 0,
        suspended:
          activeTourId && furthestStepIndex > 0
            ? { tourId: activeTourId, stepIndex, furthestStepIndex, actions }
            : get().suspended,
      });
    },
    dismissRecap() {
      set({ finishedTourId: null });
    },
    forgetSuspended() {
      set({ suspended: null });
    },
  }));
}

export const tourStore = createTourStore({
  onCompletedChange: rememberCompletedTourIds,
  suspended: readLessonResume()?.point ?? null,
});
// The session controller saves a resume point with its practice project; a
// finished or discarded lesson forgets it here.
tourStore.subscribe((state, previous) => {
  if (previous.suspended && !state.suspended) rememberLessonResume(null);
});

import { createStore, type StoreApi } from "zustand/vanilla";
import type { PathElement, PathModel } from "../../core/model/path";
import type {
  ProjectConfig,
  ProjectPath,
  ProjectPathGroup,
  LinkedTarget,
} from "../../core/model/project";
import { rememberCompletedTourIds } from "../../userData";

export type TourPlacement = "above" | "below" | "left" | "right";

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

export type TourExperiment = "handoff" | "speed" | "heading" | "events";
export interface TourFeedback {
  complete: boolean;
  message: string;
}
export type TourAction =
  | "play"
  | "finishRun"
  | "scrub"
  | "reference"
  | "replay"
  | "inspectConfig"
  | "inspectProject"
  | "inspectPath"
  | "export"
  | "import"
  | "exportFolder"
  | "importFolder"
  | "keepCopy";
export interface TourReference {
  path: PathModel;
  config: ProjectConfig;
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
  body: string;
  describe?(): string;
  /** Open this settings section as a read-only walkthrough with preset values. */
  settingsSection?: "robot" | "path-defaults" | "field" | "optimizer";
  /** Optional further reading shown inside the lesson card. */
  resource?: { label: string; href: string };
  phase?: "Build" | "Observe" | "Experiment" | "Challenge" | "Review";
  /** Visible context is independent of the controls permitted for interaction. */
  visible?: readonly string[];
  hints?: readonly string[];
  hintTargets?: readonly string[];
  demo?: TourExperiment;
  experiment?: TourExperiment;
  /** Preserve this step's entry state for a comparison after the learner edits. */
  captureReference?: true;
  handoff?: true;
  check?(): TourFeedback;
  /** Conditions that must remain true even on an observation or review step. */
  validate?(): TourFeedback;
  /** Exact element counts only for guided exercises. Challenges may accept alternatives. */
  elements?: Partial<Record<PathElement["type"], number>>;
  /** Short action shown as a task when the step waits for editor input. */
  task?: string;
  /** Keys worth showing as caps beneath the body. */
  keys?: readonly string[];
  placement?: TourPlacement;
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
   * When present the step waits for real editor state, then unlocks Continue.
   */
  completeWhen?(): boolean;
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
}

export interface TourDefinition {
  id: string;
  title: string;
  summary: string;
  durationMinutes: number;
  completionMessage: string;
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

export interface TourState {
  activeTourId: string | null;
  stepIndex: number;
  attemptId: number;
  furthestStepIndex: number;
  completedStepIndexes: readonly number[];
  actions: Partial<Record<TourAction, number>>;
  reference: TourReference | null;
  completedTourIds: readonly string[];
  start(tourId: string): void;
  goTo(stepIndex: number): void;
  next(stepCount: number): void;
  back(): void;
  setStepComplete(index: number, complete: boolean): void;
  restartAt(index: number): void;
  recordAction(action: TourAction): void;
  captureReference(reference: TourReference): void;
  hydrateCompleted(ids: readonly string[]): void;
  finish(): void;
  exit(): void;
}

export interface TourStoreOptions {
  completedTourIds?: readonly string[];
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
    reference: null,
    completedTourIds: [...new Set(options.completedTourIds ?? [])],
    start(tourId) {
      set({
        activeTourId: tourId,
        stepIndex: 0,
        furthestStepIndex: 0,
        completedStepIndexes: [],
        actions: {},
        reference: null,
        attemptId: get().attemptId + 1,
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
        ...(index === 0 ? { reference: null, actions: {} } : {}),
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
    captureReference(reference) {
      if (!get().activeTourId) return;
      set({ reference: structuredClone(reference) });
      get().recordAction("reference");
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
      set({ activeTourId: null, stepIndex: 0, reference: null });
    },
    exit() {
      set({ activeTourId: null, stepIndex: 0, reference: null });
    },
  }));
}

export const tourStore = createTourStore({
  onCompletedChange: rememberCompletedTourIds,
});

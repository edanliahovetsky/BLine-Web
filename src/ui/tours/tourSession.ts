import type { StoreApi } from "zustand/vanilla";
import { activeProjectPath } from "../../core/model/editorNavigation";
import { createProject, type Project } from "../../core/model/project";
import type { HistoryStoreState } from "../../state/historyStore";
import type { ProjectStore, ProjectStoreState } from "../../state/projectStore";
import {
  legacyProjectMigrationOwnsSession,
  projectStore,
} from "../../state/projectStore";
import type {
  SelectionState,
  SelectionStore,
} from "../../state/selectionStore";
import { selectionStore } from "../../state/selectionStore";
import { findTour, tourPracticePathName } from "./tours";
import type { PathModel } from "../../core/model/path";
import { tourStore, type TourDefinition, type TourState } from "./tourStore";
import { readLessonResume, rememberLessonResume } from "./lessonResume";
import type { ProjectConfig } from "../../core/model/project";
import { createProjectConfig } from "../../core/config/projectConfig";

interface ActiveTourSession<View> {
  project: ProjectStoreState;
  history: HistoryStoreState<Project>;
  selection: SelectionState;
  view: View;
}

export interface TourSessionControllerOptions<View> {
  captureView(): View;
  showPracticeView(projectId: string): void;
  restoreView(view: View): void;
  canStart?(): boolean;
  projects?: ProjectStore;
  selections?: SelectionStore;
  tours?: StoreApi<TourState>;
  resolveTour?(tourId: string | null): TourDefinition | null;
  protectCapturedSession?(session: ProjectStoreState): boolean;
  releaseCapturedSession?(): void;
}

export interface TourSessionController {
  /** With `resume`, reopen the lesson where the learner last left it. */
  start(tourId: string, options?: { resume?: boolean }): boolean;
  restartStep(): void;
  restartLesson(): void;
  restore(): void;
  dispose(): void;
}

let nextTourSessionId = 1;

/**
 * Owns the temporary Project session used by guided Tours. The main Project
 * store stays unaware of a generalized "transient workspace" mode: the Tour
 * swaps in one isolated in-memory session, then restores the captured editor
 * state when the Tour store leaves its active state.
 */
/**
 * The practice path a step begins from: the nearest seed at or before it, or
 * the lesson's own. Lessons with several practice paths have no single one.
 * A seed only describes a later step when every step since it is read-only;
 * after a task step the learner's own work, which isn't known after resuming,
 * is the closer starting point, so keep the current path instead.
 */
function startingPathFor(
  definition: TourDefinition,
  stepIndex: number,
): (() => PathModel) | undefined {
  for (let index = stepIndex; index >= 0; index -= 1) {
    const step = definition.steps[index];
    if (index < stepIndex && step?.task) return undefined;
    const seed = step?.prepare?.practicePath;
    if (seed) return seed;
  }
  return definition.practicePaths ? undefined : definition.practicePath;
}

export function createTourSessionController<View>(
  options: TourSessionControllerOptions<View>,
): TourSessionController {
  const projects = options.projects ?? projectStore;
  const selections = options.selections ?? selectionStore;
  const tours = options.tours ?? tourStore;
  const resolveTour = options.resolveTour ?? findTour;
  let active: ActiveTourSession<View> | null = null;
  let unsubscribeProject: (() => void) | null = null;
  let unsubscribeTour: (() => void) | null = null;
  let restoringCheckpoint = false;
  const checkpoints = new Map<
    number,
    {
      project: Project;
      history: HistoryStoreState<Project>;
      selection: SelectionState;
      activePathId: string | null;
      activePathGroupId: string | null;
    }
  >();
  const visitedStates = new Map<
    number,
    NonNullable<ReturnType<typeof snapshot>>
  >();
  function snapshot() {
    const state = projects.getState();
    return state.project
      ? {
          project: structuredClone(state.project),
          history: { ...state.history.getState() },
          selection: { ...selections.getState() },
          activePathId: state.activePathId,
          activePathGroupId: state.activePathGroupId,
        }
      : null;
  }
  function loadSnapshot(saved: NonNullable<ReturnType<typeof snapshot>>) {
    projects.getState().history.setState(saved.history);
    projects.setState({
      project: structuredClone(saved.project),
      activePathId: saved.activePathId,
      activePathGroupId: saved.activePathGroupId,
      projectSessionId: createSessionId("practice"),
      revision: 0,
      activeSave: null,
      dirty: false,
      saveQueued: false,
    });
    selections.setState(saved.selection);
  }

  const captureCheckpoint = (index: number) => {
    const state = projects.getState();
    if (!state.project || checkpoints.has(index)) return;
    checkpoints.set(index, {
      project: structuredClone(state.project),
      history: { ...state.history.getState() },
      selection: { ...selections.getState() },
      activePathId: state.activePathId,
      activePathGroupId: state.activePathGroupId,
    });
  };

  const restoreCheckpoint = (index: number) => {
    const checkpoint = checkpoints.get(index);
    if (!active || !checkpoint) return;
    projects.getState().history.setState(checkpoint.history);
    projects.setState({
      project: structuredClone(checkpoint.project),
      activePathId: checkpoint.activePathId,
      activePathGroupId: checkpoint.activePathGroupId,
      projectSessionId: createSessionId("practice"),
      revision: 0,
      activeSave: null,
      dirty: false,
      saveQueued: false,
    });
    selections.setState(checkpoint.selection);
    for (const key of checkpoints.keys()) {
      if (key > index) checkpoints.delete(key);
    }
    for (const key of visitedStates.keys()) {
      if (key >= index) visitedStates.delete(key);
    }
    restoringCheckpoint = true;
    try {
      tours.getState().restartAt(index);
    } finally {
      restoringCheckpoint = false;
    }
  };

  const restoreSession = () => {
    const captured = active;
    if (!captured) {
      return;
    }

    active = null;
    checkpoints.clear();
    visitedStates.clear();
    unsubscribeProject?.();
    unsubscribeProject = null;
    unsubscribeTour?.();
    unsubscribeTour = null;

    captured.project.history.setState(captured.history);
    projects.setState({
      ...captured.project,
      projectSessionId: captured.project.project
        ? createSessionId("restored")
        : null,
      activeSave: null,
    });
    selections.setState(captured.selection);
    selections
      .getState()
      .reconcilePath(
        activeProjectPath(
          captured.project.project,
          captured.project.activePathId,
        )?.path ?? null,
      );
    options.restoreView(captured.view);
    options.releaseCapturedSession?.();
  };

  return {
    start(tourId, { resume = false } = {}) {
      const definition = resolveTour(tourId);
      const state = projects.getState();
      if (
        active ||
        tours.getState().activeTourId ||
        !definition ||
        state.activeSave ||
        legacyProjectMigrationOwnsSession(state) ||
        state.status === "loading" ||
        state.status === "saving" ||
        state.status === "conflict" ||
        state.status === "damaged" ||
        options.canStart?.() === false
      ) {
        return false;
      }

      const historyState = state.history.getState();
      const selectionState = selections.getState();
      if (options.protectCapturedSession?.(state) === false) {
        return false;
      }
      const practiceSessionId = createSessionId("practice");
      const practiceProjectId =
        state.project?.project_id ?? `${practiceSessionId}-project`;
      const practicePaths = definition.practicePaths?.() ?? [
        {
          path_id: state.activePathId ?? `${practiceSessionId}-path`,
          display_name: tourPracticePathName,
          file_name: "tour-practice.json",
          path: definition.practicePath(),
        },
      ];
      const saved = resume ? readLessonResume() : null;
      const resumePoint =
        saved?.point.tourId === tourId &&
        saved.point.stepIndex < definition.steps.length
          ? saved.point
          : null;
      const resumeSnapshot = resumePoint ? saved?.snapshot : null;
      const practiceProject = resumeSnapshot
        ? structuredClone({
            ...resumeSnapshot.project,
            project_id: practiceProjectId,
          })
        : createProject({
            project_id: practiceProjectId,
            display_name: state.project?.display_name ?? tourPracticePathName,
            config: withLessonEventKeys(
              definition.practiceConfig?.() ?? state.project?.config,
              definition.eventKeys,
            ),
            paths: practicePaths,
            path_groups: definition.practiceGroups?.(),
            linked_targets: definition.practiceLinkedTargets?.(),
          });
      const practicePathId =
        resumeSnapshot?.activePathId &&
        practiceProject.paths.some(
          (path) => path.path_id === resumeSnapshot.activePathId,
        )
          ? resumeSnapshot.activePathId
          : practiceProject.paths[0].path_id;

      active = {
        project: state,
        history: historyState,
        selection: selectionState,
        view: options.captureView(),
      };

      state.history.setState({
        undoStack: [],
        redoStack: [],
        canUndo: false,
        canRedo: false,
      });
      projects.setState({
        project: practiceProject,
        activePathId: practicePathId,
        activePathGroupId: resumeSnapshot?.activePathGroupId ?? null,
        io: null,
        version: undefined,
        dirty: false,
        status: "idle",
        error: null,
        lastSavedAt: null,
        persistenceDamage: null,
        projectSessionId: practiceSessionId,
        revision: 0,
        activeSave: null,
        saveQueued: false,
        legacyMigrationProjectSessionId: null,
      });
      selections.getState().clearSelection();
      options.showPracticeView(practiceProject.project_id);

      // Ordinary Project mutations set dirty. Clear it synchronously while the
      // practice session owns the store so neither autosave nor Save can write
      // Tour work. History and revision tracking remain fully functional.
      unsubscribeProject = projects.subscribe((nextState) => {
        if (active && nextState.dirty) {
          projects.setState({ dirty: false, saveQueued: false });
        }
      });
      // A resumed step keeps the learner's saved work instead of its seed path.
      let keepResumedStep = resumeSnapshot !== null;
      unsubscribeTour = tours.subscribe((nextState, previousState) => {
        if (previousState.activeTourId && !nextState.activeTourId) {
          const left = snapshot();
          if (nextState.suspended?.tourId === previousState.activeTourId)
            rememberLessonResume({
              point: nextState.suspended,
              snapshot: left && {
                project: left.project,
                activePathId: left.activePathId,
                activePathGroupId: left.activePathGroupId,
              },
            });
          restoreSession();
        } else if (nextState.activeTourId) {
          if (
            !restoringCheckpoint &&
            (nextState.stepIndex !== previousState.stepIndex ||
              !previousState.activeTourId)
          ) {
            const departing = snapshot();
            if (previousState.activeTourId && departing)
              visitedStates.set(previousState.stepIndex, departing);
            const visited = visitedStates.get(nextState.stepIndex);
            // Going back to a step not seen since resuming: rebuild the path
            // it started from, not the later step's work.
            const backwards =
              !!previousState.activeTourId &&
              nextState.stepIndex < previousState.stepIndex;
            const seed = keepResumedStep
              ? undefined
              : (definition.steps[nextState.stepIndex]?.prepare?.practicePath ??
                (backwards
                  ? startingPathFor(definition, nextState.stepIndex)
                  : undefined));
            keepResumedStep = false;
            if (visited) {
              loadSnapshot(visited);
            } else if (seed) {
              const current = projects.getState();
              if (current.project) {
                projects.setState({
                  project: {
                    ...current.project,
                    paths: current.project.paths.map((path) =>
                      path.path_id === current.activePathId
                        ? { ...path, path: seed() }
                        : path,
                    ),
                  },
                  projectSessionId: createSessionId("practice"),
                  revision: 0,
                  dirty: false,
                  saveQueued: false,
                });
                current.history.setState({
                  undoStack: [],
                  redoStack: [],
                  canUndo: false,
                  canRedo: false,
                });
                selections.getState().clearSelection();
              }
            }
          }
          captureCheckpoint(nextState.stepIndex);
        }
      });
      tours.getState().start(tourId, resumePoint ?? undefined);
      return true;
    },
    restartStep() {
      restoreCheckpoint(tours.getState().stepIndex);
    },
    restartLesson() {
      restoreCheckpoint(0);
      const projectId = projects.getState().project?.project_id;
      if (projectId) options.showPracticeView(projectId);
    },
    restore() {
      if (active && tours.getState().activeTourId) {
        tours.getState().exit();
      } else {
        restoreSession();
      }
    },
    dispose() {
      if (active) {
        tours.getState().exit();
        restoreSession();
      }
      unsubscribeProject?.();
      unsubscribeTour?.();
      unsubscribeProject = null;
      unsubscribeTour = null;
    },
  };
}

/** Register the keys a lesson asks for so the Lib Key field suggests them. */
function withLessonEventKeys(
  config: ProjectConfig | undefined,
  keys: readonly string[] | undefined,
): ProjectConfig | undefined {
  if (!keys?.length) return config;
  const next = structuredClone(config ?? createProjectConfig());
  next.gui.event_trigger_keys = [
    ...new Set([...(next.gui.event_trigger_keys ?? []), ...keys]),
  ];
  return next;
}

function createSessionId(kind: "practice" | "restored"): string {
  const id = nextTourSessionId;
  nextTourSessionId += 1;
  return `tour-${kind}-session-${id}`;
}

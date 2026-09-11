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
import { tourStore, type TourDefinition, type TourState } from "./tourStore";

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
  start(tourId: string): boolean;
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
  const checkpoints = new Map<
    number,
    {
      project: Project;
      history: HistoryStoreState<Project>;
      selection: SelectionState;
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
        }
      : null;
  }
  function loadSnapshot(saved: NonNullable<ReturnType<typeof snapshot>>) {
    projects.getState().history.setState(saved.history);
    projects.setState({
      project: structuredClone(saved.project),
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
    });
  };

  const restoreCheckpoint = (index: number) => {
    const checkpoint = checkpoints.get(index);
    if (!active || !checkpoint) return;
    projects.getState().history.setState(checkpoint.history);
    projects.setState({
      project: structuredClone(checkpoint.project),
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
    tours.getState().restartAt(index);
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
    start(tourId) {
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
      const practicePathId = practicePaths[0].path_id;
      const practiceProject = createProject({
        project_id: practiceProjectId,
        display_name: state.project?.display_name ?? tourPracticePathName,
        config: definition.practiceConfig?.() ?? state.project?.config,
        paths: practicePaths,
        path_groups: definition.practiceGroups?.(),
      });

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
        activePathGroupId: null,
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
      unsubscribeTour = tours.subscribe((nextState, previousState) => {
        if (previousState.activeTourId && !nextState.activeTourId) {
          restoreSession();
        } else if (nextState.activeTourId) {
          if (
            nextState.stepIndex !== previousState.stepIndex ||
            !previousState.activeTourId
          ) {
            const departing = snapshot();
            if (previousState.activeTourId && departing)
              visitedStates.set(previousState.stepIndex, departing);
            const saved = visitedStates.get(nextState.stepIndex);
            const seed =
              definition.steps[nextState.stepIndex]?.prepare?.practicePath;
            if (saved) {
              loadSnapshot(saved);
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
      tours.getState().start(tourId);
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

function createSessionId(kind: "practice" | "restored"): string {
  const id = nextTourSessionId;
  nextTourSessionId += 1;
  return `tour-${kind}-session-${id}`;
}

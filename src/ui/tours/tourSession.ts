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
}

export interface TourSessionController {
  start(tourId: string): boolean;
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

  const restore = () => {
    const captured = active;
    if (!captured) {
      return;
    }

    active = null;
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
      const practiceSessionId = createSessionId("practice");
      const practiceProjectId =
        state.project?.project_id ?? `${practiceSessionId}-project`;
      const practicePathId = state.activePathId ?? `${practiceSessionId}-path`;
      const practiceProject = createProject({
        project_id: practiceProjectId,
        display_name: state.project?.display_name ?? tourPracticePathName,
        config: state.project?.config,
        paths: [
          {
            path_id: practicePathId,
            display_name: tourPracticePathName,
            file_name: "tour-practice.json",
            path: definition.practicePath(),
          },
        ],
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
        if (
          nextState.projectSessionId === practiceSessionId &&
          nextState.dirty
        ) {
          projects.setState({ dirty: false, saveQueued: false });
        }
      });
      unsubscribeTour = tours.subscribe((nextState, previousState) => {
        if (previousState.activeTourId && !nextState.activeTourId) {
          restore();
        }
      });
      tours.getState().start(tourId);
      return true;
    },
    dispose() {
      if (active) {
        tours.getState().exit();
        restore();
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

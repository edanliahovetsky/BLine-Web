import { useEffect } from "react";
import { PathStage } from "../../canvas/PathStage";
import { getElementPosition } from "../../canvas/geometry";
import { formatPointMeters, getElementLabel } from "../../canvas/modelSync";
import { projectStore } from "../../state/projectStore";
import { useStoreSelector } from "../../state/react";
import { selectionStore } from "../../state/selectionStore";
import { Sidebar } from "../sidebar/Sidebar";
import "./AppShell.css";
import { createInitialCanvasProject } from "./initialProject";

export function AppShell() {
  const project = useStoreSelector(projectStore, (state) => state.project);
  const dirty = useStoreSelector(projectStore, (state) => state.dirty);
  const selectedElementIndex = useStoreSelector(
    selectionStore,
    (state) => state.selectedElementIndex
  );
  const canUndo = useStoreSelector(
    projectStore,
    (state) => state.history.getState().canUndo
  );
  const canRedo = useStoreSelector(
    projectStore,
    (state) => state.history.getState().canRedo
  );

  useEffect(() => {
    if (!projectStore.getState().project) {
      projectStore.getState().createProject(createInitialCanvasProject());
    }
  }, []);

  const selectedElement =
    project && selectedElementIndex !== null
      ? project.path.path_elements[selectedElementIndex]
      : null;
  const selectedPosition =
    project && selectedElementIndex !== null
      ? getElementPosition(project.path.path_elements, selectedElementIndex)
      : null;
  const selectedSummary =
    selectedElement && selectedElementIndex !== null
      ? `Selected: ${getElementLabel(selectedElement)} #${selectedElementIndex + 1} ${formatPointMeters(selectedPosition)}`
      : "Selected: none";

  return (
    <main className="app-shell" data-testid="app-shell">
      <header className="app-toolbar">
        <div className="brand-block">
          <h1>BLine Web</h1>
          <span className="project-selector">{project?.display_name ?? "No project"}</span>
        </div>
        <nav className="app-tabs" aria-label="Primary sections">
          <button type="button">Project</button>
          <button type="button" className="is-active">
            Path
          </button>
          <button type="button" disabled>
            View
          </button>
          <button type="button" disabled>
            Simulation
          </button>
          <button type="button" disabled>
            Settings
          </button>
        </nav>
        <nav className="toolbar-actions" aria-label="Project actions">
          <button type="button" onClick={() => projectStore.getState().undo()} disabled={!canUndo}>
            Undo
          </button>
          <button type="button" onClick={() => projectStore.getState().redo()} disabled={!canRedo}>
            Redo
          </button>
          <button type="button" disabled>
            New
          </button>
          <button type="button" disabled>
            Open
          </button>
          <button type="button" disabled>
            Save
          </button>
        </nav>
      </header>

      <div className="workspace">
        <aside className="tool-rail" aria-label="Canvas tools">
          <button type="button" className="is-active" aria-label="Select tool">
            <span aria-hidden="true">S</span>
            <span>Select</span>
          </button>
          <button type="button" aria-label="Add waypoint tool" disabled>
            <span aria-hidden="true">W</span>
            <span>Waypoint</span>
          </button>
          <button type="button" aria-label="Add event tool" disabled>
            <span aria-hidden="true">E</span>
            <span>Event</span>
          </button>
          <button type="button" aria-label="Rotate tool" disabled>
            <span aria-hidden="true">R</span>
            <span>Rotate</span>
          </button>
        </aside>

        <section className="canvas-region" aria-label="Editor canvas">
          <PathStage />
        </section>

        <Sidebar project={project} selectedElementIndex={selectedElementIndex} />
      </div>

      <footer className="status-bar">
        <span>Current Path: {project?.display_name ?? "No project"}</span>
        <span data-testid="selected-element-status">{selectedSummary}</span>
        <span>{dirty ? "Unsaved changes" : "Saved"}</span>
      </footer>
    </main>
  );
}

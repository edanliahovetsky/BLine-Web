import { useCallback, useEffect } from "react";
import { PathStage } from "../../canvas/PathStage";
import { getElementPosition } from "../../canvas/geometry";
import { formatPointMeters, getElementLabel } from "../../canvas/modelSync";
import { browserWebCapabilities, tauriCapabilities } from "../../env/capabilities";
import { projectStore } from "../../state/projectStore";
import { useStoreSelector } from "../../state/react";
import { selectionStore } from "../../state/selectionStore";
import "./AppShell.css";
import { createInitialCanvasProject } from "./initialProject";

const shellRows = [
  { label: "Browser", status: "Ready", capabilities: browserWebCapabilities },
  { label: "Tauri", status: "Ready", capabilities: tauriCapabilities },
  { label: "Systemcore", status: "Deferred", capabilities: null }
] as const;

export function AppShell() {
  const project = useStoreSelector(projectStore, (state) => state.project);
  const dirty = useStoreSelector(projectStore, (state) => state.dirty);
  const selectedElementIndex = useStoreSelector(
    selectionStore,
    (state) => state.selectedElementIndex
  );

  useEffect(() => {
    if (!projectStore.getState().project) {
      projectStore.getState().createProject(createInitialCanvasProject());
    }
  }, []);

  const selectElement = useCallback(
    (index: number) => {
      selectionStore.getState().selectElement(index, project);
    },
    [project]
  );

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
          <span className="phase-label">Phase 1</span>
          <h1>BLine Web</h1>
        </div>
        <nav className="toolbar-actions" aria-label="Project actions">
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
        <aside className="sidebar" aria-label="Editor sidebar">
          <section className="sidebar-section">
            <h2>Elements</h2>
            {project ? (
              <ol className="element-list" aria-label="Path elements">
                {project.path.path_elements.map((element, index) => {
                  const position = getElementPosition(project.path.path_elements, index);

                  return (
                    <li key={`${element.type}-${index}`}>
                      <button
                        type="button"
                        className={selectedElementIndex === index ? "is-selected" : ""}
                        onClick={() => selectElement(index)}
                      >
                        <span>
                          {getElementLabel(element)} #{index + 1}
                        </span>
                        <small>{formatPointMeters(position)}</small>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="empty-state">No path elements</div>
            )}
          </section>
          <section className="sidebar-section">
            <h2>Shells</h2>
            <ul className="shell-list" aria-label="Phase 1 shells">
              {shellRows.map((row) => (
                <li key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.status}</strong>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="canvas-region" aria-label="Editor canvas">
          <PathStage />
        </section>
      </div>

      <footer className="status-bar">
        <span>{project?.display_name ?? "No project"}</span>
        <span data-testid="selected-element-status">{selectedSummary}</span>
        <span>{dirty ? "Unsaved changes" : "Saved"}</span>
      </footer>
    </main>
  );
}

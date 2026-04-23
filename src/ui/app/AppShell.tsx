import { browserWebCapabilities, tauriCapabilities } from "../../env/capabilities";
import "./AppShell.css";

const shellRows = [
  { label: "Browser", status: "Ready", capabilities: browserWebCapabilities },
  { label: "Tauri", status: "Ready", capabilities: tauriCapabilities },
  { label: "Systemcore", status: "Deferred", capabilities: null }
] as const;

export function AppShell() {
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
            <div className="empty-state">No path elements</div>
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
          <div className="field-frame">
            <div className="field-grid" />
            <svg
              className="path-preview"
              viewBox="0 0 640 360"
              role="img"
              aria-label="Empty path preview"
            >
              <line x1="96" y1="258" x2="544" y2="102" />
              <circle cx="96" cy="258" r="9" />
              <circle cx="544" cy="102" r="9" />
            </svg>
          </div>
        </section>
      </div>

      <footer className="status-bar">
        <span>Scaffold online</span>
        <span>Storage pending WP3</span>
      </footer>
    </main>
  );
}

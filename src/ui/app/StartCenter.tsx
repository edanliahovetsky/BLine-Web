import {
  ArchiveRestore,
  FilePlus2,
  FolderOpen,
  FlaskConical,
} from "lucide-react";
import type { ProjectWorkspaceSummary } from "../../platform/projectIo";
import { parseProjectTimestamp } from "./projectTimestamp";

export function StartCenter({
  initializing,
  initializationError,
  recentWorkspaces,
  supportsProjectFolders,
  onCreateProject,
  onImportArchive,
  onImportFolder,
  onOpenProject,
  onOpenRecent,
  onOpenSample,
  tourSupported,
  onStartTour,
  onRetryInitialization,
}: {
  initializing: boolean;
  initializationError: Error | null;
  recentWorkspaces: readonly ProjectWorkspaceSummary[];
  supportsProjectFolders: boolean;
  onCreateProject(): void;
  onImportArchive(): void;
  onImportFolder(): void;
  onOpenProject(): void;
  onOpenRecent(id: string): void;
  onOpenSample(): void;
  tourSupported: boolean;
  onStartTour(): void;
  onRetryInitialization(): void;
}) {
  const actionsDisabled = initializing || initializationError !== null;
  return (
    <section className="start-center" aria-labelledby="start-center-title">
      <div className="start-center__hero">
        <span className="start-center__eyebrow">BLine Web</span>
        <h1 id="start-center-title">Simple, rapid, robust.</h1>
        <p>
          Start a clean robot project, continue where your team left off, or
          learn with the sample path.
        </p>
      </div>

      {initializationError ? (
        <div className="start-center__initialization-error" role="alert">
          <div>
            <strong>Local data could not be opened.</strong>
            <small>{initializationError.message}</small>
          </div>
          <button type="button" onClick={onRetryInitialization}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="start-center__actions" aria-label="Start actions">
        <button
          type="button"
          className="start-center__action is-primary"
          disabled={actionsDisabled}
          onClick={onCreateProject}
        >
          <FilePlus2 aria-hidden="true" size={22} />
          <span>
            <strong>Create project</strong>
            <small>Name the project and its first path.</small>
          </span>
        </button>
        <button
          type="button"
          className="start-center__action"
          disabled={actionsDisabled}
          onClick={onOpenProject}
        >
          <FolderOpen aria-hidden="true" size={22} />
          <span>
            <strong>
              {supportsProjectFolders ? "Open robot project" : "Open project"}
            </strong>
            <small>
              {supportsProjectFolders
                ? "Choose an existing project folder."
                : "Continue a workspace saved in this browser."}
            </small>
          </span>
        </button>
        {!supportsProjectFolders ? (
          <button
            type="button"
            className="start-center__action"
            disabled={actionsDisabled}
            onClick={onImportFolder}
          >
            <ArchiveRestore aria-hidden="true" size={22} />
            <span>
              <strong>Import autos folder</strong>
              <small>Bring in paths and editor settings.</small>
            </span>
          </button>
        ) : null}
        <button
          type="button"
          className="start-center__action"
          disabled={actionsDisabled}
          onClick={onImportArchive}
        >
          <ArchiveRestore aria-hidden="true" size={22} />
          <span>
            <strong>Import project archive</strong>
            <small>Open a portable BLine project file.</small>
          </span>
        </button>
      </div>

      <div className="start-center__lower">
        <section aria-labelledby="recent-projects-title">
          <div className="start-center__section-heading">
            <h2 id="recent-projects-title">Recent projects</h2>
            <span>{recentWorkspaces.length}</span>
          </div>
          <div className="start-center__recent">
            {recentWorkspaces.length > 0 ? (
              recentWorkspaces.slice(0, 5).map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => onOpenRecent(workspace.id)}
                >
                  <span>{workspace.displayName}</span>
                  <small>{formatRecentTime(workspace.updatedAt)}</small>
                </button>
              ))
            ) : (
              <p>No saved projects yet.</p>
            )}
          </div>
        </section>
        <section className="start-center__sample">
          <FlaskConical aria-hidden="true" size={23} />
          <div>
            <h2>Explore a complete path</h2>
            <p>
              Open a safe sample with waypoints, events, and a velocity range.
            </p>
            <div className="start-center__sample-actions">
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={onOpenSample}
              >
                Open sample
              </button>
              {tourSupported ? (
                <button
                  type="button"
                  data-testid="start-center-guided-tour"
                  disabled={actionsDisabled}
                  onClick={onStartTour}
                >
                  <span aria-hidden="true">🧭</span> Take the guided tour
                </button>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function formatRecentTime(value: string): string {
  const date = parseProjectTimestamp(value);
  return date === null
    ? "Saved project"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

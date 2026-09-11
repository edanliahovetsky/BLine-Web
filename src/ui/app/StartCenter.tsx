import { useEffect, useRef } from "react";
import {
  Archive,
  ArrowRight,
  ChevronDown,
  Download,
  FolderOpen,
  Plus,
} from "lucide-react";
import type { ProjectWorkspaceSummary } from "../../platform/projectIo";
import { parseProjectTimestamp } from "./projectTimestamp";

export function StartCenter({
  initializing,
  initializationError,
  actionError,
  recentWorkspaces,
  supportsProjectFolders,
  onCreateProject,
  onImportArchive,
  onImportFolder,
  onOpenProject,
  onOpenRecent,
  onOpenSample,
  tourSupported,
  onOpenLessons,
  onRetryInitialization,
}: {
  initializing: boolean;
  initializationError: Error | null;
  actionError: string | null;
  recentWorkspaces: readonly ProjectWorkspaceSummary[];
  supportsProjectFolders: boolean;
  onCreateProject(): void;
  onImportArchive(): void;
  onImportFolder(): void;
  onOpenProject(): void;
  onOpenRecent(id: string): void;
  onOpenSample(): void;
  tourSupported: boolean;
  onOpenLessons(): void;
  onRetryInitialization(): void;
}) {
  const actionsDisabled = initializing || initializationError !== null;

  return (
    <section
      className="start-center"
      aria-labelledby="start-center-title"
      aria-busy={initializing}
      data-testid="start-center"
    >
      <div className="start-center__content">
        <h1 id="start-center-title" className="start-center__title">
          BLine Web
        </h1>

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

        {!initializationError && actionError ? (
          <div className="start-center__initialization-error" role="alert">
            <div>{actionError}</div>
          </div>
        ) : null}

        <div className="start-center__actions" aria-label="Start actions">
          <button
            type="button"
            className="start-center__action is-primary"
            disabled={actionsDisabled}
            onClick={onCreateProject}
          >
            <Plus aria-hidden="true" size={17} />
            <span>Create project</span>
          </button>
          <button
            type="button"
            className="start-center__action"
            disabled={actionsDisabled}
            onClick={onOpenProject}
          >
            <FolderOpen aria-hidden="true" size={17} />
            <span>Open project</span>
          </button>
          <StartCenterImports
            disabled={actionsDisabled}
            supportsProjectFolders={supportsProjectFolders}
            onImportArchive={onImportArchive}
            onImportFolder={onImportFolder}
          />
        </div>

        <section
          className="start-center__recents"
          aria-labelledby="recent-projects-title"
        >
          <div className="start-center__section-heading">
            <h2 id="recent-projects-title">Recent projects</h2>
            <span>Last saved</span>
          </div>
          <div className="start-center__recent">
            {recentWorkspaces.length > 0 ? (
              recentWorkspaces.slice(0, 5).map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  disabled={actionsDisabled}
                  onClick={() => onOpenRecent(workspace.id)}
                >
                  <FolderOpen
                    className="start-center__recent-folder"
                    aria-hidden="true"
                    size={17}
                  />
                  <span className="start-center__recent-name">
                    {workspace.displayName}
                  </span>
                  <time
                    dateTime={parseProjectTimestamp(
                      workspace.updatedAt,
                    )?.toISOString()}
                  >
                    {formatRecentTime(workspace.updatedAt)}
                  </time>
                  <ArrowRight
                    className="start-center__recent-arrow"
                    aria-hidden="true"
                    size={14}
                  />
                </button>
              ))
            ) : (
              <p className="start-center__empty" role="status">
                {initializing ? "Loading projects…" : "No saved projects yet."}
              </p>
            )}
          </div>
        </section>

        <section
          className="start-center__learning"
          aria-labelledby="start-center-learn-title"
        >
          <h2 id="start-center-learn-title">
            <span className="start-center__emoji" aria-hidden="true">
              📚
            </span>{" "}
            Learn
          </h2>
          <div className="start-center__learning-actions">
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={onOpenSample}
            >
              <span>Sample path</span>
              <ArrowRight aria-hidden="true" size={13} />
            </button>
            <button
              type="button"
              data-testid="start-center-guided-tour"
              disabled={actionsDisabled || !tourSupported}
              title={
                !tourSupported
                  ? "Guided lessons require a wider window."
                  : undefined
              }
              onClick={onOpenLessons}
            >
              <span className="start-center__emoji" aria-hidden="true">
                🧭
              </span>
              <span>Guided lessons</span>
              <ArrowRight aria-hidden="true" size={13} />
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function StartCenterImports({
  disabled,
  supportsProjectFolders,
  onImportArchive,
  onImportFolder,
}: {
  disabled: boolean;
  supportsProjectFolders: boolean;
  onImportArchive(): void;
  onImportFolder(): void;
}) {
  const disclosureRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const disclosure = disclosureRef.current;
      if (disclosure?.open && !disclosure.contains(event.target as Node)) {
        disclosure.open = false;
      }
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, []);

  useEffect(() => {
    if (disabled && disclosureRef.current) {
      disclosureRef.current.open = false;
    }
  }, [disabled]);

  const closeAndFocus = () => {
    if (disclosureRef.current) disclosureRef.current.open = false;
    triggerRef.current?.focus();
  };

  return (
    <details
      className="start-center__imports"
      ref={disclosureRef}
      onBlur={(event) => {
        // WebKit may blur to the body before a menu button receives its click.
        // Pointer dismissal is handled separately; only follow a known focus target.
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          event.currentTarget.open = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.currentTarget.open) {
          event.preventDefault();
          event.stopPropagation();
          closeAndFocus();
        }
      }}
    >
      <summary
        ref={triggerRef}
        role="button"
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        <Download aria-hidden="true" size={16} />
        <span>Import</span>
        <ChevronDown aria-hidden="true" size={13} />
      </summary>
      <div
        className="start-center__import-options"
        role="group"
        aria-label="Import options"
      >
        {!supportsProjectFolders ? (
          <button
            type="button"
            disabled={disabled}
            aria-label="Import autos folder"
            onClick={() => {
              closeAndFocus();
              onImportFolder();
            }}
          >
            <FolderOpen aria-hidden="true" size={17} />
            <span>Autos folder</span>
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          aria-label="Import project archive"
          onClick={() => {
            closeAndFocus();
            onImportArchive();
          }}
        >
          <Archive aria-hidden="true" size={17} />
          <span>Project archive</span>
        </button>
      </div>
    </details>
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

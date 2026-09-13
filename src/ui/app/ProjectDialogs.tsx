import { useEffect, useRef, useState } from "react";
import { ArrowRight, FolderOpen, Trash2 } from "lucide-react";
import type { ProjectPath, ProjectPathGroup } from "../../core/model/project";
import type { ProjectWorkspaceSummary } from "../../platform/projectIo";
import { ActionButton, CloseButton } from "../controls";
import { parseProjectTimestamp } from "./projectTimestamp";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import "./ProjectDialogs.css";

export function ImportErrorDialog({
  message,
  onClose,
}: {
  message: string;
  onClose(): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [dialogRef]);

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-error-title"
        aria-describedby="import-error-message"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="project-dialog__header">
          <h2 id="import-error-title">Could not import</h2>
          <CloseButton ariaLabel="Close import message" onClick={onClose} />
        </header>
        <div className="project-dialog__body">
          <p id="import-error-message">{message}</p>
        </div>
        <footer className="project-dialog__footer">
          <ActionButton tone="primary" onClick={onClose}>
            OK
          </ActionButton>
        </footer>
      </section>
    </div>
  );
}

export function CreateProjectDialog({
  onCancel,
  onCreate,
}: {
  onCancel(): void;
  onCreate(input: { projectName: string; pathName: string }): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLFormElement>();
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const [projectName, setProjectName] = useState("My Robot Project");
  const [pathName, setPathName] = useState("Path 1");

  useEffect(() => {
    projectInputRef.current?.focus();
    projectInputRef.current?.select();
  }, []);

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        ref={dialogRef}
        className="project-dialog create-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({
            projectName: projectName.trim() || "Untitled Project",
            pathName: pathName.trim() || "Path 1",
          });
        }}
      >
        <header className="project-dialog__header">
          <h2 id="create-project-title">Create project</h2>
          <CloseButton ariaLabel="Close create project" onClick={onCancel} />
        </header>
        <section className="project-dialog__body">
          <label className="project-dialog__field">
            <span>Project name</span>
            <input
              ref={projectInputRef}
              aria-label="Project name"
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.currentTarget.value)}
            />
          </label>
          <label className="project-dialog__field">
            <span>First path</span>
            <input
              aria-label="First path name"
              type="text"
              value={pathName}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setPathName(event.currentTarget.value)}
            />
          </label>
        </section>
        <footer className="project-dialog__footer">
          <ActionButton onClick={onCancel}>Cancel</ActionButton>
          <ActionButton type="submit" tone="primary">
            Done
          </ActionButton>
        </footer>
      </form>
    </div>
  );
}

export function OpenProjectDialog({
  workspaces,
  busy,
  onCancel,
  onOpen,
}: {
  workspaces: readonly ProjectWorkspaceSummary[];
  busy: boolean;
  onCancel(): void;
  onOpen(id: string): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();

  useEffect(() => {
    const dialog = dialogRef.current;
    const firstProject =
      dialog?.querySelector<HTMLButtonElement>("[data-project-id]");
    (
      firstProject ?? dialog?.querySelector<HTMLButtonElement>("button")
    )?.focus();
  }, [dialogRef]);

  return (
    <div
      className="config-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="project-dialog open-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-project-title"
        aria-busy={busy}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <header className="project-dialog__header">
          <span className="project-dialog__icon">
            <FolderOpen size={18} aria-hidden="true" />
          </span>
          <h2 id="open-project-title">Open project</h2>
          <CloseButton ariaLabel="Close open project" onClick={onCancel} />
        </header>
        <div className="project-dialog__body">
          {workspaces.length > 0 ? (
            <>
              <div className="open-project-dialog__labels" aria-hidden="true">
                <span>Last saved</span>
              </div>
              <ul
                className="open-project-dialog__list"
                aria-label="Saved projects"
              >
                {workspaces.map((workspace) => {
                  const savedAt = parseProjectTimestamp(workspace.updatedAt);
                  return (
                    <li key={workspace.id}>
                      <button
                        type="button"
                        data-project-id={workspace.id}
                        disabled={busy}
                        onClick={() => onOpen(workspace.id)}
                      >
                        <FolderOpen size={17} aria-hidden="true" />
                        <span className="open-project-dialog__name">
                          {workspace.displayName}
                        </span>
                        <time dateTime={savedAt?.toISOString()}>
                          {savedAt?.toLocaleString([], {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }) ?? "Saved project"}
                        </time>
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="open-project-dialog__empty">
              <FolderOpen size={28} aria-hidden="true" />
              <p>No saved projects yet.</p>
              <span>Create or import from Home.</span>
            </div>
          )}
        </div>
        <footer className="project-dialog__footer">
          <ActionButton onClick={onCancel}>Cancel</ActionButton>
        </footer>
      </section>
    </div>
  );
}

export function NameEntryDialog({
  ariaLabel,
  description,
  fieldLabel,
  initialValue,
  onCancel,
  onSubmit,
  submitLabel,
  title,
}: {
  ariaLabel: string;
  description?: string;
  fieldLabel: string;
  initialValue: string;
  onCancel(): void;
  onSubmit(displayName: string): void;
  submitLabel: string;
  title: string;
}) {
  const dialogRef = useDialogFocusTrap<HTMLFormElement>();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState(initialValue);
  const normalizedName = displayName.trim();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        ref={dialogRef}
        className="new-path-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (normalizedName) {
            onSubmit(normalizedName);
          }
        }}
      >
        <header className="config-dialog__header">
          <div>
            <strong>{title}</strong>
            {description ? <span>{description}</span> : null}
          </div>
          <CloseButton
            ariaLabel={`Close ${ariaLabel.toLocaleLowerCase()}`}
            onClick={onCancel}
          />
        </header>
        <section className="new-path-dialog__body">
          <label className="dialog-field">
            <span>{fieldLabel}</span>
            <input
              ref={inputRef}
              aria-label={fieldLabel}
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
          </label>
        </section>
        <footer className="config-dialog__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-dialog-action"
            disabled={!normalizedName}
          >
            {submitLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function DeleteProjectsDialog({
  activeWorkspaceId,
  workspaces,
  onCancel,
  onDelete,
}: {
  activeWorkspaceId: string | null;
  workspaces: ProjectWorkspaceSummary[];
  onCancel(): void;
  onDelete(projects: ProjectWorkspaceSummary[]): void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const selectedCount = selectedIds.size;
  const selectedProjects = workspaces.filter((workspaceSummary) =>
    selectedIds.has(workspaceSummary.id),
  );

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        className="delete-projects-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Delete Projects"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirming) {
            setConfirming(true);
            return;
          }
          onDelete(selectedProjects);
        }}
      >
        <header className="config-dialog__header">
          <strong>Delete Projects</strong>
          <CloseButton ariaLabel="Close delete projects" onClick={onCancel} />
        </header>
        {confirming ? (
          <section
            className="delete-projects-dialog__confirm"
            aria-label="Confirm project deletion"
          >
            <strong>
              Delete {selectedCount} selected project
              {selectedCount === 1 ? "" : "s"}?
            </strong>
            <p>
              This removes the selected project{selectedCount === 1 ? "" : "s"}{" "}
              from browser storage. Exported autos folders and downloaded
              archives are not deleted.
            </p>
            <ul>
              {selectedProjects.map((workspaceSummary) => (
                <li key={workspaceSummary.id}>
                  {workspaceSummary.displayName}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section
            className="delete-projects-dialog__list"
            aria-label="Saved projects"
          >
            {workspaces.length === 0 ? (
              <div className="delete-projects-dialog__empty">
                No projects found to delete.
              </div>
            ) : (
              workspaces.map((workspaceSummary) => {
                const checked = selectedIds.has(workspaceSummary.id);
                const isCurrent = workspaceSummary.id === activeWorkspaceId;
                return (
                  <label
                    key={workspaceSummary.id}
                    className={
                      isCurrent
                        ? "delete-project-row is-current"
                        : "delete-project-row"
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const nextChecked = event.currentTarget.checked;
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (nextChecked) {
                            next.add(workspaceSummary.id);
                          } else {
                            next.delete(workspaceSummary.id);
                          }
                          return next;
                        });
                      }}
                    />
                    <span>{workspaceSummary.displayName}</span>
                    {isCurrent ? <small>Current</small> : null}
                  </label>
                );
              })
            )}
          </section>
        )}
        <footer className="config-dialog__footer">
          {confirming ? (
            <button type="button" onClick={() => setConfirming(false)}>
              Back
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(
                    new Set(workspaces.map((summary) => summary.id)),
                  )
                }
                disabled={workspaces.length === 0}
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={selectedCount === 0}
              >
                Select None
              </button>
            </>
          )}
          <span className="delete-projects-dialog__spacer" />
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="danger-action"
            disabled={selectedCount === 0}
          >
            {confirming ? "Confirm Delete" : "Delete Selected"}
          </button>
        </footer>
      </form>
    </div>
  );
}

export function DeletePathsDialog({
  activePathId,
  initialSelectedIds = [],
  paths,
  onCancel,
  onDelete,
}: {
  activePathId: string | null;
  initialSelectedIds?: readonly string[];
  paths: ProjectPath[];
  onCancel(): void;
  onDelete(ids: string[]): void;
}) {
  return (
    <DeleteLibraryItemsDialog
      activeId={activePathId}
      initialSelectedIds={initialSelectedIds}
      items={paths.map((path) => ({
        id: path.path_id,
        name: path.display_name,
      }))}
      kind="paths"
      onCancel={onCancel}
      onDelete={onDelete}
    />
  );
}

export function DeletePathGroupsDialog({
  activeGroupId,
  initialSelectedIds = [],
  groups,
  onCancel,
  onDelete,
}: {
  activeGroupId: string | null;
  initialSelectedIds?: readonly string[];
  groups: ProjectPathGroup[];
  onCancel(): void;
  onDelete(ids: string[]): void;
}) {
  return (
    <DeleteLibraryItemsDialog
      activeId={activeGroupId}
      initialSelectedIds={initialSelectedIds}
      items={groups.map((group) => ({
        id: group.group_id,
        name: group.display_name,
      }))}
      kind="groups"
      onCancel={onCancel}
      onDelete={onDelete}
    />
  );
}

function DeleteLibraryItemsDialog({
  activeId,
  initialSelectedIds,
  items,
  kind,
  onCancel,
  onDelete,
}: {
  activeId: string | null;
  initialSelectedIds: readonly string[];
  items: { id: string; name: string }[];
  kind: "paths" | "groups";
  onCancel(): void;
  onDelete(ids: string[]): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLFormElement>();
  const title = kind === "paths" ? "Delete Paths" : "Delete Path Groups";
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () =>
      new Set(
        initialSelectedIds.filter((id) => items.some((item) => item.id === id)),
      ),
  );
  const anchorId = useRef(
    items.find((item) => initialSelectedIds.includes(item.id))?.id ?? null,
  );
  const selectItem = (
    index: number,
    modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
    toggle = false,
  ) => {
    const item = items[index];
    if (!item) return;
    const anchor = items.findIndex((entry) => entry.id === anchorId.current);
    const additive = modifiers.ctrlKey || modifiers.metaKey;
    if (modifiers.shiftKey && anchor !== -1) {
      const range = items.slice(
        Math.min(anchor, index),
        Math.max(anchor, index) + 1,
      );
      setSelectedIds(
        (current) =>
          new Set([
            ...(additive ? current : []),
            ...range.map((entry) => entry.id),
          ]),
      );
    } else {
      anchorId.current = item.id;
      setSelectedIds((current) => {
        if (!additive && !toggle) return new Set([item.id]);
        const next = new Set(current);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
    }
  };
  const selectAll = () => {
    anchorId.current = items[0]?.id ?? null;
    setSelectedIds(new Set(items.map((item) => item.id)));
  };
  const selectNone = () => {
    anchorId.current = null;
    setSelectedIds(new Set());
  };
  useEffect(() => {
    dialogRef.current?.focus();
  }, [dialogRef]);
  const selectedCount = selectedIds.size;

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        ref={dialogRef}
        tabIndex={-1}
        className={`delete-${kind === "paths" ? "paths" : "path-groups"}-dialog path-removal`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "a"
          ) {
            event.preventDefault();
            event.stopPropagation();
            selectAll();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (selectedCount > 0) onDelete([...selectedIds]);
        }}
      >
        <header className="path-removal__header">
          <span className="path-removal__icon">
            <Trash2 size={18} />
          </span>
          <div>
            <strong>{title}</strong>
            <p>
              {kind === "paths"
                ? "Remove Paths from this project and its Path Groups."
                : "Remove Path Groups from this project. Their Paths stay in All Paths."}
            </p>
          </div>
          <CloseButton
            ariaLabel={`Close ${title.toLowerCase()}`}
            onClick={onCancel}
          />
        </header>
        <div className="path-removal__selection">
          <span role="status">
            {selectedCount} of {items.length} selected
          </span>
          <div>
            <button
              type="button"
              onClick={selectAll}
              disabled={items.length === 0 || selectedCount === items.length}
            >
              Select All
            </button>
            <button
              type="button"
              onClick={selectNone}
              disabled={selectedCount === 0}
            >
              Select None
            </button>
          </div>
        </div>
        <section
          className="delete-paths-dialog__list"
          aria-label={kind === "paths" ? "Saved paths" : "Saved path groups"}
        >
          {items.length === 0 ? (
            <div className="delete-paths-dialog__empty">
              No {kind === "paths" ? "paths" : "path groups"} found to delete.
            </div>
          ) : (
            items.map((item, index) => {
              const checked = selectedIds.has(item.id);
              return (
                <label
                  key={item.id}
                  className={`delete-path-row${checked ? " is-selected" : ""}`}
                  onClick={(event) => {
                    // The checkbox has its own additive toggle; the row follows file selection.
                    if (event.target instanceof HTMLInputElement) return;
                    event.preventDefault();
                    event.currentTarget
                      .querySelector("input")
                      ?.focus({ preventScroll: true });
                    selectItem(index, event);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {}}
                    onClick={(event) => {
                      event.currentTarget.focus({ preventScroll: true });
                      selectItem(index, event, true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === " ") {
                        event.preventDefault();
                        selectItem(index, event, true);
                        return;
                      }
                      const nextIndex =
                        event.key === "ArrowDown"
                          ? Math.min(items.length - 1, index + 1)
                          : event.key === "ArrowUp"
                            ? Math.max(0, index - 1)
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? items.length - 1
                                : null;
                      if (nextIndex === null) return;
                      event.preventDefault();
                      const inputs = event.currentTarget
                        .closest("section")
                        ?.querySelectorAll("input");
                      inputs?.[nextIndex]?.focus();
                      if (event.shiftKey || !(event.ctrlKey || event.metaKey))
                        selectItem(nextIndex, event);
                    }}
                  />
                  <span>{item.name}</span>
                  {item.id === activeId ? <small>Current</small> : null}
                </label>
              );
            })
          )}
        </section>
        <footer className="path-removal__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="path-removal__delete"
            disabled={selectedCount === 0}
          >
            <Trash2 size={14} />
            Delete Selected
          </button>
        </footer>
      </form>
    </div>
  );
}

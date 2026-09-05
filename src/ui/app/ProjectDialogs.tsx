import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ProjectPath, ProjectPathGroup } from "../../core/model/project";
import type { ProjectWorkspaceSummary } from "../../platform/projectIo";
import { CloseButton } from "../controls";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import "./ProjectDialogs.css";

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
        className="create-project-dialog"
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
        <header className="config-dialog__header">
          <div>
            <strong id="create-project-title">Create project</strong>
            <span>Give your team a clear starting point.</span>
          </div>
          <CloseButton ariaLabel="Close create project" onClick={onCancel} />
        </header>
        <section className="create-project-dialog__body">
          <label className="dialog-field">
            <span>Project name</span>
            <input
              ref={projectInputRef}
              aria-label="Project name"
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.currentTarget.value)}
            />
            <small>Use your robot, event, or season name.</small>
          </label>
          <label className="dialog-field">
            <span>First path</span>
            <input
              aria-label="First path name"
              type="text"
              value={pathName}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setPathName(event.currentTarget.value)}
            />
            <small>You can add Path Groups and more Paths later.</small>
          </label>
        </section>
        <footer className="config-dialog__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-dialog-action">
            Create project
          </button>
        </footer>
      </form>
    </div>
  );
}

export function NewPathDialog({
  activeGroup,
  onCancel,
  onCreate,
}: {
  activeGroup: ProjectPathGroup | null;
  onCancel(): void;
  onCreate(input: { displayName: string; addToCurrentGroup: boolean }): void;
}) {
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState("new_path");
  const [addToCurrentGroup, setAddToCurrentGroup] = useState(
    Boolean(activeGroup),
  );

  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        className="new-path-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Create New Path"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({
            displayName: displayName.trim() || "Untitled Path",
            addToCurrentGroup: Boolean(activeGroup) && addToCurrentGroup,
          });
        }}
      >
        <header className="config-dialog__header">
          <strong>Create New Path</strong>
          <CloseButton ariaLabel="Close new path" onClick={onCancel} />
        </header>
        <section className="new-path-dialog__body">
          <label className="dialog-field">
            <span>Path name</span>
            <input
              ref={nameInputRef}
              aria-label="Path name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
          </label>
          {activeGroup ? (
            <label className="dialog-checkbox-row">
              <input
                aria-label={`Add to ${activeGroup.display_name}`}
                type="checkbox"
                checked={addToCurrentGroup}
                onChange={(event) =>
                  setAddToCurrentGroup(event.currentTarget.checked)
                }
              />
              <span>Add to {activeGroup.display_name}</span>
            </label>
          ) : null}
        </section>
        <footer className="config-dialog__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-dialog-action">
            Create Path
          </button>
        </footer>
      </form>
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
  description: string;
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
            <span>{description}</span>
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
              onClick={() =>
                setSelectedIds(new Set(items.map((item) => item.id)))
              }
              disabled={items.length === 0 || selectedCount === items.length}
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
            items.map((item) => {
              const checked = selectedIds.has(item.id);
              return (
                <label
                  key={item.id}
                  className={`delete-path-row${checked ? " is-selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const nextChecked = event.currentTarget.checked;
                      setSelectedIds((current) => {
                        const next = new Set(current);
                        if (nextChecked) {
                          next.add(item.id);
                        } else {
                          next.delete(item.id);
                        }
                        return next;
                      });
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

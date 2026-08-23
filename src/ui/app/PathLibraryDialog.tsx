import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Eye, EyeOff, Search } from "lucide-react";
import type {
  Project,
  ProjectPath,
  ProjectPathGroup,
} from "../../core/model/project";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import { isEditableShortcutTarget } from "../keyboardShortcuts";
import {
  CopyIcon,
  DownloadIcon,
  FilePlusIcon,
  OpenIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from "../icons";
import { CloseButton, IconButton } from "../controls";
import { NameEntryDialog } from "./ProjectDialogs";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import "./LibraryDialog.css";
import "./ProjectLibraryDialogs.css";

type LibraryNameAction =
  | {
      kind: "rename-group";
      groupId: string;
      initialName: string;
    }
  | {
      kind: "duplicate-path" | "rename-path";
      pathId: string;
      initialName: string;
      addToGroupId: string | null;
    };

const unlabeledFilterId = "__unlabeled_paths__";

export function PathLibraryDialog({
  project,
  activePathId,
  activePathGroupId,
  showGhostPaths,
  onCancel,
  onCreatePath,
  onDeletePaths,
  onExportPath,
  onImportPath,
  onShowGhostPathsChange,
}: {
  project: Project;
  activePathId: string | null;
  activePathGroupId: string | null;
  showGhostPaths: boolean;
  onCancel(): void;
  onCreatePath(groupId: string | null): void;
  onDeletePaths(): void;
  onExportPath(): void;
  onImportPath(): void;
  onShowGhostPathsChange(show: boolean): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<
    string | null | typeof unlabeledFilterId
  >(activePathGroupId);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(
    activePathId ?? project.paths[0]?.path_id ?? null,
  );
  const [query, setQuery] = useState("");
  const [showCreateCollectionDialog, setShowCreateCollectionDialog] =
    useState(false);
  const [deletingGroup, setDeletingGroup] = useState<ProjectPathGroup | null>(
    null,
  );
  const [nameAction, setNameAction] = useState<LibraryNameAction | null>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleHistoryShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        deletingGroup ||
        showCreateCollectionDialog ||
        nameAction
      ) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (
        !modifier ||
        event.altKey ||
        isEditableShortcutTarget(event.target) ||
        (key !== "z" && key !== "y")
      ) {
        return;
      }

      event.preventDefault();
      if (key === "y" || event.shiftKey) {
        projectStore.getState().redo();
      } else {
        projectStore.getState().undo();
      }
    };

    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [deletingGroup, nameAction, showCreateCollectionDialog]);

  const selectedGroup =
    project.path_groups.find((group) => group.group_id === selectedGroupId) ??
    null;
  const pathsForSelectedFilter =
    selectedGroupId === unlabeledFilterId
      ? project.paths.filter((path) =>
          project.path_groups.every(
            (group) => !group.path_ids.includes(path.path_id),
          ),
        )
      : visiblePathsForGroup(project.paths, selectedGroup);
  const selectedCollectionPaths = pathsForSelectedFilter.filter((path) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (
      !normalizedQuery ||
      path.display_name.toLocaleLowerCase().includes(normalizedQuery) ||
      path.file_name.toLocaleLowerCase().includes(normalizedQuery)
    );
  });
  const selectedPathFromState =
    project.paths.find((path) => path.path_id === selectedPathId) ?? null;
  const selectedPath =
    selectedPathFromState &&
    selectedCollectionPaths.some(
      (path) => path.path_id === selectedPathFromState.path_id,
    )
      ? selectedPathFromState
      : (selectedCollectionPaths.find(
          (path) => path.path_id === activePathId,
        ) ??
        selectedCollectionPaths[0] ??
        null);
  const effectiveSelectedPathId = selectedPath?.path_id ?? null;
  const handleSelectLibraryGroup = (
    groupId: string | null | typeof unlabeledFilterId,
  ) => {
    const nextGroup =
      project.path_groups.find((group) => group.group_id === groupId) ?? null;
    const nextPaths =
      groupId === unlabeledFilterId
        ? project.paths.filter((path) =>
            project.path_groups.every(
              (group) => !group.path_ids.includes(path.path_id),
            ),
          )
        : visiblePathsForGroup(project.paths, nextGroup);

    setSelectedGroupId(groupId);
    projectStore.getState().setActivePathGroup(nextGroup?.group_id ?? null);
    selectionStore.getState().clearSelection();
    setSelectedPathId((current) =>
      current && nextPaths.some((path) => path.path_id === current)
        ? current
        : (nextPaths[0]?.path_id ?? null),
    );
  };

  const handleUsePath = (pathId: string) => {
    projectStore.getState().setActivePathGroup(selectedGroup?.group_id ?? null);
    projectStore.getState().setActivePath(pathId);
    selectionStore.getState().clearSelection();
  };

  const handleCreateGroup = (displayName: string) => {
    const pathId = effectiveSelectedPathId;

    projectStore.getState().createPathGroup({
      displayName,
      activePathId: pathId,
      pathIds: pathId ? [pathId] : [],
      makeActive: true,
    });

    const createdGroupId = projectStore.getState().activePathGroupId;
    selectionStore.getState().clearSelection();
    setSelectedGroupId(createdGroupId);
    setSelectedPathId(pathId);
    setShowCreateCollectionDialog(false);
  };

  const handleRenameGroup = () => {
    if (!selectedGroup) {
      return;
    }

    setNameAction({
      kind: "rename-group",
      groupId: selectedGroup.group_id,
      initialName: selectedGroup.display_name,
    });
  };

  const handleToggleSelectedPathMembership = (
    groupId: string,
    checked: boolean,
  ) => {
    if (!selectedPath) {
      return;
    }

    if (checked) {
      projectStore.getState().addPathsToGroup(groupId, [selectedPath.path_id]);
    } else {
      projectStore
        .getState()
        .removePathsFromGroup(groupId, [selectedPath.path_id]);
    }
    selectionStore.getState().clearSelection();
  };

  const handleCreatePathInSelectedCollection = () => {
    selectionStore.getState().clearSelection();
    onCreatePath(selectedGroup?.group_id ?? null);
  };

  const handleDuplicateSelectedPath = () => {
    if (!selectedPath) {
      return;
    }

    setNameAction({
      kind: "duplicate-path",
      pathId: selectedPath.path_id,
      initialName: selectedPath.display_name,
      addToGroupId: selectedGroup?.group_id ?? null,
    });
  };

  const handleRenameSelectedPath = () => {
    if (!selectedPath) {
      return;
    }

    setNameAction({
      kind: "rename-path",
      pathId: selectedPath.path_id,
      initialName: selectedPath.display_name,
      addToGroupId: selectedGroup?.group_id ?? null,
    });
  };

  const handleConfirmNameAction = (displayName: string) => {
    if (!nameAction) {
      return;
    }

    try {
      if (nameAction.kind === "rename-group") {
        projectStore
          .getState()
          .renamePathGroup(nameAction.groupId, displayName);
      } else if (nameAction.kind === "duplicate-path") {
        projectStore.getState().duplicatePath(nameAction.pathId, displayName, {
          addToGroupId: nameAction.addToGroupId,
        });
        const nextPathId = projectStore.getState().activePathId;
        selectionStore.getState().clearSelection();
        setSelectedPathId(nextPathId);
      } else {
        projectStore.getState().renamePath(nameAction.pathId, displayName);
        setSelectedPathId(nameAction.pathId);
      }
      setNameAction(null);
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    }
  };

  const handleExportSelectedPath = () => {
    if (!selectedPath) {
      return;
    }

    projectStore.getState().setActivePath(selectedPath.path_id);
    selectionStore.getState().clearSelection();
    onExportPath();
  };

  const handleDeleteSelectedPath = () => {
    if (!selectedPath) {
      return;
    }

    projectStore.getState().setActivePath(selectedPath.path_id);
    selectionStore.getState().clearSelection();
    onDeletePaths();
  };
  const selectedFilterLabel =
    selectedGroup?.display_name ??
    (selectedGroupId === unlabeledFilterId ? "Unlabeled" : "All Paths");
  const comparisonPaths = selectedGroup
    ? visiblePathsForGroup(project.paths, selectedGroup).filter(
        (path) => path.path_id !== activePathId,
      )
    : [];

  return (
    <div
      className="project-navigator-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="library-dialog path-library-dialog project-navigator"
        role="dialog"
        aria-modal="true"
        aria-label="Project Navigator"
        data-testid="path-library-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "F2" && selectedPath) {
            event.preventDefault();
            handleRenameSelectedPath();
          }
        }}
      >
        <header className="config-dialog__header">
          <div>
            <strong>Paths</strong>
            <span>{project.display_name} · organize with labels</span>
          </div>
          <CloseButton ariaLabel="Close paths panel" onClick={onCancel} />
        </header>

        <div className="path-library-panel__body">
          <label className="project-navigator__search">
            <Search aria-hidden="true" size={15} />
            <input
              ref={searchInputRef}
              type="search"
              aria-label="Search paths"
              placeholder="Search paths…"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>

          <section
            className="path-library-panel__section path-library-dialog__groups"
            aria-label="Labels"
          >
            <header className="path-library-panel__section-header">
              <div>
                <strong>Labels</strong>
                <span>{selectedFilterLabel}</span>
              </div>
              <div className="path-library-dialog__header-actions">
                <button
                  type="button"
                  className="path-library-panel__add-button"
                  aria-label="Create label"
                  onClick={() => setShowCreateCollectionDialog(true)}
                >
                  <PlusIcon size={14} />
                  Add label
                </button>
                <PathLibraryHeaderButton
                  label="Rename label"
                  disabled={!selectedGroup}
                  onClick={handleRenameGroup}
                >
                  <PencilIcon size={15} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Delete label"
                  tone="danger"
                  disabled={!selectedGroup}
                  onClick={() => {
                    if (selectedGroup) {
                      setDeletingGroup(selectedGroup);
                    }
                  }}
                >
                  <TrashIcon size={15} />
                </PathLibraryHeaderButton>
              </div>
            </header>
            <div
              className="path-library-dialog__group-list"
              role="listbox"
              aria-label="Label filters"
            >
              <button
                type="button"
                className={
                  !selectedGroup && selectedGroupId !== unlabeledFilterId
                    ? "path-library-dialog__group is-permanent is-selected"
                    : "path-library-dialog__group is-permanent"
                }
                role="option"
                aria-selected={
                  !selectedGroup && selectedGroupId !== unlabeledFilterId
                }
                onClick={() => handleSelectLibraryGroup(null)}
              >
                <span>All</span>
                <small>{project.paths.length}</small>
              </button>
              <button
                type="button"
                className={
                  selectedGroupId === unlabeledFilterId
                    ? "path-library-dialog__group is-selected"
                    : "path-library-dialog__group"
                }
                role="option"
                aria-selected={selectedGroupId === unlabeledFilterId}
                onClick={() => handleSelectLibraryGroup(unlabeledFilterId)}
              >
                <span>Unlabeled</span>
                <small>
                  {
                    project.paths.filter((path) =>
                      project.path_groups.every(
                        (group) => !group.path_ids.includes(path.path_id),
                      ),
                    ).length
                  }
                </small>
              </button>
              {project.path_groups.map((group) => (
                <button
                  key={group.group_id}
                  type="button"
                  className={
                    selectedGroup?.group_id === group.group_id
                      ? "path-library-dialog__group is-selected"
                      : "path-library-dialog__group"
                  }
                  role="option"
                  aria-selected={selectedGroup?.group_id === group.group_id}
                  onClick={() => handleSelectLibraryGroup(group.group_id)}
                >
                  <span>{group.display_name}</span>
                  <small>{group.path_ids.length}</small>
                </button>
              ))}
            </div>
          </section>

          <section
            className="path-library-panel__section path-library-dialog__paths"
            aria-label="Paths"
          >
            <header className="path-library-panel__section-header">
              <div>
                <strong>Paths</strong>
                <span>
                  {selectedCollectionPaths.length}{" "}
                  {selectedCollectionPaths.length === 1 ? "result" : "results"}
                </span>
              </div>
              <button
                type="button"
                className="path-library-panel__add-button"
                aria-label="Create new path"
                onClick={handleCreatePathInSelectedCollection}
              >
                <FilePlusIcon size={14} />
                Add path
              </button>
            </header>
            <div
              className="path-library-dialog__path-list"
              role="listbox"
              aria-label={`Paths filtered by ${selectedFilterLabel}`}
            >
              {selectedCollectionPaths.length > 0 ? (
                selectedCollectionPaths.map((path) => {
                  const pathLabels = project.path_groups.filter((group) =>
                    group.path_ids.includes(path.path_id),
                  );
                  return (
                    <button
                      key={path.path_id}
                      type="button"
                      role="option"
                      className={[
                        "path-library-dialog__path",
                        path.path_id === effectiveSelectedPathId
                          ? "is-selected"
                          : "",
                        path.path_id === activePathId ? "is-current" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-selected={path.path_id === effectiveSelectedPathId}
                      onClick={() => setSelectedPathId(path.path_id)}
                      onDoubleClick={() => handleUsePath(path.path_id)}
                    >
                      <span className="path-library-dialog__path-copy">
                        <strong>{path.display_name}</strong>
                        <small>{path.file_name}</small>
                      </span>
                      <span className="path-library-dialog__path-labels">
                        {pathLabels.length > 0 ? (
                          pathLabels.map((label) => (
                            <small key={label.group_id}>
                              {label.display_name}
                            </small>
                          ))
                        ) : (
                          <small className="is-muted">Unlabeled</small>
                        )}
                      </span>
                      {path.path_id === activePathId ? (
                        <span className="path-library-dialog__open-marker">
                          Open
                        </span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <div className="library-dialog__empty path-library-dialog__empty">
                  No Paths match this label and search.
                </div>
              )}
            </div>
            <div className="path-library-dialog__path-actions">
              <PathLibraryTextAction
                label="Open"
                disabled={!selectedPath}
                onClick={() => {
                  if (selectedPath) {
                    handleUsePath(selectedPath.path_id);
                  }
                }}
              >
                <OpenIcon size={15} />
              </PathLibraryTextAction>
              <PathLibraryTextAction
                label="Duplicate"
                disabled={!selectedPath}
                onClick={handleDuplicateSelectedPath}
              >
                <CopyIcon size={15} />
              </PathLibraryTextAction>
              <PathLibraryTextAction
                label="Rename"
                disabled={!selectedPath}
                onClick={handleRenameSelectedPath}
              >
                <PencilIcon size={15} />
              </PathLibraryTextAction>
              <PathLibraryTextAction
                label="Delete"
                tone="danger"
                disabled={!selectedPath}
                onClick={handleDeleteSelectedPath}
              >
                <TrashIcon size={15} />
              </PathLibraryTextAction>
            </div>
          </section>

          <section
            className="path-library-panel__section path-library-dialog__compare"
            aria-label="Compare Paths"
          >
            <header className="path-library-panel__section-header">
              <div>
                <strong>Compare Paths</strong>
                <span>
                  {selectedGroup
                    ? `${comparisonPaths.length} other ${comparisonPaths.length === 1 ? "Path" : "Paths"} with ${selectedGroup.display_name}`
                    : "Choose a label to define the overlay set"}
                </span>
              </div>
              <button
                type="button"
                className={
                  showGhostPaths
                    ? "path-library-dialog__overlay-toggle is-active"
                    : "path-library-dialog__overlay-toggle"
                }
                aria-pressed={showGhostPaths}
                disabled={!selectedGroup}
                onClick={() => onShowGhostPathsChange(!showGhostPaths)}
              >
                {showGhostPaths ? (
                  <Eye aria-hidden="true" size={15} />
                ) : (
                  <EyeOff aria-hidden="true" size={15} />
                )}
                {showGhostPaths ? "Shown" : "Hidden"}
              </button>
            </header>
            {selectedGroup ? (
              <div className="path-library-dialog__compare-list">
                {comparisonPaths.length > 0 ? (
                  comparisonPaths.map((path) => (
                    <button
                      type="button"
                      key={path.path_id}
                      onClick={() => handleUsePath(path.path_id)}
                    >
                      <span aria-hidden="true" />
                      <strong>{path.display_name}</strong>
                      <small>Open</small>
                    </button>
                  ))
                ) : (
                  <p>Add another Path to this label to compare it.</p>
                )}
              </div>
            ) : null}
          </section>

          <section
            className="path-library-panel__section path-library-dialog__details"
            aria-label="Label membership"
          >
            <header className="path-library-panel__section-header">
              <div>
                <strong>Labels on Path</strong>
                <span>{selectedPath?.display_name ?? "Select a Path"}</span>
              </div>
            </header>
            {selectedPath ? (
              <div className="path-library-dialog__membership-list">
                {project.path_groups.length > 0 ? (
                  project.path_groups.map((group) => (
                    <label
                      key={group.group_id}
                      className={
                        group.group_id === selectedGroup?.group_id
                          ? "path-library-dialog__membership-row is-current"
                          : "path-library-dialog__membership-row"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={group.path_ids.includes(selectedPath.path_id)}
                        onChange={(event) =>
                          handleToggleSelectedPathMembership(
                            group.group_id,
                            event.currentTarget.checked,
                          )
                        }
                      />
                      <span>{group.display_name}</span>
                      <small>
                        {group.path_ids.includes(selectedPath.path_id)
                          ? "Assigned"
                          : "Add"}
                      </small>
                    </label>
                  ))
                ) : (
                  <button
                    type="button"
                    className="path-library-dialog__empty-label-action"
                    onClick={() => setShowCreateCollectionDialog(true)}
                  >
                    Create the first label
                  </button>
                )}
              </div>
            ) : (
              <div className="library-dialog__empty path-library-dialog__empty">
                Select a Path to add or remove labels.
              </div>
            )}
          </section>
        </div>

        <footer className="path-library-panel__footer">
          <div>
            <button
              type="button"
              className="path-library-panel__secondary-action"
              onClick={onImportPath}
            >
              <UploadIcon size={14} />
              Import
            </button>
            <button
              type="button"
              className="path-library-panel__secondary-action"
              disabled={!selectedPath}
              onClick={handleExportSelectedPath}
            >
              <DownloadIcon size={14} />
              Export
            </button>
          </div>
          <button type="button" onClick={onCancel}>
            Close
          </button>
        </footer>
      </section>

      {deletingGroup ? (
        <DeleteLabelDialog
          group={deletingGroup}
          onCancel={() => setDeletingGroup(null)}
          onDelete={() => {
            projectStore.getState().deletePathGroup(deletingGroup.group_id);
            selectionStore.getState().clearSelection();
            setSelectedGroupId(null);
            setDeletingGroup(null);
          }}
        />
      ) : null}
      {showCreateCollectionDialog ? (
        <CreateLabelDialog
          onCancel={() => setShowCreateCollectionDialog(false)}
          onCreate={handleCreateGroup}
        />
      ) : null}
      {nameAction ? (
        <NameEntryDialog
          ariaLabel={
            nameAction.kind === "rename-group"
              ? "Rename Label"
              : nameAction.kind === "duplicate-path"
                ? "Save Path As"
                : "Rename Path"
          }
          title={
            nameAction.kind === "rename-group"
              ? "Rename Label"
              : nameAction.kind === "duplicate-path"
                ? "Save Path As"
                : "Rename Path"
          }
          description={
            nameAction.kind === "rename-group"
              ? "Update this label name without changing its Paths."
              : nameAction.kind === "duplicate-path"
                ? "Create a separate editable copy of this path."
                : "Update the path name everywhere it appears in this project."
          }
          fieldLabel={
            nameAction.kind === "rename-group" ? "Label name" : "Path name"
          }
          initialValue={nameAction.initialName}
          submitLabel={
            nameAction.kind === "duplicate-path" ? "Save Copy" : "Rename"
          }
          onCancel={() => setNameAction(null)}
          onSubmit={handleConfirmNameAction}
        />
      ) : null}
    </div>
  );
}

function PathLibraryHeaderButton({
  children,
  disabled = false,
  label,
  onClick,
  tone = "neutral",
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick(): void;
  tone?: "danger" | "neutral";
}) {
  return (
    <IconButton
      className={`path-library-dialog__header-button path-library-dialog__header-button--${tone}`}
      aria-label={label}
      title={label}
      tone={tone === "danger" ? "danger" : "accent"}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </IconButton>
  );
}

function PathLibraryTextAction({
  children,
  disabled = false,
  label,
  onClick,
  tone = "neutral",
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick(): void;
  tone?: "danger" | "neutral";
}) {
  return (
    <button
      type="button"
      className={`path-library-dialog__text-action path-library-dialog__text-action--${tone}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      {label}
    </button>
  );
}

function DeleteLabelDialog({
  group,
  onCancel,
  onDelete,
}: {
  group: ProjectPathGroup;
  onCancel(): void;
  onDelete(): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLFormElement>();

  return (
    <div className="path-library-modal-backdrop" role="presentation">
      <form
        ref={dialogRef}
        className="path-library-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Delete Label"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          onDelete();
        }}
      >
        <header>
          <div>
            <strong>Delete Label</strong>
            <span>{group.display_name}</span>
          </div>
          <CloseButton ariaLabel="Close delete label" onClick={onCancel} />
        </header>
        <p>
          This removes the label from {group.path_ids.length}{" "}
          {group.path_ids.length === 1 ? "Path" : "Paths"}. The Paths themselves
          will stay in the project.
        </p>
        <footer>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="danger-dialog-action">
            Delete Label
          </button>
        </footer>
      </form>
    </div>
  );
}

function CreateLabelDialog({
  onCancel,
  onCreate,
}: {
  onCancel(): void;
  onCreate(displayName: string): void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      className="path-library-create-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Create label"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(displayName.trim() || "New Label");
      }}
    >
      <header>
        <strong>Create Label</strong>
        <CloseButton ariaLabel="Close create label" onClick={onCancel} />
      </header>
      <label className="dialog-field">
        <span>Label name</span>
        <input
          ref={inputRef}
          aria-label="Label name"
          data-testid="path-collection-new-name"
          type="text"
          value={displayName}
          placeholder="Score autos"
          onChange={(event) => setDisplayName(event.currentTarget.value)}
        />
      </label>
      <footer>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="primary-dialog-action"
          data-testid="create-path-collection"
        >
          Create
        </button>
      </footer>
    </form>
  );
}

function visiblePathsForGroup(
  paths: readonly ProjectPath[],
  group: ProjectPathGroup | null,
): ProjectPath[] {
  if (!group) {
    return [...paths];
  }

  return group.path_ids.flatMap((pathId) => {
    const path = paths.find((candidate) => candidate.path_id === pathId);
    return path ? [path] : [];
  });
}

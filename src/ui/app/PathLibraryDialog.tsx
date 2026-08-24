import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MoreHorizontal, Search } from "lucide-react";
import type {
  Project,
  ProjectPath,
  ProjectPathGroup,
} from "../../core/model/project";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import { isEditableShortcutTarget } from "../keyboardShortcuts";
import { PlusIcon } from "../icons";
import { CloseButton } from "../controls";
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
type LibraryMode = "browse" | "manage";

export function PathLibraryDialog({
  project,
  activePathId,
  activePathGroupId,
  onCancel,
  onDeletePaths,
}: {
  project: Project;
  activePathId: string | null;
  activePathGroupId: string | null;
  onCancel(): void;
  onDeletePaths(): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<LibraryMode>("browse");
  const [selectedGroupId, setSelectedGroupId] = useState<
    string | null | typeof unlabeledFilterId
  >(activePathGroupId);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(
    activePathId ?? project.paths[0]?.path_id ?? null,
  );
  const [query, setQuery] = useState("");
  const [openPathMenuId, setOpenPathMenuId] = useState<string | null>(null);
  const [openLabelMenuId, setOpenLabelMenuId] = useState<string | null>(null);
  const [showCreateLabelDialog, setShowCreateLabelDialog] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<ProjectPathGroup | null>(
    null,
  );
  const [nameAction, setNameAction] = useState<LibraryNameAction | null>(null);

  useEffect(() => {
    if (mode === "browse") {
      searchInputRef.current?.focus();
    }
  }, [mode]);

  useEffect(() => {
    const handleHistoryShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        deletingGroup ||
        showCreateLabelDialog ||
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
  }, [deletingGroup, nameAction, showCreateLabelDialog]);

  const selectedGroup =
    project.path_groups.find((group) => group.group_id === selectedGroupId) ??
    null;
  const unlabeledPathCount = project.paths.filter((path) =>
    project.path_groups.every(
      (group) => !group.path_ids.includes(path.path_id),
    ),
  ).length;
  const pathsForSelectedFilter =
    selectedGroupId === unlabeledFilterId
      ? project.paths.filter((path) =>
          project.path_groups.every(
            (group) => !group.path_ids.includes(path.path_id),
          ),
        )
      : visiblePathsForGroup(project.paths, selectedGroup);
  const filteredPaths = pathsForSelectedFilter.filter((path) => {
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
    filteredPaths.some((path) => path.path_id === selectedPathFromState.path_id)
      ? selectedPathFromState
      : (filteredPaths.find((path) => path.path_id === activePathId) ??
        filteredPaths[0] ??
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
    setSelectedPathId(pathId);
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
    setShowCreateLabelDialog(false);
  };

  const handleRenameGroup = (group: ProjectPathGroup) => {
    setNameAction({
      kind: "rename-group",
      groupId: group.group_id,
      initialName: group.display_name,
    });
  };

  const handleTogglePathMembership = (
    groupId: string,
    pathId: string,
    checked: boolean,
  ) => {
    if (checked) {
      projectStore.getState().addPathsToGroup(groupId, [pathId]);
    } else {
      projectStore.getState().removePathsFromGroup(groupId, [pathId]);
    }
    selectionStore.getState().clearSelection();
  };

  const handleDuplicatePath = (path: ProjectPath) => {
    setNameAction({
      kind: "duplicate-path",
      pathId: path.path_id,
      initialName: path.display_name,
      addToGroupId: selectedGroup?.group_id ?? null,
    });
  };

  const handleRenamePath = (path: ProjectPath) => {
    setNameAction({
      kind: "rename-path",
      pathId: path.path_id,
      initialName: path.display_name,
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

  const handleDeletePath = (path: ProjectPath) => {
    projectStore.getState().setActivePath(path.path_id);
    selectionStore.getState().clearSelection();
    onDeletePaths();
  };
  const selectedFilterLabel =
    selectedGroup?.display_name ??
    (selectedGroupId === unlabeledFilterId ? "Unlabeled" : "All Paths");
  const handleEnterManageMode = () => {
    const nextGroup =
      selectedGroup ??
      project.path_groups.find(
        (group) => group.group_id === activePathGroupId,
      ) ??
      project.path_groups[0] ??
      null;

    setOpenPathMenuId(null);
    setMode("manage");
    if (nextGroup) {
      setSelectedGroupId(nextGroup.group_id);
    }
  };

  const handleReturnToBrowse = () => {
    setOpenLabelMenuId(null);
    projectStore
      .getState()
      .setActivePathGroup(selectedGroup?.group_id ?? null);
    selectionStore.getState().clearSelection();
    setMode("browse");
  };

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
            if (openPathMenuId || openLabelMenuId) {
              setOpenPathMenuId(null);
              setOpenLabelMenuId(null);
            } else if (mode === "manage") {
              handleReturnToBrowse();
            } else {
              onCancel();
            }
          } else if (event.key === "F2" && selectedPath) {
            event.preventDefault();
            handleRenamePath(selectedPath);
          }
        }}
      >
        {mode === "browse" ? (
          <>
            <header className="config-dialog__header">
              <div>
                <strong>Paths</strong>
                <span>Switch and filter without leaving the field</span>
              </div>
              <CloseButton ariaLabel="Close" onClick={onCancel} />
            </header>

            <div className="path-library-dialog__browse-controls">
              <label className="project-navigator__search">
                <Search aria-hidden="true" size={15} />
                <input
                  ref={searchInputRef}
                  type="search"
                  aria-label="Search paths"
                  placeholder="Search Paths…"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </label>
              <div
                className="path-library-dialog__group-list"
                role="listbox"
                aria-label="Labels"
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
                  <small>{unlabeledPathCount}</small>
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
            </div>

            <div
              className="path-library-dialog__path-list"
              role="listbox"
              aria-label={`Paths filtered by ${selectedFilterLabel}`}
            >
              {filteredPaths.length > 0 ? (
                filteredPaths.map((path) => (
                  <div
                    key={path.path_id}
                    className={
                      openPathMenuId === path.path_id
                        ? "path-library-dialog__path-row is-menu-open"
                        : "path-library-dialog__path-row"
                    }
                  >
                    <button
                      type="button"
                      role="option"
                      className={
                        path.path_id === activePathId
                          ? "path-library-dialog__path is-current"
                          : "path-library-dialog__path"
                      }
                      aria-selected={path.path_id === activePathId}
                      onClick={() => handleUsePath(path.path_id)}
                    >
                      <span className="path-library-dialog__path-copy">
                        <strong>{path.display_name}</strong>
                        <small>{path.file_name}</small>
                      </span>
                      {path.path_id === activePathId ? (
                        <span className="path-library-dialog__open-marker">
                          Open
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="path-library-dialog__path-menu-trigger"
                      aria-label={`More actions for ${path.display_name}`}
                      aria-haspopup="menu"
                      aria-expanded={openPathMenuId === path.path_id}
                      onClick={() => {
                        setSelectedPathId(path.path_id);
                        setOpenPathMenuId((current) =>
                          current === path.path_id ? null : path.path_id,
                        );
                      }}
                    >
                      <MoreHorizontal aria-hidden="true" size={17} />
                    </button>
                    {openPathMenuId === path.path_id ? (
                      <div
                        className="path-library-dialog__row-menu"
                        role="menu"
                        aria-label={`${path.display_name} actions`}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenPathMenuId(null);
                            handleDuplicatePath(path);
                          }}
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenPathMenuId(null);
                            handleRenamePath(path);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="is-danger"
                          onClick={() => {
                            setOpenPathMenuId(null);
                            handleDeletePath(path);
                          }}
                        >
                          Delete…
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="library-dialog__empty path-library-dialog__empty">
                  No Paths match this label and search.
                </div>
              )}
            </div>

            <footer className="path-library-panel__footer">
              <span>
                {filteredPaths.length}{" "}
                {filteredPaths.length === 1 ? "Path" : "Paths"}
              </span>
              <button type="button" onClick={handleEnterManageMode}>
                Manage labels…
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className="path-library-dialog__manage-header">
              <button
                type="button"
                className="path-library-dialog__back-button"
                aria-label="Back to Paths"
                onClick={handleReturnToBrowse}
              >
                <ArrowLeft aria-hidden="true" size={16} />
              </button>
              <div>
                <strong>Manage labels</strong>
                <span>Choose a label, then the Paths that belong to it</span>
              </div>
              <button
                type="button"
                className="path-library-dialog__done-button"
                onClick={handleReturnToBrowse}
              >
                Done
              </button>
            </header>

            <div className="path-library-dialog__manage-body">
              <section
                className="path-library-dialog__manage-labels"
                aria-label="Manage labels"
              >
                <header className="path-library-dialog__manage-section-header">
                  <div>
                    <strong>Labels</strong>
                    <span>{project.path_groups.length} total</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Create label"
                    onClick={() => setShowCreateLabelDialog(true)}
                  >
                    <PlusIcon size={14} />
                    New label
                  </button>
                </header>
                {project.path_groups.length > 0 ? (
                  <div className="path-library-dialog__manage-label-list">
                    {project.path_groups.map((group) => (
                      <div
                        key={group.group_id}
                        className="path-library-dialog__manage-label-row"
                      >
                        <button
                          type="button"
                          className={
                            selectedGroup?.group_id === group.group_id
                              ? "path-library-dialog__manage-label is-selected"
                              : "path-library-dialog__manage-label"
                          }
                          onClick={() => setSelectedGroupId(group.group_id)}
                        >
                          <span aria-hidden="true" />
                          <strong>{group.display_name}</strong>
                          <small>
                            {group.path_ids.length}{" "}
                            {group.path_ids.length === 1 ? "Path" : "Paths"}
                          </small>
                        </button>
                        <button
                          type="button"
                          className="path-library-dialog__label-menu-trigger"
                          aria-label={`Label actions for ${group.display_name}`}
                          aria-haspopup="menu"
                          aria-expanded={openLabelMenuId === group.group_id}
                          onClick={() => {
                            setSelectedGroupId(group.group_id);
                            setOpenLabelMenuId((current) =>
                              current === group.group_id ? null : group.group_id,
                            );
                          }}
                        >
                          <MoreHorizontal aria-hidden="true" size={17} />
                        </button>
                        {openLabelMenuId === group.group_id ? (
                          <div
                            className="path-library-dialog__label-menu"
                            role="menu"
                            aria-label={`${group.display_name} label actions`}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              aria-label="Rename label"
                              onClick={() => {
                                setOpenLabelMenuId(null);
                                handleRenameGroup(group);
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="is-danger"
                              aria-label="Delete label"
                              onClick={() => {
                                setOpenLabelMenuId(null);
                                setDeletingGroup(group);
                              }}
                            >
                              Delete…
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="path-library-dialog__manage-empty">
                    <p>Create a label, then choose which Paths belong to it.</p>
                  </div>
                )}
              </section>

              <section
                className="path-library-dialog__manage-memberships"
                aria-label="Label membership"
              >
                <header className="path-library-dialog__manage-section-header">
                  <div>
                    <strong>
                      {selectedGroup
                        ? `Paths with ${selectedGroup.display_name}`
                        : "Paths"}
                    </strong>
                    <span>
                      {selectedGroup
                        ? "Check a Path to add it"
                        : "Create or select a label first"}
                    </span>
                  </div>
                </header>
                {selectedGroup ? (
                  <div className="path-library-dialog__membership-list">
                    {project.paths.map((path) => (
                      <label
                        key={path.path_id}
                        className="path-library-dialog__membership-row"
                      >
                        <input
                          type="checkbox"
                          checked={selectedGroup.path_ids.includes(path.path_id)}
                          onChange={(event) =>
                            handleTogglePathMembership(
                              selectedGroup.group_id,
                              path.path_id,
                              event.currentTarget.checked,
                            )
                          }
                        />
                        <span>
                          <strong>{path.display_name}</strong>
                          <small>{path.file_name}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="path-library-dialog__manage-empty">
                    <p>No label selected.</p>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </section>

      {deletingGroup ? (
        <DeleteLabelDialog
          group={deletingGroup}
          onCancel={() => setDeletingGroup(null)}
          onDelete={() => {
            const nextGroup =
              project.path_groups.find(
                (group) => group.group_id !== deletingGroup.group_id,
              ) ?? null;
            projectStore.getState().deletePathGroup(deletingGroup.group_id);
            selectionStore.getState().clearSelection();
            setSelectedGroupId(nextGroup?.group_id ?? null);
            setDeletingGroup(null);
          }}
        />
      ) : null}
      {showCreateLabelDialog ? (
        <CreateLabelDialog
          onCancel={() => setShowCreateLabelDialog(false)}
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

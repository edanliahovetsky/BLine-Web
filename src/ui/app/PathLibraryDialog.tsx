import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
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
import { DeletePathGroupDialog, NameEntryDialog } from "./ProjectDialogs";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
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

export function PathLibraryDialog({
  project,
  activePathId,
  activePathGroupId,
  onCancel,
  onCreatePath,
  onDeletePaths,
  onExportPath,
  onImportPath,
}: {
  project: Project;
  activePathId: string | null;
  activePathGroupId: string | null;
  onCancel(): void;
  onCreatePath(groupId: string | null): void;
  onDeletePaths(): void;
  onExportPath(): void;
  onImportPath(): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    activePathGroupId,
  );
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
  const selectedCollectionPaths = visiblePathsForGroup(
    project.paths,
    selectedGroup,
  ).filter((path) => {
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
  const handleSelectLibraryGroup = (groupId: string | null) => {
    const nextGroup =
      project.path_groups.find((group) => group.group_id === groupId) ?? null;
    const nextPaths = visiblePathsForGroup(project.paths, nextGroup);

    setSelectedGroupId(groupId);
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
    selectionStore.getState().clearSelection();
    onDeletePaths();
  };

  return (
    <div className="project-navigator-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="path-library-dialog project-navigator"
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
            <strong>Project Navigator</strong>
            <span>{project.display_name}</span>
          </div>
          <CloseButton ariaLabel="Close project navigator" onClick={onCancel} />
        </header>

        <div className="path-library-dialog__utility-bar">
          <div className="path-library-dialog__selection-summary">
            <strong>{selectedGroup?.display_name ?? "All Paths"}</strong>
            <span>
              {selectedCollectionPaths.length}{" "}
              {selectedCollectionPaths.length === 1 ? "path" : "paths"} visible
            </span>
          </div>
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
          <div className="path-library-dialog__utility-actions">
            <button
              type="button"
              className="path-library-dialog__utility-button"
              onClick={onImportPath}
            >
              <UploadIcon size={17} />
              <span>Import Path</span>
            </button>
            <button
              type="button"
              className="path-library-dialog__utility-button"
              disabled={!selectedPath}
              onClick={handleExportSelectedPath}
            >
              <DownloadIcon size={17} />
              <span>Export Path</span>
            </button>
          </div>
        </div>

        <div className="path-library-dialog__body">
          <aside
            className="path-library-dialog__groups"
            aria-label="Collections"
          >
            <div className="path-library-dialog__column-header path-library-dialog__column-header--action">
              <strong>Collections</strong>
              <div className="path-library-dialog__header-actions">
                <PathLibraryHeaderButton
                  label="Create collection"
                  onClick={() => setShowCreateCollectionDialog(true)}
                >
                  <PlusIcon size={17} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Rename collection"
                  disabled={!selectedGroup}
                  onClick={handleRenameGroup}
                >
                  <PencilIcon size={16} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Delete collection"
                  tone="danger"
                  disabled={!selectedGroup}
                  onClick={() => {
                    if (selectedGroup) {
                      setDeletingGroup(selectedGroup);
                    }
                  }}
                >
                  <TrashIcon size={16} />
                </PathLibraryHeaderButton>
              </div>
            </div>
            <div
              className="path-library-dialog__group-list"
              role="listbox"
              aria-label="Collection list"
            >
              <button
                type="button"
                className={[
                  "path-library-dialog__group",
                  "is-permanent",
                  !selectedGroup ? "is-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="option"
                aria-selected={!selectedGroup}
                onClick={() => handleSelectLibraryGroup(null)}
              >
                <span>All Paths</span>
                <small>
                  Permanent collection / {project.paths.length} paths
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
                  <small>
                    {group.path_ids.length}{" "}
                    {group.path_ids.length === 1 ? "path" : "paths"}
                    {activePathGroupId === group.group_id ? " / active" : ""}
                  </small>
                </button>
              ))}
            </div>
          </aside>

          <section
            className="path-library-dialog__paths"
            aria-label="Paths in selected collection"
          >
            <div className="path-library-dialog__column-header path-library-dialog__column-header--action">
              <strong>Paths</strong>
              <div className="path-library-dialog__header-actions">
                <PathLibraryHeaderButton
                  label="Open path"
                  disabled={!selectedPath}
                  onClick={() => {
                    if (selectedPath) {
                      handleUsePath(selectedPath.path_id);
                    }
                  }}
                >
                  <OpenIcon size={16} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Save path as"
                  disabled={!selectedPath}
                  onClick={handleDuplicateSelectedPath}
                >
                  <CopyIcon size={16} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Create new path"
                  onClick={handleCreatePathInSelectedCollection}
                >
                  <FilePlusIcon size={16} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Rename path"
                  disabled={!selectedPath}
                  onClick={handleRenameSelectedPath}
                >
                  <PencilIcon size={16} />
                </PathLibraryHeaderButton>
                <PathLibraryHeaderButton
                  label="Delete path"
                  tone="danger"
                  disabled={!selectedPath}
                  onClick={handleDeleteSelectedPath}
                >
                  <TrashIcon size={16} />
                </PathLibraryHeaderButton>
              </div>
            </div>
            <div
              className="path-library-dialog__path-list"
              role="listbox"
              aria-label="Path list"
            >
              {selectedCollectionPaths.length > 0 ? (
                selectedCollectionPaths.map((path) => (
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
                    <span>{path.display_name}</span>
                    <small>
                      {path.file_name}
                      {path.path_id === activePathId ? " / open" : ""}
                    </small>
                  </button>
                ))
              ) : (
                <div className="path-library-dialog__empty">
                  No paths are in this collection yet.
                </div>
              )}
            </div>
          </section>

          <section
            className="path-library-dialog__details"
            aria-label="Collection membership"
          >
            <div className="path-library-dialog__column-header">
              <strong>Membership</strong>
              <span>
                {selectedPath ? selectedPath.display_name : "No path"}
              </span>
            </div>
            <div className="path-library-dialog__details-scroll">
              {selectedPath ? (
                <section className="path-library-dialog__membership">
                  <div className="path-library-dialog__subhead">
                    <strong>{selectedPath.file_name}</strong>
                    <span>{project.path_groups.length + 1} collections</span>
                  </div>
                  <div className="path-library-dialog__membership-list">
                    <label className="path-library-dialog__membership-row is-permanent">
                      <input type="checkbox" checked disabled />
                      <span>All Paths</span>
                      <small>Permanent</small>
                    </label>
                    {project.path_groups.map((group) => (
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
                          checked={group.path_ids.includes(
                            selectedPath.path_id,
                          )}
                          onChange={(event) =>
                            handleToggleSelectedPathMembership(
                              group.group_id,
                              event.currentTarget.checked,
                            )
                          }
                        />
                        <span>{group.display_name}</span>
                        <small>
                          {group.path_ids.length}{" "}
                          {group.path_ids.length === 1 ? "path" : "paths"}
                        </small>
                      </label>
                    ))}
                  </div>
                </section>
              ) : (
                <div className="path-library-dialog__empty">
                  Select a path to manage collection membership.
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="config-dialog__footer path-library-dialog__footer">
          <button type="button" onClick={onCancel}>
            Close
          </button>
        </footer>
      </section>

      {deletingGroup ? (
        <DeletePathGroupDialog
          group={deletingGroup}
          memberPaths={visiblePathsForGroup(project.paths, deletingGroup)}
          onCancel={() => setDeletingGroup(null)}
          onDelete={(deleteMemberPaths) => {
            projectStore
              .getState()
              .deletePathGroup(deletingGroup.group_id, { deleteMemberPaths });
            selectionStore.getState().clearSelection();
            setDeletingGroup(null);
          }}
        />
      ) : null}
      {showCreateCollectionDialog ? (
        <CreateCollectionDialog
          onCancel={() => setShowCreateCollectionDialog(false)}
          onCreate={handleCreateGroup}
        />
      ) : null}
      {nameAction ? (
        <NameEntryDialog
          ariaLabel={
            nameAction.kind === "rename-group"
              ? "Rename Collection"
              : nameAction.kind === "duplicate-path"
                ? "Save Path As"
                : "Rename Path"
          }
          title={
            nameAction.kind === "rename-group"
              ? "Rename Collection"
              : nameAction.kind === "duplicate-path"
                ? "Save Path As"
                : "Rename Path"
          }
          description={
            nameAction.kind === "rename-group"
              ? "Update this collection name without changing its paths."
              : nameAction.kind === "duplicate-path"
                ? "Create a separate editable copy of this path."
                : "Update the path name everywhere it appears in this project."
          }
          fieldLabel={
            nameAction.kind === "rename-group" ? "Collection name" : "Path name"
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

function CreateCollectionDialog({
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
      aria-label="Create collection"
      onSubmit={(event) => {
        event.preventDefault();
        onCreate(displayName.trim() || "New Collection");
      }}
    >
      <header>
        <strong>Create Collection</strong>
        <CloseButton ariaLabel="Close create collection" onClick={onCancel} />
      </header>
      <label className="dialog-field">
        <span>Collection name</span>
        <input
          ref={inputRef}
          aria-label="Collection name"
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

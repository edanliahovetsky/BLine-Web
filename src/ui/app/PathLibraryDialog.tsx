import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type {
  Project,
  ProjectPath,
  ProjectPathGroup,
} from "../../core/model/project";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import { isEditableShortcutTarget } from "../keyboardShortcuts";
import { CloseButton } from "../controls";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import "./LibraryDialog.css";
import "./ProjectLibraryDialogs.css";

type InlineEdit =
  | { kind: "collection"; id: string; value: string }
  | { kind: "path"; id: string; value: string };

interface DraggedPaths {
  pathIds: string[];
  sourceGroupId: string | null;
}

const pathDragType = "application/x-bline-paths";

export function PathLibraryDialog({
  project,
  activePathId,
  activePathGroupId,
  onCancel,
  onCreatePath,
  onDeletePaths,
}: {
  project: Project;
  activePathId: string | null;
  activePathGroupId: string | null;
  onCancel(): void;
  onCreatePath(groupId: string | null): void;
  onDeletePaths(pathIds: readonly string[]): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const skipBlurCommitRef = useRef(false);
  const initialGroupId =
    project.path_groups.find((group) => group.group_id === activePathGroupId)
      ?.group_id ??
    project.path_groups[0]?.group_id ??
    null;
  const initialPathId = activePathId ?? project.paths[0]?.path_id ?? null;

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    initialGroupId,
  );
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set(initialGroupId ? [initialGroupId] : []),
  );
  const [selectedPathIds, setSelectedPathIds] = useState<Set<string>>(
    () => new Set(initialPathId ? [initialPathId] : []),
  );
  const [query, setQuery] = useState("");
  const [openCollectionMenuId, setOpenCollectionMenuId] = useState<
    string | null
  >(null);
  const [showMembershipMenu, setShowMembershipMenu] = useState(false);
  const [editing, setEditing] = useState<InlineEdit | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<ProjectPathGroup | null>(
    null,
  );
  const [dragSourceGroupId, setDragSourceGroupId] = useState<string | null>(
    null,
  );
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [isRemovingDropTarget, setIsRemovingDropTarget] = useState(false);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleHistoryShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        deletingGroup ||
        editing ||
        isEditableShortcutTarget(event.target)
      ) {
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (!modifier || event.altKey || (key !== "z" && key !== "y")) {
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
  }, [deletingGroup, editing]);

  const selectedGroup =
    project.path_groups.find((group) => group.group_id === selectedGroupId) ??
    null;
  const visibleSelectedPathIds = useMemo(() => {
    const validPathIds = new Set(project.paths.map((path) => path.path_id));
    return new Set(
      [...selectedPathIds].filter((pathId) => validPathIds.has(pathId)),
    );
  }, [project.paths, selectedPathIds]);
  const selectedPaths = project.paths.filter((path) =>
    visibleSelectedPathIds.has(path.path_id),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const sortedPaths = useMemo(
    () =>
      [...project.paths]
        .filter(
          (path) =>
            !normalizedQuery ||
            path.display_name.toLocaleLowerCase().includes(normalizedQuery) ||
            path.file_name.toLocaleLowerCase().includes(normalizedQuery),
        )
        .sort((left, right) => {
          const membershipDifference =
            collectionMemberships(project, right.path_id).length -
            collectionMemberships(project, left.path_id).length;
          return (
            membershipDifference ||
            left.display_name.localeCompare(right.display_name, undefined, {
              sensitivity: "base",
            })
          );
        }),
    [normalizedQuery, project],
  );

  const closeTransientUi = () => {
    setOpenCollectionMenuId(null);
    setShowMembershipMenu(false);
  };

  const handleSelectCollection = (group: ProjectPathGroup) => {
    closeTransientUi();
    setSelectedGroupId(group.group_id);
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      next.add(group.group_id);
      return next;
    });
    projectStore.getState().setActivePathGroup(group.group_id);
    selectionStore.getState().clearSelection();
  };

  const handleUsePath = (pathId: string, groupId = selectedGroupId) => {
    const group = project.path_groups.find(
      (candidate) => candidate.group_id === groupId,
    );
    projectStore
      .getState()
      .setActivePathGroup(
        group?.path_ids.includes(pathId) ? group.group_id : null,
      );
    projectStore.getState().setActivePath(pathId);
    selectionStore.getState().clearSelection();
  };

  const handleSelectPath = (
    event: Pick<ReactMouseEvent, "ctrlKey" | "metaKey" | "shiftKey">,
    pathId: string,
    groupId = selectedGroupId,
  ) => {
    const extendSelection = event.metaKey || event.ctrlKey || event.shiftKey;
    setSelectedPathIds((current) => {
      if (!extendSelection) {
        return new Set([pathId]);
      }
      const next = new Set(current);
      if (next.has(pathId) && next.size > 1) {
        next.delete(pathId);
      } else {
        next.add(pathId);
      }
      return next;
    });
    handleUsePath(pathId, groupId);
  };

  const beginCollectionRename = (group: ProjectPathGroup) => {
    closeTransientUi();
    setSelectedGroupId(group.group_id);
    setEditing({
      kind: "collection",
      id: group.group_id,
      value: group.display_name,
    });
  };

  const beginPathRename = (path: ProjectPath) => {
    closeTransientUi();
    setSelectedPathIds(new Set([path.path_id]));
    setEditing({ kind: "path", id: path.path_id, value: path.display_name });
  };

  const commitInlineEdit = (value = editing?.value ?? "") => {
    if (!editing) {
      return;
    }
    try {
      if (editing.kind === "collection") {
        projectStore
          .getState()
          .renamePathGroup(editing.id, value.trim() || "Untitled Collection");
      } else {
        projectStore
          .getState()
          .renamePath(editing.id, value.trim() || "Untitled Path");
      }
      setEditing(null);
    } catch (caughtError) {
      projectStore.getState().markSaveError(caughtError);
    }
  };

  const handleInlineEditKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commitInlineEdit(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      skipBlurCommitRef.current = true;
      setEditing(null);
    }
  };

  const handleInlineEditBlur = (value: string) => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    commitInlineEdit(value);
  };

  const createCollection = (
    source?: Pick<ProjectPathGroup, "display_name" | "path_ids">,
  ) => {
    const baseName = source ? `${source.display_name} Copy` : "New Collection";
    const displayName = uniqueName(
      baseName,
      project.path_groups.map((group) => group.display_name),
    );
    projectStore.getState().createPathGroup({
      displayName,
      activePathId: source?.path_ids[0] ?? null,
      pathIds: source?.path_ids ?? [],
      makeActive: true,
    });
    const createdGroupId = projectStore.getState().activePathGroupId;
    if (createdGroupId) {
      setSelectedGroupId(createdGroupId);
      setExpandedGroupIds((current) => new Set([...current, createdGroupId]));
      setEditing({
        kind: "collection",
        id: createdGroupId,
        value: displayName,
      });
    }
    closeTransientUi();
  };

  const duplicateSelectedPath = () => {
    const path = selectedPaths.length === 1 ? selectedPaths[0] : null;
    if (!path) {
      return;
    }
    const displayName = uniqueName(
      `${path.display_name} Copy`,
      project.paths.map((candidate) => candidate.display_name),
    );
    projectStore.getState().duplicatePath(path.path_id, displayName, {
      addToGroupId: selectedGroup?.group_id ?? null,
    });
    const createdPathId = projectStore.getState().activePathId;
    if (createdPathId) {
      setSelectedPathIds(new Set([createdPathId]));
      setEditing({ kind: "path", id: createdPathId, value: displayName });
    }
  };

  const toggleMembership = (group: ProjectPathGroup) => {
    if (selectedPaths.length === 0) {
      return;
    }
    const pathIds = selectedPaths.map((path) => path.path_id);
    const allIncluded = pathIds.every((pathId) =>
      group.path_ids.includes(pathId),
    );
    if (allIncluded) {
      projectStore.getState().removePathsFromGroup(group.group_id, pathIds);
    } else {
      projectStore.getState().addPathsToGroup(group.group_id, pathIds);
    }
    selectionStore.getState().clearSelection();
  };

  const setDragData = (
    event: ReactDragEvent,
    pathIds: string[],
    sourceGroupId: string | null,
  ) => {
    const payload: DraggedPaths = { pathIds, sourceGroupId };
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(pathDragType, JSON.stringify(payload));
    setDragSourceGroupId(sourceGroupId);
  };

  const readDragData = (event: ReactDragEvent): DraggedPaths | null => {
    try {
      const value = event.dataTransfer.getData(pathDragType);
      return value ? (JSON.parse(value) as DraggedPaths) : null;
    } catch {
      return null;
    }
  };

  const handleDropOnCollection = (
    event: ReactDragEvent,
    group: ProjectPathGroup,
  ) => {
    event.preventDefault();
    const payload = readDragData(event);
    if (payload?.pathIds.length) {
      projectStore.getState().addPathsToGroup(group.group_id, payload.pathIds);
      setSelectedGroupId(group.group_id);
      setExpandedGroupIds((current) => new Set([...current, group.group_id]));
    }
    setDragOverGroupId(null);
    setDragSourceGroupId(null);
  };

  const handleDropOnAllPaths = (event: ReactDragEvent) => {
    event.preventDefault();
    const payload = readDragData(event);
    if (payload?.sourceGroupId && payload.pathIds.length) {
      projectStore
        .getState()
        .removePathsFromGroup(payload.sourceGroupId, payload.pathIds);
    }
    setIsRemovingDropTarget(false);
    setDragSourceGroupId(null);
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
          if (
            event.key === "Escape" &&
            !isEditableShortcutTarget(event.target)
          ) {
            event.preventDefault();
            if (openCollectionMenuId || showMembershipMenu) {
              closeTransientUi();
            } else {
              onCancel();
            }
          } else if (event.key === "F2" && selectedPaths.length === 1) {
            event.preventDefault();
            beginPathRename(selectedPaths[0]);
          }
        }}
      >
        <header className="project-navigator__header">
          <div>
            <strong>Project Navigator</strong>
            <span>{project.display_name}</span>
          </div>
          <CloseButton ariaLabel="Close" onClick={onCancel} />
        </header>

        <div className="project-navigator__columns">
          <aside
            className="project-library"
            aria-label="Project library"
            onPointerDown={() => setShowMembershipMenu(false)}
          >
            <header className="project-navigator__column-header">
              <strong>Project Library</strong>
              <span>{project.path_groups.length}</span>
            </header>
            <div className="project-library__tree">
              {project.path_groups.length > 0 ? (
                project.path_groups.map((group) => {
                  const isExpanded = expandedGroupIds.has(group.group_id);
                  const isSelected = selectedGroupId === group.group_id;
                  const isMenuOpen = openCollectionMenuId === group.group_id;
                  const isDropTarget = dragOverGroupId === group.group_id;
                  return (
                    <div
                      key={group.group_id}
                      className={`project-library__collection-block${isSelected ? " is-selected" : ""}${isDropTarget ? " is-drop-target" : ""}`}
                    >
                      <div
                        className="project-library__collection-row"
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "copy";
                          setDragOverGroupId(group.group_id);
                        }}
                        onDragLeave={() => setDragOverGroupId(null)}
                        onDrop={(event) => handleDropOnCollection(event, group)}
                      >
                        <button
                          type="button"
                          className="project-library__expand"
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${group.display_name}`}
                          aria-expanded={isExpanded}
                          onClick={() => {
                            setExpandedGroupIds((current) => {
                              const next = new Set(current);
                              if (next.has(group.group_id)) {
                                next.delete(group.group_id);
                              } else {
                                next.add(group.group_id);
                              }
                              return next;
                            });
                          }}
                        >
                          {isExpanded ? (
                            <ChevronDown aria-hidden="true" size={14} />
                          ) : (
                            <ChevronRight aria-hidden="true" size={14} />
                          )}
                        </button>
                        <Folder aria-hidden="true" size={14} />
                        {editing?.kind === "collection" &&
                        editing.id === group.group_id ? (
                          <input
                            autoFocus
                            className="project-navigator__inline-input"
                            aria-label="Collection name"
                            value={editing.value}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) =>
                              setEditing({
                                kind: "collection",
                                id: group.group_id,
                                value: event.currentTarget.value,
                              })
                            }
                            onKeyDown={handleInlineEditKeyDown}
                            onBlur={(event) =>
                              handleInlineEditBlur(event.currentTarget.value)
                            }
                          />
                        ) : (
                          <button
                            type="button"
                            className="project-library__collection-name"
                            aria-pressed={isSelected}
                            onClick={() => handleSelectCollection(group)}
                            onDoubleClick={() => beginCollectionRename(group)}
                          >
                            {group.display_name}
                          </button>
                        )}
                        <span className="project-library__count">
                          {group.path_ids.length}
                        </span>
                        <button
                          type="button"
                          className="project-library__more"
                          aria-label={`Collection actions for ${group.display_name}`}
                          aria-haspopup="menu"
                          aria-expanded={isMenuOpen}
                          onClick={() => {
                            setSelectedGroupId(group.group_id);
                            setShowMembershipMenu(false);
                            setOpenCollectionMenuId((current) =>
                              current === group.group_id
                                ? null
                                : group.group_id,
                            );
                          }}
                        >
                          <MoreHorizontal aria-hidden="true" size={16} />
                        </button>
                        {isMenuOpen ? (
                          <div
                            className="project-library__collection-menu"
                            role="menu"
                            aria-label={`${group.display_name} collection actions`}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => createCollection()}
                            >
                              <FolderPlus aria-hidden="true" size={14} />
                              New Collection
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => beginCollectionRename(group)}
                            >
                              <Pencil aria-hidden="true" size={14} />
                              Rename Collection
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => createCollection(group)}
                            >
                              <Copy aria-hidden="true" size={14} />
                              Duplicate Collection
                            </button>
                            <div role="separator" />
                            <button
                              type="button"
                              role="menuitem"
                              className="is-danger"
                              onClick={() => {
                                setOpenCollectionMenuId(null);
                                setDeletingGroup(group);
                              }}
                            >
                              <Trash2 aria-hidden="true" size={14} />
                              Delete Collection
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {isExpanded ? (
                        <div className="project-library__children">
                          {group.path_ids.length > 0 ? (
                            group.path_ids.flatMap((pathId) => {
                              const path = project.paths.find(
                                (candidate) => candidate.path_id === pathId,
                              );
                              if (!path) {
                                return [];
                              }
                              return [
                                <button
                                  key={path.path_id}
                                  type="button"
                                  draggable
                                  className={`project-library__child${activePathId === path.path_id ? " is-current" : ""}${visibleSelectedPathIds.has(path.path_id) ? " is-selected" : ""}`}
                                  onClick={(event) => {
                                    setSelectedGroupId(group.group_id);
                                    handleSelectPath(
                                      event,
                                      path.path_id,
                                      group.group_id,
                                    );
                                  }}
                                  onDoubleClick={() => beginPathRename(path)}
                                  onDragStart={(event) =>
                                    setDragData(
                                      event,
                                      visibleSelectedPathIds.has(path.path_id)
                                        ? [...visibleSelectedPathIds]
                                        : [path.path_id],
                                      group.group_id,
                                    )
                                  }
                                  onDragEnd={() => {
                                    setDragSourceGroupId(null);
                                    setDragOverGroupId(null);
                                    setIsRemovingDropTarget(false);
                                  }}
                                >
                                  {path.display_name}
                                </button>,
                              ];
                            })
                          ) : (
                            <span className="project-library__empty-collection">
                              Drop Paths here
                            </span>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <div className="project-library__empty">
                  Create a Collection to organize Paths.
                </div>
              )}
            </div>
            <button
              type="button"
              className="project-library__add"
              aria-label="Create Collection"
              onClick={() => createCollection()}
            >
              <Plus aria-hidden="true" size={15} />
              Add Collection
            </button>
          </aside>

          <section
            className={`all-paths${isRemovingDropTarget ? " is-removing-drop-target" : ""}`}
            aria-label="All Paths"
            onDragOver={(event) => {
              if (!dragSourceGroupId) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setIsRemovingDropTarget(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setIsRemovingDropTarget(false);
              }
            }}
            onDrop={handleDropOnAllPaths}
          >
            <header className="project-navigator__column-header all-paths__header">
              <strong>All Paths · {project.paths.length}</strong>
              <div className="all-paths__header-tools">
                <span className="all-paths__sort">Collections ↓ · A–Z</span>
                <label className="project-navigator__search">
                  <Search aria-hidden="true" size={14} />
                  <input
                    ref={searchInputRef}
                    type="search"
                    aria-label="Search paths"
                    placeholder="Search Paths"
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                  />
                </label>
              </div>
            </header>

            <div className="all-paths__actions">
              <strong>
                {selectedPaths.length}{" "}
                {selectedPaths.length === 1 ? "Path" : "Paths"} selected
              </strong>
              <div>
                <button
                  type="button"
                  className="all-paths__add-to"
                  aria-haspopup="menu"
                  aria-expanded={showMembershipMenu}
                  disabled={selectedPaths.length === 0}
                  onClick={() => {
                    setOpenCollectionMenuId(null);
                    setShowMembershipMenu((current) => !current);
                  }}
                >
                  <Folder aria-hidden="true" size={14} />
                  Add to…
                </button>
                <button
                  type="button"
                  className="all-paths__icon-action"
                  aria-label="Create new path"
                  title="Create new path"
                  onClick={() => onCreatePath(selectedGroupId)}
                >
                  <Plus aria-hidden="true" size={15} />
                </button>
                <button
                  type="button"
                  className="all-paths__icon-action"
                  aria-label="Duplicate selected path"
                  title="Duplicate selected path"
                  disabled={selectedPaths.length !== 1}
                  onClick={duplicateSelectedPath}
                >
                  <Copy aria-hidden="true" size={14} />
                </button>
                <button
                  type="button"
                  className="all-paths__icon-action"
                  aria-label="Rename selected path"
                  title="Rename selected path"
                  disabled={selectedPaths.length !== 1}
                  onClick={() =>
                    selectedPaths[0] && beginPathRename(selectedPaths[0])
                  }
                >
                  <Pencil aria-hidden="true" size={14} />
                </button>
                <button
                  type="button"
                  className="all-paths__icon-action is-danger"
                  aria-label="Delete selected paths"
                  title="Delete selected paths"
                  disabled={selectedPaths.length === 0}
                  onClick={() => onDeletePaths([...visibleSelectedPathIds])}
                >
                  <Trash2 aria-hidden="true" size={14} />
                </button>
              </div>
              {showMembershipMenu ? (
                <div
                  className="all-paths__membership-menu"
                  role="menu"
                  aria-label="Add to Collections"
                >
                  <header>
                    <strong>Add to Collections</strong>
                    <button
                      type="button"
                      aria-label="Close Add to Collections"
                      onClick={() => setShowMembershipMenu(false)}
                    >
                      ×
                    </button>
                  </header>
                  {project.path_groups.length > 0 ? (
                    project.path_groups.map((group) => {
                      const includedCount = selectedPaths.filter((path) =>
                        group.path_ids.includes(path.path_id),
                      ).length;
                      const allIncluded =
                        selectedPaths.length > 0 &&
                        includedCount === selectedPaths.length;
                      return (
                        <button
                          key={group.group_id}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={allIncluded}
                          onClick={() => toggleMembership(group)}
                        >
                          <span>
                            <Folder aria-hidden="true" size={14} />
                            {group.display_name}
                          </span>
                          <small>
                            {allIncluded
                              ? "Remove"
                              : includedCount > 0
                                ? "Add all"
                                : "Add"}
                          </small>
                        </button>
                      );
                    })
                  ) : (
                    <p>No Collections yet.</p>
                  )}
                </div>
              ) : null}
            </div>

            {dragSourceGroupId ? (
              <div className="all-paths__drop-message">
                Drop here to remove from the Collection
              </div>
            ) : null}

            <div
              className="all-paths__list"
              role="listbox"
              aria-label="All project Paths"
              aria-multiselectable="true"
            >
              {sortedPaths.length > 0 ? (
                sortedPaths.map((path) => {
                  const memberships = collectionMemberships(
                    project,
                    path.path_id,
                  );
                  const isMember = Boolean(
                    selectedGroup?.path_ids.includes(path.path_id),
                  );
                  const isSelected = visibleSelectedPathIds.has(path.path_id);
                  const isEditing =
                    editing?.kind === "path" && editing.id === path.path_id;
                  return (
                    <div
                      key={path.path_id}
                      role="option"
                      aria-selected={isSelected}
                      tabIndex={0}
                      draggable={!isEditing}
                      className={`all-paths__row${isMember ? " is-collection-member" : ""}${isSelected ? " is-selected" : ""}${activePathId === path.path_id ? " is-current" : ""}`}
                      onClick={(event) => {
                        if (!isEditableShortcutTarget(event.target)) {
                          handleSelectPath(event, path.path_id);
                        }
                      }}
                      onDoubleClick={() => beginPathRename(path)}
                      onKeyDown={(event) => {
                        if (
                          (event.key === "Enter" || event.key === " ") &&
                          event.target === event.currentTarget
                        ) {
                          event.preventDefault();
                          handleSelectPath(event, path.path_id);
                        }
                      }}
                      onDragStart={(event) =>
                        setDragData(
                          event,
                          isSelected
                            ? [...visibleSelectedPathIds]
                            : [path.path_id],
                          null,
                        )
                      }
                      onDragEnd={() => {
                        setDragSourceGroupId(null);
                        setDragOverGroupId(null);
                        setIsRemovingDropTarget(false);
                      }}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          className="project-navigator__inline-input"
                          aria-label="Path name"
                          value={editing.value}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) =>
                            setEditing({
                              kind: "path",
                              id: path.path_id,
                              value: event.currentTarget.value,
                            })
                          }
                          onKeyDown={handleInlineEditKeyDown}
                          onBlur={(event) =>
                            handleInlineEditBlur(event.currentTarget.value)
                          }
                        />
                      ) : (
                        <strong>{path.display_name}</strong>
                      )}
                      <div
                        className="all-paths__pills"
                        aria-label="Collections"
                      >
                        {memberships.map((group, index) => (
                          <button
                            key={group.group_id}
                            type="button"
                            className="all-paths__pill"
                            data-color={index % 4}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSelectCollection(group);
                            }}
                          >
                            {group.display_name}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="all-paths__empty">
                  {project.paths.length === 0
                    ? "Create your first Path."
                    : "No Paths match your search."}
                </div>
              )}
            </div>
          </section>
        </div>
      </section>

      {deletingGroup ? (
        <DeleteCollectionDialog
          group={deletingGroup}
          onCancel={() => setDeletingGroup(null)}
          onDelete={() => {
            projectStore.getState().deletePathGroup(deletingGroup.group_id);
            selectionStore.getState().clearSelection();
            setSelectedGroupId((current) =>
              current === deletingGroup.group_id
                ? (project.path_groups.find(
                    (group) => group.group_id !== deletingGroup.group_id,
                  )?.group_id ?? null)
                : current,
            );
            setDeletingGroup(null);
          }}
        />
      ) : null}
    </div>
  );
}

function DeleteCollectionDialog({
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
        aria-label="Delete Collection"
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
            <strong>Delete “{group.display_name}”?</strong>
          </div>
          <CloseButton ariaLabel="Close delete Collection" onClick={onCancel} />
        </header>
        <p>
          The Collection will be removed. Its {group.path_ids.length} Paths
          remain in All Paths and in every other Collection.
        </p>
        <footer>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="danger-dialog-action">
            Delete Collection
          </button>
        </footer>
      </form>
    </div>
  );
}

function collectionMemberships(
  project: Project,
  pathId: string,
): ProjectPathGroup[] {
  return project.path_groups.filter((group) => group.path_ids.includes(pathId));
}

function uniqueName(
  baseName: string,
  existingNames: readonly string[],
): string {
  const normalizedNames = new Set(
    existingNames.map((name) => name.trim().toLocaleLowerCase()),
  );
  if (!normalizedNames.has(baseName.toLocaleLowerCase())) {
    return baseName;
  }
  let suffix = 2;
  while (normalizedNames.has(`${baseName} ${suffix}`.toLocaleLowerCase())) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}

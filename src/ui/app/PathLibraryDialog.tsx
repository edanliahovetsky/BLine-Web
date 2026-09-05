import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type CSSProperties,
} from "react";
import {
  Check,
  Copy,
  Eye,
  Folder,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  ExternalLink,
} from "lucide-react";
import type { Project } from "../../core/model/project";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import { isEditableShortcutTarget } from "../keyboardShortcuts";
import { CloseButton } from "../controls";
import { useDialogFocusTrap } from "./useDialogFocusTrap";
import {
  usePathGroupLinkDrag,
  type LibraryNode,
  type ConnectionPoint,
} from "./usePathGroupLinkDrag";
import "./ProjectLibraryDialogs.css";

interface Node extends LibraryNode {
  name: string;
  count: number;
}
interface Edge {
  groupId: string;
  pathId: string;
}
interface InlineEdit extends LibraryNode {
  value: string;
}
interface RowMenu {
  node: Node;
  x: number;
  y: number;
  trigger: HTMLButtonElement;
}
const keyFor = (node: LibraryNode) => `${node.kind}:${node.id}`;
const sameNode = (a: LibraryNode | null, b: LibraryNode | null) =>
  Boolean(a && b && a.kind === b.kind && a.id === b.id);
const edgeFor = (a: LibraryNode, b: LibraryNode): Edge =>
  a.kind === "group"
    ? { groupId: a.id, pathId: b.id }
    : { groupId: b.id, pathId: a.id };
const incident = (edge: Edge, node: LibraryNode | null) =>
  node?.kind === "group" ? edge.groupId === node.id : edge.pathId === node?.id;
const uniqueName = (base: string, names: string[]) => {
  const existing = new Set(names.map((name) => name.toLocaleLowerCase()));
  let value = base,
    suffix = 2;
  while (existing.has(value.toLocaleLowerCase())) value = `${base} ${suffix++}`;
  return value;
};
function curve(from: ConnectionPoint, to: ConnectionPoint, direction = 1) {
  const bend = Math.max(32, Math.abs(to.x - from.x) * 0.48);
  return `M ${from.x} ${from.y} C ${from.x + direction * bend} ${from.y}, ${to.x - direction * bend} ${to.y}, ${to.x} ${to.y}`;
}

export function PathLibraryDialog({
  project,
  activePathId,
  activePathGroupId,
  onCancel,
  onCreatePath,
  onDeletePaths,
  onPreviewPathGroup,
}: {
  project: Project;
  activePathId: string | null;
  activePathGroupId: string | null;
  onCancel(): void;
  onCreatePath(groupId: string | null): void;
  onDeletePaths(pathIds: readonly string[]): void;
  onPreviewPathGroup(): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const boardRef = useRef<HTMLDivElement>(null);
  const skipBlur = useRef(false);
  const [selected, setSelected] = useState<LibraryNode | null>(() =>
    activePathGroupId
      ? { kind: "group", id: activePathGroupId }
      : activePathId
        ? { kind: "path", id: activePathId }
        : null,
  );
  const [groupContext, setGroupContext] = useState(activePathGroupId);
  const [groupQuery, setGroupQuery] = useState("");
  const [pathQuery, setPathQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [pending, setPending] = useState<LibraryNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [editing, setEditing] = useState<InlineEdit | null>(null);
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [geometry, setGeometry] = useState<{
    width: number;
    height: number;
    points: Map<string, ConnectionPoint>;
  }>({ width: 1, height: 1, points: new Map() });

  const { groups, paths, edges } = useMemo(() => {
    const edges: Edge[] = project.path_groups.flatMap((group) =>
      group.path_ids.map((pathId) => ({ groupId: group.group_id, pathId })),
    );
    const counts = new Map<string, number>();
    for (const edge of edges)
      counts.set(edge.pathId, (counts.get(edge.pathId) ?? 0) + 1);
    const groups: Node[] = project.path_groups.map((group) => ({
      kind: "group",
      id: group.group_id,
      name: group.display_name,
      count: group.path_ids.length,
    }));
    const paths: Node[] = project.paths.map((path) => ({
      kind: "path",
      id: path.path_id,
      name: path.display_name,
      count: counts.get(path.path_id) ?? 0,
    }));
    const order = (a: Node, b: Node) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.id.localeCompare(b.id);
    return {
      groups: groups.sort(order),
      paths: paths.sort(order),
      edges,
    };
  }, [project]);
  const findNode = (node: LibraryNode | null) =>
    node
      ? (node.kind === "group" ? groups : paths).find(
          (item) => item.id === node.id,
        )
      : undefined;
  const focus =
    findNode(selected) ??
    paths.find((node) => node.id === activePathId) ??
    groups[0] ??
    paths[0] ??
    null;
  const connected = (edge: Edge) =>
    edges.some(
      (candidate) =>
        candidate.groupId === edge.groupId && candidate.pathId === edge.pathId,
    );
  const related = (node: Node) =>
    Boolean(
      focus && node.kind !== focus.kind && connected(edgeFor(focus, node)),
    );
  const visibleGroups = useMemo(
    () =>
      groups.filter((node) =>
        node.name
          .toLocaleLowerCase()
          .includes(groupQuery.trim().toLocaleLowerCase()),
      ),
    [groups, groupQuery],
  );
  const visiblePaths = useMemo(
    () =>
      paths.filter((node) => {
        const query = pathQuery.trim().toLocaleLowerCase();
        return (
          node.name.toLocaleLowerCase().includes(query) ||
          project.paths
            .find((path) => path.path_id === node.id)
            ?.file_name.toLocaleLowerCase()
            .includes(query)
        );
      }),
    [paths, pathQuery, project.paths],
  );
  const visibleEdges = edges.filter(
    (edge) =>
      visibleGroups.some((node) => node.id === edge.groupId) &&
      visiblePaths.some((node) => node.id === edge.pathId),
  );
  const hiddenCount = focus
    ? focus.count - visibleEdges.filter((edge) => incident(edge, focus)).length
    : 0;

  // An inline editor or menu can unmount with focus still inside it. Keep
  // shortcuts in this dialog, while leaving any dialog opened above it alone.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const topDialog = [
      ...document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    ].at(-1);
    if (
      dialog &&
      topDialog === dialog &&
      document.activeElement === document.body
    ) {
      dialog.focus({ preventScroll: true });
    }
  });
  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, [dialogRef]);
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const measure = () => {
      const bounds = board.getBoundingClientRect();
      const points = new Map<string, ConnectionPoint>();
      board.querySelectorAll<HTMLButtonElement>(".fc-port").forEach((port) => {
        const rect = port.getBoundingClientRect();
        points.set(port.dataset.nodeKey!, {
          x: rect.x + rect.width / 2 - bounds.x,
          y: rect.y + rect.height / 2 - bounds.y,
        });
      });
      setGeometry({ width: bounds.width, height: bounds.height, points });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, [visibleGroups, visiblePaths]);

  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Element &&
        !event.target.closest(".fc-menu, .fc-more")
      )
        setMenu(null);
    };
    const close = () => setMenu(null);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const mutate = (action: () => void) => {
    try {
      action();
      setError("");
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The change could not be saved.",
      );
      return false;
    }
  };
  const connect = (source: LibraryNode, target: LibraryNode) => {
    if (source.kind === target.kind || !findNode(source) || !findNode(target))
      return;
    const edge = edgeFor(source, target);
    setPending(null);
    setSelectedEdge(null);
    if (connected(edge)) {
      setMessage("Already connected.");
      return;
    }
    if (
      mutate(() =>
        projectStore.getState().addPathsToGroup(edge.groupId, [edge.pathId]),
      )
    )
      setMessage("Connection added.");
  };
  const disconnect = (edge: Edge) => {
    setPending(null);
    setSelectedEdge(null);
    if (
      mutate(() =>
        projectStore
          .getState()
          .removePathsFromGroup(edge.groupId, [edge.pathId], {
            preserveActivePath: true,
          }),
      )
    )
      setMessage("Connection removed. The Path is kept.");
  };
  const tapPort = (node: LibraryNode) => {
    if (focus && node.kind !== focus.kind && connected(edgeFor(focus, node))) {
      disconnect(edgeFor(focus, node));
      return;
    }
    if (pending && pending.kind !== node.kind) {
      connect(pending, node);
      return;
    }
    setMenu(null);
    setSelectedEdge(null);
    setMessage("");
    if (sameNode(pending, node)) setPending(null);
    else {
      setSelected(node);
      setPending(node);
      if (node.kind === "group") setGroupContext(node.id);
    }
  };
  const drag = usePathGroupLinkDrag(
    boardRef,
    (source) => {
      setSelected(source);
      setPending(null);
      setMenu(null);
      setSelectedEdge(null);
      setMessage("");
      if (source.kind === "group") setGroupContext(source.id);
    },
    connect,
    tapPort,
  );
  const select = (node: Node) => {
    if (pending && pending.kind !== node.kind) {
      tapPort(node);
      return;
    }
    setSelected(node);
    setPending(null);
    setSelectedEdge(null);
    setMenu(null);
    setMessage("");
    if (node.kind === "group") setGroupContext(node.id);
  };
  const startRename = (node: Node) => {
    skipBlur.current = false;
    setMenu(null);
    setPending(null);
    setSelectedEdge(null);
    setError("");
    setEditing({ kind: node.kind, id: node.id, value: node.name });
  };
  const finishRename = (value: string) => {
    if (!editing) return;
    const name = value.trim();
    if (!name) {
      setError("Enter a name.");
      return;
    }
    const peers = editing.kind === "group" ? groups : paths;
    if (
      peers.some(
        (node) =>
          node.id !== editing.id &&
          node.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      setError("This name is already in use.");
      return;
    }
    const node = findNode(editing);
    if (!node || name === node.name) {
      setEditing(null);
      setError("");
      return;
    }
    if (
      mutate(() =>
        editing.kind === "group"
          ? projectStore.getState().renamePathGroup(editing.id, name)
          : projectStore.getState().renamePath(editing.id, name),
      )
    ) {
      setEditing(null);
      setMessage("Name updated.");
    }
  };
  const createGroup = (source?: Node) => {
    setMenu(null);
    setPending(null);
    const name = uniqueName(
      source ? `${source.name} Copy` : "New Path Group",
      groups.map((node) => node.name),
    );
    const group = source
      ? project.path_groups.find((group) => group.group_id === source.id)
      : null;
    if (
      !mutate(() =>
        projectStore.getState().createPathGroup({
          displayName: name,
          pathIds: group?.path_ids ?? [],
          makeActive: false,
        }),
      )
    )
      return;
    const created = projectStore
      .getState()
      .project?.path_groups.find(
        (group) => !groups.some((node) => node.id === group.group_id),
      );
    if (created) {
      const node: Node = {
        kind: "group",
        id: created.group_id,
        name: created.display_name,
        count: created.path_ids.length,
      };
      setGroupQuery("");
      setSelected(node);
      setGroupContext(node.id);
      startRename(node);
    }
  };
  const duplicate = (node: Node) => {
    if (node.kind === "group") {
      createGroup(node);
      return;
    }
    setMenu(null);
    setPending(null);
    const name = uniqueName(
      `${node.name} Copy`,
      paths.map((path) => path.name),
    );
    if (
      !mutate(() =>
        projectStore.getState().duplicatePath(node.id, name, {
          copyMemberships: true,
          makeActive: false,
        }),
      )
    )
      return;
    const created = projectStore
      .getState()
      .project?.paths.find(
        (path) => !paths.some((node) => node.id === path.path_id),
      );
    if (created) {
      const copy: Node = {
        kind: "path",
        id: created.path_id,
        name,
        count: node.count,
      };
      setPathQuery("");
      setSelected(copy);
      startRename(copy);
    }
  };
  const remove = (node: Node) => {
    setMenu(null);
    setPending(null);
    setSelectedEdge(null);
    if (node.kind === "path") onDeletePaths([node.id]);
    else if (mutate(() => projectStore.getState().deletePathGroup(node.id)))
      setMessage("Path Group deleted. Its Paths are kept.");
  };
  const openOnCanvas = (node: Node) => {
    if (node.kind === "group") {
      if (!node.count) return;
      projectStore.getState().setActivePathGroup(node.id);
      onPreviewPathGroup();
    } else {
      const groupId =
        [groupContext, activePathGroupId].find(
          (id) => id && connected({ groupId: id, pathId: node.id }),
        ) ?? null;
      projectStore.getState().setActivePath(node.id);
      projectStore.getState().setActivePathGroup(groupId);
    }
    selectionStore.getState().clearSelection();
    onCancel();
  };
  const closeMenu = () => {
    menu?.trigger.focus({ preventScroll: true });
    setMenu(null);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (menu) closeMenu();
      else if (drag.view || pending || selectedEdge) {
        drag.cancel();
        setPending(null);
        setSelectedEdge(null);
      } else onCancel();
    } else if (
      isEditableShortcutTarget(event.target) &&
      !(
        event.target instanceof HTMLInputElement &&
        event.target.type === "checkbox"
      )
    ) {
      return;
    } else if (event.key === "F2" && focus) {
      event.preventDefault();
      startRename(focus);
    } else if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      /^(z|y)$/i.test(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      drag.cancel();
      setPending(null);
      setSelectedEdge(null);
      setMenu(null);
      mutate(() =>
        event.key.toLowerCase() === "y" || event.shiftKey
          ? projectStore.getState().redo()
          : projectStore.getState().undo(),
      );
    }
  };
  const origin = drag.view?.source ?? pending;
  const previewStart = drag.view
    ? geometry.points.get(keyFor(drag.view.source))
    : null;
  const previewEnd = drag.view?.target
    ? geometry.points.get(keyFor(drag.view.target))
    : drag.view?.point;
  let status =
    message ||
    "Drag between connection points to link. Click a connected endpoint to disconnect.";
  if (pending)
    status = `Choose a ${pending.kind === "group" ? "Path" : "Path Group"} to connect. Esc to cancel.`;
  if (drag.view)
    status = drag.view.target
      ? connected(edgeFor(drag.view.source, drag.view.target))
        ? "Already connected."
        : `Release to connect to ${findNode(drag.view.target)?.name ?? "the destination"}.`
      : "Drag to the other column. Esc to cancel.";
  if (selectedEdge)
    status = `${groups.find((node) => node.id === selectedEdge.groupId)?.name} ↔ ${paths.find((node) => node.id === selectedEdge.pathId)?.name}`;

  const renderNode = (node: Node) => {
    const isFocused = sameNode(focus, node),
      isRelated = related(node),
      isEditing = sameNode(editing, node);
    const isTarget = Boolean(origin && origin.kind !== node.kind);
    const endpointLabel =
      isRelated && focus
        ? `Disconnect ${paths.find((path) => path.id === edgeFor(focus, node).pathId)?.name} from ${groups.find((group) => group.id === edgeFor(focus, node).groupId)?.name}`
        : sameNode(pending, node)
          ? `Cancel connection from ${node.name}`
          : isTarget
            ? `Connect to ${node.name}`
            : `Start connection from ${node.name}`;
    return (
      <div
        key={node.id}
        className={`fc-row ${node.kind === "path" ? "all-paths__row" : ""}${isFocused ? " is-focused" : isRelated ? " is-related" : !isTarget ? " is-muted" : ""}${isTarget ? " is-target" : ""}${sameNode(drag.view?.target ?? null, node) ? " is-drop-target" : ""}`}
        data-kind={node.kind}
        data-node-id={node.id}
      >
        {isEditing && editing ? (
          <div className="fc-rename">
            <input
              autoFocus
              aria-label={
                node.kind === "group" ? "Path Group name" : "Path name"
              }
              maxLength={120}
              value={editing.value}
              aria-invalid={Boolean(error)}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                setEditing({ ...editing, value: event.currentTarget.value });
                setError("");
              }}
              onBlur={(event) => {
                if (skipBlur.current) {
                  skipBlur.current = false;
                  return;
                }
                finishRename(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  finishRename(event.currentTarget.value);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  skipBlur.current = true;
                  setEditing(null);
                  setError("");
                }
              }}
            />
            <button
              type="button"
              aria-label="Save name"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => finishRename(editing.value)}
            >
              <Check size={14} />
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="fc-select"
              aria-label={`Focus ${node.name}`}
              aria-pressed={isFocused}
              onClick={() => select(node)}
              onDoubleClick={() => startRename(node)}
            >
              {node.kind === "group" && (
                <Folder className="fc-folder" size={17} />
              )}
              <span className="fc-name" title={node.name}>
                {node.name}
              </span>
              <span
                className="fc-count"
                title={`${node.count} ${node.kind === "group" ? "Paths" : "Path Groups"}`}
              >
                {node.count}
              </span>
            </button>
            <button
              type="button"
              className="fc-more"
              aria-label={`${node.kind === "group" ? "Path Group" : "Path"} actions for ${node.name}`}
              aria-haspopup="menu"
              aria-expanded={sameNode(menu?.node ?? null, node)}
              title="Rename, duplicate, or delete"
              onClick={(event) => {
                if (sameNode(menu?.node ?? null, node)) {
                  setMenu(null);
                  return;
                }
                const box = event.currentTarget.getBoundingClientRect();
                setPending(null);
                setSelectedEdge(null);
                setMenu({
                  node,
                  trigger: event.currentTarget,
                  x: Math.max(
                    8,
                    Math.min(window.innerWidth - 190, box.right - 182),
                  ),
                  y: Math.max(
                    8,
                    Math.min(window.innerHeight - 160, box.bottom + 6),
                  ),
                });
              }}
            >
              <MoreHorizontal size={17} />
            </button>
          </>
        )}
        <button
          type="button"
          className={`fc-port${isRelated ? " is-connected" : ""}${sameNode(origin, node) ? " is-origin" : ""}`}
          data-node-key={keyFor(node)}
          disabled={Boolean(editing)}
          aria-label={endpointLabel}
          title={
            isRelated
              ? "Click to disconnect · drag to connect"
              : "Drag to connect · or click"
          }
          onPointerDown={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            setMenu(null);
            drag.start(event, node);
          }}
          onClick={(event) => {
            if (event.detail === 0) tapPort(node);
          }}
        />
      </div>
    );
  };

  return (
    <div
      className="project-navigator-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="project-navigator fc-navigator"
        role="dialog"
        aria-modal="true"
        aria-label="Project Navigator"
        tabIndex={-1}
        data-testid="path-library-dialog"
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          if (
            event.target instanceof Element &&
            !event.target.closest("button, input, label")
          ) {
            event.currentTarget.focus({ preventScroll: true });
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
        <div className="fc-focusbar">
          <div className="fc-focus-meta">
            <span className="fc-focus-icon">
              {focus?.kind === "group" ? (
                <Folder size={18} />
              ) : (
                <Link2 size={18} />
              )}
            </span>
            <div>
              <strong data-testid="path-library-focus-name">
                {focus?.name ?? "Paths & Path Groups"}
              </strong>
              <span data-testid="path-library-focus-count">
                {focus
                  ? `${focus.count} ${focus.kind === "group" ? "Path" : "Path Group"}${focus.count === 1 ? "" : "s"} connected${hiddenCount ? ` · ${hiddenCount} hidden by search` : ""}`
                  : "Create a Path or Path Group to begin."}
              </span>
            </div>
          </div>
          <div className="fc-focus-actions">
            {focus && (
              <button
                type="button"
                className="fc-open"
                disabled={focus.kind === "group" && focus.count === 0}
                onClick={() => openOnCanvas(focus)}
              >
                {focus.kind === "group" ? (
                  <Eye size={14} />
                ) : (
                  <ExternalLink size={14} />
                )}
                {focus.kind === "group" ? "Preview Path Group" : "Open Path"}
              </button>
            )}
            <label className="fc-toggle">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.currentTarget.checked)}
              />
              Show all connections
            </label>
          </div>
        </div>
        <div
          className="fc-scroll"
          onScroll={() => {
            setMenu(null);
            drag.scroll();
          }}
        >
          <div
            className={`fc-board${drag.view ? " is-dragging" : ""}`}
            ref={boardRef}
            onPointerMove={drag.move}
            onPointerUp={drag.end}
            onPointerCancel={drag.cancel}
            onLostPointerCapture={drag.cancel}
          >
            <svg
              className="fc-wires"
              aria-hidden="true"
              viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            >
              {visibleEdges
                .filter((edge) => showAll || incident(edge, focus))
                .map((edge) => {
                  const from = geometry.points.get(`group:${edge.groupId}`),
                    to = geometry.points.get(`path:${edge.pathId}`);
                  if (!from || !to) return null;
                  const selected =
                    selectedEdge?.groupId === edge.groupId &&
                    selectedEdge?.pathId === edge.pathId;
                  return (
                    <g
                      key={`${edge.groupId}:${edge.pathId}`}
                      className="fc-wire-group"
                    >
                      <path
                        className={`fc-wire${incident(edge, focus) ? "" : " is-dim"}${selected ? " is-selected" : ""}`}
                        d={curve(from, to)}
                      />
                      <path
                        className="fc-wire-hit"
                        d={curve(from, to)}
                        onClick={() => {
                          if (!pending && !drag.view) setSelectedEdge(edge);
                        }}
                      />
                    </g>
                  );
                })}
              {previewStart && previewEnd && (
                <>
                  <path
                    className={`fc-wire-preview${drag.view?.target ? " is-snapped" : ""}`}
                    d={curve(
                      previewStart,
                      previewEnd,
                      drag.view?.source.kind === "path" ? -1 : 1,
                    )}
                  />
                  {!drag.view?.target && (
                    <circle
                      className="fc-preview-tip"
                      cx={previewEnd.x}
                      cy={previewEnd.y}
                      r={5}
                    />
                  )}
                </>
              )}
            </svg>
            <section className="fc-column fc-groups" aria-label="Path Groups">
              <header>
                <h2>
                  Path Groups <span>{groups.length}</span>
                </h2>
                <button
                  type="button"
                  aria-label="Create Path Group"
                  title="New Path Group"
                  onClick={() => createGroup()}
                >
                  <Plus size={14} />
                </button>
              </header>
              <label className="fc-search">
                <Search size={14} />
                <input
                  type="search"
                  aria-label="Find a Path Group"
                  placeholder="Find a Path Group"
                  value={groupQuery}
                  onChange={(event) => {
                    setGroupQuery(event.currentTarget.value);
                    setSelectedEdge(null);
                  }}
                />
              </label>
              <div className="fc-rows">
                {visibleGroups.map(renderNode)}
                {!visibleGroups.length && (
                  <div className="fc-empty">
                    {groups.length
                      ? "No Path Groups match your search."
                      : "Create a Path Group, then link your Paths."}
                  </div>
                )}
              </div>
            </section>
            <section className="fc-column fc-paths" aria-label="All Paths">
              <header>
                <h2>
                  All Paths <span>{paths.length}</span>
                </h2>
                <button
                  type="button"
                  aria-label="Create new path"
                  title="New Path"
                  onClick={() =>
                    onCreatePath(focus?.kind === "group" ? focus.id : null)
                  }
                >
                  <Plus size={14} />
                </button>
              </header>
              <label className="fc-search">
                <Search size={14} />
                <input
                  type="search"
                  aria-label="Search paths"
                  placeholder="Find a Path"
                  value={pathQuery}
                  onChange={(event) => {
                    setPathQuery(event.currentTarget.value);
                    setSelectedEdge(null);
                  }}
                />
              </label>
              <div className="fc-rows">
                {visiblePaths.map(renderNode)}
                {!visiblePaths.length && (
                  <div className="fc-empty">
                    {paths.length
                      ? "No Paths match your search."
                      : "Create your first Path."}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
        <footer className={`fc-status${origin ? " is-linking" : ""}`}>
          <span role={error ? "alert" : "status"}>
            <Link2 size={14} />
            {error || status}
          </span>
          {selectedEdge && (
            <button type="button" onClick={() => disconnect(selectedEdge)}>
              Remove connection
            </button>
          )}
          {pending && !drag.view && (
            <button type="button" onClick={() => setPending(null)}>
              Cancel
            </button>
          )}
        </footer>
        {menu && (
          <NodeMenu
            menu={menu}
            onClose={closeMenu}
            onRename={() => startRename(menu.node)}
            onDuplicate={() => duplicate(menu.node)}
            onDelete={() => remove(menu.node)}
          />
        )}
      </section>
    </div>
  );
}

function NodeMenu({
  menu,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
}: {
  menu: RowMenu;
  onClose(): void;
  onRename(): void;
  onDuplicate(): void;
  onDelete(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, [menu.node.id]);
  const label = menu.node.kind === "group" ? "Path Group" : "Path";
  return (
    <div
      ref={ref}
      className="fc-menu"
      role="menu"
      aria-label={`Actions for ${menu.node.name}`}
      style={{ left: menu.x, top: menu.y } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button",
            ),
          ];
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
          buttons[index]?.focus();
        }
      }}
    >
      <button
        type="button"
        role="menuitem"
        aria-label={`Rename ${label}`}
        onClick={onRename}
      >
        <Pencil size={15} />
        Rename
      </button>
      <button
        type="button"
        role="menuitem"
        aria-label={`Duplicate ${label}`}
        onClick={onDuplicate}
      >
        <Copy size={15} />
        Duplicate
      </button>
      <button
        type="button"
        role="menuitem"
        aria-label={`Delete ${label}`}
        className="fc-delete"
        onClick={onDelete}
      >
        <Trash2 size={15} />
        Delete
      </button>
    </div>
  );
}

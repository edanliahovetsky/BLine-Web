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
  useCollectionLinkDrag,
  type CollectionNode,
  type ConnectionPoint,
} from "./useCollectionLinkDrag";
import "./ProjectLibraryDialogs.css";

interface Node extends CollectionNode {
  name: string;
  count: number;
}
interface Edge {
  groupId: string;
  pathId: string;
}
interface InlineEdit extends CollectionNode {
  value: string;
}
interface RowMenu {
  node: Node;
  x: number;
  y: number;
  trigger: HTMLButtonElement;
}
const keyFor = (node: CollectionNode) => `${node.kind}:${node.id}`;
const sameNode = (a: CollectionNode | null, b: CollectionNode | null) =>
  Boolean(a && b && a.kind === b.kind && a.id === b.id);
const edgeFor = (a: CollectionNode, b: CollectionNode): Edge =>
  a.kind === "collection"
    ? { groupId: a.id, pathId: b.id }
    : { groupId: b.id, pathId: a.id };
const incident = (edge: Edge, node: CollectionNode | null) =>
  node?.kind === "collection"
    ? edge.groupId === node.id
    : edge.pathId === node?.id;
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
  onPreviewCollection,
}: {
  project: Project;
  activePathId: string | null;
  activePathGroupId: string | null;
  onCancel(): void;
  onCreatePath(groupId: string | null): void;
  onDeletePaths(pathIds: readonly string[]): void;
  onPreviewCollection(): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const boardRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const skipBlur = useRef(false);
  const [selected, setSelected] = useState<CollectionNode | null>(() =>
    activePathGroupId
      ? { kind: "collection", id: activePathGroupId }
      : activePathId
        ? { kind: "path", id: activePathId }
        : null,
  );
  const [collectionContext, setCollectionContext] = useState(activePathGroupId);
  const [collectionQuery, setCollectionQuery] = useState("");
  const [pathQuery, setPathQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [pending, setPending] = useState<CollectionNode | null>(null);
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

  const { collections, paths, edges } = useMemo(() => {
    const edges: Edge[] = project.path_groups.flatMap((group) =>
      group.path_ids.map((pathId) => ({ groupId: group.group_id, pathId })),
    );
    const counts = new Map<string, number>();
    for (const edge of edges)
      counts.set(edge.pathId, (counts.get(edge.pathId) ?? 0) + 1);
    const collections: Node[] = project.path_groups.map((group) => ({
      kind: "collection",
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
      collections: collections.sort(order),
      paths: paths.sort(order),
      edges,
    };
  }, [project]);
  const findNode = (node: CollectionNode | null) =>
    node
      ? (node.kind === "collection" ? collections : paths).find(
          (item) => item.id === node.id,
        )
      : undefined;
  const focus =
    findNode(selected) ??
    paths.find((node) => node.id === activePathId) ??
    collections[0] ??
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
  const visibleCollections = useMemo(
    () =>
      collections.filter((node) =>
        node.name
          .toLocaleLowerCase()
          .includes(collectionQuery.trim().toLocaleLowerCase()),
      ),
    [collections, collectionQuery],
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
      visibleCollections.some((node) => node.id === edge.groupId) &&
      visiblePaths.some((node) => node.id === edge.pathId),
  );
  const hiddenCount = focus
    ? focus.count - visibleEdges.filter((edge) => incident(edge, focus)).length
    : 0;

  useEffect(() => {
    searchRef.current?.focus();
  }, []);
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
  }, [visibleCollections, visiblePaths]);

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
  const connect = (source: CollectionNode, target: CollectionNode) => {
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
  const tapPort = (node: CollectionNode) => {
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
      if (node.kind === "collection") setCollectionContext(node.id);
    }
  };
  const drag = useCollectionLinkDrag(
    boardRef,
    (source) => {
      setSelected(source);
      setPending(null);
      setMenu(null);
      setSelectedEdge(null);
      setMessage("");
      if (source.kind === "collection") setCollectionContext(source.id);
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
    if (node.kind === "collection") setCollectionContext(node.id);
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
    const peers = editing.kind === "collection" ? collections : paths;
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
        editing.kind === "collection"
          ? projectStore.getState().renamePathGroup(editing.id, name)
          : projectStore.getState().renamePath(editing.id, name),
      )
    ) {
      setEditing(null);
      setMessage("Name updated.");
    }
  };
  const createCollection = (source?: Node) => {
    setMenu(null);
    setPending(null);
    const name = uniqueName(
      source ? `${source.name} Copy` : "New Collection",
      collections.map((node) => node.name),
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
        (group) => !collections.some((node) => node.id === group.group_id),
      );
    if (created) {
      const node: Node = {
        kind: "collection",
        id: created.group_id,
        name: created.display_name,
        count: created.path_ids.length,
      };
      setCollectionQuery("");
      setSelected(node);
      setCollectionContext(node.id);
      startRename(node);
    }
  };
  const duplicate = (node: Node) => {
    if (node.kind === "collection") {
      createCollection(node);
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
      setMessage("Collection deleted. Its Paths are kept.");
  };
  const openOnCanvas = (node: Node) => {
    if (node.kind === "collection") {
      if (!node.count) return;
      projectStore.getState().setActivePathGroup(node.id);
      onPreviewCollection();
    } else {
      const groupId =
        [collectionContext, activePathGroupId].find(
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
    } else if (isEditableShortcutTarget(event.target)) {
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
    status = `Choose a ${pending.kind === "collection" ? "Path" : "Collection"} to connect. Esc to cancel.`;
  if (drag.view)
    status = drag.view.target
      ? connected(edgeFor(drag.view.source, drag.view.target))
        ? "Already connected."
        : `Release to connect to ${findNode(drag.view.target)?.name ?? "the destination"}.`
      : "Drag to the other column. Esc to cancel.";
  if (selectedEdge)
    status = `${collections.find((node) => node.id === selectedEdge.groupId)?.name} ↔ ${paths.find((node) => node.id === selectedEdge.pathId)?.name}`;

  const renderNode = (node: Node) => {
    const isFocused = sameNode(focus, node),
      isRelated = related(node),
      isEditing = sameNode(editing, node);
    const isTarget = Boolean(origin && origin.kind !== node.kind);
    const endpointLabel =
      isRelated && focus
        ? `Disconnect ${paths.find((path) => path.id === edgeFor(focus, node).pathId)?.name} from ${collections.find((group) => group.id === edgeFor(focus, node).groupId)?.name}`
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
                node.kind === "collection" ? "Collection name" : "Path name"
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
              {node.kind === "collection" && (
                <Folder className="fc-folder" size={17} />
              )}
              <span className="fc-name" title={node.name}>
                {node.name}
              </span>
              <span
                className="fc-count"
                title={`${node.count} ${node.kind === "collection" ? "Paths" : "Collections"}`}
              >
                {node.count}
              </span>
            </button>
            <button
              type="button"
              className="fc-more"
              aria-label={`${node.kind === "collection" ? "Collection" : "Path"} actions for ${node.name}`}
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
        data-testid="path-library-dialog"
        onKeyDown={handleKeyDown}
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
              {focus?.kind === "collection" ? (
                <Folder size={18} />
              ) : (
                <Link2 size={18} />
              )}
            </span>
            <div>
              <strong data-testid="collection-focus-name">
                {focus?.name ?? "Paths & Collections"}
              </strong>
              <span data-testid="collection-focus-count">
                {focus
                  ? `${focus.count} ${focus.kind === "collection" ? "Path" : "Collection"}${focus.count === 1 ? "" : "s"} connected${hiddenCount ? ` · ${hiddenCount} hidden by search` : ""}`
                  : "Create a Path or Collection to begin."}
              </span>
            </div>
          </div>
          <div className="fc-focus-actions">
            {focus && (
              <button
                type="button"
                className="fc-open"
                disabled={focus.kind === "collection" && focus.count === 0}
                onClick={() => openOnCanvas(focus)}
              >
                {focus.kind === "collection" ? (
                  <Eye size={14} />
                ) : (
                  <ExternalLink size={14} />
                )}
                {focus.kind === "collection"
                  ? "Preview Collection"
                  : "Open Path"}
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
                  const from = geometry.points.get(
                      `collection:${edge.groupId}`,
                    ),
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
            <section
              className="fc-column fc-collections"
              aria-label="Collections"
            >
              <header>
                <h2>
                  Collections <span>{collections.length}</span>
                </h2>
                <button
                  type="button"
                  aria-label="Create Collection"
                  title="New Collection"
                  onClick={() => createCollection()}
                >
                  <Plus size={14} />
                </button>
              </header>
              <label className="fc-search">
                <Search size={14} />
                <input
                  type="search"
                  aria-label="Find a Collection"
                  placeholder="Find a Collection"
                  value={collectionQuery}
                  onChange={(event) => {
                    setCollectionQuery(event.currentTarget.value);
                    setSelectedEdge(null);
                  }}
                />
              </label>
              <div className="fc-rows">
                {visibleCollections.map(renderNode)}
                {!visibleCollections.length && (
                  <div className="fc-empty">
                    {collections.length
                      ? "No Collections match your search."
                      : "Create a Collection, then link your Paths."}
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
                    onCreatePath(focus?.kind === "collection" ? focus.id : null)
                  }
                >
                  <Plus size={14} />
                </button>
              </header>
              <label className="fc-search">
                <Search size={14} />
                <input
                  ref={searchRef}
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
  const label = menu.node.kind === "collection" ? "Collection" : "Path";
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

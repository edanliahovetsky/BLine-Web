import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";

export interface LibraryNode {
  kind: "group" | "path";
  id: string;
}
export interface ConnectionPoint {
  x: number;
  y: number;
}
interface DragView {
  source: LibraryNode;
  target: LibraryNode | null;
  point: ConnectionPoint;
}
interface DragSession {
  source: LibraryNode;
  pointerId: number;
  start: ConnectionPoint;
  client: ConnectionPoint;
  active: boolean;
}

/** Capture on the board, which stays mounted when the focused rows change. */
export function usePathGroupLinkDrag(
  boardRef: RefObject<HTMLDivElement | null>,
  onStart: (source: LibraryNode) => void,
  onConnect: (source: LibraryNode, target: LibraryNode) => void,
  onTap: (source: LibraryNode) => void,
) {
  const session = useRef<DragSession | null>(null);
  const [view, setView] = useState<DragView | null>(null);
  const release = useCallback(() => {
    const current = session.current;
    session.current = null;
    setView(null);
    if (current && boardRef.current?.hasPointerCapture(current.pointerId)) {
      boardRef.current.releasePointerCapture(current.pointerId);
    }
    return current;
  }, [boardRef]);

  useEffect(() => {
    const cancel = () => {
      release();
    };
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      session.current = null;
    };
  }, [release]);

  const locate = (current: DragSession): DragView => {
    const board = boardRef.current;
    const bounds = board?.getBoundingClientRect();
    const row = document
      .elementFromPoint(current.client.x, current.client.y)
      ?.closest<HTMLElement>(".fc-row");
    const kind = row?.dataset.kind;
    const id = row?.dataset.nodeId;
    const target: LibraryNode | null =
      row &&
      board?.contains(row) &&
      id &&
      (kind === "group" || kind === "path") &&
      kind !== current.source.kind
        ? { kind, id }
        : null;
    return {
      source: current.source,
      target,
      point: {
        x: current.client.x - (bounds?.left ?? 0),
        y: current.client.y - (bounds?.top ?? 0),
      },
    };
  };
  const start = (
    event: PointerEvent<HTMLButtonElement>,
    source: LibraryNode,
  ) => {
    if (event.button !== 0 || !event.isPrimary || session.current) return;
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    session.current = {
      source,
      pointerId: event.pointerId,
      start: point,
      client: point,
      active: false,
    };
    boardRef.current?.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.client = { x: event.clientX, y: event.clientY };
    if (
      !current.active &&
      Math.hypot(
        current.client.x - current.start.x,
        current.client.y - current.start.y,
      ) >= 5
    ) {
      current.active = true;
      onStart(current.source);
    }
    if (current.active) {
      event.preventDefault();
      setView(locate(current));
    }
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.client = { x: event.clientX, y: event.clientY };
    const target = current.active ? locate(current).target : null;
    release();
    if (!current.active) onTap(current.source);
    else if (target) onConnect(current.source, target);
  };
  const cancel = (event?: PointerEvent<HTMLDivElement>) => {
    if (!event || event.pointerId === session.current?.pointerId) release();
  };
  const scroll = () => {
    if (session.current?.active) setView(locate(session.current));
  };
  return { view, start, move, end, cancel, scroll };
}

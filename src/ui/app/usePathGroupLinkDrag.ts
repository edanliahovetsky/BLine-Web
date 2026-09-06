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
  canLink: (source: LibraryNode, target: LibraryNode) => boolean,
) {
  const session = useRef<DragSession | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const [view, setView] = useState<DragView | null>(null);
  const release = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
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
      if (scrollFrame.current !== null)
        cancelAnimationFrame(scrollFrame.current);
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
      canLink(current.source, { kind, id })
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
  const autoScroll = () => {
    const current = session.current;
    if (!current?.active) return;
    const kind = current.source.kind === "group" ? "path" : "group";
    const scroll = boardRef.current?.querySelector<HTMLElement>(
      `.fc-list-scroll[data-kind="${kind}"]`,
    );
    if (scroll) {
      const bounds = scroll.getBoundingClientRect();
      const { x, y } = current.client;
      if (
        x >= bounds.left &&
        x <= bounds.right &&
        y >= bounds.top - 10 &&
        y <= bounds.bottom + 10
      ) {
        const speed =
          y < bounds.top + 45
            ? -Math.ceil((bounds.top + 45 - y) / 6)
            : y > bounds.bottom - 45
              ? Math.ceil((y - bounds.bottom + 45) / 6)
              : 0;
        const before = scroll.scrollTop;
        scroll.scrollTop += speed;
        if (scroll.scrollTop !== before) setView(locate(current));
      }
    }
    scrollFrame.current = requestAnimationFrame(autoScroll);
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
      scrollFrame.current = requestAnimationFrame(autoScroll);
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

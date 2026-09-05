import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import type { ConnectionPoint, LibraryNode } from "./usePathGroupLinkDrag";

export type OffscreenDirection = "above" | "below";
interface PortPoint extends ConnectionPoint {
  offscreen: OffscreenDirection | null;
}
interface Geometry {
  width: number;
  height: number;
  points: Map<string, PortPoint>;
  overflowAnchors: Map<string, ConnectionPoint>;
}

export function usePathLibraryGeometry(
  boardRef: RefObject<HTMLDivElement | null>,
  layoutKey: string,
) {
  const [geometry, setGeometry] = useState<Geometry>({
    width: 1,
    height: 1,
    points: new Map(),
    overflowAnchors: new Map(),
  });
  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const bounds = board.getBoundingClientRect();
    const viewports = new Map<Element, { top: number; bottom: number }>();
    board.querySelectorAll(".fc-list-scroll").forEach((scroll) => {
      const rect = scroll.getBoundingClientRect();
      const connectedCenters = [
        ...scroll.querySelectorAll(".fc-row.is-related .fc-port"),
      ].map((port) => {
        const point = port.getBoundingClientRect();
        return point.y + point.height / 2;
      });
      // Keep endpoints covered by a stack in that stack's connection count.
      viewports.set(scroll, {
        top:
          rect.top + (connectedCenters.some((y) => y < rect.top + 4) ? 74 : 4),
        bottom:
          rect.bottom -
          (connectedCenters.some((y) => y > rect.bottom - 4) ? 74 : 4),
      });
    });
    const points = new Map<string, PortPoint>();
    board.querySelectorAll<HTMLButtonElement>(".fc-port").forEach((port) => {
      const rect = port.getBoundingClientRect();
      const scroll = port.closest(".fc-list-scroll");
      const scrollBounds = scroll ? viewports.get(scroll) : undefined;
      const center = rect.y + rect.height / 2;
      points.set(port.dataset.nodeKey!, {
        x: rect.x + rect.width / 2 - bounds.x,
        y: center - bounds.y,
        offscreen: !scrollBounds
          ? null
          : center < scrollBounds.top
            ? "above"
            : center > scrollBounds.bottom
              ? "below"
              : null,
      });
    });
    const overflowAnchors = new Map<string, ConnectionPoint>();
    board
      .querySelectorAll<HTMLElement>(".fc-list-viewport")
      .forEach((viewport) => {
        const kind = viewport.dataset.kind;
        const rect = viewport.getBoundingClientRect();
        for (const direction of ["above", "below"] as const) {
          overflowAnchors.set(`${kind}:${direction}`, {
            x: (kind === "group" ? rect.right : rect.left) - bounds.x,
            y:
              (direction === "above" ? rect.top + 37 : rect.bottom - 37) -
              bounds.y,
          });
        }
      });
    setGeometry({
      width: bounds.width,
      height: bounds.height,
      points,
      overflowAnchors,
    });
  }, [boardRef]);

  useLayoutEffect(() => {
    measure();
    const board = boardRef.current;
    if (!board) return;
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    board
      .querySelectorAll(".fc-list-viewport")
      .forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [boardRef, layoutKey, measure]);

  const jumpToConnection = (
    kind: LibraryNode["kind"],
    ids: readonly string[],
    direction: OffscreenDirection,
  ) => {
    const scroll = boardRef.current?.querySelector<HTMLElement>(
      `.fc-list-scroll[data-kind="${kind}"]`,
    );
    if (!scroll) return;
    const matches = new Set(ids);
    const rows = [...scroll.querySelectorAll<HTMLElement>(".fc-row")].filter(
      (row) => matches.has(row.dataset.nodeId!),
    );
    const row = direction === "above" ? rows.at(-1) : rows[0];
    if (!row) return;
    const rect = row.getBoundingClientRect(),
      viewport = scroll.getBoundingClientRect();
    scroll.scrollTop +=
      rect.y + rect.height / 2 - viewport.y - viewport.height / 2;
    measure();
  };
  return { geometry, measure, jumpToConnection };
}

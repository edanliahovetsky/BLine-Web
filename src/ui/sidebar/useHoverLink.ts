import { useEffect } from "react";
import { hoverLinkStore, linkedHoverIndex } from "../../state/hoverLinkStore";
import { useStoreSelector } from "../../state/react";

/** The element the pointer is over on the canvas, for rows and chips to echo. */
export function useCanvasHoverIndex(): number | null {
  return useStoreSelector(hoverLinkStore, (state) =>
    linkedHoverIndex(state, "sidebar"),
  );
}

/** Pointer handlers that point the canvas at an element from the sidebar. */
export function sidebarHoverProps(elementIndex: number) {
  return {
    onPointerEnter: () =>
      hoverLinkStore.getState().hover("sidebar", elementIndex),
    onPointerLeave: () => hoverLinkStore.getState().leave("sidebar"),
  };
}

/** A list that unmounts under the pointer never fires its leave handler. */
export function useEndSidebarHoverOnUnmount(): void {
  useEffect(() => () => hoverLinkStore.getState().leave("sidebar"), []);
}

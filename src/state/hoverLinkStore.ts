import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Which surface the pointer is over, so the other one can echo it: hovering
 * an element on the canvas highlights its sidebar row and chip, and hovering
 * a row or chip highlights the element on the canvas. Highlight only — the
 * echo never selects anything.
 */
export type HoverLinkSource = "canvas" | "sidebar";

export interface HoverLinkState {
  elementIndex: number | null;
  source: HoverLinkSource | null;
  hover(source: HoverLinkSource, elementIndex: number | null): void;
  /** Ends hover from one surface without clearing the other's. */
  leave(source: HoverLinkSource): void;
}

export type HoverLinkStore = StoreApi<HoverLinkState>;

export function createHoverLinkStore(): HoverLinkStore {
  return createStore<HoverLinkState>((set, get) => ({
    elementIndex: null,
    source: null,
    hover(source, elementIndex) {
      if (elementIndex === null || elementIndex < 0) {
        get().leave(source);
        return;
      }
      const state = get();
      if (state.source === source && state.elementIndex === elementIndex) {
        return;
      }
      set({ source, elementIndex });
    },
    leave(source) {
      if (get().source === source) set({ source: null, elementIndex: null });
    },
  }));
}

export const hoverLinkStore = createHoverLinkStore();

/** The element another surface is pointing at, as seen from `viewer`. */
export function linkedHoverIndex(
  state: Pick<HoverLinkState, "elementIndex" | "source">,
  viewer: HoverLinkSource,
): number | null {
  return state.source !== null && state.source !== viewer
    ? state.elementIndex
    : null;
}

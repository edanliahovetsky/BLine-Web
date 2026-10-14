import { describe, expect, it } from "vitest";
import {
  createHoverLinkStore,
  linkedHoverIndex,
} from "../../../src/state/hoverLinkStore";

describe("hover link store", () => {
  it("echoes one surface's hover to the other surface only", () => {
    const store = createHoverLinkStore();
    store.getState().hover("sidebar", 2);
    expect(linkedHoverIndex(store.getState(), "canvas")).toBe(2);
    expect(linkedHoverIndex(store.getState(), "sidebar")).toBeNull();

    store.getState().hover("canvas", 4);
    expect(linkedHoverIndex(store.getState(), "sidebar")).toBe(4);
    expect(linkedHoverIndex(store.getState(), "canvas")).toBeNull();
  });

  it("lets a surface end only its own hover", () => {
    const store = createHoverLinkStore();
    store.getState().hover("canvas", 1);
    store.getState().leave("sidebar");
    expect(store.getState().elementIndex).toBe(1);
    store.getState().hover("canvas", null);
    expect(store.getState()).toMatchObject({
      source: null,
      elementIndex: null,
    });
  });

  it("ignores the preview start pose", () => {
    const store = createHoverLinkStore();
    store.getState().hover("canvas", -1);
    expect(store.getState().source).toBeNull();
  });
});

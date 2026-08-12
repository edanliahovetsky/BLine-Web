import { describe, expect, it } from "vitest";

import {
  orderedSelectionGesture,
  updateOrderedSelection,
} from "../../../src/ui/sidebar/orderedSelection";

describe("ordered selection", () => {
  const orderedIndexes = [10, 20, 30, 40];

  it("replaces the selection with the inclusive range from its anchor", () => {
    expect(
      updateOrderedSelection({
        orderedIndexes,
        selectedIndexes: [10],
        anchorIndex: 10,
        targetIndex: 40,
        gesture: "range",
      }),
    ).toEqual({
      anchorIndex: 10,
      focusIndex: 40,
      indexes: [10, 20, 30, 40],
    });
  });

  it("selects an inclusive range in reverse path order", () => {
    expect(
      updateOrderedSelection({
        orderedIndexes,
        selectedIndexes: [40],
        anchorIndex: 40,
        targetIndex: 20,
        gesture: "range",
      }).indexes,
    ).toEqual([20, 30, 40]);
  });

  it("toggles noncontiguous entries without disturbing the others", () => {
    const added = updateOrderedSelection({
      orderedIndexes,
      selectedIndexes: [10],
      anchorIndex: 10,
      targetIndex: 30,
      gesture: "toggle",
    });
    expect(added.indexes).toEqual([10, 30]);

    expect(
      updateOrderedSelection({
        orderedIndexes,
        selectedIndexes: added.indexes,
        anchorIndex: added.anchorIndex,
        targetIndex: 10,
        gesture: "toggle",
      }),
    ).toEqual({
      anchorIndex: 10,
      focusIndex: 30,
      indexes: [30],
    });
  });

  it("adds a range to an existing noncontiguous selection", () => {
    expect(
      updateOrderedSelection({
        orderedIndexes,
        selectedIndexes: [10, 40],
        anchorIndex: 10,
        targetIndex: 30,
        gesture: "add-range",
      }).indexes,
    ).toEqual([10, 20, 30, 40]);
  });

  it("uses the target as the range anchor when no valid anchor exists", () => {
    expect(
      updateOrderedSelection({
        orderedIndexes,
        selectedIndexes: [],
        anchorIndex: 99,
        targetIndex: 30,
        gesture: "range",
      }),
    ).toEqual({
      anchorIndex: 30,
      focusIndex: 30,
      indexes: [30],
    });
  });

  it("maps standard platform modifiers to selection gestures", () => {
    expect(
      orderedSelectionGesture({
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe("range");
    expect(
      orderedSelectionGesture({
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe("toggle");
    expect(
      orderedSelectionGesture({
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe("add-range");
  });
});

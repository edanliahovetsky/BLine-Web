export type OrderedSelectionGesture =
  | "replace"
  | "range"
  | "toggle"
  | "add-range";

export type OrderedSelectionState = {
  anchorIndex: number | null;
  focusIndex: number | null;
  indexes: number[];
};

type SelectionModifiers = {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export function orderedSelectionGesture(
  modifiers: SelectionModifiers,
): OrderedSelectionGesture {
  const toggle = modifiers.metaKey || modifiers.ctrlKey;
  if (modifiers.shiftKey) {
    return toggle ? "add-range" : "range";
  }
  return toggle ? "toggle" : "replace";
}

export function updateOrderedSelection({
  orderedIndexes,
  selectedIndexes,
  anchorIndex,
  targetIndex,
  gesture,
}: {
  orderedIndexes: readonly number[];
  selectedIndexes: readonly number[];
  anchorIndex: number | null;
  targetIndex: number;
  gesture: OrderedSelectionGesture;
}): OrderedSelectionState {
  const order = [...new Set(orderedIndexes)];
  const orderSet = new Set(order);
  const currentSet = new Set(
    selectedIndexes.filter((index) => orderSet.has(index)),
  );

  if (!orderSet.has(targetIndex)) {
    const indexes = order.filter((index) => currentSet.has(index));
    return {
      anchorIndex:
        anchorIndex !== null && orderSet.has(anchorIndex) ? anchorIndex : null,
      focusIndex: indexes.at(-1) ?? null,
      indexes,
    };
  }

  if (gesture === "replace") {
    return {
      anchorIndex: targetIndex,
      focusIndex: targetIndex,
      indexes: [targetIndex],
    };
  }

  if (gesture === "toggle") {
    if (currentSet.has(targetIndex)) {
      currentSet.delete(targetIndex);
    } else {
      currentSet.add(targetIndex);
    }
    const indexes = order.filter((index) => currentSet.has(index));
    return {
      anchorIndex: indexes.length > 0 ? targetIndex : null,
      focusIndex: currentSet.has(targetIndex)
        ? targetIndex
        : (indexes.at(-1) ?? null),
      indexes,
    };
  }

  const rangeAnchor =
    anchorIndex !== null && orderSet.has(anchorIndex)
      ? anchorIndex
      : targetIndex;
  const anchorPosition = order.indexOf(rangeAnchor);
  const targetPosition = order.indexOf(targetIndex);
  const rangeStart = Math.min(anchorPosition, targetPosition);
  const rangeEnd = Math.max(anchorPosition, targetPosition);
  const rangeIndexes = order.slice(rangeStart, rangeEnd + 1);

  if (gesture === "add-range") {
    for (const index of rangeIndexes) {
      currentSet.add(index);
    }
  } else {
    currentSet.clear();
    for (const index of rangeIndexes) {
      currentSet.add(index);
    }
  }

  return {
    anchorIndex: rangeAnchor,
    focusIndex: targetIndex,
    indexes: order.filter((index) => currentSet.has(index)),
  };
}

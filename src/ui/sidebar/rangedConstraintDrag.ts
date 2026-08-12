import type { RangedConstraint } from "../../core/model/path";

export type RangedEntry = {
  constraint: RangedConstraint;
  index: number;
};

export type RangeBoundary = {
  segmentIndex: number;
  side: "start" | "end";
};

export function cloneRangedEntries(
  entries: readonly RangedEntry[],
): RangedEntry[] {
  return entries.map((entry) => ({
    index: entry.index,
    constraint: { ...entry.constraint },
  }));
}

export function hitTestRangeBoundary(
  entries: readonly RangedEntry[],
  position: number,
  cellExtent: number,
  preferredSegmentIndex = -1,
): RangeBoundary | null {
  const preferred = boundaryForEntry(
    entries,
    preferredSegmentIndex,
    position,
    cellExtent,
  );
  if (preferred) {
    return preferred;
  }

  for (let segmentIndex = 0; segmentIndex < entries.length; segmentIndex += 1) {
    if (segmentIndex === preferredSegmentIndex) {
      continue;
    }
    const boundary = boundaryForEntry(
      entries,
      segmentIndex,
      position,
      cellExtent,
    );
    if (boundary) {
      return boundary;
    }
  }

  return null;
}

export function hitTestRangeSegment(
  entries: readonly RangedEntry[],
  position: number,
  cellExtent: number,
): number {
  return entries.findIndex(({ constraint }) => {
    const start = (constraint.start_ordinal - 1) * cellExtent;
    const end = constraint.end_ordinal * cellExtent;
    return position >= start && position < end;
  });
}

/**
 * Resize from the drag-start snapshot so moving away and back is reversible.
 * A shared edge behaves like a divider and always leaves both ranges at least
 * one cell wide.
 */
export function resizeRangedSegment(
  entries: readonly RangedEntry[],
  segmentIndex: number,
  side: "start" | "end",
  ordinal: number,
  total: number,
): RangedEntry[] {
  const nextEntries = cloneRangedEntries(entries);
  const entry = nextEntries[segmentIndex];
  if (!entry || hasOverlappingSibling(entries, segmentIndex)) {
    return cloneRangedEntries(entries);
  }

  const segment = entry.constraint;
  if (side === "start") {
    const previousIndex = closestPreviousSegment(entries, segmentIndex);
    const previous = nextEntries[previousIndex]?.constraint;
    const sharedBoundary = previous?.end_ordinal === segment.start_ordinal - 1;
    const minimumStart = sharedBoundary
      ? previous.start_ordinal + 1
      : previous
        ? previous.end_ordinal + 1
        : 1;
    const nextStart = clampOrdinal(ordinal, minimumStart, segment.end_ordinal);

    if (previous && sharedBoundary) {
      previous.end_ordinal = nextStart - 1;
    }
    segment.start_ordinal = nextStart;
  } else {
    const nextIndex = closestNextSegment(entries, segmentIndex);
    const following = nextEntries[nextIndex]?.constraint;
    const sharedBoundary = following?.start_ordinal === segment.end_ordinal + 1;
    const maximumEnd = sharedBoundary
      ? following.end_ordinal - 1
      : following
        ? following.start_ordinal - 1
        : total;
    const nextEnd = clampOrdinal(ordinal, segment.start_ordinal, maximumEnd);

    if (following && sharedBoundary) {
      following.start_ordinal = nextEnd + 1;
    }
    segment.end_ordinal = nextEnd;
  }

  return nextEntries;
}

/**
 * Move a range only inside the free interval between its current neighbors.
 * Ranges never cross, overlap, shrink, or accumulate collision corrections
 * while the pointer moves.
 */
export function moveRangedSegment(
  entries: readonly RangedEntry[],
  segmentIndex: number,
  targetOrdinal: number,
  offset: number,
  total: number,
): RangedEntry[] {
  const nextEntries = cloneRangedEntries(entries);
  const entry = nextEntries[segmentIndex];
  if (!entry || hasOverlappingSibling(entries, segmentIndex)) {
    return cloneRangedEntries(entries);
  }

  const segment = entry.constraint;
  const width = segment.end_ordinal - segment.start_ordinal;
  const previousIndex = closestPreviousSegment(entries, segmentIndex);
  const nextIndex = closestNextSegment(entries, segmentIndex);
  const previous = entries[previousIndex]?.constraint;
  const following = entries[nextIndex]?.constraint;
  const minimumStart = previous ? previous.end_ordinal + 1 : 1;
  const maximumStart = following
    ? following.start_ordinal - width - 1
    : total - width;

  if (minimumStart > maximumStart) {
    return nextEntries;
  }

  const desiredStart = targetOrdinal - offset;
  const nextStart = clampOrdinal(desiredStart, minimumStart, maximumStart);
  segment.start_ordinal = nextStart;
  segment.end_ordinal = nextStart + width;
  return nextEntries;
}

function boundaryForEntry(
  entries: readonly RangedEntry[],
  segmentIndex: number,
  position: number,
  cellExtent: number,
): RangeBoundary | null {
  const constraint = entries[segmentIndex]?.constraint;
  if (!constraint) {
    return null;
  }

  const hitRadius = 5;
  const start = (constraint.start_ordinal - 1) * cellExtent;
  const end = constraint.end_ordinal * cellExtent;
  if (Math.abs(position - start) <= hitRadius) {
    return { segmentIndex, side: "start" };
  }
  if (Math.abs(position - end) <= hitRadius) {
    return { segmentIndex, side: "end" };
  }
  return null;
}

function closestPreviousSegment(
  entries: readonly RangedEntry[],
  segmentIndex: number,
): number {
  const segment = entries[segmentIndex]?.constraint;
  if (!segment) {
    return -1;
  }

  let previousIndex = -1;
  let previousEnd = -Infinity;
  for (let index = 0; index < entries.length; index += 1) {
    if (index === segmentIndex) {
      continue;
    }
    const candidate = entries[index]?.constraint;
    if (
      candidate &&
      candidate.end_ordinal < segment.start_ordinal &&
      candidate.end_ordinal > previousEnd
    ) {
      previousIndex = index;
      previousEnd = candidate.end_ordinal;
    }
  }
  return previousIndex;
}

function closestNextSegment(
  entries: readonly RangedEntry[],
  segmentIndex: number,
): number {
  const segment = entries[segmentIndex]?.constraint;
  if (!segment) {
    return -1;
  }

  let nextIndex = -1;
  let nextStart = Infinity;
  for (let index = 0; index < entries.length; index += 1) {
    if (index === segmentIndex) {
      continue;
    }
    const candidate = entries[index]?.constraint;
    if (
      candidate &&
      candidate.start_ordinal > segment.end_ordinal &&
      candidate.start_ordinal < nextStart
    ) {
      nextIndex = index;
      nextStart = candidate.start_ordinal;
    }
  }
  return nextIndex;
}

function hasOverlappingSibling(
  entries: readonly RangedEntry[],
  segmentIndex: number,
): boolean {
  const segment = entries[segmentIndex]?.constraint;
  if (!segment) {
    return true;
  }

  return entries.some(({ constraint }, index) => {
    if (index === segmentIndex) {
      return false;
    }
    return (
      constraint.start_ordinal <= segment.end_ordinal &&
      constraint.end_ordinal >= segment.start_ordinal
    );
  });
}

function clampOrdinal(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

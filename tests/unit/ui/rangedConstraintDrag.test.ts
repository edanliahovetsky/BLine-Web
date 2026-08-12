import { describe, expect, it } from "vitest";

import type { RangedConstraint } from "../../../src/core/model/path";
import {
  hitTestRangeBoundary,
  moveRangedSegment,
  resizeRangedSegment,
  type RangedEntry,
} from "../../../src/ui/sidebar/rangedConstraintDrag";

describe("ranged constraint drag geometry", () => {
  it("gives a clicked range ownership of its shared boundary", () => {
    const entries = [entry(0, 1, 2), entry(1, 3, 4)];
    const sharedBoundary = 2 * 44;

    expect(hitTestRangeBoundary(entries, sharedBoundary, 44)).toEqual({
      segmentIndex: 0,
      side: "end",
    });
    expect(hitTestRangeBoundary(entries, sharedBoundary, 44, 1)).toEqual({
      segmentIndex: 1,
      side: "start",
    });
  });

  it("resizes a shared start edge upward and downward without losing a range", () => {
    const entries = [entry(0, 1, 2), entry(1, 3, 5)];

    expect(bounds(resizeRangedSegment(entries, 1, "start", 2, 5))).toEqual([
      [1, 1],
      [2, 5],
    ]);
    expect(bounds(resizeRangedSegment(entries, 1, "start", 4, 5))).toEqual([
      [1, 3],
      [4, 5],
    ]);
    expect(bounds(entries)).toEqual([
      [1, 2],
      [3, 5],
    ]);
  });

  it("resizes a shared end edge in either direction", () => {
    const entries = [entry(0, 1, 3), entry(1, 4, 6)];

    expect(bounds(resizeRangedSegment(entries, 0, "end", 4, 6))).toEqual([
      [1, 4],
      [5, 6],
    ]);
    expect(bounds(resizeRangedSegment(entries, 0, "end", 2, 6))).toEqual([
      [1, 2],
      [3, 6],
    ]);
  });

  it("moves a whole range only within the free interval between neighbors", () => {
    const entries = [entry(2, 7, 7), entry(1, 4, 5), entry(0, 1, 2)];

    expect(boundsByIndex(moveRangedSegment(entries, 1, 1, 0, 8))).toEqual({
      0: [1, 2],
      1: [3, 4],
      2: [7, 7],
    });
    expect(boundsByIndex(moveRangedSegment(entries, 1, 8, 0, 8))).toEqual({
      0: [1, 2],
      1: [5, 6],
      2: [7, 7],
    });
    expect(boundsByIndex(entries)).toEqual({
      0: [1, 2],
      1: [4, 5],
      2: [7, 7],
    });
  });

  it("keeps a whole range stable when adjacent ranges leave no free cell", () => {
    const entries = [entry(0, 1, 2), entry(1, 3, 4), entry(2, 5, 6)];

    expect(bounds(moveRangedSegment(entries, 1, 1, 0, 6))).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect(bounds(moveRangedSegment(entries, 1, 6, 0, 6))).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });
});

function entry(index: number, start: number, end: number): RangedEntry {
  const constraint: RangedConstraint = {
    key: "max_velocity_meters_per_sec",
    value: index + 1,
    start_ordinal: start,
    end_ordinal: end,
  };
  return { index, constraint };
}

function bounds(entries: readonly RangedEntry[]): Array<[number, number]> {
  return entries.map(({ constraint }) => [
    constraint.start_ordinal,
    constraint.end_ordinal,
  ]);
}

function boundsByIndex(
  entries: readonly RangedEntry[],
): Record<number, [number, number]> {
  return Object.fromEntries(
    entries.map(({ index, constraint }) => [
      index,
      [constraint.start_ordinal, constraint.end_ordinal],
    ]),
  );
}

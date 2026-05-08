import { describe, expect, it } from "vitest";
import {
  appendRangedConstraintInstance,
  remapRangedConstraints,
  rotationDomain,
  splitRangedConstraintInstance,
  translationDomain,
} from "../../../src/core/constraints/rangedConstraints";
import {
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  type RangedConstraint,
} from "../../../src/core/model/path";

describe("ranged constraint edit operations", () => {
  it("appends into the first free ordinal", () => {
    const constraints: RangedConstraint[] = [ranged(2, 1, 1), ranged(3, 3, 3)];

    const added = appendRangedConstraintInstance(
      constraints,
      "max_velocity_meters_per_sec",
      4,
      3,
    );

    expect(added).toEqual(ranged(4, 2, 2));
  });

  it("splits the largest covered range when no free ordinal remains", () => {
    const constraints: RangedConstraint[] = [ranged(2, 1, 3)];

    const added = appendRangedConstraintInstance(
      constraints,
      "max_velocity_meters_per_sec",
      5,
      3,
    );

    expect(added).toEqual(ranged(5, 3, 3));
    expect(constraints).toEqual([ranged(2, 1, 2), ranged(5, 3, 3)]);
  });

  it("returns null when fully covered ranges cannot be split", () => {
    const constraints: RangedConstraint[] = [ranged(2, 1, 1), ranged(3, 2, 2)];

    const added = appendRangedConstraintInstance(
      constraints,
      "max_velocity_meters_per_sec",
      4,
      2,
    );

    expect(added).toBeNull();
    expect(constraints).toEqual([ranged(2, 1, 1), ranged(3, 2, 2)]);
  });

  it("splits a selected range and inserts the new segment after it", () => {
    const first = ranged(2, 1, 2);
    const second = ranged(3, 3, 3);
    const constraints: RangedConstraint[] = [first, second];

    const added = splitRangedConstraintInstance(constraints, first);

    expect(added).toEqual(ranged(2, 2, 2));
    expect(constraints).toEqual([ranged(2, 1, 1), ranged(2, 2, 2), second]);
  });
});

describe("ranged constraint ordinal remap", () => {
  it("uses translation and rotation domains without event triggers", () => {
    const translation = createTranslationTarget();
    const waypoint = createWaypoint();
    const rotation = createRotationTarget();
    const event = createEventTrigger();

    expect(translationDomain([translation, rotation, waypoint, event])).toEqual(
      [translation, waypoint],
    );
    expect(rotationDomain([translation, rotation, waypoint, event])).toEqual([
      rotation,
      waypoint,
    ]);
  });

  it("shifts inserted translation-domain elements by identity", () => {
    const first = createTranslationTarget();
    const second = createTranslationTarget();
    const inserted = createTranslationTarget();
    const path = createPathModel({
      path_elements: [inserted, first, second],
      ranged_constraints: [ranged(2, 1, 2)],
    });

    remapRangedConstraints(path, [first, second]);

    expect(path.ranged_constraints).toEqual([ranged(2, 2, 3)]);
  });

  it("drops constraints whose entire covered range was removed", () => {
    const first = createTranslationTarget();
    const second = createTranslationTarget();
    const path = createPathModel({
      path_elements: [second],
      ranged_constraints: [ranged(2, 1, 1)],
    });

    remapRangedConstraints(path, [first, second]);

    expect(path.ranged_constraints).toEqual([]);
  });

  it("drops rotation constraints that only covered event triggers", () => {
    const eventA = createEventTrigger();
    const eventB = createEventTrigger();
    const inserted = createEventTrigger();
    const path = createPathModel({
      path_elements: [inserted, eventA, eventB],
      ranged_constraints: [
        {
          key: "max_velocity_deg_per_sec",
          value: 50,
          start_ordinal: 1,
          end_ordinal: 2,
        },
      ],
    });

    remapRangedConstraints(path, [eventA, eventB]);

    expect(path.ranged_constraints).toEqual([]);
  });
});

function ranged(
  value: number,
  start_ordinal: number,
  end_ordinal: number,
): RangedConstraint {
  return {
    key: "max_velocity_meters_per_sec",
    value,
    start_ordinal,
    end_ordinal,
  };
}

import { describe, expect, it } from "vitest";
import { seedHandoffRadii } from "../../../src/core/bend/autoSeedHandoffRadii";
import { solveJointAutoConstraints } from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createTranslationTarget,
  getHandoffRadiusSource,
  setHandoffRadiusSource,
  type PathModel,
} from "../../../src/core/model/path";

function pathOf(points: Array<[number, number]>): PathModel {
  return createPathModel({
    path_elements: points.map(([x, y]) =>
      createTranslationTarget({ x_meters: x, y_meters: y }),
    ),
  });
}

describe("solveJointAutoConstraints", () => {
  it("solves coupled handoff radii and adjacent velocity caps as one bounded policy", () => {
    const path = pathOf([
      [5.7, 2.5],
      [7, 4],
      [14.88016, 2.7264],
      [10.9, 5.5],
    ]);
    const seeded = seedHandoffRadii(path).path;

    const result = solveJointAutoConstraints(seeded, {});

    expect(result.status).toBe("valid");
    expect(result.profile.diagnostics.reachedEnd).toBe(true);
    expect(
      result.profile.diagnostics.handoffs.every(
        (handoff) => handoff.passed && !handoff.skippedOutgoingSegment,
      ),
    ).toBe(true);
    expect(result.profile.segmentCaps).toHaveLength(4);
    expect(result.stats.evaluations).toBeLessThanOrEqual(180);
    expect(["converged", "evaluation-budget"]).toContain(
      result.stats.terminationReason,
    );
  });

  it("keeps a straight-through anchor canonical instead of inventing a tiny corner", () => {
    const path = pathOf([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);

    const result = solveJointAutoConstraints(seedHandoffRadii(path).path, {});

    expect(result.status).toBe("valid");
    expect(result.profile.corners).toHaveLength(0);
    expect(result.path.path_elements[1]).toMatchObject({
      intermediate_handoff_radius_meters: null,
    });
    expect(result.profile.segmentCaps.slice(1).map((cap) => cap.value)).toEqual(
      [
        result.profile.usableMaxVelocityMps,
        result.profile.usableMaxVelocityMps,
      ],
    );
    expect(result.profile.diagnostics.reachedEnd).toBe(true);
  });

  it("reports an unset corner whose incoming leg cannot fit the radius lattice", () => {
    const path = pathOf([
      [0, 0],
      [0.04, 0],
      [0.04, 1],
    ]);

    const result = solveJointAutoConstraints(seedHandoffRadii(path).path, {});

    expect(result.status).toBe("unsolvable");
    expect(result.path.path_elements[1]).toMatchObject({
      intermediate_handoff_radius_meters: null,
    });
  });

  it("preserves manual radius and velocity pins while solving neighboring coordinates", () => {
    const path = pathOf([
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ]);
    path.path_elements[1] = setHandoffRadiusSource(
      createTranslationTarget({
        x_meters: 1,
        y_meters: 0,
        intermediate_handoff_radius_meters: 0.3,
      }),
      "manual",
    );
    path.ranged_constraints = [
      {
        key: "max_velocity_meters_per_sec",
        value: 1.5,
        start_ordinal: 2,
        end_ordinal: 2,
      },
    ];

    const result = solveJointAutoConstraints(seedHandoffRadii(path).path, {});

    expect(result.path.path_elements[1]).toMatchObject({
      intermediate_handoff_radius_meters: 0.3,
    });
    expect(getHandoffRadiusSource(result.path.path_elements[1])).toBe("manual");
    expect(
      result.profile.segmentCaps.find((cap) => cap.targetOrdinal === 2)?.value,
    ).toBe(1.5);
    expect(result.status).toBe("valid");
  });

  it("returns the same persisted policy for identical inputs", () => {
    const seeded = seedHandoffRadii(
      pathOf([
        [0, 0],
        [1.4, 0],
        [1.4, 1.1],
        [2.8, 1.1],
      ]),
    ).path;

    expect(solveJointAutoConstraints(seeded, {})).toEqual(
      solveJointAutoConstraints(seeded, {}),
    );
  });
});

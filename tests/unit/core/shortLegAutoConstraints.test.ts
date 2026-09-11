import { describe, expect, it } from "vitest";
import {
  applyGeneratedAutoRadii,
  autoRadiiCapSolveInput,
} from "../../../src/core/constraints/autoConstraintGeneration";
import { autoVelocitySettingsForPath } from "../../../src/core/constraints/autoVelocityApply";
import { anchorHandoffRadii } from "../../../src/core/model/handoffRadii";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  getHandoffRadiusSource,
  setHandoffRadiusSource,
  type PathModel,
} from "../../../src/core/model/path";

const config = {
  default_max_velocity_meters_per_sec: 4,
  default_max_acceleration_meters_per_sec2: 8,
  default_intermediate_handoff_radius_meters: 0.25,
  default_max_velocity_deg_per_sec: 180,
  default_max_acceleration_deg_per_sec2: 360,
};

function cornerPath(incoming: number, outgoing: number): PathModel {
  return createPathModel({
    path_elements: [
      createTranslationTarget(),
      createTranslationTarget({ x_meters: incoming }),
      createTranslationTarget({ x_meters: incoming, y_meters: outgoing }),
    ],
  });
}

function solve(path: PathModel) {
  return autoRadiiCapSolveInput(
    path,
    config,
    autoVelocitySettingsForPath(path, config),
  );
}

describe("short-leg automatic constraints", () => {
  it.each([
    [0.0556, 1],
    [0.06, 1],
    [0.1, 1],
    [0.2, 0.2],
    [0.299, 0.299],
    [0.3, 0.3],
    [0.301, 0.301],
    [1, 0.01],
    [2, 0.1],
  ])(
    "solves a %s m approach and %s m exit within the existing bounds",
    (incoming, outgoing) => {
      const path = cornerPath(incoming, outgoing);
      const result = solve(path);
      const radius = result.radii.find(
        (assignment) => assignment.elementIndex === 1,
      )?.radiusMeters;

      expect(radius).toBeGreaterThanOrEqual(0.05);
      expect(radius).toBeLessThanOrEqual(0.9 * incoming + 1e-9);
      expect(getHandoffRadiusSource(result.path.path_elements[1])).toBe("auto");
      expect(result.stats.searchableBlocks).toBe(1);
      expect(result.status).toBe("valid");
      expect(result.stats.stabilityValidationPassed).toBe(true);
      expect(result.profile.diagnostics.reachedEnd).toBe(true);
      expect(result.profile.diagnostics.handoffs).toHaveLength(1);
      expect(result.profile.diagnostics.handoffs[0]).toMatchObject({
        passed: true,
        skippedOutgoingSegment: false,
      });
      expect(result.path.path_elements[2]).toEqual(path.path_elements[2]);
      expect(solve(result.path)).toEqual(result);
    },
  );

  it.each([0.04, 0.0555])(
    "clears stale generated output and uses the default when a %s m approach cannot fit the minimum",
    (incoming) => {
      const path = cornerPath(incoming, 1);
      path.path_elements[1] = setHandoffRadiusSource(
        createTranslationTarget({
          x_meters: incoming,
          intermediate_handoff_radius_meters: 0.2,
        }),
        "auto",
      );
      const result = solve(path);
      const applied = applyGeneratedAutoRadii(path, result.radii);

      expect(result.radii).toContainEqual({
        elementIndex: 1,
        radiusMeters: null,
      });
      expect(result.stats.searchableBlocks).toBe(0);
      expect(result.status).not.toBe("unsolvable");
      expect(anchorHandoffRadii(applied.path_elements, 0.25)[1]).toMatchObject({
        valueMeters: null,
        effectiveValueMeters: 0.25,
        source: null,
        inert: false,
      });
      expect(result.path).toEqual(applied);
    },
  );

  it.each([null, "manual"] as const)(
    "preserves an authored radius below the generator minimum with source %s",
    (source) => {
      const path = cornerPath(0.1, 1);
      path.path_elements[1] = setHandoffRadiusSource(
        createTranslationTarget({
          x_meters: 0.1,
          intermediate_handoff_radius_meters: 0.02,
        }),
        source,
      );
      const result = solve(path);

      expect(result.path.path_elements[1]).toEqual(path.path_elements[1]);
      expect(result.radii).not.toContainEqual(
        expect.objectContaining({ elementIndex: 1 }),
      );
      expect(result.status).toBe("valid");
    },
  );

  it("generates a short-leg waypoint radius while satisfying its authored rotation", () => {
    const path = cornerPath(0.2, 2);
    path.path_elements[1] = createWaypoint({
      translation_target: createTranslationTarget({ x_meters: 0.2 }),
      rotation_target: createRotationTarget({
        rotation_radians: Math.PI / 6,
        profiled_rotation: false,
      }),
    });
    const result = solve(path);
    const radius = result.radii.find(
      (assignment) => assignment.elementIndex === 1,
    )?.radiusMeters;

    expect(radius).toBeGreaterThanOrEqual(0.05);
    expect(radius).toBeLessThanOrEqual(0.18);
    expect(getHandoffRadiusSource(result.path.path_elements[1])).toBe("auto");
    expect(result.status).toBe("valid");
    expect(
      result.profile.diagnostics.rotationFeasibility?.length,
    ).toBeGreaterThan(0);
    expect(
      result.profile.diagnostics.rotationFeasibility?.every(
        (target) => target.passed,
      ),
    ).toBe(true);
    expect(result.stats.stabilityValidationPassed).toBe(true);
  });
});

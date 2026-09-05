import { expect, it } from "vitest";
import { solveJointAutoConstraints } from "../../../src/core/constraints/autoVelocityConstraints";
import { refreshAutoVelocityConstraints } from "../../../src/core/constraints/autoVelocityApply";
import {
  createPathModel,
  createTranslationTarget,
  createRotationTarget,
  createWaypoint,
  setHandoffRadiusSource,
} from "../../../src/core/model/path";
import { simulatePathWithTrace } from "../../../src/core/sim";
import { evaluateRotationFeasibility } from "../../../src/core/sim/rotationFeasibility";

// Exported six-anchor path that took 19.56 s with version 10. Its fast seed
// exceeded the 0.26 m corridor limit at one corner; feasibility-first search
// abandoned that seed and settled on 1.18 m/s caps and 0.05–0.21 m radii.
const points = [
  [6.40373, 6.59658, 0.45],
  [7.70599, 4.76691, 0.05],
  [9.92548, 5.63044, 0.081],
  [6.60621, 1.87782, 0.207],
  [14.8527, 6.26767, 0.149],
  [14.61279, 0.49502, 0.25],
] as const;
const path = createPathModel({
  path_elements: points.map(([x, y, radius], index) => {
    const translation = createTranslationTarget({
      x_meters: x,
      y_meters: y,
      intermediate_handoff_radius_meters: radius,
    });
    return setHandoffRadiusSource(
      index === 1 || index === 2
        ? createWaypoint({
            translation_target: translation,
            rotation_target: createRotationTarget({
              rotation_radians: index === 1 ? 0.4427 : -2.89776,
              profiled_rotation: true,
            }),
          })
        : translation,
      "auto",
    );
  }),
  ranged_constraints: [2.25, 1.18, 1.18, 1.18, 1.18, 1.62].map(
    (value, index) => ({
      key: "max_velocity_meters_per_sec",
      value,
      start_ordinal: index + 1,
      end_ordinal: index + 1,
      source: "auto_velocity",
    }),
  ),
});
const config = {
  default_max_velocity_meters_per_sec: 4.5,
  default_max_acceleration_meters_per_sec2: 12,
  default_intermediate_handoff_radius_meters: 0.25,
  default_max_velocity_deg_per_sec: 600,
  default_max_acceleration_deg_per_sec2: 2000,
};
const settings = {
  velocitySafetyFactor: 0.9,
  accelerationSafetyFactor: 0.8,
  mergeToleranceMps: 0.3,
};

it("repairs a fast real-path seed instead of accepting a slow feasible basin", () => {
  const solved = solveJointAutoConstraints(path, config, settings);
  expect(solved.status).toBe("valid");
  expect(solved.profile.diagnostics.totalTimeS).toBeLessThan(7);
  expect(solved.profile.diagnostics.handoffs.every((h) => h.passed)).toBe(true);
  expect(solved.stats.stabilityValidationPassed).toBe(true);
  expect(
    solved.profile.corners.every(
      (corner) => corner.handoffDistanceMeters > 0.5,
    ),
  ).toBe(true);
  expect(
    solved.profile.segmentCaps
      .filter((cap) => cap.targetOrdinal > 1)
      .every((cap) => cap.value > 2.5),
  ).toBe(true);

  const saved = refreshAutoVelocityConstraints(solved.path, config, {
    whenPresentOnly: false,
    settings,
  });
  for (const dt of [0.02, 0.01, 0.005]) {
    const simulation = simulatePathWithTrace(saved, config, { dt_s: dt });
    expect(simulation.total_time_s).toBeLessThan(7);
    expect(
      evaluateRotationFeasibility(saved, config, simulation.trace).every(
        (target) => target.passed,
      ),
    ).toBe(true);
    const final = simulation.trace.at(-1)!;
    expect(
      Math.hypot(final.x_m - 14.61279, final.y_m - 0.49502),
    ).toBeLessThanOrEqual(0.001);
  }
}, 10000);

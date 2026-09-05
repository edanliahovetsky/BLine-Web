import { refreshAutoVelocityConstraints } from "../../../src/core/constraints/autoVelocityApply";
import { evaluateRotationFeasibility } from "../../../src/core/sim/rotationFeasibility";
import { simulatePathWithTrace } from "../../../src/core/sim";
import { describe, expect, it } from "vitest";
import {
  solveJointAutoConstraints,
  generateAutoVelocityProfile,
} from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
} from "../../../src/core/model/path";

const config = {
  default_max_velocity_meters_per_sec: 4,
  default_max_acceleration_meters_per_sec2: 8,
  default_max_velocity_deg_per_sec: 90,
  default_max_acceleration_deg_per_sec2: 180,
};
const options = { velocitySafetyFactor: 1, accelerationSafetyFactor: 1 };
function pathOf() {
  return createPathModel({
    path_elements: [
      createTranslationTarget({ x_meters: 0 }),
      createRotationTarget({
        t_ratio: 0.5,
        rotation_radians: Math.PI,
        profiled_rotation: false,
      }),
      createTranslationTarget({ x_meters: 4 }),
    ],
  });
}

describe("rotation-aware automatic constraints", () => {
  it("satisfies an analytical turn without the preview controller's lag budget", () => {
    const result = solveJointAutoConstraints(pathOf(), config, options);
    expect(result.status).toBe("valid");
    expect(
      result.profile.diagnostics.rotationFeasibility?.every(
        (target) => target.passed,
      ),
    ).toBe(true);
    expect(result.stats.stabilityValidationPassed).toBe(true);
    // A whole-leg cap must give the first 2 m at least 2.5 s. The rest of the
    // 4 m leg uses that same cap; no claim of per-sample speed optimization.
    expect(result.profile.diagnostics.totalTimeS).toBeGreaterThan(4.7);
    expect(result.profile.diagnostics.totalTimeS).toBeLessThan(5.3);
  });
  it("also gates cap refreshes while preserving authored values", () => {
    const path = pathOf();
    const snapshot = structuredClone(path);
    const profile = generateAutoVelocityProfile(path, config, options);
    expect(
      profile.diagnostics.rotationFeasibility?.every((target) => target.passed),
    ).toBe(true);
    expect(path).toEqual(snapshot);
    const pinned = {
      ...path,
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec" as const,
          value: 4,
          start_ordinal: 2,
          end_ordinal: 2,
        },
      ],
    };
    const result = solveJointAutoConstraints(pinned, config, options);
    expect(result.status).toBe("best-effort");
    expect(
      result.profile.segmentCaps.find((cap) => cap.targetOrdinal === 2)?.value,
    ).toBe(4);
    expect(result.path.ranged_constraints).toEqual(pinned.ranged_constraints);
  });
});

it("matches an independent two-waypoint cap lattice and preserves manual radii", () => {
  const path = createPathModel({
    path_elements: [
      createTranslationTarget(),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 4,
          intermediate_handoff_radius_meters: 0.45,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: Math.PI / 2,
          profiled_rotation: false,
        }),
      }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 4,
          y_meters: 4,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: Math.PI,
          profiled_rotation: false,
        }),
      }),
    ],
  });
  const result = solveJointAutoConstraints(path, config, options);
  expect(result.status).toBe("valid");
  expect(result.path.path_elements.slice(1)).toEqual(
    path.path_elements.slice(1),
  );
  expect(result.profile.diagnostics.totalTimeS).toBeLessThan(4.2);
  // Independent oracle: both 90 degree unprofiled turns need 1.5 s from rest.
  // Check actual translation arrival, with no dependency on the new angular
  // evaluator or on the preview controller's heading error.
  let oracle = Infinity;
  for (let first = 0.8; first <= 3.6; first += 0.1) {
    for (let second = 0.8; second <= 3.6; second += 0.1) {
      const candidate = {
        ...path,
        ranged_constraints: [first, second].map((value, i) => ({
          key: "max_velocity_meters_per_sec" as const,
          value,
          start_ordinal: i + 2,
          end_ordinal: i + 2,
        })),
      };
      const trace = simulatePathWithTrace(candidate, config, {
        dt_s: 0.005,
      }).trace;
      const transition = trace.findIndex(
        (sample) => sample.segment_index === 1,
      );
      const handoff = trace[transition - 1]?.time_s ?? 0;
      const arrival = trace.find(
        (sample) =>
          sample.segment_index === 1 &&
          Math.hypot(sample.x_m - 4, sample.y_m - 4) < 0.001,
      )?.time_s;
      // This manual-radius fixture is slow enough that the simple corridor
      // gate independently rules out candidates that cut or overshoot the bend.
      const safe = trace.every(
        (sample) =>
          Math.min(Math.abs(sample.y_m), Math.abs(sample.x_m - 4)) <= 0.2 &&
          sample.x_m <= 4.2,
      );
      if (
        arrival !== undefined &&
        safe &&
        handoff >= 1.5 &&
        arrival - handoff >= 1.5
      )
        oracle = Math.min(oracle, arrival);
    }
  }
  expect(oracle).toBeLessThan(Infinity);
  expect(result.profile.diagnostics.totalTimeS).toBeLessThanOrEqual(
    oracle * 1.05 + 0.02,
  );
}, 15_000);

it("validates merged saved caps at all three timesteps", () => {
  const path = createPathModel({
    path_elements: [
      createTranslationTarget(),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 4,
          intermediate_handoff_radius_meters: 0.45,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: Math.PI / 2,
          profiled_rotation: false,
        }),
      }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 4,
          y_meters: 4,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: Math.PI,
          profiled_rotation: false,
        }),
      }),
    ],
  });
  const saved = refreshAutoVelocityConstraints(path, config, {
    whenPresentOnly: false,
    settings: {
      velocitySafetyFactor: 1,
      accelerationSafetyFactor: 1,
      mergeToleranceMps: 0.2,
    },
  });
  for (const dt of [0.02, 0.01, 0.005]) {
    const trace = simulatePathWithTrace(saved, config, { dt_s: dt }).trace;
    expect(
      evaluateRotationFeasibility(saved, config, trace).every(
        (target) => target.passed,
      ),
    ).toBe(true);
    const arrival = trace.find(
      (sample) =>
        sample.segment_index === 1 &&
        Math.hypot(sample.x_m - 4, sample.y_m - 4) < 0.001,
    );
    expect(arrival?.time_s).toBeLessThan(4.2);
  }
});

it("keeps an achievable profiled heading fast and reports impossible manual timing", () => {
  const path = createPathModel({
    path_elements: [
      createTranslationTarget(),
      createRotationTarget({
        t_ratio: 1,
        rotation_radians: Math.PI / 6,
        profiled_rotation: true,
      }),
      createTranslationTarget({ x_meters: 4 }),
    ],
  });
  const result = solveJointAutoConstraints(path, config, options);
  expect(result.status).toBe("valid");
  expect(result.profile.diagnostics.totalTimeS).toBeLessThan(2);
  const pinned = {
    ...pathOf(),
    ranged_constraints: [
      {
        key: "max_velocity_meters_per_sec" as const,
        value: 4,
        start_ordinal: 2,
        end_ordinal: 2,
      },
    ],
  };
  const impossible = solveJointAutoConstraints(pinned, config, {
    ...options,
    velocitySafetyFactor: 0.5,
  });
  expect(impossible.status).toBe("best-effort");
  expect(
    impossible.profile.segmentCaps.find((cap) => cap.targetOrdinal === 2)
      ?.value,
  ).toBe(4);
  expect(impossible.path.ranged_constraints).toEqual(pinned.ranged_constraints);
  expect(
    impossible.profile.diagnostics.rotationFeasibility?.[0]?.availableTimeS,
  ).toBeLessThan(1);
});

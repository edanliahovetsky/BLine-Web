import { describe, expect, it } from "vitest";
import {
  generateAutoVelocityProfile,
  solveJointAutoConstraints,
} from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createTranslationTarget,
  createRotationTarget,
  createWaypoint,
  setHandoffRadiusSource,
  type PathModel,
  type RangedConstraint,
} from "../../../src/core/model/path";
import { simulatePathWithTrace } from "../../../src/core/sim";

const config = {
  default_max_velocity_meters_per_sec: 4.5,
  default_max_acceleration_meters_per_sec2: 12,
  default_max_velocity_deg_per_sec: 720,
  default_max_acceleration_deg_per_sec2: 1500,
};
const options = {
  velocitySafetyFactor: 0.9,
  accelerationSafetyFactor: 0.8,
  mergeToleranceMps: 0,
};

function pathOf(rotations = false): PathModel {
  return createPathModel({
    path_elements: [
      [0, 0],
      [4, 0],
      [4, 4],
      [8, 4],
    ].map(([x, y], index) => {
      const target = createTranslationTarget({
        x_meters: x,
        y_meters: y,
        intermediate_handoff_radius_meters: 0.45,
      });
      return setHandoffRadiusSource(
        rotations && index === 2
          ? createWaypoint({
              translation_target: target,
              rotation_target: createRotationTarget({ rotation_radians: 0.2 }),
            })
          : target,
        "auto",
      );
    }),
  });
}

const acceleration: RangedConstraint = {
  key: "max_acceleration_meters_per_sec2",
  value: 2,
  start_ordinal: 3,
  end_ordinal: 3,
};

describe("ranged acceleration in automatic constraints", () => {
  it("leaves the policy unchanged for a range covering only the start anchor", () => {
    const baseline = solveJointAutoConstraints(pathOf(), config, options);
    const path = pathOf();
    path.ranged_constraints = [
      { ...acceleration, start_ordinal: 1, end_ordinal: 1 },
    ];
    const solved = solveJointAutoConstraints(path, config, options);
    expect(solved.profile.segmentCaps).toEqual(baseline.profile.segmentCaps);
    expect(solved.profile.corners).toEqual(baseline.profile.corners);
  });

  it("matches runtime acceleration ranges with overlapping reversed bounds", () => {
    const path = pathOf();
    path.ranged_constraints = [
      ...[2, 3, 4].map(
        (ordinal): RangedConstraint => ({
          key: "max_velocity_meters_per_sec",
          value: 1.5,
          start_ordinal: ordinal,
          end_ordinal: ordinal,
        }),
      ),
      { ...acceleration, value: 4, start_ordinal: 4, end_ordinal: 2 },
      acceleration,
    ];
    const profile = generateAutoVelocityProfile(path, config, options);
    const expected = simulatePathWithTrace(path, config);
    expect(profile.diagnostics.totalTimeS).toBeCloseTo(
      expected.total_time_s,
      6,
    );
    expect(profile.samples.at(-1)?.sMeters).toBeCloseTo(12, 6);
  });

  it.each([false, true])(
    "changes radii and caps for local acceleration with rotations=%s",
    (rotations) => {
      const baseline = solveJointAutoConstraints(
        pathOf(rotations),
        config,
        options,
      );
      const path = pathOf(rotations);
      path.ranged_constraints = [acceleration];
      const before = structuredClone(path);
      const limited = solveJointAutoConstraints(path, config, options);
      expect(limited.status).toBe("valid");
      expect(limited.stats.stabilityValidationPassed).toBe(true);
      expect(
        limited.profile.corners.map((corner) => corner.handoffDistanceMeters),
      ).not.toEqual(
        baseline.profile.corners.map((corner) => corner.handoffDistanceMeters),
      );
      expect(limited.profile.segmentCaps.map((cap) => cap.value)).not.toEqual(
        baseline.profile.segmentCaps.map((cap) => cap.value),
      );
      expect(limited.path.ranged_constraints).toEqual([acceleration]);
      expect(path).toEqual(before);
      const saved: PathModel = {
        ...limited.path,
        ranged_constraints: [
          ...limited.path.ranged_constraints,
          ...limited.profile.segmentCaps.map(
            (cap): RangedConstraint => ({
              key: "max_velocity_meters_per_sec",
              value: cap.value,
              start_ordinal: cap.targetOrdinal,
              end_ordinal: cap.targetOrdinal,
            }),
          ),
        ],
      };
      for (const factor of [1, options.accelerationSafetyFactor]) {
        const simulated: PathModel = {
          ...saved,
          constraints: {
            ...saved.constraints,
            max_acceleration_meters_per_sec2: 12 * factor,
          },
          ranged_constraints: saved.ranged_constraints.map((constraint) =>
            constraint.key === acceleration.key
              ? { ...constraint, value: constraint.value * factor }
              : constraint,
          ),
        };
        for (const dt of [0.02, 0.01, 0.005]) {
          const simulation = simulatePathWithTrace(simulated, config, {
            dt_s: dt,
          });
          expect(simulation.total_time_s).toBeLessThan(8);
          const final = simulation.trace.at(-1)!;
          expect(Math.hypot(final.x_m - 8, final.y_m - 4)).toBeLessThanOrEqual(
            0.001,
          );
          const cornerSamples = simulation.trace.filter(
            (sample) => sample.target_anchor_ordinal_1b === 3,
          );
          expect(cornerSamples.length).toBeGreaterThan(10);
          expect(
            Math.max(
              ...cornerSamples.map((sample) => sample.acceleration_mps2),
            ),
          ).toBeCloseTo(2 * factor, 6);
          const otherSamples = simulation.trace.filter(
            (sample) => sample.target_anchor_ordinal_1b !== 3,
          );
          expect(
            Math.max(...otherSamples.map((sample) => sample.acceleration_mps2)),
          ).toBeGreaterThan(2 * factor);
          // Independent corridor check within each handoff's checked interval.
          const segments = [
            [0, 0, 4, 0],
            [4, 0, 4, 4],
            [4, 4, 8, 4],
          ];
          for (const sample of simulation.trace) {
            if (
              !limited.profile.corners.some(
                (corner) =>
                  sample.global_s_m >= corner.startS - 1e-6 &&
                  sample.global_s_m <= corner.endS + 1e-6,
              )
            )
              continue;
            const deviation = Math.min(
              ...segments.map(([ax, ay, bx, by]) => {
                const dx = bx - ax;
                const dy = by - ay;
                const t = Math.max(
                  0,
                  Math.min(
                    1,
                    ((sample.x_m - ax) * dx + (sample.y_m - ay) * dy) /
                      (dx * dx + dy * dy),
                  ),
                );
                return Math.hypot(
                  sample.x_m - ax - t * dx,
                  sample.y_m - ay - t * dy,
                );
              }),
            );
            expect(deviation).toBeLessThanOrEqual(0.26);
          }
        }
      }
    },
    15000,
  );
});

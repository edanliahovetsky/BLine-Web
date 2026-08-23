import { describe, expect, it } from "vitest";
import { seedHandoffRadii } from "../../../src/core/bend/autoSeedHandoffRadii";
import { solveJointAutoConstraints } from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  type PathModel,
} from "../../../src/core/model/path";
import {
  buildGlobalRotationTargets,
  buildSegments,
  evaluateRotationTargets,
  simulatePathWithTrace,
  type SimulationConfig,
} from "../../../src/core/sim";

const rotationLimitedConfig = {
  default_max_velocity_meters_per_sec: 4,
  default_max_acceleration_meters_per_sec2: 8,
  default_max_velocity_deg_per_sec: 90,
  default_max_acceleration_deg_per_sec2: 180,
};

describe("rotation-aware automatic constraints", () => {
  it("slows a straight translation enough to reach its fixed rotation target", () => {
    const path = seedHandoffRadii(
      createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 0, y_meters: 0 }),
          createRotationTarget({
            t_ratio: 0.5,
            rotation_radians: Math.PI,
            profiled_rotation: true,
          }),
          createTranslationTarget({ x_meters: 4, y_meters: 0 }),
        ],
      }),
    ).path;

    const result = solveJointAutoConstraints(path, rotationLimitedConfig);
    const oracleTime = fastestFeasibleLatticeTime(
      path,
      {
        ...rotationLimitedConfig,
        default_max_velocity_meters_per_sec:
          result.profile.usableMaxVelocityMps,
        default_max_acceleration_meters_per_sec2:
          result.profile.usableMaxAccelerationMps2,
      },
      result.profile.usableMaxVelocityMps,
    );

    expect(result.status).toBe("valid");
    expect(result.profile.diagnostics.rotationTargets).toHaveLength(1);
    expect(result.profile.diagnostics.rotationTargets[0]?.passed).toBe(true);
    expect(
      result.profile.segmentCaps.find((cap) => cap.targetOrdinal === 2)?.value,
    ).toBeLessThan(4);
    expect(oracleTime).not.toBeNull();
    expect(result.profile.diagnostics.totalTimeS).toBeLessThanOrEqual(
      (oracleTime ?? Number.POSITIVE_INFINITY) * 1.03 + 0.02,
    );
  }, 20_000);

  it("reports co-located conflicting authored targets as infeasible", () => {
    const path = seedHandoffRadii(
      createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 0, y_meters: 0 }),
          createRotationTarget({ t_ratio: 0.5, rotation_radians: 0 }),
          createRotationTarget({ t_ratio: 0.5, rotation_radians: Math.PI }),
          createTranslationTarget({ x_meters: 4, y_meters: 0 }),
        ],
      }),
    ).path;

    const result = solveJointAutoConstraints(path, rotationLimitedConfig);

    expect(result.status).not.toBe("valid");
    expect(result.profile.diagnostics.rotationTargets).toHaveLength(2);
    expect(
      result.profile.diagnostics.rotationTargets.every(
        (target) => target.passed,
      ),
    ).toBe(false);
  }, 20_000);
});

/** Independent small-fixture oracle: ordinary simulator plus a fixed cap grid. */
function fastestFeasibleLatticeTime(
  path: PathModel,
  config: SimulationConfig,
  maximumCapMps: number,
): number | null {
  const { anchors, cumulativeLengths } = buildSegments(path);
  const targets = buildGlobalRotationTargets(path, anchors, cumulativeLengths);
  let fastest: number | null = null;

  for (let step = 1; step <= Math.ceil(maximumCapMps / 0.05); step += 1) {
    const cap = Math.min(maximumCapMps, step * 0.05);
    const trial: PathModel = {
      ...path,
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec",
          value: cap,
          start_ordinal: 2,
          end_ordinal: 2,
        },
      ],
    };
    const result = simulatePathWithTrace(trial, config, { dt_s: 0.01 });
    if (
      evaluateRotationTargets(targets, result.trace).every(
        (target) => target.passed,
      )
    ) {
      fastest =
        fastest === null
          ? result.total_time_s
          : Math.min(fastest, result.total_time_s);
    }
  }

  return fastest;
}

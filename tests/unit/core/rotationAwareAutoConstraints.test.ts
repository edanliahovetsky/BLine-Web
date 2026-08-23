import { describe, expect, it } from "vitest";
import { seedHandoffRadii } from "../../../src/core/bend/autoSeedHandoffRadii";
import { solveJointAutoConstraints } from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
} from "../../../src/core/model/path";

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

    expect(result.status).toBe("valid");
    expect(result.profile.diagnostics.rotationTargets).toHaveLength(1);
    expect(result.profile.diagnostics.rotationTargets[0]?.passed).toBe(true);
    expect(
      result.profile.segmentCaps.find((cap) => cap.targetOrdinal === 2)?.value,
    ).toBeLessThan(4);
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

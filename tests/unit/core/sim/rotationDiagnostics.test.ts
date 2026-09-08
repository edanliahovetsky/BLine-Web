import { describe, expect, it } from "vitest";
import {
  evaluateRotationTargets,
  rotationTargetToleranceRadians,
  type AuthoredRotationTarget,
  type SimulationTraceSample,
} from "../../../../src/core/sim";

describe("rotation target diagnostics", () => {
  it("uses an inclusive raw 0.5 degree gate", () => {
    const tolerance = rotationTargetToleranceRadians;
    expect(evaluateAtError(tolerance).passed).toBe(true);
    expect(evaluateAtError(tolerance - 1e-9).passed).toBe(true);
    expect(evaluateAtError(tolerance + 1e-9).passed).toBe(false);
  });

  it("interpolates heading through angle wraparound", () => {
    const target = authoredTarget(0.5, -Math.PI);
    const result = evaluateRotationTargets(
      [target],
      [sample(0, radians(179)), sample(1, radians(-179))],
    )[0]!;

    expect(result.error_rad).toBeLessThan(1e-9);
    expect(result.passed).toBe(true);
  });

  it("retains and evaluates every co-located authored target", () => {
    const diagnostics = evaluateRotationTargets(
      [authoredTarget(0.5, 0, 1), authoredTarget(0.5, Math.PI, 2)],
      [sample(0, 0), sample(1, 0)],
    );

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((item) => item.passed)).toEqual([true, false]);
    expect(diagnostics.map((item) => item.path_element_index)).toEqual([1, 2]);
  });

  it("reports an unreached target", () => {
    const diagnostic = evaluateRotationTargets(
      [authoredTarget(2, Math.PI / 2)],
      [sample(0, 0), sample(1, Math.PI / 4)],
    )[0]!;

    expect(diagnostic.actual_theta_rad).toBeNull();
    expect(diagnostic.error_rad).toBe(Number.POSITIVE_INFINITY);
    expect(diagnostic.passed).toBe(false);
  });
});

function evaluateAtError(errorRadians: number) {
  return evaluateRotationTargets(
    [authoredTarget(1, 0)],
    [sample(0, errorRadians), sample(1, errorRadians)],
  )[0]!;
}

function authoredTarget(
  sMeters: number,
  thetaRadians: number,
  elementIndex = 1,
): AuthoredRotationTarget {
  return {
    s_m: sMeters,
    theta_target: thetaRadians,
    event_ordinal_1b: elementIndex,
    profiled_rotation: true,
    path_element_index: elementIndex,
  };
}

function sample(sMeters: number, thetaRadians: number): SimulationTraceSample {
  return {
    time_s: sMeters,
    x_m: sMeters,
    y_m: 0,
    theta_rad: thetaRadians,
    segment_index: 0,
    target_anchor_ordinal_1b: 2,
    global_s_m: sMeters,
    segment_s_m: sMeters,
    vx_mps: 0,
    vy_mps: 0,
    omega_radps: 0,
    speed_mps: 0,
    ax_mps2: 0,
    ay_mps2: 0,
    acceleration_mps2: 0,
    snapped_position: false,
    snapped_rotation: false,
  };
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

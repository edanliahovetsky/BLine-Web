import { describe, expect, it } from "vitest";
import {
  evaluateRotationFeasibility,
  reachableAngularVelocities,
} from "../../../../src/core/sim/rotationFeasibility";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
} from "../../../../src/core/model/path";
import type { SimulationTraceSample } from "../../../../src/core/sim";

describe("angular reachability", () => {
  it("matches the analytical triangular and trapezoidal rest-to-rest times", () => {
    // 180 degrees: accelerate for .5 s, cruise 1.5 s, brake .5 s.
    expect(
      reachableAngularVelocities(180, 2.5, [0, 0], 90, 180, true),
    ).not.toBeNull();
    expect(
      reachableAngularVelocities(180, 2.499, [0, 0], 90, 180, true),
    ).toBeNull();
    // 45 degrees: triangular, .5 s accelerating and .5 s braking.
    expect(
      reachableAngularVelocities(45, 1, [0, 0], 90, 180, true),
    ).not.toBeNull();
    expect(
      reachableAngularVelocities(45, 0.999, [0, 0], 90, 180, true),
    ).toBeNull();
  });

  it("carries angular velocity across same-direction targets without a forced stop", () => {
    const middle = reachableAngularVelocities(90, 1.25, [0, 0], 90, 180, false);
    expect(middle).not.toBeNull();
    expect(
      reachableAngularVelocities(90, 1.25, middle!, 90, 180, true),
    ).not.toBeNull();
    expect(
      reachableAngularVelocities(90, 1.25, [0, 0], 90, 180, true),
    ).toBeNull();
  });

  it("does not invent instantaneous braking or a reversal within a turn", () => {
    expect(
      reachableAngularVelocities(1, 1, [90, 90], 90, 180, true),
    ).toBeNull();
    expect(
      reachableAngularVelocities(45, 1, [-90, -90], 90, 180, false),
    ).toBeNull();
  });
});

describe("rotation feasibility along a translation trace", () => {
  const config = {
    default_max_velocity_deg_per_sec: 90,
    default_max_acceleration_deg_per_sec2: 180,
  };
  const path = createPathModel({
    path_elements: [
      createTranslationTarget({ x_meters: 0, y_meters: 0 }),
      createRotationTarget({
        t_ratio: 0.5,
        rotation_radians: Math.PI,
        profiled_rotation: true,
      }),
      createTranslationTarget({ x_meters: 4, y_meters: 0 }),
    ],
  });

  it("uses available time and limits, independently of preview tracking error", () => {
    const result = evaluateRotationFeasibility(path, config, [
      sample(0, 0),
      sample(2.5, 2),
      sample(3, 4),
    ]);
    expect(result[0]?.passed).toBe(true);
    expect(result[0]?.requiredTimeS).toBeCloseTo(2.5, 6);
    expect(
      evaluateRotationFeasibility(path, config, [
        sample(0, 0),
        sample(2, 2),
        sample(3, 4),
      ])[0]?.passed,
    ).toBe(false);
  });

  it("honors ranged angular limits", () => {
    const limited = {
      ...path,
      ranged_constraints: [
        {
          key: "max_velocity_deg_per_sec" as const,
          value: 45,
          start_ordinal: 1,
          end_ordinal: 1,
        },
      ],
    };
    const result = evaluateRotationFeasibility(limited, config, [
      sample(0, 0),
      sample(2.5, 2),
      sample(3, 4),
    ]);
    expect(result[0]?.passed).toBe(false);
    expect(result[0]?.requiredTimeS).toBeCloseTo(4.25, 6);
  });

  it("does not count time after a handoff has retired the target", () => {
    const late = createPathModel({
      path_elements: [
        createTranslationTarget(),
        createRotationTarget({ t_ratio: 1, rotation_radians: Math.PI }),
        createTranslationTarget({ x_meters: 4 }),
        createTranslationTarget({ x_meters: 8 }),
      ],
    });
    const result = evaluateRotationFeasibility(late, config, [
      sample(0, 0),
      sample(2, 3.5),
      { ...sample(2.02, 4.2), segment_index: 1 },
      sample(5, 8),
    ]);
    expect(result[0]?.deadlineS).toBe(2);
    expect(result[0]?.passed).toBe(false);
  });

  it("reports conflicting co-located and unreached targets", () => {
    const conflicting = {
      ...path,
      path_elements: [
        path.path_elements[0]!,
        createRotationTarget({ t_ratio: 0.5, rotation_radians: 0 }),
        path.path_elements[1]!,
        path.path_elements[2]!,
      ],
    };
    expect(
      evaluateRotationFeasibility(conflicting, config, [
        sample(0, 0),
        sample(5, 4),
      ])[1]?.reason,
    ).toBe("conflicting-targets");
    expect(
      evaluateRotationFeasibility(path, config, [sample(0, 0), sample(1, 1)])[0]
        ?.reason,
    ).toBe("unreached");
  });
});

function sample(time: number, distance: number): SimulationTraceSample {
  return {
    time_s: time,
    global_s_m: distance,
    x_m: distance,
    y_m: 0,
    theta_rad: 0,
    segment_index: 0,
    target_anchor_ordinal_1b: 2,
    segment_s_m: distance,
    vx_mps: 0,
    vy_mps: 0,
    speed_mps: 0,
    omega_radps: 0,
    ax_mps2: 0,
    ay_mps2: 0,
    acceleration_mps2: 0,
    snapped_position: false,
    snapped_rotation: false,
  };
}

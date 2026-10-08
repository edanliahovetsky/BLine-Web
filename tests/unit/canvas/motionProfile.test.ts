import { describe, expect, it } from "vitest";
import {
  createEventTrigger,
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import type { SimulationTraceSample } from "../../../src/core/sim/types";
import {
  buildMotionProfile,
  motionProfilePolyline,
  motionProfileReadoutAt,
} from "../../../src/canvas/motionProfile";

describe("motion profile", () => {
  const path = createPathModel({
    path_elements: [
      createTranslationTarget({ x_meters: 0, y_meters: 0 }),
      createEventTrigger({ t_ratio: 0.5, lib_key: "intake" }),
      createTranslationTarget({ x_meters: 4, y_meters: 0 }),
    ],
  });
  const trace = [
    sample({ time: 0, s: 0, speed: 0, omega: 0, target: 2 }),
    sample({ time: 1, s: 2, speed: 3, omega: -Math.PI, target: 2 }),
    sample({ time: 2, s: 4, speed: 0, omega: 0, target: 3 }),
  ];

  it("reports peaks, keeps the configured limit in range, and finds events", () => {
    const profile = buildMotionProfile(path, trace, 2, 4);

    expect(profile).not.toBeNull();
    expect(profile?.peak_speed_mps).toBe(3);
    expect(profile?.peak_omega_deg_per_s).toBeCloseTo(180);
    expect(profile?.speed_limit_mps).toBe(4);
    expect(profile?.speed_scale_max_mps).toBeGreaterThan(4);
    expect(profile?.events).toEqual([{ key: "intake", time_s: 1 }]);
    expect(profile?.handoff_times_s).toEqual([2]);
  });

  it("ignores an unusable limit and returns nothing for an empty preview", () => {
    expect(
      buildMotionProfile(path, trace, 2, Number.NaN)?.speed_limit_mps,
    ).toBe(null);
    expect(buildMotionProfile(path, trace.slice(0, 1), 2, 4)).toBeNull();
    expect(buildMotionProfile(path, trace, 0, 4)).toBeNull();
    expect(buildMotionProfile(path, null, 2, 4)).toBeNull();
  });

  it("interpolates the readout and names nearby events", () => {
    const profile = buildMotionProfile(path, trace, 2, 4)!;

    const halfway = motionProfileReadoutAt(profile, trace, 0.5);
    expect(halfway?.speed_mps).toBeCloseTo(1.5);
    expect(halfway?.omega_deg_per_s).toBeCloseTo(90);
    expect(halfway?.events).toEqual([]);
    expect(motionProfileReadoutAt(profile, trace, 1.05)?.events).toEqual([
      "intake",
    ]);
    expect(motionProfileReadoutAt(profile, trace, 9)?.time_s).toBe(2);
  });

  it("maps samples into the plot box with speed rising upward", () => {
    const profile = buildMotionProfile(path, trace, 2, null)!;
    const points = motionProfilePolyline(profile, "speed", 100, 50)
      .split(" ")
      .map((point) => point.split(",").map(Number));

    expect(points[0]).toEqual([0, 50]);
    expect(points[1][0]).toBe(50);
    expect(points[1][1]).toBeLessThan(50);
    expect(points[2]).toEqual([100, 50]);
  });

  it("downsamples long traces while keeping the final sample", () => {
    const long = Array.from({ length: 2401 }, (_, index) =>
      sample({
        time: index * 0.005,
        s: index * 0.001,
        speed: 1,
        omega: 0,
        target: 2,
      }),
    );
    const profile = buildMotionProfile(path, long, 12, 4)!;

    expect(profile.points.length).toBeLessThanOrEqual(602);
    expect(profile.points.at(-1)?.time_s).toBe(long.at(-1)?.time_s);
  });
});

function sample({
  time,
  s,
  speed,
  omega,
  target,
}: {
  time: number;
  s: number;
  speed: number;
  omega: number;
  target: number;
}): SimulationTraceSample {
  return {
    time_s: time,
    x_m: s,
    y_m: 0,
    theta_rad: 0,
    segment_index: 0,
    target_anchor_ordinal_1b: target,
    global_s_m: s,
    segment_s_m: s,
    vx_mps: speed,
    vy_mps: 0,
    omega_radps: omega,
    speed_mps: speed,
    ax_mps2: 0,
    ay_mps2: 0,
    acceleration_mps2: 0,
    snapped_position: false,
    snapped_rotation: false,
  };
}

import { describe, expect, it } from "vitest";
import type {
  SimTraceResult,
  SimulationTraceSample,
} from "../../../src/core/sim/types";
import {
  maximumBlendSamples,
  previewBlendDurationMs,
  SimulationPreviewInterpolation,
} from "../../../src/canvas/simulationPreviewInterpolation";

function result(
  points: Array<[time: number, x: number, y: number, heading?: number]>,
): SimTraceResult {
  const trace: SimulationTraceSample[] = points.map(
    ([time, x, y, heading]) => ({
      time_s: time,
      x_m: x,
      y_m: y,
      theta_rad: heading ?? 0,
      speed_mps: 1,
      global_s_m: time,
      segment_index: 0,
      target_anchor_ordinal_1b: 1,
      segment_s_m: time,
      vx_mps: 1,
      vy_mps: 0,
      omega_radps: 0,
      ax_mps2: 0,
      ay_mps2: 0,
      acceleration_mps2: 0,
      snapped_position: false,
      snapped_rotation: false,
    }),
  );
  return {
    trace,
    total_time_s: trace.at(-1)?.time_s ?? 0,
    poses_by_time: new Map(
      trace.map((p) => [p.time_s, [p.x_m, p.y_m, p.theta_rad]]),
    ),
    global_s_by_time: new Map(trace.map((p) => [p.time_s, p.global_s_m])),
    protrusion_visible_by_time: new Map(),
    times_sorted: trace.map((p) => p.time_s),
    trail_points: trace.map((p) => [p.x_m, p.y_m]),
  };
}

const initial = result([
  [0, 0, 0],
  [1, 2, 0],
  [2, 4, 0],
]);
const target = result([
  [0, 0, 2],
  [1, 2, 4],
  [2, 4, 2],
]);

describe("actual simulation preview interpolation", () => {
  it("holds the last real simulation until a result arrives, then lerps and settles exactly", () => {
    const blend = new SimulationPreviewInterpolation(initial);
    expect(blend.sample(1000)).toBe(initial);
    expect(blend.isAnimating(1000)).toBe(false);
    blend.retarget(target, 1000);
    expect(blend.sample(1000)).toBe(initial);
    const halfway = blend.sample(1000 + previewBlendDurationMs / 2)!;
    expect(halfway.trail_points).toEqual([
      [0, 1],
      [2, 2],
      [4, 1],
    ]);
    expect(halfway.poses_by_time.get(1)).toEqual([2, 2, 0]);
    expect(halfway.times_sorted).toEqual([0, 1, 2]);
    expect(blend.sample(1000 + previewBlendDurationMs)).toBe(target);
    expect(blend.isAnimating(1000 + previewBlendDurationMs)).toBe(false);
  });

  it("retargets from the currently displayed blend without jumping backward", () => {
    const blend = new SimulationPreviewInterpolation(initial);
    blend.retarget(target, 0);
    const displayed = blend.sample(40)!;
    const next = result([
      [0, 0, 4],
      [1, 2, 8],
      [2, 4, 4],
    ]);
    blend.retarget(next, 40);
    expect(blend.sample(40)).toEqual(displayed);
    expect(blend.sample(80)!.trail_points).toEqual([
      [0, 2.5],
      [2, 5],
      [4, 2.5],
    ]);
    expect(blend.sample(120)).toBe(next);
  });

  it("pairs unequal trace lengths and durations by playback progress", () => {
    const blend = new SimulationPreviewInterpolation(initial);
    const longer = result([
      [0, 0, 2],
      [1, 1, 2],
      [2, 2, 2],
      [3, 3, 2],
      [4, 4, 2],
    ]);
    blend.retarget(longer, 0);
    const halfway = blend.sample(40)!;
    expect(halfway.trail_points).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
    expect(halfway.times_sorted).toEqual([0, 0.75, 1.5, 2.25, 3]);
    expect(halfway.total_time_s).toBe(3);
    expect(blend.sample(80)).toBe(longer);
  });

  it("uses the short arc across the heading wrap", () => {
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const blend = new SimulationPreviewInterpolation(
      result([[0, 0, 0, radians(350)]]),
    );
    blend.retarget(result([[0, 0, 0, radians(10)]]), 0);
    expect(blend.sample(40)!.trace[0].theta_rad).toBeCloseTo(2 * Math.PI);
  });

  it("bounds animation work but restores the complete exact simulation afterward", () => {
    const large = result(
      Array.from({ length: 10000 }, (_, index) => [index / 50, index / 100, 2]),
    );
    const blend = new SimulationPreviewInterpolation(initial);
    blend.retarget(large, 0);
    expect(blend.sample(40)!.trace).toHaveLength(maximumBlendSamples);
    expect(blend.sample(40)!.trace.at(-1)!.x_m).toBe((4 + 99.99) / 2);
    expect(blend.sample(80)).toBe(large);
    expect(blend.sample(80)!.trace).toHaveLength(10000);
  });

  it("handles absent, empty and single-pose simulations without invalid coordinates", () => {
    const blend = new SimulationPreviewInterpolation(null);
    expect(blend.sample(0)).toBeNull();
    blend.retarget(initial, 0);
    expect(blend.sample(0)).toBe(initial);
    const empty = result([]);
    blend.retarget(empty, 20);
    expect(blend.sample(40)).toBe(empty);
    expect(blend.isAnimating(40)).toBe(false);
    const single = result([[0, 1, 1]]);
    blend.retarget(single, 60);
    expect(blend.sample(70)).toBe(single);
    blend.retarget(target, 80);
    expect(blend.sample(120)!.trail_points).toEqual([
      [0.5, 1.5],
      [1.5, 2.5],
      [2.5, 1.5],
    ]);
  });
});

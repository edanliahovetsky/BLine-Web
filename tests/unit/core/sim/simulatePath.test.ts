import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deserializePath } from "../../../../src/core/io/projectSerde";
import {
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  type RangedConstraint
} from "../../../../src/core/model/path";
import {
  buildSegments,
  buildGlobalRotationKeyframes,
  desiredHeadingForGlobalS,
  simulatePath,
  simulatePathWithTrace
} from "../../../../src/core/sim";

const defaultConfig = {
  default_max_velocity_meters_per_sec: 2,
  default_max_acceleration_meters_per_sec2: 4,
  default_intermediate_handoff_radius_meters: 0.25,
  default_max_velocity_deg_per_sec: 90,
  default_max_acceleration_deg_per_sec2: 180
};

describe("simulatePath", () => {
  it("simulates a straight path with Python-reference sample values", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 3, y_meters: 1 })
      ]
    });

    const result = simulatePath(path, defaultConfig, { dt_s: 0.01 });

    expect(result.total_time_s).toBeCloseTo(2, 6);
    expect(result.trail_points).toHaveLength(201);
    expectPose(result.poses_by_time.get(0), [0.000379, 0.000126, 0.321751], 6);
    expectPose(result.poses_by_time.get(1), [1.451485, 0.483828, 0.321751], 6);
    expectPose(result.poses_by_time.get(2), [3, 1, 0.321751], 6);
  });

  it("returns a single zero-time pose for one anchor", () => {
    const path = createPathModel({
      path_elements: [createTranslationTarget({ x_meters: 2.5, y_meters: -1.25 })]
    });

    const result = simulatePath(path, defaultConfig, { dt_s: 0.01 });

    expect(result.total_time_s).toBe(0);
    expect(result.times_sorted).toEqual([0]);
    expectPose(result.poses_by_time.get(0), [2.5, -1.25, 0], 9);
  });

  it("rejects nonpositive timesteps", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 0 })
      ]
    });

    expect(() => simulatePath(path, defaultConfig, { dt_s: 0 })).toThrow(
      /positive finite/
    );
  });

  it("builds profiled global rotation keyframes and heading interpolation", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createRotationTarget({
          rotation_radians: Math.PI / 2,
          t_ratio: 0.5
        }),
        createTranslationTarget({ x_meters: 2, y_meters: 0 })
      ]
    });
    const result = simulatePath(path, defaultConfig, { dt_s: 0.01 });
    const { anchors, cumulativeLengths } = buildSegmentsForTest(path);
    const frames = buildGlobalRotationKeyframes(path, anchors, cumulativeLengths);

    expect(frames[0]).toMatchObject({
      s_m: 1,
      theta_target: Math.PI / 2,
      profiled_rotation: true
    });
    expect(
      desiredHeadingForGlobalS(frames, 0.5, 0).desiredTheta
    ).toBeCloseTo(Math.PI / 4, 6);
    expect(result.total_time_s).toBeCloseTo(1.42, 2);
    expectPose(result.poses_by_time.get(result.total_time_s), [2, 0, Math.PI / 2], 6);
  });

  it("steps non-profiled rotation immediately to the target heading", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createRotationTarget({
          rotation_radians: Math.PI / 2,
          t_ratio: 0.5,
          profiled_rotation: false
        }),
        createTranslationTarget({ x_meters: 2, y_meters: 0 })
      ]
    });
    const { anchors, cumulativeLengths } = buildSegmentsForTest(path);
    const frames = buildGlobalRotationKeyframes(path, anchors, cumulativeLengths);

    expect(
      desiredHeadingForGlobalS(frames, 0.5, 0).desiredTheta
    ).toBeCloseTo(Math.PI / 2, 6);
  });

  it("applies ranged translation velocity limits by target anchor ordinal", () => {
    const ranged: RangedConstraint = {
      key: "max_velocity_meters_per_sec",
      value: 0.5,
      start_ordinal: 2,
      end_ordinal: 2
    };
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 0 }),
        createTranslationTarget({ x_meters: 2, y_meters: 0 })
      ],
      ranged_constraints: [ranged]
    });

    const result = simulatePath(path, defaultConfig, { dt_s: 0.01 });

    expect(result.total_time_s).toBeGreaterThan(2);
    expectPose(result.poses_by_time.get(result.total_time_s), [2, 0, 0], 6);
  });

  it("reports trace samples with segment state and vector acceleration", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 1 })
      ]
    });

    const result = simulatePathWithTrace(path, defaultConfig, { dt_s: 0.02 });

    expect(result.trace.length).toBeGreaterThan(2);
    expect(result.trace[0]).toMatchObject({
      time_s: 0,
      x_m: 0,
      y_m: 0,
      segment_index: 0,
      target_anchor_ordinal_1b: 2,
      speed_mps: 0,
      acceleration_mps2: 0
    });
    expect(result.trace.some((sample) => sample.segment_index === 1)).toBe(true);
    expect(Math.max(...result.trace.map((sample) => sample.acceleration_mps2)))
      .toBeLessThanOrEqual(defaultConfig.default_max_acceleration_meters_per_sec2 + 1e-6);
  });

  it("keeps final snap frames from creating fake trace acceleration spikes", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 0.05, y_meters: 0 })
      ]
    });

    const result = simulatePathWithTrace(path, defaultConfig, { dt_s: 0.02 });

    expect(result.trace.at(-1)?.snapped_position).toBe(true);
    expect(Math.max(...result.trace.map((sample) => sample.acceleration_mps2)))
      .toBeLessThanOrEqual(defaultConfig.default_max_acceleration_meters_per_sec2 + 1e-6);
  });

  it("toggles protrusion visibility from named event triggers", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createEventTrigger({ t_ratio: 0.25, lib_key: "deploy" }),
        createEventTrigger({ t_ratio: 0.75, lib_key: "stow" }),
        createTranslationTarget({ x_meters: 4, y_meters: 0 })
      ]
    });

    const result = simulatePath(
      path,
      {
        ...defaultConfig,
        gui: {
          robot: {
            length_meters: 0.5,
            width_meters: 0.5
          },
          protrusions: {
            enabled: true,
            distance_meters: 0.25,
            side: "front",
            default_state: "hidden",
            show_on_event_keys: ["deploy"],
            hide_on_event_keys: ["stow"]
          }
        }
      },
      { dt_s: 0.01 }
    );

    expect(result.protrusion_visible_by_time.get(0)).toBe(false);
    expect(visibilityAtOrAfterS(result, 1)).toBe(true);
    expect(visibilityAtOrAfterS(result, 2)).toBe(true);
    expect(visibilityAtOrAfterS(result, 3)).toBe(false);
  });

  it("uses case-sensitive event key matching and gives show keys precedence", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createEventTrigger({ t_ratio: 0.5, lib_key: "Deploy" }),
        createTranslationTarget({ x_meters: 2, y_meters: 0 })
      ]
    });

    const unmatched = simulatePath(
      path,
      {
        ...defaultConfig,
        gui: {
          robot: {
            length_meters: 0.5,
            width_meters: 0.5
          },
          protrusions: {
            enabled: true,
            distance_meters: 0.25,
            side: "front",
            default_state: "hidden",
            show_on_event_keys: ["deploy"],
            hide_on_event_keys: []
          }
        }
      },
      { dt_s: 0.01 }
    );
    expect(visibilityAtOrAfterS(unmatched, 1)).toBe(false);

    const showWins = simulatePath(
      path,
      {
        ...defaultConfig,
        gui: {
          robot: {
            length_meters: 0.5,
            width_meters: 0.5
          },
          protrusions: {
            enabled: true,
            distance_meters: 0.25,
            side: "front",
            default_state: "hidden",
            show_on_event_keys: ["Deploy"],
            hide_on_event_keys: ["Deploy"]
          }
        }
      },
      { dt_s: 0.01 }
    );
    expect(visibilityAtOrAfterS(showWins, 1)).toBe(true);
  });

  it("simulates the dense top sweep fixture without endpoint spin", () => {
    const path = deserializePath(readFixture("top_sweep_short_depo.json"));
    const result = simulatePath(
      path,
      {
        default_max_velocity_meters_per_sec: 4.5,
        default_max_acceleration_meters_per_sec2: 12,
        default_intermediate_handoff_radius_meters: 0.25,
        default_max_velocity_deg_per_sec: 600,
        default_max_acceleration_deg_per_sec2: 2000
      },
      { dt_s: 0.02 }
    );

    expect(result.total_time_s).toBeCloseTo(18.54, 2);
    expect(result.trail_points).toHaveLength(928);
    expectPose(result.poses_by_time.get(0), [3.376893, 5.590979, 0], 6);
    expectPose(result.poses_by_time.get(9.26), [1.743742, 4.971691, 1.366353], 6);
    expectPose(result.poses_by_time.get(18.54), [6.020539, 5.353239, 0], 6);
  });
});

function buildSegmentsForTest(path: Parameters<typeof simulatePath>[0]) {
  return buildSegments(path);
}

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/simulation/${name}`, import.meta.url), "utf8")
  ) as unknown;
}

function expectPose(
  pose: readonly [number, number, number] | undefined,
  expected: readonly [number, number, number],
  precision: number
) {
  expect(pose).toBeDefined();
  expect(pose?.[0]).toBeCloseTo(expected[0], precision);
  expect(pose?.[1]).toBeCloseTo(expected[1], precision);
  expect(pose?.[2]).toBeCloseTo(expected[2], precision);
}

function visibilityAtOrAfterS(
  result: ReturnType<typeof simulatePath>,
  targetS: number
): boolean | undefined {
  const time = result.times_sorted.find(
    (candidate) => (result.global_s_by_time.get(candidate) ?? 0) >= targetS
  );
  return time === undefined ? undefined : result.protrusion_visible_by_time.get(time);
}

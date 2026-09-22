import { describe, expect, it } from "vitest";
import { activeRotationLimit } from "../../../../src/core/sim/simulatePath";
import {
  createConstraints,
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  type RangedConstraint,
} from "../../../../src/core/model/path";
import {
  buildSegments,
  buildGlobalRotationKeyframes,
  buildRotationDomainEvents,
  desiredHeadingForGlobalS,
  simulatePath,
  simulatePathWithTrace,
} from "../../../../src/core/sim";

const defaultConfig = {
  default_max_velocity_meters_per_sec: 2,
  default_max_acceleration_meters_per_sec2: 4,
  default_intermediate_handoff_radius_meters: 0.25,
  default_max_velocity_deg_per_sec: 90,
  default_max_acceleration_deg_per_sec2: 180,
};

describe("simulatePath", () => {
  it("releases ranged angular limits after the last rotation target", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createRotationTarget({ rotation_radians: 0.1, t_ratio: 0.5 }),
        createTranslationTarget({ x_meters: 1, y_meters: 0 }),
        createTranslationTarget({ x_meters: 3, y_meters: 0 }),
      ],
      ranged_constraints: [
        {
          key: "min_velocity_deg_per_sec",
          value: 60,
          start_ordinal: 1,
          end_ordinal: 1,
        },
      ],
    });
    const { anchors, cumulativeLengths } = buildSegments(path);
    const events = buildRotationDomainEvents(path, anchors, cumulativeLengths);
    expect(
      activeRotationLimit(path, events, "min_velocity_deg_per_sec", 0.25),
    ).toBe(60);
    expect(
      activeRotationLimit(path, events, "min_velocity_deg_per_sec", 1),
    ).toBeNull();
  });
  it("simulates a straight path with Python-reference sample values", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 3, y_meters: 1 }),
      ],
    });

    const result = simulatePath(path, defaultConfig, { dt_s: 0.01 });

    expect(result.total_time_s).toBeCloseTo(2, 6);
    expect(result.trail_points).toHaveLength(201);
    expectPose(result.poses_by_time.get(0), [0.000379, 0.000126, 0.321751], 6);
    expectPose(result.poses_by_time.get(1), [1.451485, 0.483828, 0.321751], 6);
    expectPose(result.poses_by_time.get(2), [3, 1, 0.321751], 6);
  });

  it("simulates a single target from the separate preview start", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 2.5, y_meters: -1.25 }),
      ],
    });

    const result = simulatePath(path, defaultConfig, { dt_s: 0.01 });

    expect(result.total_time_s).toBeGreaterThan(0);
    expect(result.trail_points.length).toBeGreaterThan(1);
    const { anchors } = buildSegments(path);
    expect(anchors[0]).toEqual({ x: 0, y: 0, pathIndex: -1 });
    expectPose(
      result.poses_by_time.get(result.total_time_s),
      [2.5, -1.25, 0],
      9,
    );
    expect(path.path_elements).toHaveLength(1);
  });

  it.each([
    { tRatio: 0.5, profiled: true },
    { tRatio: 0, profiled: true },
    { tRatio: 0.5, profiled: false },
  ])(
    "uses the ghost pose for leading rotations and limits ($tRatio, $profiled)",
    ({ tRatio, profiled }) => {
      const path = createPathModel({
        preview: {
          start_pose: { x_meters: 0, y_meters: 0, rotation_radians: 0 },
        },
        path_elements: [
          createRotationTarget({
            rotation_radians: Math.PI / 2,
            t_ratio: tRatio,
            profiled_rotation: profiled,
          }),
          createTranslationTarget({ x_meters: 2 }),
        ],
        ranged_constraints: [
          {
            key: "max_velocity_deg_per_sec",
            value: 30,
            start_ordinal: 1,
            end_ordinal: 1,
          },
        ],
      });
      const { anchors, cumulativeLengths } = buildSegments(path);
      expect(
        buildRotationDomainEvents(path, anchors, cumulativeLengths),
      ).toEqual([{ event_ordinal_1b: 1, s_m: 2 * tRatio }]);
      const result = simulatePathWithTrace(path, defaultConfig);
      expect(result.trace[0].theta_rad).toBe(0);
      expect(result.trace.at(-1)!.theta_rad).toBeCloseTo(Math.PI / 2, 6);
      const peakOmega = Math.max(
        ...result.trace.map((sample) => Math.abs(sample.omega_radps)),
      );
      expect(peakOmega).toBeGreaterThan(0.1);
      expect(peakOmega).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
      for (const sample of result.trace.filter(
        (sample) => sample.global_s_m <= 2 * tRatio,
      )) {
        expect(Math.abs(sample.omega_radps)).toBeLessThanOrEqual(
          Math.PI / 6 + 1e-9,
        );
      }
    },
  );

  it("rejects nonpositive timesteps", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 0 }),
      ],
    });

    expect(() => simulatePath(path, defaultConfig, { dt_s: 0 })).toThrow(
      /positive finite/,
    );
  });

  it("builds profiled global rotation keyframes and heading interpolation", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createRotationTarget({
          rotation_radians: Math.PI / 2,
          t_ratio: 0.5,
        }),
        createTranslationTarget({ x_meters: 2, y_meters: 0 }),
      ],
    });
    const result = simulatePath(path, defaultConfig, { dt_s: 0.01 });
    const { anchors, cumulativeLengths } = buildSegmentsForTest(path);
    const frames = buildGlobalRotationKeyframes(
      path,
      anchors,
      cumulativeLengths,
    );

    expect(frames[0]).toMatchObject({
      s_m: 1,
      theta_target: Math.PI / 2,
      profiled_rotation: true,
    });
    expect(desiredHeadingForGlobalS(frames, 0.5, 0).desiredTheta).toBeCloseTo(
      Math.PI / 4,
      6,
    );
    expect(result.total_time_s).toBeCloseTo(1.42, 2);
    expectPose(
      result.poses_by_time.get(result.total_time_s),
      [2, 0, Math.PI / 2],
      6,
    );
  });

  it("steps non-profiled rotation immediately to the target heading", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createRotationTarget({
          rotation_radians: Math.PI / 2,
          t_ratio: 0.5,
          profiled_rotation: false,
        }),
        createTranslationTarget({ x_meters: 2, y_meters: 0 }),
      ],
    });
    const { anchors, cumulativeLengths } = buildSegmentsForTest(path);
    const frames = buildGlobalRotationKeyframes(
      path,
      anchors,
      cumulativeLengths,
    );

    expect(desiredHeadingForGlobalS(frames, 0.5, 0).desiredTheta).toBeCloseTo(
      Math.PI / 2,
      6,
    );
  });

  it("applies ranged translation velocity limits by target anchor ordinal", () => {
    const ranged: RangedConstraint = {
      key: "max_velocity_meters_per_sec",
      value: 0.5,
      start_ordinal: 2,
      end_ordinal: 2,
    };
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 0 }),
        createTranslationTarget({ x_meters: 2, y_meters: 0 }),
      ],
      ranged_constraints: [ranged],
    });

    const result = simulatePath(path, defaultConfig, { dt_s: 0.01 });

    expect(result.total_time_s).toBeGreaterThan(2);
    expectPose(result.poses_by_time.get(result.total_time_s), [2, 0, 0], 6);
  });

  it("lets ranged translation limits exceed global simulation limits", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 6, y_meters: 0 }),
      ],
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec",
          value: 10,
          start_ordinal: 2,
          end_ordinal: 2,
        },
        {
          key: "max_acceleration_meters_per_sec2",
          value: 10,
          start_ordinal: 2,
          end_ordinal: 2,
        },
      ],
    });

    const result = simulatePathWithTrace(
      path,
      {
        ...defaultConfig,
        default_max_velocity_meters_per_sec: 1,
        default_max_acceleration_meters_per_sec2: 1,
      },
      { dt_s: 0.02 },
    );

    expect(
      Math.max(...result.trace.map((sample) => sample.speed_mps)),
    ).toBeGreaterThan(1.5);
    expect(
      Math.max(...result.trace.map((sample) => sample.acceleration_mps2)),
    ).toBeGreaterThan(1.5);
  });

  it("lets ranged rotation limits exceed global simulation limits", () => {
    const path = createPathModel({
      path_elements: [
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 0,
            y_meters: 0,
          }),
          rotation_target: createRotationTarget({ rotation_radians: 0 }),
        }),
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 4,
            y_meters: 0,
          }),
          rotation_target: createRotationTarget({ rotation_radians: Math.PI }),
        }),
      ],
      ranged_constraints: [
        {
          key: "max_velocity_deg_per_sec",
          value: 180,
          start_ordinal: 2,
          end_ordinal: 2,
        },
        {
          key: "max_acceleration_deg_per_sec2",
          value: 720,
          start_ordinal: 2,
          end_ordinal: 2,
        },
      ],
    });

    const result = simulatePathWithTrace(
      path,
      {
        ...defaultConfig,
        default_max_velocity_deg_per_sec: 10,
        default_max_acceleration_deg_per_sec2: 30,
      },
      { dt_s: 0.02 },
    );

    expect(
      Math.max(...result.trace.map((sample) => Math.abs(sample.omega_radps))),
    ).toBeGreaterThan((10 * Math.PI) / 180 + 1e-3);
  });

  it("approaches ranged minimum velocity through the acceleration limit", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 0 }),
      ],
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec",
          value: 1,
          start_ordinal: 2,
          end_ordinal: 2,
        },
        {
          key: "min_velocity_meters_per_sec",
          value: 0.8,
          start_ordinal: 2,
          end_ordinal: 2,
        },
      ],
    });

    const result = simulatePathWithTrace(path, defaultConfig, { dt_s: 0.02 });
    const firstMovingSample = result.trace.find(
      (sample) => sample.speed_mps > 0,
    );

    expect(firstMovingSample?.speed_mps).toBeCloseTo(4 * 0.02, 6);
    expect(result.trace.at(-1)!.speed_mps).toBeGreaterThanOrEqual(0.8);
    expect(
      Math.max(...result.trace.map((sample) => sample.acceleration_mps2)),
    ).toBeLessThanOrEqual(4 + 1e-6);
  });

  it("finishes rolling exits with best-effort heading, but waits for heading on stopped exits", () => {
    const path = createPathModel({
      path_elements: [
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 0,
            y_meters: 0,
          }),
          rotation_target: createRotationTarget({ rotation_radians: 0 }),
        }),
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 2,
            y_meters: 0,
          }),
          rotation_target: createRotationTarget({
            rotation_radians: Math.PI / 2,
          }),
        }),
      ],
      constraints: createConstraints({ min_velocity_meters_per_sec: 0.8 }),
    });
    const config = { ...defaultConfig, default_max_velocity_deg_per_sec: 10 };
    const rolling = simulatePathWithTrace(path, config, { dt_s: 0.02 });
    const exit = rolling.trace.at(-1)!;
    expect(exit.x_m).toBeCloseTo(2);
    expect(exit.speed_mps).toBeGreaterThanOrEqual(0.8);
    expect(exit.theta_rad).toBeLessThan(Math.PI / 4);
    expect(exit.snapped_rotation).toBe(false);
    const stopped = simulatePathWithTrace(
      {
        ...path,
        constraints: { ...path.constraints, min_velocity_meters_per_sec: null },
      },
      config,
      { dt_s: 0.02 },
    );
    expect(stopped.total_time_s).toBeGreaterThan(rolling.total_time_s);
    expect(stopped.trace.at(-1)!.theta_rad).toBeCloseTo(Math.PI / 2);
    expect(stopped.trace.at(-1)!.speed_mps).toBe(0);
  });

  it("disables ranged minimum translation baselines that exceed the paired maximum", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 0 }),
      ],
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec",
          value: 0.4,
          start_ordinal: 2,
          end_ordinal: 2,
        },
        {
          key: "min_velocity_meters_per_sec",
          value: 0.8,
          start_ordinal: 2,
          end_ordinal: 2,
        },
      ],
    });

    const result = simulatePathWithTrace(path, defaultConfig, { dt_s: 0.02 });
    const firstMovingSample = result.trace.find(
      (sample) => sample.time_s > 0 && sample.speed_mps > 0,
    );

    expect(firstMovingSample?.speed_mps).toBeLessThan(0.8);
  });

  it("reports trace samples with segment state and vector acceleration", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 0 }),
        createTranslationTarget({ x_meters: 1, y_meters: 1 }),
      ],
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
      acceleration_mps2: 0,
    });
    expect(result.trace.some((sample) => sample.segment_index === 1)).toBe(
      true,
    );
    expect(
      Math.max(...result.trace.map((sample) => sample.acceleration_mps2)),
    ).toBeLessThanOrEqual(
      defaultConfig.default_max_acceleration_meters_per_sec2 + 1e-6,
    );
  });

  it("keeps final snap frames from creating fake trace acceleration spikes", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 0.05, y_meters: 0 }),
      ],
    });

    const result = simulatePathWithTrace(path, defaultConfig, { dt_s: 0.02 });

    expect(result.trace.at(-1)?.snapped_position).toBe(true);
    expect(
      Math.max(...result.trace.map((sample) => sample.acceleration_mps2)),
    ).toBeLessThanOrEqual(
      defaultConfig.default_max_acceleration_meters_per_sec2 + 1e-6,
    );
  });

  it.each([false, true])(
    "toggles protrusion visibility from named event triggers (ghost start: %s)",
    (ghost) => {
      const path = createPathModel({
        path_elements: [
          ...(!ghost
            ? [createTranslationTarget({ x_meters: 0, y_meters: 0 })]
            : []),
          createEventTrigger({ t_ratio: 0.25, lib_key: "deploy" }),
          createEventTrigger({ t_ratio: 0.75, lib_key: "stow" }),
          createTranslationTarget({ x_meters: 4, y_meters: 0 }),
        ],
      });

      const result = simulatePath(
        path,
        {
          ...defaultConfig,
          gui: {
            robot: {
              length_meters: 0.5,
              width_meters: 0.5,
            },
            protrusions: {
              enabled: true,
              distance_meters: 0.25,
              side: "front",
              default_state: "hidden",
              show_on_event_keys: ["deploy"],
              hide_on_event_keys: ["stow"],
            },
          },
        },
        { dt_s: 0.01 },
      );

      expect(result.protrusion_visible_by_time.get(0)).toBe(false);
      expect(visibilityAtOrAfterS(result, 1)).toBe(true);
      expect(visibilityAtOrAfterS(result, 2)).toBe(true);
      expect(visibilityAtOrAfterS(result, 3)).toBe(false);
    },
  );

  it("uses case-sensitive event key matching and gives show keys precedence", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createEventTrigger({ t_ratio: 0.5, lib_key: "Deploy" }),
        createTranslationTarget({ x_meters: 2, y_meters: 0 }),
      ],
    });

    const unmatched = simulatePath(
      path,
      {
        ...defaultConfig,
        gui: {
          robot: {
            length_meters: 0.5,
            width_meters: 0.5,
          },
          protrusions: {
            enabled: true,
            distance_meters: 0.25,
            side: "front",
            default_state: "hidden",
            show_on_event_keys: ["deploy"],
            hide_on_event_keys: [],
          },
        },
      },
      { dt_s: 0.01 },
    );
    expect(visibilityAtOrAfterS(unmatched, 1)).toBe(false);

    const showWins = simulatePath(
      path,
      {
        ...defaultConfig,
        gui: {
          robot: {
            length_meters: 0.5,
            width_meters: 0.5,
          },
          protrusions: {
            enabled: true,
            distance_meters: 0.25,
            side: "front",
            default_state: "hidden",
            show_on_event_keys: ["Deploy"],
            hide_on_event_keys: ["Deploy"],
          },
        },
      },
      { dt_s: 0.01 },
    );
    expect(visibilityAtOrAfterS(showWins, 1)).toBe(true);
  });
});

function buildSegmentsForTest(path: Parameters<typeof simulatePath>[0]) {
  return buildSegments(path);
}

function expectPose(
  pose: readonly [number, number, number] | undefined,
  expected: readonly [number, number, number],
  precision: number,
) {
  expect(pose).toBeDefined();
  expect(pose?.[0]).toBeCloseTo(expected[0], precision);
  expect(pose?.[1]).toBeCloseTo(expected[1], precision);
  expect(pose?.[2]).toBeCloseTo(expected[2], precision);
}

function visibilityAtOrAfterS(
  result: ReturnType<typeof simulatePath>,
  targetS: number,
): boolean | undefined {
  const time = result.times_sorted.find(
    (candidate) => (result.global_s_by_time.get(candidate) ?? 0) >= targetS,
  );
  return time === undefined
    ? undefined
    : result.protrusion_visible_by_time.get(time);
}

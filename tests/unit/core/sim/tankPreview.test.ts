import { describe, expect, it } from "vitest";
import {
  createPathModel,
  createTranslationTarget,
  createRotationTarget,
  createWaypoint,
  createEventTrigger,
} from "../../../../src/core/model/path";
import { simulatePathWithTrace } from "../../../../src/core/sim";
import { shortestAngularDistance } from "../../../../src/core/sim/simGeometry";
import type { SimulationConfig } from "../../../../src/core/sim/types";
import {
  simulationEventMoments,
  simulationEventPulseAtTime,
} from "../../../../src/canvas/simulationEventPulse";

const config: SimulationConfig = {
  gui: { robot: { drive_type: "tank" } },
  default_max_velocity_meters_per_sec: 2,
  default_max_acceleration_meters_per_sec2: 3,
  default_max_velocity_deg_per_sec: 180,
  default_max_acceleration_deg_per_sec2: 360,
  default_intermediate_handoff_radius_meters: 0.3,
};
const point = (x: number, y: number) =>
  createTranslationTarget({ x_meters: x, y_meters: y });
const waypoint = (x: number, y: number, angle: number) =>
  createWaypoint({
    translation_target: point(x, y),
    rotation_target: createRotationTarget({ rotation_radians: angle }),
  });

describe("ideal tank preview", () => {
  it.each([0, 0.8])(
    "completes endpoint events inside tolerance with minimum speed %s",
    (minimum) => {
      const path = createPathModel({
        path_elements: [
          point(0, 0),
          createEventTrigger({ lib_key: "finish", t_ratio: 1 }),
          point(2, 0),
        ],
        constraints: {
          ...createPathModel().constraints,
          max_velocity_meters_per_sec: minimum === 0 ? 0.2 : 2,
          min_velocity_meters_per_sec: minimum,
          end_translation_tolerance_meters: 0.1,
        },
      });
      const eventConfig: SimulationConfig = {
        ...config,
        gui: {
          ...config.gui,
          protrusions: {
            enabled: true,
            default_state: "hidden",
            show_on_event_keys: ["finish"],
          },
        },
      };
      const result = simulatePathWithTrace(path, eventConfig);
      const last = result.trace.at(-1)!;
      expect(result.completed).toBe(true);
      expect(last.x_m).toBeGreaterThanOrEqual(1.9);
      expect(last.x_m).toBeLessThan(2);
      expect(last.snapped_position).toBe(false);
      expect(simulationEventMoments(path, result.trace)).toEqual([
        { key: "finish", distance: 2, time: result.total_time_s },
      ]);
      expect(
        simulationEventPulseAtTime(path, result.trace, result.total_time_s),
      ).toBe(1);
      expect(result.protrusion_visible_by_time.get(result.total_time_s)).toBe(
        true,
      );
      expect(
        result.protrusion_visible_by_time.get(result.times_sorted.at(-2)!),
      ).toBe(false);

      // An invalid motion limit aborts the preview; it must not complete pending events.
      const incomplete = simulatePathWithTrace(
        {
          ...path,
          constraints: {
            ...path.constraints,
            max_acceleration_meters_per_sec2: 0,
          },
        },
        eventConfig,
      );
      expect(incomplete.completed).toBe(false);
      expect(simulationEventMoments(path, incomplete.trace)).toEqual([]);
      expect(
        incomplete.protrusion_visible_by_time.get(incomplete.total_time_s),
      ).toBe(false);
    },
  );
  it.each([30, 90, 150, 180])(
    "negotiates a %i degree point-to-point bend without feedback tuning",
    (degrees) => {
      const angle = (degrees * Math.PI) / 180;
      const path = createPathModel({
        path_elements: [
          waypoint(0, 0, 0),
          point(3, 0),
          waypoint(3 + 3 * Math.cos(angle), 3 * Math.sin(angle), angle),
        ],
      });
      const result = simulatePathWithTrace(path, config, { dt_s: 0.02 });
      const last = result.trace.at(-1)!;
      expect(result.completed, JSON.stringify(last)).toBe(true);
      expect(
        Math.hypot(
          last.x_m - (3 + 3 * Math.cos(angle)),
          last.y_m - 3 * Math.sin(angle),
        ),
      ).toBeLessThanOrEqual(0.03);
      expect(
        Math.abs(shortestAngularDistance(angle, last.theta_rad)),
      ).toBeLessThan((2 * Math.PI) / 180);
      expect(last.speed_mps).toBeLessThan(1e-8);
      expect(Math.abs(last.omega_radps)).toBeLessThan(1e-8);
      for (const sample of result.trace) {
        expect(sample.speed_mps).toBeLessThanOrEqual(2 + 1e-8);
        expect(sample.acceleration_mps2).toBeLessThanOrEqual(3 + 1e-6);
        // Differential drive can never slide sideways in its body frame.
        expect(
          -sample.vx_mps * Math.sin(sample.theta_rad) +
            sample.vy_mps * Math.cos(sample.theta_rad),
        ).toBeCloseTo(0, 9);
      }
    },
  );
  it("scales time with physical limits rather than hidden controller gains", () => {
    const path = createPathModel({
      path_elements: [
        waypoint(0, 0, 0),
        point(3, 0),
        waypoint(3, 3, Math.PI / 2),
      ],
    });
    const normal = simulatePathWithTrace(path, config, { dt_s: 0.02 });
    const faster = simulatePathWithTrace(
      path,
      {
        ...config,
        default_max_velocity_meters_per_sec: 4,
        default_max_acceleration_meters_per_sec2: 12,
        default_max_velocity_deg_per_sec: 360,
        default_max_acceleration_deg_per_sec2: 1440,
      },
      { dt_s: 0.01 },
    );
    expect(faster.completed).toBe(true);
    expect(faster.total_time_s * 2).toBeCloseTo(normal.total_time_s, 6);
    expect(faster.trace.length).toBe(normal.trace.length);
    normal.trace.forEach((sample, index) => {
      expect(faster.trace[index].x_m).toBeCloseTo(sample.x_m, 6);
      expect(faster.trace[index].y_m).toBeCloseTo(sample.y_m, 6);
      expect(faster.trace[index].theta_rad).toBeCloseTo(sample.theta_rad, 6);
    });
  });

  it.each(["forward", "backward"] as const)(
    "uses the selected %s direction, ignoring intermediate headings",
    (direction) => {
      const startHeading = direction === "forward" ? Math.PI : 0;
      const path = createPathModel({
        tank_drive_direction: direction,
        preview: {
          start_pose: {
            x_meters: 0,
            y_meters: 0,
            rotation_radians: startHeading,
          },
        },
        path_elements: [
          createRotationTarget({
            rotation_radians: -Math.PI / 2,
            t_ratio: 0.5,
          }),
          waypoint(3, 0, Math.PI / 2),
        ],
      });
      const result = simulatePathWithTrace(path, config, { dt_s: 0.02 });
      expect(result.completed).toBe(true);
      expect(result.trace[0]).toMatchObject({
        x_m: 0,
        y_m: 0,
        theta_rad: startHeading,
      });
      for (const sample of result.trace) {
        const signedSpeed =
          sample.vx_mps * Math.cos(sample.theta_rad) +
          sample.vy_mps * Math.sin(sample.theta_rad);
        expect(
          direction === "forward" ? signedSpeed : -signedSpeed,
        ).toBeGreaterThanOrEqual(-1e-9);
        expect(sample.target_anchor_ordinal_1b).toBe(1);
      }
      const plain = simulatePathWithTrace(
        { ...path, path_elements: [path.path_elements[1]] },
        config,
        { dt_s: 0.02 },
      );
      expect(result.trace).toEqual(plain.trace);
    },
  );

  it("retains nonzero motion at a rolling endpoint without aligning to its heading", () => {
    const path = createPathModel({
      path_elements: [waypoint(0, 0, 0), waypoint(3, 0, Math.PI)],
      constraints: {
        ...createPathModel().constraints,
        min_velocity_meters_per_sec: 1,
      },
    });
    const result = simulatePathWithTrace(path, config, { dt_s: 0.02 });
    expect(result.completed).toBe(true);
    expect(result.trace.at(-1)!.speed_mps).toBeGreaterThanOrEqual(1);
    expect(result.trace.at(-1)!.theta_rad).toBeCloseTo(0, 9);
  });
});

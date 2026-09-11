import { describe, expect, it } from "vitest";
import { createPathModel } from "../../../src/core/model/path";
import type { SimulationTraceSample } from "../../../src/core/sim";
import { traceClearsObstacle } from "../../../src/ui/tours/bumperClearance";
import {
  clearance,
  practiceConfig,
  waypoint,
} from "../../../src/ui/tours/tourScenario";

const square = { length_meters: 0.8, width_meters: 0.8 };
const obstacle = { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 };

function sample(
  x: number,
  y: number,
  theta = 0,
  overrides: Partial<SimulationTraceSample> = {},
): SimulationTraceSample {
  return {
    time_s: 0,
    x_m: x,
    y_m: y,
    theta_rad: theta,
    segment_index: 0,
    target_anchor_ordinal_1b: 2,
    global_s_m: 0,
    segment_s_m: 0,
    vx_mps: 0,
    vy_mps: 0,
    omega_radps: 0,
    speed_mps: 0,
    ax_mps2: 0,
    ay_mps2: 0,
    acceleration_mps2: 0,
    snapped_position: true,
    snapped_rotation: true,
    ...overrides,
  };
}

describe("simulated bumper clearance", () => {
  it("allows a close pass according to bumper width and actual heading", () => {
    const longRobot = { length_meters: 2, width_meters: 0.5 };
    // A 5 cm gap is clear; inflating by half the diagonal would reject it.
    const straight = [sample(-3, 0.8), sample(3, 0.8)];
    expect(traceClearsObstacle(straight, longRobot, obstacle)).toBe(true);
    expect(
      traceClearsObstacle(
        straight.map((pose) => ({ ...pose, theta_rad: Math.PI / 2 })),
        longRobot,
        obstacle,
      ),
    ).toBe(false);
  });

  it("detects a bumper collision even when the robot center stays clear", () => {
    expect(
      traceClearsObstacle([sample(-2, 0.8), sample(2, 0.8)], square, obstacle),
    ).toBe(false);
  });

  it("covers a thin obstacle between sparse samples away from their midpoint", () => {
    const tinyObstacle = { minX: 1.234, maxX: 1.235, minY: -0.01, maxY: 0.01 };
    expect(
      traceClearsObstacle(
        [sample(-5, 0), sample(5, 0)],
        { length_meters: 0.01, width_meters: 0.01 },
        tinyObstacle,
      ),
    ).toBe(false);
  });

  it("catches a rotating corner although both recorded footprints are clear", () => {
    const cornerObstacle = { minX: 0.65, maxX: 0.8, minY: 0.65, maxY: 0.8 };
    const longRobot = { length_meters: 2, width_meters: 0.2 };
    const horizontal = sample(0, 0);
    const vertical = sample(0, 0, Math.PI / 2);
    expect(
      traceClearsObstacle([horizontal, horizontal], longRobot, cornerObstacle),
    ).toBe(true);
    expect(
      traceClearsObstacle([vertical, vertical], longRobot, cornerObstacle),
    ).toBe(true);
    expect(
      traceClearsObstacle([horizontal, vertical], longRobot, cornerObstacle),
    ).toBe(false);
  });

  it("uses all four separating axes for a rotated bumper near an obstacle corner", () => {
    const pose = sample(1.15, 1.15, -Math.PI / 4);
    // The world-aligned bounding boxes overlap; the actual rectangles do not.
    expect(
      traceClearsObstacle(
        [pose, pose],
        { length_meters: 2, width_meters: 0.2 },
        obstacle,
      ),
    ).toBe(true);
  });

  it("interpolates a wrapped heading through the short turn", () => {
    const tinyObstacle = { minX: -0.1, maxX: 0.1, minY: 0.65, maxY: 0.75 };
    expect(
      traceClearsObstacle(
        [
          sample(0, 0, (179 * Math.PI) / 180),
          sample(0, 0, (-179 * Math.PI) / 180),
        ],
        { length_meters: 2, width_meters: 0.2 },
        tinyObstacle,
      ),
    ).toBe(true);
  });

  it("counts touching and a collision at either endpoint", () => {
    expect(
      traceClearsObstacle([sample(-2, 0.9), sample(2, 0.9)], square, obstacle),
    ).toBe(false);
    expect(
      traceClearsObstacle([sample(0, 0), sample(2, 0)], square, obstacle),
    ).toBe(false);
    expect(
      traceClearsObstacle([sample(-2, 0), sample(0, 0)], square, obstacle),
    ).toBe(false);
  });

  it("does not approve absent, invalid, or unfinished simulation traces", () => {
    expect(traceClearsObstacle([], square, obstacle)).toBe(false);
    expect(traceClearsObstacle([sample(3, 3)], square, obstacle)).toBe(false);
    expect(
      traceClearsObstacle(
        [sample(2, 3), sample(3, 3, 0, { snapped_position: false })],
        square,
        obstacle,
      ),
    ).toBe(false);
    expect(
      traceClearsObstacle(
        [sample(2, 3), sample(3, 3, 0, { snapped_rotation: false })],
        square,
        obstacle,
      ),
    ).toBe(false);
    expect(
      traceClearsObstacle(
        [sample(Number.NaN, 3), sample(3, 3)],
        square,
        obstacle,
      ),
    ).toBe(false);
    expect(
      traceClearsObstacle(
        [sample(2, 3), sample(3, 3)],
        { ...square, width_meters: 0 },
        obstacle,
      ),
    ).toBe(false);
  });

  it("uses a full simulation and supports a custom obstacle in the lesson gate", () => {
    const config = practiceConfig();
    config.gui.robot = { length_meters: 2, width_meters: 0.5 };
    const path = createPathModel({
      path_elements: [waypoint(2, 4.8), waypoint(8, 4.8)],
    });
    const box = { minX: 4.5, maxX: 5.5, minY: 3.5, maxY: 4.5 };
    expect(clearance(path, config, box)).toBe(true);
    expect(clearance(path, config, { ...box, maxY: 4.6 })).toBe(false);
    expect(clearance(createPathModel(), config, box)).toBe(false);
  });
});

import { expect, it } from "vitest";
import { createProjectConfig } from "../../../src/core/config/projectConfig";
import {
  solveJointAutoConstraints,
  autoVelocityInputSignature,
} from "../../../src/core/constraints/autoVelocityConstraints";
import { refreshAutoVelocityConstraints } from "../../../src/core/constraints/autoVelocityApply";
import {
  createPathModel,
  createTranslationTarget,
  createRotationTarget,
  createWaypoint,
} from "../../../src/core/model/path";
import { simulatePathWithTrace } from "../../../src/core/sim";

it("generates and validates tank limits with the actual ideal preview, ignoring intermediate headings", () => {
  const point = (x: number, y: number) =>
    createTranslationTarget({
      x_meters: x,
      y_meters: y,
      intermediate_handoff_radius_meters: 0.3,
      handoff_radius_source: "manual",
    });
  const path = createPathModel({
    path_elements: [
      createWaypoint({
        translation_target: point(0, 0),
        rotation_target: createRotationTarget(),
      }),
      createRotationTarget({ rotation_radians: Math.PI, t_ratio: 0.95 }),
      point(3, 0),
      point(3, 3),
    ],
  });
  const config = createProjectConfig({
    gui: { robot: { drive_type: "tank" } },
    kinematic_constraints: {
      default_max_velocity_meters_per_sec: 2,
      default_max_acceleration_meters_per_sec2: 3,
      default_max_velocity_deg_per_sec: 180,
      default_max_acceleration_deg_per_sec2: 360,
    },
  });
  const result = solveJointAutoConstraints(path, config);
  expect(result.status).toBe("valid");
  expect(result.stats.genericValidationPassed).toBe(true);
  expect(result.stats.stabilityValidationPassed).toBe(true);
  expect(result.profile.diagnostics.rotationFeasibility).toEqual([]);
  const persisted = refreshAutoVelocityConstraints(result.path, config, {
    whenPresentOnly: false,
  });
  const simulation = simulatePathWithTrace(persisted, config, { dt_s: 0.01 });
  expect(simulation.completed).toBe(true);
  const end = simulation.trace.at(-1)!;
  expect(Math.hypot(end.x_m - 3, end.y_m - 3)).toBeLessThanOrEqual(0.03);
  expect(end.speed_mps).toBeLessThan(1e-8);
  expect(autoVelocityInputSignature(path, config, {})).not.toBe(
    autoVelocityInputSignature(path, createProjectConfig(), {}),
  );
  expect(autoVelocityInputSignature(path, config, {})).not.toBe(
    autoVelocityInputSignature(
      { ...path, preview: { tank_direction: "backward" } },
      config,
      {},
    ),
  );
}, 30000);

it.each(["tank", "swerve"] as const)(
  "generates a %s current-pose path without shifting authored constraints or exporting a ghost",
  (driveType) => {
    const path = createPathModel({
      preview: {
        start_pose: { x_meters: 1, y_meters: 1, rotation_radians: 0 },
      },
      path_elements: [
        createRotationTarget({ rotation_radians: 0.2, t_ratio: 0.5 }),
        createTranslationTarget({ x_meters: 3, y_meters: 1 }),
        createTranslationTarget({ x_meters: 5, y_meters: 1 }),
      ],
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec",
          value: 0.7,
          start_ordinal: 1,
          end_ordinal: 1,
        },
      ],
    });
    const before = structuredClone(path);
    const config = createProjectConfig({
      gui: { robot: { drive_type: driveType } },
    });
    const solved = solveJointAutoConstraints(path, config);
    expect(solved.status).toBe("valid");
    expect(path).toEqual(before);
    expect(solved.path.path_elements).toHaveLength(3);
    expect(solved.path.path_elements[0].type).toBe("rotation");
    expect(solved.path.ranged_constraints).toEqual(path.ranged_constraints);
    expect(solved.profile.anchors[0]).toMatchObject({
      x: 1,
      y: 1,
      pathIndex: -1,
    });
    expect(solved.profile.segmentCaps.map((cap) => cap.targetOrdinal)).toEqual([
      1, 2,
    ]);
    const persisted = refreshAutoVelocityConstraints(solved.path, config, {
      whenPresentOnly: false,
    });
    expect(persisted.ranged_constraints).toContainEqual(
      expect.objectContaining({
        ...path.ranged_constraints[0],
        source: undefined,
      }),
    );
    const preview = simulatePathWithTrace(persisted, config, { dt_s: 0.02 });
    expect(preview.trace[0].target_anchor_ordinal_1b).toBe(1);
    expect(
      preview.trace
        .filter((sample) => sample.target_anchor_ordinal_1b === 1)
        .every((sample) => sample.speed_mps <= 0.700001),
    ).toBe(true);
    expect(
      Math.hypot(preview.trace.at(-1)!.x_m - 5, preview.trace.at(-1)!.y_m - 1),
    ).toBeLessThanOrEqual(0.03);
  },
  30000,
);

import { describe, expect, it } from "vitest";
import { generateAutoVelocityProfile } from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
} from "../../../src/core/model/path";

const config = {
  kinematic_constraints: {
    default_max_velocity_meters_per_sec: 5,
    default_max_acceleration_meters_per_sec2: 4,
    default_intermediate_handoff_radius_meters: 0.25,
    default_max_velocity_deg_per_sec: 720,
    default_max_acceleration_deg_per_sec2: 1500,
    default_end_translation_tolerance_meters: 0.03,
    default_end_rotation_tolerance_deg: 2,
  },
};

describe("generateAutoVelocityProfile", () => {
  it("limits the incoming cap for a tight 90 degree handoff", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.25,
        }),
        createTranslationTarget({ x_meters: 1, y_meters: 1 }),
      ],
    });

    const profile = generateAutoVelocityProfile(path, config, {
      velocitySafetyFactor: 1,
      accelerationSafetyFactor: 1,
    });

    expect(profile.corners).toHaveLength(1);
    expect(profile.corners[0]?.effectiveRadiusMeters).toBeCloseTo(0.25, 3);
    expect(profile.segmentCaps.map((cap) => cap.targetOrdinal)).toEqual([
      1, 2, 3,
    ]);
    expect(profile.segmentCaps[0]?.value).toBeCloseTo(2.5, 2);
    expect(profile.segmentCaps[1]?.value).toBeLessThanOrEqual(1);
    expect(profile.segmentCaps[2]?.value).toBeLessThanOrEqual(5);
    expect(profile.segmentCaps[2]?.value ?? 0).toBeGreaterThan(
      profile.segmentCaps[1]?.value ?? 0,
    );
    expectSafeAutoVelocityProfile(profile);
  });

  it("keeps shallow turns faster than sharp turns", () => {
    const shallow = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.25,
        }),
        createTranslationTarget({ x_meters: 2, y_meters: 1 }),
      ],
    });
    const sharp = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.25,
        }),
        createTranslationTarget({ x_meters: 0.3, y_meters: 0.7 }),
      ],
    });

    const shallowProfile = generateAutoVelocityProfile(shallow, config, {
      velocitySafetyFactor: 1,
      accelerationSafetyFactor: 1,
    });
    const sharpProfile = generateAutoVelocityProfile(sharp, config, {
      velocitySafetyFactor: 1,
      accelerationSafetyFactor: 1,
    });
    const shallowCap = shallowProfile.segmentCaps.find(
      (cap) => cap.targetOrdinal === 2,
    )?.value;
    const sharpCap = sharpProfile.segmentCaps.find(
      (cap) => cap.targetOrdinal === 2,
    )?.value;

    expect(shallowCap).toBeGreaterThan(sharpCap ?? 0);
    expect(shallowCap).toBeLessThanOrEqual(shallowProfile.usableMaxVelocityMps);
    expect(sharpCap).toBeLessThanOrEqual(sharpProfile.usableMaxVelocityMps);
    expectSafeAutoVelocityProfile(shallowProfile);
    expectSafeAutoVelocityProfile(sharpProfile);
    expect(sharpProfile.corners[0]?.effectiveRadiusMeters).toBeCloseTo(0.25, 3);
  });

  it("keeps straight paths at usable max velocity after the first ordinal", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 2, y_meters: 0 }),
        createTranslationTarget({ x_meters: 4, y_meters: 0 }),
      ],
    });

    const profile = generateAutoVelocityProfile(path, config, {
      velocitySafetyFactor: 0.8,
      accelerationSafetyFactor: 1,
    });

    expect(profile.corners).toHaveLength(0);
    expect(profile.usableMaxVelocityMps).toBeCloseTo(4, 2);
    expect(profile.segmentCaps.map((cap) => cap.value)).toEqual([2.5, 4, 4]);
  });

  it("matches the preview sim on a wide handoff instead of the circular estimate", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 7.41, y_meters: 2.14 }),
        createTranslationTarget({
          x_meters: 10.35,
          y_meters: 6.47,
          intermediate_handoff_radius_meters: 1.1,
        }),
        createTranslationTarget({
          x_meters: 16.13,
          y_meters: 4.68,
          intermediate_handoff_radius_meters: 0.25,
        }),
      ],
    });

    const profile = generateAutoVelocityProfile(
      path,
      {
        kinematic_constraints: {
          ...config.kinematic_constraints,
          default_max_velocity_meters_per_sec: 4.5,
          default_max_acceleration_meters_per_sec2: 12,
          default_intermediate_handoff_radius_meters: 0.25,
        },
      },
      {
        velocitySafetyFactor: 0.9,
        accelerationSafetyFactor: 0.8,
      },
    );

    expect(profile.usableMaxVelocityMps).toBeCloseTo(4.05, 2);
    expect(profile.segmentCaps.map((cap) => cap.value)).toEqual([
      2.25, 4.05, 4.05,
    ]);
  });

  it("evaluates the runtime radius even when it exceeds the outgoing leg", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 10.42282, y_meters: 1.79173 }),
        createTranslationTarget({
          x_meters: 5.81011,
          y_meters: 1.78833,
          intermediate_handoff_radius_meters: 0.85,
        }),
        createTranslationTarget({ x_meters: 6.16637, y_meters: 2.16544 }),
      ],
    });

    const profile = generateAutoVelocityProfile(path, config);

    expect(profile.corners).toHaveLength(1);
    expect(profile.corners[0]?.handoffDistanceMeters).toBeCloseTo(0.85, 9);
    expect(profile.corners[0]?.clamped).toBe(false);
    expect(profile.diagnostics.handoffs[0]?.earlyHandoffRatio).toBeGreaterThan(
      0.1,
    );
    expect(profile.diagnostics.handoffs[0]?.earlyHandoffRatio).toBeLessThan(
      0.25,
    );
    expect(profile.diagnostics.handoffs[0]?.skippedOutgoingSegment).toBe(false);
  });

  it("adjusts adjacent caps independently across chained turns", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1.4,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.4,
        }),
        createTranslationTarget({
          x_meters: 1.4,
          y_meters: 1.2,
          intermediate_handoff_radius_meters: 0.4,
        }),
        createTranslationTarget({
          x_meters: 2.8,
          y_meters: 1.2,
          intermediate_handoff_radius_meters: 0.4,
        }),
        createTranslationTarget({ x_meters: 2.8, y_meters: 2.4 }),
      ],
    });

    const profile = generateAutoVelocityProfile(
      path,
      {
        kinematic_constraints: {
          ...config.kinematic_constraints,
          default_max_velocity_meters_per_sec: 4.5,
          default_max_acceleration_meters_per_sec2: 7,
          default_intermediate_handoff_radius_meters: 0.25,
        },
      },
      {
        velocitySafetyFactor: 0.9,
        accelerationSafetyFactor: 0.8,
      },
    );
    const caps = profile.segmentCaps.slice(1).map((cap) => cap.value);

    expect(profile.usableMaxVelocityMps).toBeCloseTo(4.05, 2);
    expect(caps.some((cap) => cap < 2)).toBe(true);
    expect(new Set(caps).size).toBeGreaterThan(2);
    expect(Math.max(...caps)).toBeLessThanOrEqual(4.05);
    expectSafeAutoVelocityProfile(profile);
  });

  it("adds a first-ordinal default cap at half of configured max velocity", () => {
    const path = createPathModel({
      path_elements: [createTranslationTarget({ x_meters: 0, y_meters: 0 })],
    });

    const profile = generateAutoVelocityProfile(path, config, {
      velocitySafetyFactor: 0.8,
      accelerationSafetyFactor: 1,
    });

    expect(profile.usableMaxVelocityMps).toBeCloseTo(4, 2);
    expect(profile.segmentCaps).toEqual([
      {
        segmentIndex: 0,
        targetOrdinal: 1,
        value: 2.5,
        minVelocityLimitMps: 2.5,
      },
    ]);
  });

  it("reuses cached profiles when only manual acceleration constraints change", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1.2,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.3,
        }),
        createTranslationTarget({
          x_meters: 2.2,
          y_meters: 0.7,
          intermediate_handoff_radius_meters: 0.35,
        }),
        createTranslationTarget({ x_meters: 3.4, y_meters: 0.5 }),
      ],
    });
    const profile = generateAutoVelocityProfile(path, config, {
      velocitySafetyFactor: 0.9,
      accelerationSafetyFactor: 0.8,
    });
    const edited = structuredClone(path);
    edited.ranged_constraints = [
      {
        key: "max_acceleration_meters_per_sec2",
        value: 5,
        start_ordinal: 3,
        end_ordinal: 3,
      },
    ];

    expect(
      generateAutoVelocityProfile(edited, config, {
        velocitySafetyFactor: 0.9,
        accelerationSafetyFactor: 0.8,
      }),
    ).toBe(profile);
  });

  it("invalidates cached profiles when a manual velocity cap changes", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1.2,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.3,
        }),
        createTranslationTarget({ x_meters: 2.4, y_meters: 0.9 }),
      ],
    });
    const profile = generateAutoVelocityProfile(path, config, {
      velocitySafetyFactor: 0.9,
      accelerationSafetyFactor: 0.8,
    });
    const edited = structuredClone(path);
    edited.ranged_constraints = [
      {
        key: "max_velocity_meters_per_sec",
        value: 2.1,
        start_ordinal: 2,
        end_ordinal: 2,
      },
    ];

    expect(
      generateAutoVelocityProfile(edited, config, {
        velocitySafetyFactor: 0.9,
        accelerationSafetyFactor: 0.8,
      }),
    ).not.toBe(profile);
  });

  it("bounds the incoming cap of a full reversal by along-track overshoot", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 2,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.3,
        }),
        createTranslationTarget({ x_meters: 0, y_meters: 0.001 }),
      ],
    });

    const profile = generateAutoVelocityProfile(path, config, {
      velocitySafetyFactor: 1,
      accelerationSafetyFactor: 1,
    });
    const incomingCap = profile.segmentCaps.find(
      (cap) => cap.targetOrdinal === 2,
    )?.value;

    // Stopping from v inside R + tolerance needs v <= sqrt(2·a·(R + tol));
    // with a = 4 and tol = 0.105 that is ~1.8 m/s. High caps that blow past
    // the anchor must no longer pass the gates.
    expect(profile.corners[0]?.turnAngleRadians).toBeGreaterThan(3.1);
    expect(incomingCap).toBeLessThanOrEqual(2.1);
    expectSafeAutoVelocityProfile(profile);
  });

  it("solves around a pinned cap instead of overwriting it", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.25,
        }),
        createTranslationTarget({ x_meters: 1, y_meters: 1 }),
      ],
    });
    path.ranged_constraints = [
      {
        key: "max_velocity_meters_per_sec",
        value: 0.8,
        start_ordinal: 2,
        end_ordinal: 2,
      },
    ];

    const profile = generateAutoVelocityProfile(path, config, {
      velocitySafetyFactor: 1,
      accelerationSafetyFactor: 1,
    });
    const incomingCap = profile.segmentCaps.find(
      (cap) => cap.targetOrdinal === 2,
    );

    expect(incomingCap?.value).toBeCloseTo(0.8, 3);
    expectSafeAutoVelocityProfile(profile);
  });

  it("invalidates cached profiles when rotation ranged constraints change", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createRotationTarget({
          rotation_radians: Math.PI / 2,
          t_ratio: 0.5,
        }),
        createTranslationTarget({
          x_meters: 1.2,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.3,
        }),
        createTranslationTarget({ x_meters: 2.4, y_meters: 0.7 }),
      ],
    });
    const profile = generateAutoVelocityProfile(path, config, {
      velocitySafetyFactor: 0.9,
      accelerationSafetyFactor: 0.8,
    });
    const edited = structuredClone(path);
    edited.ranged_constraints = [
      {
        key: "max_velocity_deg_per_sec",
        value: 180,
        start_ordinal: 1,
        end_ordinal: 1,
      },
    ];

    expect(
      generateAutoVelocityProfile(edited, config, {
        velocitySafetyFactor: 0.9,
        accelerationSafetyFactor: 0.8,
      }),
    ).not.toBe(profile);
  });
});

function expectSafeAutoVelocityProfile(
  profile: ReturnType<typeof generateAutoVelocityProfile>,
) {
  expect(profile.diagnostics.reachedEnd).toBe(true);
  expect(profile.diagnostics.maxHandoffErrorRatio).toBeLessThanOrEqual(1);
  expect(profile.diagnostics.maxPostHandoffErrorRatio).toBeLessThanOrEqual(1);
  expect(profile.diagnostics.maxOvershootErrorRatio).toBeLessThanOrEqual(1);
  expect(profile.diagnostics.maxCorridorDeviationRatio).toBeLessThanOrEqual(1);
}

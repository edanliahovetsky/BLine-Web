import { describe, expect, it } from "vitest";
import {
  generateAutoVelocityProfile
} from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createTranslationTarget
} from "../../../src/core/model/path";

const config = {
  kinematic_constraints: {
    default_max_velocity_meters_per_sec: 5,
    default_max_acceleration_meters_per_sec2: 4,
    default_intermediate_handoff_radius_meters: 0.25,
    default_max_velocity_deg_per_sec: 720,
    default_max_acceleration_deg_per_sec2: 1500,
    default_end_translation_tolerance_meters: 0.03,
    default_end_rotation_tolerance_deg: 2
  }
};

describe("generateAutoVelocityProfile", () => {
  it("limits the incoming cap for a tight 90 degree handoff", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.25
        }),
        createTranslationTarget({ x_meters: 1, y_meters: 1 })
      ]
    });

    const profile = generateAutoVelocityProfile(path, config, {
      velocitySafetyFactor: 1,
      accelerationSafetyFactor: 1
    });

    expect(profile.corners).toHaveLength(1);
    expect(profile.corners[0]?.effectiveRadiusMeters).toBeCloseTo(0.25, 3);
    expect(profile.segmentCaps.map((cap) => cap.targetOrdinal)).toEqual([1, 2, 3]);
    expect(profile.segmentCaps[0]?.value).toBeCloseTo(2.5, 2);
    expect(profile.segmentCaps[1]?.value).toBeCloseTo(1, 2);
    expect(profile.segmentCaps[2]?.value).toBeCloseTo(5, 2);
  });

  it("keeps shallow turns faster than sharp turns", () => {
    const shallow = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.25
        }),
        createTranslationTarget({ x_meters: 2, y_meters: 1 })
      ]
    });
    const sharp = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.25
        }),
        createTranslationTarget({ x_meters: 0.3, y_meters: 0.7 })
      ]
    });

    const shallowProfile = generateAutoVelocityProfile(shallow, config, {
      velocitySafetyFactor: 1,
      accelerationSafetyFactor: 1
    });
    const sharpProfile = generateAutoVelocityProfile(sharp, config, {
      velocitySafetyFactor: 1,
      accelerationSafetyFactor: 1
    });
    const shallowCap = shallowProfile.segmentCaps.find(
      (cap) => cap.targetOrdinal === 2
    )?.value;
    const sharpCap = sharpProfile.segmentCaps.find(
      (cap) => cap.targetOrdinal === 2
    )?.value;

    expect(shallowCap).toBeGreaterThan(sharpCap ?? 0);
    expect(shallowCap).toBeCloseTo(1.4, 1);
    expect(sharpCap).toBeCloseTo(1, 2);
    expect(sharpProfile.corners[0]?.effectiveRadiusMeters).toBeCloseTo(0.25, 3);
  });

  it("keeps straight paths at usable max velocity after the first ordinal", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 2, y_meters: 0 }),
        createTranslationTarget({ x_meters: 4, y_meters: 0 })
      ]
    });

    const profile = generateAutoVelocityProfile(path, config, {
      velocitySafetyFactor: 0.8,
      accelerationSafetyFactor: 1
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
          intermediate_handoff_radius_meters: 1.1
        }),
        createTranslationTarget({
          x_meters: 16.13,
          y_meters: 4.68,
          intermediate_handoff_radius_meters: 0.25
        })
      ]
    });

    const profile = generateAutoVelocityProfile(path, {
      kinematic_constraints: {
        ...config.kinematic_constraints,
        default_max_velocity_meters_per_sec: 4.5,
        default_max_acceleration_meters_per_sec2: 12,
        default_intermediate_handoff_radius_meters: 0.25
      }
    }, {
      velocitySafetyFactor: 0.9,
      accelerationSafetyFactor: 0.8
    });

    expect(profile.usableMaxVelocityMps).toBeCloseTo(4.05, 2);
    expect(profile.segmentCaps.map((cap) => cap.value)).toEqual([2.25, 4.05, 4.05]);
  });

  it("adjusts adjacent caps independently across chained turns", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1.4,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.4
        }),
        createTranslationTarget({
          x_meters: 1.4,
          y_meters: 1.2,
          intermediate_handoff_radius_meters: 0.4
        }),
        createTranslationTarget({
          x_meters: 2.8,
          y_meters: 1.2,
          intermediate_handoff_radius_meters: 0.4
        }),
        createTranslationTarget({ x_meters: 2.8, y_meters: 2.4 })
      ]
    });

    const profile = generateAutoVelocityProfile(path, {
      kinematic_constraints: {
        ...config.kinematic_constraints,
        default_max_velocity_meters_per_sec: 4.5,
        default_max_acceleration_meters_per_sec2: 7,
        default_intermediate_handoff_radius_meters: 0.25
      }
    }, {
      velocitySafetyFactor: 0.9,
      accelerationSafetyFactor: 0.8
    });
    const caps = profile.segmentCaps.slice(1).map((cap) => cap.value);

    expect(profile.usableMaxVelocityMps).toBeCloseTo(4.05, 2);
    expect(caps.some((cap) => cap < 2)).toBe(true);
    expect(new Set(caps).size).toBeGreaterThan(2);
    expect(Math.max(...caps)).toBeLessThanOrEqual(4.05);
  });

  it("adds a first-ordinal default cap at half of configured max velocity", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 })
      ]
    });

    const profile = generateAutoVelocityProfile(path, config, {
      velocitySafetyFactor: 0.8,
      accelerationSafetyFactor: 1
    });

    expect(profile.usableMaxVelocityMps).toBeCloseTo(4, 2);
    expect(profile.segmentCaps).toEqual([
      {
        segmentIndex: 0,
        targetOrdinal: 1,
        value: 2.5,
        minVelocityLimitMps: 2.5
      }
    ]);
  });
});

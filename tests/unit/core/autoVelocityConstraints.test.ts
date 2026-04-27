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
  it("caps a 90 degree handoff from lateral acceleration", () => {
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
      accelerationSafetyFactor: 1,
      sampleStepMeters: 0.025
    });

    expect(profile.corners).toHaveLength(1);
    expect(profile.corners[0]?.effectiveRadiusMeters).toBeCloseTo(0.25, 3);
    expect(profile.segmentCaps.map((cap) => cap.targetOrdinal)).toEqual([1, 2, 3]);
    expect(profile.segmentCaps[0]?.value).toBeCloseTo(2.5, 2);
    expect(profile.segmentCaps[1]?.value).toBeCloseTo(1, 2);
    expect(profile.segmentCaps[2]?.value).toBeCloseTo(5, 2);
  });

  it("keeps sharp turns from shrinking below the handoff-radius floor", () => {
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

    expect(shallowCap).toBeGreaterThan(1);
    expect(sharpCap).toBeCloseTo(1, 2);
    expect(sharpProfile.corners[0]?.effectiveRadiusMeters).toBeCloseTo(0.25, 3);
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

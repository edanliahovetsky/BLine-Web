import { describe, expect, it } from "vitest";
import {
  countAnchorElements,
  countRotationEventElements,
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  getHandoffRadiusSource,
  setHandoffRadiusSource,
} from "../../../src/core/model/path";

describe("path model", () => {
  it("creates the Phase 1 element set with desktop-reference defaults", () => {
    const translation = createTranslationTarget();
    const rotation = createRotationTarget();
    const trigger = createEventTrigger();
    const waypoint = createWaypoint();

    expect(translation).toMatchObject({
      type: "translation",
      x_meters: 0,
      y_meters: 0,
      intermediate_handoff_radius_meters: null,
    });
    expect(rotation).toMatchObject({
      type: "rotation",
      rotation_radians: 0,
      t_ratio: 0,
      profiled_rotation: true,
      legacy_position: null,
      legacy_converted: false,
    });
    expect(trigger).toMatchObject({
      type: "event_trigger",
      t_ratio: 0,
      lib_key: "",
    });
    expect(waypoint.translation_target.type).toBe("translation");
    expect(waypoint.rotation_target.type).toBe("rotation");
  });

  it("leaves handoff radius ownership untagged until someone claims it", () => {
    const translation = createTranslationTarget();
    const waypoint = createWaypoint();

    expect("handoff_radius_source" in translation).toBe(false);
    expect(getHandoffRadiusSource(translation)).toBeNull();
    expect(getHandoffRadiusSource(waypoint)).toBeNull();
    expect(getHandoffRadiusSource(createRotationTarget())).toBeNull();

    const tagged = setHandoffRadiusSource(translation, "auto");
    const taggedWaypoint = setHandoffRadiusSource(waypoint, "manual");

    expect(getHandoffRadiusSource(tagged)).toBe("auto");
    expect(taggedWaypoint).toMatchObject({
      translation_target: { handoff_radius_source: "manual" },
    });
    expect("handoff_radius_source" in translation).toBe(false);
    expect(
      "handoff_radius_source" in setHandoffRadiusSource(tagged, null),
    ).toBe(false);
  });

  it("counts anchor and rotation domains used by ranged constraints", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget(),
        createEventTrigger(),
        createRotationTarget(),
        createWaypoint(),
      ],
    });

    expect(countAnchorElements(path.path_elements)).toBe(2);
    expect(countRotationEventElements(path.path_elements)).toBe(2);
  });
});

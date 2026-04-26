import { describe, expect, it } from "vitest";
import {
  countAnchorElements,
  countRotationEventElements,
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  getPathElement,
  reorderPathElements
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
      intermediate_handoff_radius_meters: null
    });
    expect(rotation).toMatchObject({
      type: "rotation",
      rotation_radians: 0,
      t_ratio: 0,
      profiled_rotation: true,
      legacy_position: null,
      legacy_converted: false
    });
    expect(trigger).toMatchObject({
      type: "event_trigger",
      t_ratio: 0,
      lib_key: ""
    });
    expect(waypoint.translation_target.type).toBe("translation");
    expect(waypoint.rotation_target.type).toBe("rotation");
  });

  it("gets and reorders path elements without mutating the original path", () => {
    const first = createTranslationTarget({ x_meters: 1 });
    const second = createRotationTarget({ rotation_radians: 0.5 });
    const third = createTranslationTarget({ x_meters: 3 });
    const path = createPathModel({ path_elements: [first, second, third] });

    expect(getPathElement(path, 1)).toBe(second);

    const reordered = reorderPathElements(path, [2, 0, 1]);

    expect(reordered.path_elements).toEqual([third, first, second]);
    expect(path.path_elements).toEqual([first, second, third]);
  });

  it("counts anchor and rotation domains used by ranged constraints", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget(),
        createEventTrigger(),
        createRotationTarget(),
        createWaypoint()
      ]
    });

    expect(countAnchorElements(path.path_elements)).toBe(2);
    expect(countRotationEventElements(path.path_elements)).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  createEventTrigger,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
} from "../../../src/core/model/path";
import { buildElementProtrusionVisibilityByIndex } from "../../../src/canvas/protrusionVisibility";

describe("canvas protrusion visibility", () => {
  it("toggles waypoint and rotation protrusion previews from named events", () => {
    const elements = [
      createTranslationTarget({ x_meters: 0, y_meters: 0 }),
      createEventTrigger({ t_ratio: 0.25, lib_key: "deploy" }),
      createRotationTarget({ t_ratio: 0.5 }),
      createEventTrigger({ t_ratio: 0.75, lib_key: "stow" }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 4,
          y_meters: 0,
        }),
      }),
    ];

    const visibility = buildElementProtrusionVisibilityByIndex(elements, {
      gui: {
        protrusions: {
          enabled: true,
          distance_meters: 0.25,
          side: "front",
          default_state: "hidden",
          show_on_event_keys: ["deploy"],
          hide_on_event_keys: ["stow"],
        },
      },
    });

    expect(visibility.get(2)).toBe(true);
    expect(visibility.get(4)).toBe(false);
    expect(visibility.has(1)).toBe(false);
  });

  it("uses case-sensitive keys and show precedence like the PySide GUI", () => {
    const elements = [
      createTranslationTarget({ x_meters: 0, y_meters: 0 }),
      createEventTrigger({ t_ratio: 0.25, lib_key: "Deploy" }),
      createRotationTarget({ t_ratio: 0.5 }),
      createTranslationTarget({ x_meters: 2, y_meters: 0 }),
    ];

    expect(
      buildElementProtrusionVisibilityByIndex(elements, {
        gui: {
          protrusions: {
            enabled: true,
            default_state: "hidden",
            show_on_event_keys: ["deploy"],
          },
        },
      }).get(2),
    ).toBe(false);

    expect(
      buildElementProtrusionVisibilityByIndex(elements, {
        gui: {
          protrusions: {
            enabled: true,
            default_state: "hidden",
            show_on_event_keys: ["Deploy"],
            hide_on_event_keys: ["Deploy"],
          },
        },
      }).get(2),
    ).toBe(true);
  });
});

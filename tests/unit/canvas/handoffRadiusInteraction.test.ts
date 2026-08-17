import { describe, expect, it } from "vitest";
import {
  createTranslationTarget,
  setHandoffRadiusSource,
} from "../../../src/core/model/path";
import {
  handoffRingRadiusPx,
  handoffRingsForPath,
} from "../../../src/canvas/handoffRadiusInteraction";

describe("handoff radius canvas rendering", () => {
  const elements = [
    createTranslationTarget({ x_meters: 1, y_meters: 1 }),
    setHandoffRadiusSource(
      createTranslationTarget({
        x_meters: 3,
        y_meters: 1,
        intermediate_handoff_radius_meters: 0.4,
      }),
      "auto",
    ),
    createTranslationTarget({ x_meters: 3, y_meters: 3 }),
  ];

  it("builds rings only for live interior anchors", () => {
    const rings = handoffRingsForPath(elements, 0.45);

    expect(rings).toHaveLength(1);
    expect(rings[0]).toMatchObject({
      elementIndex: 1,
      ordinal: 2,
      anchorPosition: { x_meters: 3, y_meters: 1 },
      radiusMeters: 0.4,
      state: "auto",
    });
  });

  it("keeps small radii visible at low zoom", () => {
    expect(handoffRingRadiusPx(0.05, 20)).toBe(8);
  });
});

import { describe, expect, it } from "vitest";
import {
  createTranslationTarget,
  setHandoffRadiusSource,
} from "../../../src/core/model/path";
import {
  createFieldViewport,
  modelToStagePoint,
} from "../../../src/canvas/geometry";
import {
  handoffRadiusForPointer,
  handoffRingGrabBand,
  handoffRingRadiusPx,
  handoffRingsForPath,
  hitTestHandoffRing,
} from "../../../src/canvas/handoffRadiusInteraction";

describe("handoff radius canvas interaction", () => {
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
      storedRadiusMeters: 0.4,
      radiusMeters: 0.4,
      source: "auto",
      state: "auto",
      range: { minMeters: 0.05, maxMeters: 1.8 },
    });
  });

  it("keeps the grab band outside the node and usable at low zoom", () => {
    expect(handoffRingGrabBand(8, 21)).toEqual({
      innerPx: 21,
      outerPx: 43,
    });
    expect(handoffRingRadiusPx(0.05, 20)).toBe(8);
  });

  it("hit-tests the nearest ring edge without entering the node zone", () => {
    const viewport = {
      ...createFieldViewport({ width: 960, height: 540 }),
      scale: 100,
    };
    const ring = handoffRingsForPath(elements, 0.45)[0];
    const center = modelToStagePoint(ring.anchorPosition, viewport);

    expect(
      hitTestHandoffRing([ring], viewport, {
        x: center.x + 40,
        y: center.y,
      }),
    ).toBe(ring);
    expect(
      hitTestHandoffRing([ring], viewport, {
        x: center.x + 20,
        y: center.y,
      }),
    ).toBeNull();
    expect(
      hitTestHandoffRing([ring], viewport, {
        x: center.x + 60,
        y: center.y,
      }),
    ).toBeNull();
  });

  it("clamps pointer-derived radii to the corner's feasible range", () => {
    const ring = handoffRingsForPath(elements, 0.45)[0];

    expect(handoffRadiusForPointer(ring, ring.anchorPosition)).toBeCloseTo(
      0.05,
      6,
    );
    expect(
      handoffRadiusForPointer(ring, {
        x_meters: ring.anchorPosition.x_meters + 0.6,
        y_meters: ring.anchorPosition.y_meters,
      }),
    ).toBeCloseTo(0.6, 6);
    expect(
      handoffRadiusForPointer(ring, {
        x_meters: ring.anchorPosition.x_meters + 4,
        y_meters: ring.anchorPosition.y_meters,
      }),
    ).toBeCloseTo(1.8, 6);
  });
});

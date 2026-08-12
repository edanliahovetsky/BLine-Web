import { describe, expect, it } from "vitest";
import {
  seedHandoffRadii,
  seedableHandoffElementIndexes,
} from "../../../src/core/bend/autoSeedHandoffRadii";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  getHandoffRadiusSource,
} from "../../../src/core/model/path";
import type { PathElement, PathModel } from "../../../src/core/model/path";

const radiusOf = (element: PathElement): number | null =>
  element.type === "translation"
    ? element.intermediate_handoff_radius_meters
    : element.type === "waypoint"
      ? element.translation_target.intermediate_handoff_radius_meters
      : null;

const openPath = (): PathModel =>
  createPathModel({
    path_elements: [
      createTranslationTarget({ x_meters: 0, y_meters: 0 }),
      createRotationTarget({ t_ratio: 0.4 }),
      createTranslationTarget({ x_meters: 3, y_meters: 0 }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 3,
          y_meters: 2.5,
        }),
      }),
      createTranslationTarget({ x_meters: 6, y_meters: 2.5 }),
    ],
  });

describe("seedHandoffRadii", () => {
  it("seeds interior anchors and tags them auto", () => {
    const result = seedHandoffRadii(openPath());

    expect(result.seededElementIndexes).toEqual([2, 3]);
    for (const index of result.seededElementIndexes) {
      const element = result.path.path_elements[index];
      expect(getHandoffRadiusSource(element)).toBe("auto");
      const radius = radiusOf(element);
      expect(radius).not.toBeNull();
      expect(radius!).toBeGreaterThanOrEqual(0.05);
      expect(radius!).toBeLessThanOrEqual(1.47);
    }
    // Endpoints stay untouched.
    expect(radiusOf(result.path.path_elements[0])).toBeNull();
    expect(radiusOf(result.path.path_elements[4])).toBeNull();
  });

  it("seeds from the incoming leg even when the outgoing leg is shorter", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 3, y_meters: 0 }),
        createTranslationTarget({ x_meters: 3, y_meters: 2.5 }),
      ],
    });

    // The 3 m incoming leg provides the trigger approach: 49% is 1.47 m.
    const result = seedHandoffRadii(path);
    expect(radiusOf(result.path.path_elements[1])).toBeCloseTo(1.47, 3);
  });

  it("never rewrites manual or untagged-but-set radii", () => {
    const path = openPath();
    const pinned = path.path_elements[2];
    path.path_elements[2] =
      pinned.type === "translation"
        ? { ...pinned, intermediate_handoff_radius_meters: 0.2 }
        : pinned;

    const result = seedHandoffRadii(path);
    expect(result.seededElementIndexes).toEqual([3]);
    expect(radiusOf(result.path.path_elements[2])).toBeCloseTo(0.2, 9);
    expect(getHandoffRadiusSource(result.path.path_elements[2])).toBeNull();
  });

  it("reseeds anchors already tagged auto", () => {
    const first = seedHandoffRadii(openPath());
    const again = seedHandoffRadii(first.path);
    expect(again.seededElementIndexes).toEqual([2, 3]);
  });

  it("does not treat neighboring trigger radii as two ends of one fillet", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 1.2,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.9,
        }),
        createTranslationTarget({ x_meters: 1.2, y_meters: 1.2 }),
        createTranslationTarget({ x_meters: 3.4, y_meters: 1.2 }),
      ],
    });

    const result = seedHandoffRadii(path);
    expect(result.seededElementIndexes).toEqual([2]);
    expect(radiusOf(result.path.path_elements[1])).toBeCloseTo(0.9, 9);
    const seeded = radiusOf(result.path.path_elements[2]);
    expect(seeded).not.toBeNull();
    expect(seeded).toBeCloseTo(0.49 * 1.2, 9);
  });

  it("returns the path unchanged when nothing is seedable", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({
          x_meters: 2,
          y_meters: 1,
          intermediate_handoff_radius_meters: 0.3,
        }),
        createTranslationTarget({ x_meters: 4, y_meters: 0 }),
      ],
    });

    const result = seedHandoffRadii(path);
    expect(result.seededElementIndexes).toEqual([]);
    expect(result.path).toBe(path);
  });
});

describe("seedableHandoffElementIndexes", () => {
  it("lists interior anchors the optimizer may own", () => {
    expect(seedableHandoffElementIndexes(openPath().path_elements)).toEqual([
      2, 3,
    ]);
  });
});

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
  setHandoffRadiusSource,
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
  it("seeds the first and eligible interior anchors and tags them auto", () => {
    const result = seedHandoffRadii(openPath());

    expect(result.seededElementIndexes).toEqual([0, 2, 3]);
    for (const index of result.seededElementIndexes) {
      const element = result.path.path_elements[index];
      expect(getHandoffRadiusSource(element)).toBe("auto");
      const radius = radiusOf(element);
      expect(radius).not.toBeNull();
      expect(radius!).toBeGreaterThanOrEqual(0.05);
      expect(radius!).toBeLessThanOrEqual(1.47);
    }
    expect(radiusOf(result.path.path_elements[0])).toBe(0.45);
    // The final endpoint stays untouched.
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
    expect(result.seededElementIndexes).toEqual([0, 3]);
    expect(radiusOf(result.path.path_elements[2])).toBeCloseTo(0.2, 9);
    expect(getHandoffRadiusSource(result.path.path_elements[2])).toBeNull();
  });

  it("reseeds anchors already tagged auto", () => {
    const first = seedHandoffRadii(openPath());
    const again = seedHandoffRadii(first.path);
    expect(again.seededElementIndexes).toEqual([0, 2, 3]);
  });

  it("uses exactly 0.45 meters for first translation and waypoint anchors", () => {
    for (const first of [
      createTranslationTarget({ x_meters: 0, y_meters: 0 }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 0,
          y_meters: 0,
        }),
      }),
    ]) {
      const result = seedHandoffRadii(
        createPathModel({
          path_elements: [
            first,
            createTranslationTarget({ x_meters: 2, y_meters: 0 }),
          ],
        }),
      );
      expect(result.seededElementIndexes).toEqual([0]);
      expect(radiusOf(result.path.path_elements[0])).toBe(0.45);
      expect(getHandoffRadiusSource(result.path.path_elements[0])).toBe("auto");
      expect(radiusOf(result.path.path_elements[1])).toBeNull();
    }
  });

  it("applies the first-anchor rule to a one-anchor Path", () => {
    const result = seedHandoffRadii(
      createPathModel({
        path_elements: [createTranslationTarget({ x_meters: 0, y_meters: 0 })],
      }),
    );

    expect(result.seededElementIndexes).toEqual([0]);
    expect(radiusOf(result.path.path_elements[0])).toBe(0.45);
  });

  it("resets an auto-owned first radius but preserves manual-null ownership", () => {
    const autoFirst = setHandoffRadiusSource(
      createTranslationTarget({
        x_meters: 0,
        y_meters: 0,
        intermediate_handoff_radius_meters: 0.2,
      }),
      "auto",
    );
    const manualNullFirst = setHandoffRadiusSource(
      createTranslationTarget({ x_meters: 0, y_meters: 0 }),
      "manual",
    );
    const endpoint = createTranslationTarget({ x_meters: 2, y_meters: 0 });

    const autoResult = seedHandoffRadii(
      createPathModel({ path_elements: [autoFirst, endpoint] }),
    );
    const manualResult = seedHandoffRadii(
      createPathModel({ path_elements: [manualNullFirst, endpoint] }),
    );

    expect(radiusOf(autoResult.path.path_elements[0])).toBe(0.45);
    expect(manualResult.seededElementIndexes).toEqual([]);
    expect(radiusOf(manualResult.path.path_elements[0])).toBeNull();
    expect(getHandoffRadiusSource(manualResult.path.path_elements[0])).toBe(
      "manual",
    );
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
    expect(result.seededElementIndexes).toEqual([0, 2]);
    expect(radiusOf(result.path.path_elements[1])).toBeCloseTo(0.9, 9);
    const seeded = radiusOf(result.path.path_elements[2]);
    expect(seeded).not.toBeNull();
    expect(seeded).toBeCloseTo(0.49 * 1.2, 9);
  });

  it("reseeds below 0.3 meters without taking manual ownership", () => {
    const atBoundary = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createTranslationTarget({ x_meters: 0.3, y_meters: 0 }),
        createTranslationTarget({ x_meters: 0.3, y_meters: 0.3 }),
      ],
    });
    const belowBoundary = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        setHandoffRadiusSource(
          createTranslationTarget({
            x_meters: 0.299,
            y_meters: 0,
            intermediate_handoff_radius_meters: 0.2,
          }),
          "auto",
        ),
        createTranslationTarget({ x_meters: 0.299, y_meters: 1 }),
      ],
    });
    const manualBelowBoundary = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        setHandoffRadiusSource(
          createTranslationTarget({
            x_meters: 0.299,
            y_meters: 0,
            intermediate_handoff_radius_meters: 0.2,
          }),
          "manual",
        ),
        createTranslationTarget({ x_meters: 0.299, y_meters: 1 }),
      ],
    });

    expect(radiusOf(seedHandoffRadii(atBoundary).path.path_elements[1])).toBe(
      0.147,
    );
    const reseeded = seedHandoffRadii(belowBoundary).path.path_elements[1];
    expect(radiusOf(reseeded)).toBe(0.147);
    expect(getHandoffRadiusSource(reseeded)).toBe("auto");
    const manual = seedHandoffRadii(manualBelowBoundary).path.path_elements[1];
    expect(radiusOf(manual)).toBe(0.2);
    expect(getHandoffRadiusSource(manual)).toBe("manual");
  });

  it.each(["translation", "waypoint"] as const)(
    "keeps %s seeds at the minimum and clears stale auto radii only when it cannot fit",
    (kind) => {
      for (const [length, expectedRadius] of [
        [0.0556, 0.05],
        [0.0555, null],
      ] as const) {
        for (const source of [null, "auto", "manual"] as const) {
          const target = createTranslationTarget({
            x_meters: length,
            intermediate_handoff_radius_meters: source === null ? null : 0.2,
          });
          const element = setHandoffRadiusSource(
            kind === "translation"
              ? target
              : createWaypoint({ translation_target: target }),
            source,
          );
          const path = createPathModel({
            path_elements: [
              createTranslationTarget(),
              element,
              createTranslationTarget({ x_meters: length, y_meters: 1 }),
            ],
          });
          const seeded = seedHandoffRadii(path).path.path_elements[1];

          expect(radiusOf(seeded)).toBe(
            source === "manual" ? 0.2 : expectedRadius,
          );
          expect(getHandoffRadiusSource(seeded)).toBe(
            source === "manual"
              ? "manual"
              : expectedRadius === null
                ? null
                : "auto",
          );
          expect(radiusOf(path.path_elements[1])).toBe(
            source === null ? null : 0.2,
          );
        }
      }
    },
  );

  it("returns the path unchanged when nothing is seedable", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({
          x_meters: 0,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.45,
        }),
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
  it("lists the first and interior anchors the optimizer may own", () => {
    expect(seedableHandoffElementIndexes(openPath().path_elements)).toEqual([
      0, 2, 3,
    ]);
  });
});

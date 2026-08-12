import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyGeneratedAutoRadii,
  autoRadiiCapSolveInput,
  autoHandoffRadiusElementIndexes,
  canGenerateAutoConstraints,
  clearGeneratedAutoConstraints,
  generateAutoRadiiAndCaps,
  refreshAutoRadiiAndCaps,
} from "../../../src/core/constraints/autoConstraintGeneration";
import { autoVelocitySettingsForPath } from "../../../src/core/constraints/autoVelocityApply";
import { autoHandoffRadiusObjectiveCost } from "../../../src/core/constraints/autoHandoffRadiusObjective";
import { validateAutoHandoffRadii } from "../../../src/core/constraints/autoHandoffRadiusValidation";
import {
  autoVelocityInputSignature,
  evaluateAutoHandoffRadiusObjectiveInputs,
  generateAutoVelocityProfile,
} from "../../../src/core/constraints/autoVelocityConstraints";
import { seedHandoffRadii } from "../../../src/core/bend/autoSeedHandoffRadii";
import {
  createPathModel,
  createTranslationTarget,
  getHandoffRadiusSource,
  setHandoffRadiusSource,
  type PathModel,
} from "../../../src/core/model/path";
import { deserializePath } from "../../../src/core/io/projectSerde";

function pathOf(points: Array<[number, number]>): PathModel {
  return createPathModel({
    path_elements: points.map(([x, y]) =>
      createTranslationTarget({ x_meters: x, y_meters: y }),
    ),
  });
}

function radiusAt(path: PathModel, index: number): number | null {
  const element = path.path_elements[index];
  return element.type === "translation"
    ? element.intermediate_handoff_radius_meters
    : element.type === "waypoint"
      ? element.translation_target.intermediate_handoff_radius_meters
      : null;
}

function radiusObjectiveCost(path: PathModel): number {
  return Math.min(
    ...evaluateAutoHandoffRadiusObjectiveInputs(
      path,
      {},
      {
        includeGeneratedRadiiInCacheKey: true,
      },
    ).map((evaluation) => autoHandoffRadiusObjectiveCost(evaluation)),
  );
}

/** Element 2's geometric seed clears no gate at any speed; element 1's does. */
function unhonorableCornerPath(): PathModel {
  return pathOf([
    [4.34, 0.95],
    [5.55, 0.52],
    [4.95, 1.78],
    [5.24, 3.73],
  ]);
}

const squarePath = () =>
  pathOf([
    [0, 0],
    [4, 0],
    [4, 4],
    [8, 4],
  ]);

function sharpCornerPath(): PathModel {
  const turnRadians = (149.2 * Math.PI) / 180;
  return pathOf([
    [0, 0],
    [3.65, 0],
    [3.65 + 3.78 * Math.cos(turnRadians), 3.78 * Math.sin(turnRadians)],
  ]);
}

const reversalPath = () =>
  pathOf([
    [0, 0],
    [4, 0],
    [0, 0],
  ]);

function coupledRadiusBasinPath(): PathModel {
  return pathOf([
    [5.7, 2.5],
    [7, 4],
    [14.88016, 2.7264],
    [10.9, 5.5],
  ]);
}

function candidateGapRegressionPath(): PathModel {
  const fixture = deserializePath(
    JSON.parse(
      readFileSync(
        new URL(
          "../../fixtures/simulation/auto_radius_candidate_gap.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const autoRadiusIndexes = new Set([1, 3, 5]);

  return {
    ...fixture,
    path_elements: fixture.path_elements.map((element, index) =>
      autoRadiusIndexes.has(index)
        ? setHandoffRadiusSource(element, "auto")
        : element,
    ),
    ranged_constraints: fixture.ranged_constraints.map((constraint) => ({
      ...constraint,
      source: "auto_velocity",
    })),
  };
}

function strippedCompetitionFixture(): PathModel {
  const fixture = deserializePath(
    JSON.parse(
      readFileSync(
        new URL(
          "../../fixtures/simulation/top_sweep_short_depo.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );

  return {
    ...fixture,
    path_elements: fixture.path_elements.map((element) =>
      element.type === "translation"
        ? {
            ...element,
            intermediate_handoff_radius_meters: null,
          }
        : element.type === "waypoint"
          ? {
              ...element,
              translation_target: {
                ...element.translation_target,
                intermediate_handoff_radius_meters: null,
              },
            }
          : element,
    ),
    ranged_constraints: fixture.ranged_constraints.filter(
      (constraint) => constraint.key !== "max_velocity_meters_per_sec",
    ),
  };
}

describe("handoff radius validation", () => {
  it("shrinks a seeded corner the follower cannot honor", () => {
    const seeded = seedHandoffRadii(unhonorableCornerPath());
    const validated = validateAutoHandoffRadii(seeded.path, {});

    expect(validated.shrunkElementIndexes).toContain(2);
    const seededRadius = radiusAt(seeded.path, 2) ?? 0;
    const validatedRadius = radiusAt(validated.path, 2) ?? 0;
    expect(validatedRadius).toBeLessThan(seededRadius);
    expect(validatedRadius).toBeGreaterThanOrEqual(0.05);
    // The path-level search may also improve a passing neighbor because its
    // trace and traversal time are evaluated jointly.
    expect(radiusAt(validated.path, 1)).toBeGreaterThanOrEqual(0.05);
  });

  it("descends from the geometric maximum into the measured corridor", () => {
    const seeded = seedHandoffRadii(squarePath());
    const validated = validateAutoHandoffRadii(seeded.path, {});

    expect(validated.shrunkElementIndexes).toEqual([1, 2]);
    expect(radiusAt(seeded.path, 1)).toBeCloseTo(1.96, 9);
    expect(radiusAt(validated.path, 1)).toBeLessThan(
      radiusAt(seeded.path, 1) ?? 0,
    );
    expect(radiusAt(validated.path, 2)).toBeLessThan(
      radiusAt(seeded.path, 2) ?? 0,
    );
  });

  it("never moves a pinned radius", () => {
    const seeded = seedHandoffRadii(unhonorableCornerPath());
    const pinned = {
      ...seeded.path,
      path_elements: seeded.path.path_elements.map((element, index) =>
        index === 2 && element.type === "translation"
          ? setHandoffRadiusSource(
              { ...element, intermediate_handoff_radius_meters: 0.55 },
              "manual",
            )
          : element,
      ),
    };

    const validated = validateAutoHandoffRadii(pinned, {});

    expect(validated.shrunkElementIndexes).not.toContain(2);
    expect(radiusAt(validated.path, 2)).toBeCloseTo(0.55, 9);
    expect(getHandoffRadiusSource(validated.path.path_elements[2])).toBe(
      "manual",
    );
  });

  it("returns the same radii for the same path", () => {
    const seeded = seedHandoffRadii(unhonorableCornerPath());

    expect(validateAutoHandoffRadii(seeded.path, {}).path).toEqual(
      validateAutoHandoffRadii(seeded.path, {}).path,
    );
  });
});

describe("auto constraint generation", () => {
  it("generates handoff radii and the caps solved for them", () => {
    const path = squarePath();
    expect(canGenerateAutoConstraints(path)).toBe(true);

    const generated = generateAutoRadiiAndCaps(path, {});

    expect(autoHandoffRadiusElementIndexes(generated.path_elements)).toEqual([
      1, 2,
    ]);
    expect(radiusAt(generated, 1)).toBeGreaterThan(0);
    expect(
      generated.ranged_constraints.some(
        (constraint) => constraint.source === "auto_velocity",
      ),
    ).toBe(true);
  });

  it("balances sharp-corner time against measured trace fidelity", () => {
    const generated = generateAutoRadiiAndCaps(sharpCornerPath(), {});
    const profile = generateAutoVelocityProfile(generated, {});
    const legacyRadiusPath = {
      ...sharpCornerPath(),
      path_elements: sharpCornerPath().path_elements.map((element, index) =>
        index === 1 && element.type === "translation"
          ? setHandoffRadiusSource(
              { ...element, intermediate_handoff_radius_meters: 0.217 },
              "manual",
            )
          : element,
      ),
    };
    const legacyProfile = generateAutoVelocityProfile(
      generateAutoRadiiAndCaps(legacyRadiusPath, {}),
      {},
    );

    expect(radiusAt(generated, 1)).toBeGreaterThan(0.05);
    expect(profile.diagnostics.totalTimeS).toBeLessThan(
      legacyProfile.diagnostics.totalTimeS,
    );
    expect(profile.diagnostics.maxCorridorDeviationRatio).toBeLessThanOrEqual(
      1,
    );
    expect(
      profile.diagnostics.handoffs[0]?.corridorDeviationMeters,
    ).toBeLessThanOrEqual(0.26);
  });

  it("limits early handoff on a reversal despite its shared corridor", () => {
    const generated = generateAutoRadiiAndCaps(reversalPath(), {});
    const profile = generateAutoVelocityProfile(generated, {});

    expect(radiusAt(generated, 1)).toBeGreaterThanOrEqual(0.5);
    expect(radiusAt(generated, 1)).toBeLessThanOrEqual(0.9);
    expect(
      profile.diagnostics.handoffs[0]?.corridorDeviationMeters,
    ).toBeLessThanOrEqual(
      profile.diagnostics.handoffs[0]?.corridorToleranceMeters ?? 0,
    );
    expect(
      profile.diagnostics.handoffs[0]?.overshootErrorMeters,
    ).toBeLessThanOrEqual(
      profile.diagnostics.handoffs[0]?.overshootToleranceMeters ?? 0,
    );
    expect(
      profile.diagnostics.handoffs[0]?.earlyHandoffRatio,
    ).toBeLessThanOrEqual(0.2);
  });

  it("escapes a coupled minimum-radius basin before coordinate refinement", () => {
    const generated = generateAutoRadiiAndCaps(coupledRadiusBasinPath(), {});
    const profile = generateAutoVelocityProfile(generated, {});

    expect(radiusAt(generated, 1)).toBeGreaterThan(0.2);
    expect(radiusAt(generated, 2)).toBeGreaterThan(0.4);
    expect(profile.diagnostics.totalTimeS).toBeLessThan(6);
    expect(
      profile.diagnostics.handoffs.every(
        (handoff) => !handoff.skippedOutgoingSegment,
      ),
    ).toBe(true);
    expect(profile.diagnostics.maxHandoffErrorRatio).toBeLessThan(1.05);
    expect(profile.diagnostics.maxCorridorDeviationRatio).toBeLessThan(1);
  });

  it("refines a skipped interval instead of stranding a valid radius at the floor", () => {
    const original = candidateGapRegressionPath();
    const validated = validateAutoHandoffRadii(original, {});
    const profile = generateAutoVelocityProfile(validated.path, {});

    expect(radiusAt(validated.path, 3)).toBeGreaterThanOrEqual(0.1);
    expect(radiusAt(validated.path, 3)).toBeLessThanOrEqual(0.45);
    expect(radiusObjectiveCost(validated.path)).toBeLessThan(
      radiusObjectiveCost(original),
    );
    expect(
      profile.diagnostics.handoffs.every((handoff) => handoff.passed),
    ).toBe(true);
  });

  it("keeps the dense competition fixture inside its measured corridor", () => {
    const config = {
      default_max_velocity_meters_per_sec: 4.5,
      default_max_acceleration_meters_per_sec2: 12,
      default_intermediate_handoff_radius_meters: 0.25,
      default_max_velocity_deg_per_sec: 720,
      default_max_acceleration_deg_per_sec2: 2000,
    };
    const generated = generateAutoRadiiAndCaps(
      strippedCompetitionFixture(),
      config,
    );
    const profile = generateAutoVelocityProfile(generated, config);
    const generatedRadii = autoHandoffRadiusElementIndexes(
      generated.path_elements,
    ).map((index) => radiusAt(generated, index) ?? 0);

    // One interior run is effectively collinear, so fourteen of the fifteen
    // interior anchors carry a meaningful generated corner radius.
    expect(generatedRadii).toHaveLength(14);
    expect(generatedRadii.every((radius) => radius >= 0.05)).toBe(true);
    expect(profile.diagnostics.reachedEnd).toBe(true);
    expect(profile.diagnostics.maxCorridorDeviationRatio).toBeLessThanOrEqual(
      1,
    );
    expect(
      profile.diagnostics.handoffs.every((handoff) => handoff.passed),
    ).toBe(true);
  }, 15_000);

  it("refreshes only a path that already carries generated values", () => {
    const path = squarePath();
    expect(refreshAutoRadiiAndCaps(path, {})).toBe(path);

    const generated = generateAutoRadiiAndCaps(path, {});
    // Deterministic and idempotent: the sync applies this to its own output.
    expect(refreshAutoRadiiAndCaps(generated, {})).toEqual(generated);
  });

  it("regenerates radii and caps after the geometry moves", () => {
    const generated = generateAutoRadiiAndCaps(
      pathOf([
        [0, 0],
        [1, 0],
        [1.6, 0.8],
        [3, 0.8],
      ]),
      {},
    );
    const moved = {
      ...generated,
      path_elements: generated.path_elements.map((element, index) =>
        index === 1 && element.type === "translation"
          ? { ...element, x_meters: 0.6 }
          : element,
      ),
    };

    const refreshed = refreshAutoRadiiAndCaps(moved, {});

    expect(radiusAt(refreshed, 1)).toBeLessThan(radiusAt(generated, 1) ?? 0);
    expect(getHandoffRadiusSource(refreshed.path_elements[1])).toBe("auto");
  });

  it("keeps generated radii out of the input signature", () => {
    const generated = generateAutoRadiiAndCaps(squarePath(), {});
    const nudged = {
      ...generated,
      path_elements: generated.path_elements.map((element, index) =>
        index === 1 && element.type === "translation"
          ? { ...element, intermediate_handoff_radius_meters: 0.21 }
          : element,
      ),
    };
    const pinned = {
      ...generated,
      path_elements: generated.path_elements.map((element, index) =>
        index === 1 ? setHandoffRadiusSource(element, "manual") : element,
      ),
    };

    expect(autoVelocityInputSignature(nudged, {}, {})).toBe(
      autoVelocityInputSignature(generated, {}, {}),
    );
    // Candidate evaluation opts into the generated value because it compares
    // multiple radii carrying the same Auto ownership marker.
    expect(
      autoVelocityInputSignature(
        nudged,
        {},
        {
          includeGeneratedRadiiInCacheKey: true,
        },
      ),
    ).not.toBe(
      autoVelocityInputSignature(
        generated,
        {},
        {
          includeGeneratedRadiiInCacheKey: true,
        },
      ),
    );
    // Pinning is an input change, so the caps become stale.
    expect(autoVelocityInputSignature(pinned, {}, {})).not.toBe(
      autoVelocityInputSignature(generated, {}, {}),
    );
  });

  it("applies radii solved elsewhere as generated values", () => {
    const applied = applyGeneratedAutoRadii(squarePath(), [
      { elementIndex: 1, radiusMeters: 0.31 },
    ]);

    expect(radiusAt(applied, 1)).toBeCloseTo(0.31, 9);
    expect(getHandoffRadiusSource(applied.path_elements[1])).toBe("auto");
  });

  it("carries a generated-radius clear across the worker assignment seam", () => {
    const straight = pathOf([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    straight.path_elements[1] = setHandoffRadiusSource(
      createTranslationTarget({
        x_meters: 1,
        y_meters: 0,
        intermediate_handoff_radius_meters: 0.3,
      }),
      "auto",
    );

    const solved = autoRadiiCapSolveInput(
      straight,
      {},
      autoVelocitySettingsForPath(straight, {}),
    );
    const applied = applyGeneratedAutoRadii(straight, solved.radii);

    expect(solved.radii).toContainEqual({
      elementIndex: 1,
      radiusMeters: null,
    });
    expect(radiusAt(applied, 1)).toBeNull();
    expect(getHandoffRadiusSource(applied.path_elements[1])).toBeNull();
  });

  it("does not let a stale clear erase a manually pinned radius", () => {
    const square = squarePath();
    square.path_elements[1] = setHandoffRadiusSource(
      createTranslationTarget({
        x_meters: 4,
        y_meters: 0,
        intermediate_handoff_radius_meters: 0.4,
      }),
      "manual",
    );

    const applied = applyGeneratedAutoRadii(square, [
      { elementIndex: 1, radiusMeters: null },
    ]);

    expect(radiusAt(applied, 1)).toBe(0.4);
    expect(getHandoffRadiusSource(applied.path_elements[1])).toBe("manual");
  });

  it("clears generated values and keeps pinned ones", () => {
    const generated = generateAutoRadiiAndCaps(squarePath(), {});
    const withPin = {
      ...generated,
      path_elements: generated.path_elements.map((element, index) =>
        index === 2 ? setHandoffRadiusSource(element, "manual") : element,
      ),
    };
    const pinnedRadius = radiusAt(withPin, 2);

    const cleared = clearGeneratedAutoConstraints(withPin);

    expect(radiusAt(cleared, 1)).toBeNull();
    expect(getHandoffRadiusSource(cleared.path_elements[1])).toBeNull();
    expect(radiusAt(cleared, 2)).toBe(pinnedRadius);
    expect(getHandoffRadiusSource(cleared.path_elements[2])).toBe("manual");
    expect(
      cleared.ranged_constraints.some(
        (constraint) => constraint.source === "auto_velocity",
      ),
    ).toBe(false);
  });

  it("reports a fully pinned path as nothing to generate", () => {
    const generated = generateAutoRadiiAndCaps(squarePath(), {});
    const pinned = {
      ...generated,
      path_elements: generated.path_elements.map((element) =>
        setHandoffRadiusSource(element, "manual"),
      ),
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec" as const,
          value: 2,
          start_ordinal: 1,
          end_ordinal: 4,
        },
      ],
    };

    expect(canGenerateAutoConstraints(pinned)).toBe(false);
  });
});

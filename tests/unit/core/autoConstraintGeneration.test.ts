import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyGeneratedAutoRadii,
  autoHandoffRadiusElementIndexes,
  autoRadiiCapSolveInput,
  canGenerateAutoConstraints,
  clearGeneratedAutoConstraints,
} from "../../../src/core/constraints/autoConstraintGeneration";
import { autoVelocitySettingsForPath } from "../../../src/core/constraints/autoVelocityApply";
import { autoVelocityInputSignature } from "../../../src/core/constraints/autoVelocityConstraints";
import { deserializePath } from "../../../src/core/io/projectSerde";
import {
  createPathModel,
  createTranslationTarget,
  getHandoffRadiusSource,
  setHandoffRadiusSource,
  type PathModel,
} from "../../../src/core/model/path";

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

function solveInput(
  path: PathModel,
  config: Parameters<typeof autoRadiiCapSolveInput>[1] = {},
) {
  return autoRadiiCapSolveInput(
    path,
    config,
    autoVelocitySettingsForPath(path, config),
  );
}

const squarePath = () =>
  pathOf([
    [0, 0],
    [4, 0],
    [4, 4],
    [8, 4],
  ]);

function withGeneratedRadii(path: PathModel): PathModel {
  return {
    ...path,
    path_elements: path.path_elements.map((element, index) =>
      index > 0 &&
      index < path.path_elements.length - 1 &&
      element.type === "translation"
        ? setHandoffRadiusSource(
            { ...element, intermediate_handoff_radius_meters: 0.3 },
            "auto",
          )
        : element,
    ),
  };
}

function sharpCornerPath(): PathModel {
  const turnRadians = (149.2 * Math.PI) / 180;
  return pathOf([
    [0, 0],
    [3.65, 0],
    [3.65 + 3.78 * Math.cos(turnRadians), 3.78 * Math.sin(turnRadians)],
  ]);
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
        ? { ...element, intermediate_handoff_radius_meters: null }
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

describe("auto constraint generation", () => {
  it("retains the sharp-corner radius and measured-fidelity policy", () => {
    const solved = solveInput(sharpCornerPath());
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
    const legacy = solveInput(legacyRadiusPath);

    expect(radiusAt(solved.path, 1)).toBeGreaterThan(0.05);
    expect(solved.profile.diagnostics.totalTimeS).toBeLessThan(
      legacy.profile.diagnostics.totalTimeS,
    );
    expect(
      solved.profile.diagnostics.maxCorridorDeviationRatio,
    ).toBeLessThanOrEqual(1);
    expect(
      solved.profile.diagnostics.handoffs[0]?.corridorDeviationMeters,
    ).toBeLessThanOrEqual(0.26);
  });

  it("retains the reversal radius and handoff-safety policy", () => {
    const solved = solveInput(
      pathOf([
        [0, 0],
        [4, 0],
        [0, 0],
      ]),
    );
    const handoff = solved.profile.diagnostics.handoffs[0];

    expect(radiusAt(solved.path, 1)).toBeGreaterThanOrEqual(0.5);
    expect(radiusAt(solved.path, 1)).toBeLessThanOrEqual(0.9);
    expect(handoff?.earlyHandoffRatio).toBeLessThanOrEqual(0.2);
    expect(handoff?.corridorDeviationMeters).toBeLessThanOrEqual(
      handoff?.corridorToleranceMeters ?? 0,
    );
    expect(handoff?.overshootErrorMeters).toBeLessThanOrEqual(
      handoff?.overshootToleranceMeters ?? 0,
    );
  });

  it("retains the coupled minimum-radius basin policy", () => {
    const solved = solveInput(
      pathOf([
        [5.7, 2.5],
        [7, 4],
        [14.88016, 2.7264],
        [10.9, 5.5],
      ]),
    );

    expect(radiusAt(solved.path, 1)).toBeGreaterThan(0.2);
    expect(radiusAt(solved.path, 2)).toBeGreaterThan(0.4);
    expect(solved.profile.diagnostics.totalTimeS).toBeLessThan(6);
    expect(
      solved.profile.diagnostics.handoffs.every(
        (handoff) => !handoff.skippedOutgoingSegment,
      ),
    ).toBe(true);
    expect(solved.profile.diagnostics.maxHandoffErrorRatio).toBeLessThan(1.05);
    expect(solved.profile.diagnostics.maxCorridorDeviationRatio).toBeLessThan(
      1,
    );
  });

  it("retains the real competition-path radius and corridor policy", () => {
    const config = {
      default_max_velocity_meters_per_sec: 4.5,
      default_max_acceleration_meters_per_sec2: 12,
      default_intermediate_handoff_radius_meters: 0.25,
      default_max_velocity_deg_per_sec: 720,
      default_max_acceleration_deg_per_sec2: 2000,
    };
    const solved = solveInput(strippedCompetitionFixture(), config);
    const generatedRadii = autoHandoffRadiusElementIndexes(
      solved.path.path_elements,
    ).map((index) => radiusAt(solved.path, index) ?? 0);

    expect(generatedRadii).toHaveLength(14);
    expect(generatedRadii.every((radius) => radius >= 0.05)).toBe(true);
    expect(solved.profile.diagnostics.reachedEnd).toBe(true);
    expect(
      solved.profile.diagnostics.maxCorridorDeviationRatio,
    ).toBeLessThanOrEqual(1);
    expect(
      solved.profile.diagnostics.handoffs.every((handoff) => handoff.passed),
    ).toBe(true);
  }, 15_000);

  it("keeps generated radii out of the input signature", () => {
    const generated = withGeneratedRadii(squarePath());
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
    const generatedRadii = withGeneratedRadii(squarePath());
    const generated = {
      ...generatedRadii,
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec" as const,
          value: 2,
          start_ordinal: 1,
          end_ordinal: 4,
          source: "auto_velocity" as const,
          auto_velocity: null,
        },
      ],
    };
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
    const generated = withGeneratedRadii(squarePath());
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

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { seedHandoffRadii } from "../../../src/core/bend/autoSeedHandoffRadii";
import {
  applyGeneratedAutoRadii,
  autoConstraintLargePathWarningBudget,
} from "../../../src/core/constraints/autoConstraintGeneration";
import {
  autoVelocitySettingsForPath,
  refreshAutoVelocityConstraints,
} from "../../../src/core/constraints/autoVelocityApply";
import {
  requestAutoRadiiAndCaps,
  resetAutoVelocityRunner,
  supersededAutoVelocityProfile,
} from "../../../src/platform/autoVelocityRunner";
import {
  jointAutoConstraintSearchPlan,
  preferredNearStraightHandoffRadiusMeters,
  solveJointAutoConstraints,
} from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createTranslationTarget,
  getHandoffRadiusSource,
  setHandoffRadiusSource,
  type PathModel,
} from "../../../src/core/model/path";
import { simulatePathWithTrace } from "../../../src/core/sim";

function pathOf(points: Array<[number, number]>): PathModel {
  return createPathModel({
    path_elements: points.map(([x, y]) =>
      createTranslationTarget({ x_meters: x, y_meters: y }),
    ),
  });
}

async function generatePersistedPolicy(
  path: PathModel,
  config: Parameters<typeof requestAutoRadiiAndCaps>[1] = {},
): Promise<PathModel> {
  const settings = autoVelocitySettingsForPath(path, config);
  const run = await requestAutoRadiiAndCaps(path, config, settings);
  if (run === supersededAutoVelocityProfile) {
    throw new Error("Expected the live generation request to complete");
  }
  return refreshAutoVelocityConstraints(
    applyGeneratedAutoRadii(path, run.radii),
    config,
    { whenPresentOnly: false, settings },
  );
}

afterEach(() => resetAutoVelocityRunner());

function generatedRadii(path: PathModel): number[] {
  return path.path_elements.flatMap((element) => {
    if (element.type === "translation") {
      return element.intermediate_handoff_radius_meters ?? [];
    }
    return element.type === "waypoint"
      ? (element.translation_target.intermediate_handoff_radius_meters ?? [])
      : [];
  });
}

// These basin-regression fixtures were captured against the original policy.
// Pin its factors so changing application defaults does not silently redefine
// the objective that the fixtures are intended to hold constant.
const basinRegressionConfig = {
  kinematic_constraints: {
    default_auto_velocity_velocity_safety_factor: 0.9,
    default_auto_velocity_acceleration_safety_factor: 0.8,
  },
};

describe("solveJointAutoConstraints", () => {
  it("prefers larger near-straight radii as velocity rises", () => {
    const tenDegreeTurn = (10 * Math.PI) / 180;

    expect(
      preferredNearStraightHandoffRadiusMeters(tenDegreeTurn, 2, 2),
    ).toBeCloseTo(0.3, 9);
    expect(
      preferredNearStraightHandoffRadiusMeters(tenDegreeTurn, 4, 2),
    ).toBeCloseTo(0.32, 9);
    expect(
      preferredNearStraightHandoffRadiusMeters(tenDegreeTurn, 4.5, 2),
    ).toBeCloseTo(0.36, 9);
  });

  it("clamps the near-straight preference to a short incoming leg", () => {
    expect(
      preferredNearStraightHandoffRadiusMeters((10 * Math.PI) / 180, 4.5, 0.2),
    ).toBeCloseTo(0.18, 9);
  });

  it("smoothly fades the near-straight preference into the generic target", () => {
    const at15Degrees = preferredNearStraightHandoffRadiusMeters(
      (15 * Math.PI) / 180,
      4.5,
      2,
    );
    const at37Degrees = preferredNearStraightHandoffRadiusMeters(
      (37.5 * Math.PI) / 180,
      4.5,
      2,
    );
    const at60Degrees = preferredNearStraightHandoffRadiusMeters(
      (60 * Math.PI) / 180,
      4.5,
      2,
    );

    expect(at15Degrees).toBeCloseTo(0.36, 9);
    expect(at37Degrees).toBeCloseTo(0.305, 9);
    expect(at60Degrees).toBeCloseTo(0.25, 9);
    expect(at15Degrees).toBeGreaterThan(at37Degrees);
    expect(at37Degrees).toBeGreaterThan(at60Degrees);
  });

  it("applies the near-straight preference in a complete production solve", () => {
    const path = pathOf([
      [0, 0],
      [2, 0],
      [4, 0.35],
    ]);

    const lowSpeed = solveJointAutoConstraints(seedHandoffRadii(path).path, {
      kinematic_constraints: {
        default_max_velocity_meters_per_sec: 2,
        default_max_acceleration_meters_per_sec2: 12,
      },
    });
    const highSpeed = solveJointAutoConstraints(
      seedHandoffRadii(path).path,
      {},
    );
    const lowSpeedRadius = generatedRadii(lowSpeed.path)[0];
    const highSpeedRadius = generatedRadii(highSpeed.path)[0];

    expect(lowSpeed.status).toBe("valid");
    expect(highSpeed.status).toBe("valid");
    expect(highSpeed.profile.diagnostics.reachedEnd).toBe(true);
    expect(lowSpeedRadius).toBeGreaterThanOrEqual(0.29);
    expect(highSpeedRadius).toBeGreaterThanOrEqual(lowSpeedRadius ?? 0);
  });

  it("solves coupled handoff radii and adjacent velocity caps as one bounded policy", () => {
    const path = pathOf([
      [5.7, 2.5],
      [7, 4],
      [14.88016, 2.7264],
      [10.9, 5.5],
    ]);
    const seeded = seedHandoffRadii(path).path;

    const result = solveJointAutoConstraints(seeded, {});

    expect(result.status).toBe("valid");
    expect(result.profile.diagnostics.reachedEnd).toBe(true);
    expect(
      result.profile.diagnostics.handoffs.every(
        (handoff) => handoff.passed && !handoff.skippedOutgoingSegment,
      ),
    ).toBe(true);
    expect(result.profile.segmentCaps).toHaveLength(4);
    expect(result.stats.searchableBlocks).toBe(2);
    expect(result.stats.evaluationBudget).toBe(8_000);
    expect(result.stats.evaluations).toBeLessThanOrEqual(
      result.stats.evaluationBudget,
    );
    expect(result.stats.genericEvaluations).toBeGreaterThanOrEqual(8);
    expect(["converged", "evaluation-budget"]).toContain(
      result.stats.terminationReason,
    );
  });

  it("scales without a global cap so every large-path block gets both passes", () => {
    const path = pathOf(
      Array.from({ length: 50 }, (_, index) => [
        index,
        index % 2 === 0 ? 0 : 1,
      ]),
    );
    const seeded = seedHandoffRadii(path).path;

    const plan = jointAutoConstraintSearchPlan(seeded, {});

    expect(plan.searchableBlocks).toBe(48);
    expect(plan.evaluationBudget).toBe(18_052);
    expect(plan.evaluationBudget).toBeGreaterThan(512);
  });

  it("warns only beyond the normal fully searchable 16-anchor workload", () => {
    const planFor = (anchorCount: number) => {
      const path = pathOf(
        Array.from({ length: anchorCount }, (_, index): [number, number] => [
          index,
          index % 2 === 0 ? 0 : 1,
        ]),
      );
      return jointAutoConstraintSearchPlan(seedHandoffRadii(path).path, {});
    };

    expect(planFor(16).evaluationBudget).toBe(
      autoConstraintLargePathWarningBudget,
    );
    expect(planFor(17).evaluationBudget).toBeGreaterThan(
      autoConstraintLargePathWarningBudget,
    );
  });

  it("is independent of generated values from a previous solve", () => {
    const corpus = JSON.parse(
      readFileSync(
        new URL(
          "../../fixtures/simulation/auto_joint_reference_corpus.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { paths: Array<{ points: Array<[number, number]> }> };
    const geometric = seedHandoffRadii(pathOf(corpus.paths[1]!.points)).path;
    const first = solveJointAutoConstraints(geometric, {});
    const refreshed = solveJointAutoConstraints(first.path, {});

    expect(generatedRadii(refreshed.path)).toEqual(generatedRadii(first.path));
    expect(refreshed.profile.segmentCaps).toEqual(first.profile.segmentCaps);
  }, 30_000);

  it("keeps remote radii stable for a local Path 2 endpoint edit", () => {
    const corpus = JSON.parse(
      readFileSync(
        new URL(
          "../../fixtures/simulation/auto_joint_reference_corpus.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { paths: Array<{ points: Array<[number, number]> }> };
    const points = corpus.paths[1]!.points;
    const editedPoints = points.map(([x, y], index): [number, number] =>
      index === points.length - 1 ? [x + 0.2, y] : [x, y],
    );
    const base = solveJointAutoConstraints(
      seedHandoffRadii(pathOf(points)).path,
      basinRegressionConfig,
    );
    const edited = solveJointAutoConstraints(
      seedHandoffRadii(pathOf(editedPoints)).path,
      basinRegressionConfig,
    );

    const baseRadii = generatedRadii(base.path).slice(0, -2);
    const editedRadii = generatedRadii(edited.path).slice(0, -2);
    expect(editedRadii.slice(0, 8)).toEqual(baseRadii.slice(0, 8));
    expect(
      Math.max(
        ...editedRadii.map((radius, index) =>
          Math.abs(radius - (baseRadii[index] ?? radius)),
        ),
      ),
    ).toBeLessThan(0.2);
  }, 30_000);

  it("recovers the supplied complex path when local search is best-effort", () => {
    const corpus = JSON.parse(
      readFileSync(
        new URL(
          "../../fixtures/simulation/auto_joint_reference_corpus.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { paths: Array<{ points: Array<[number, number]> }> };
    const result = solveJointAutoConstraints(
      seedHandoffRadii(pathOf(corpus.paths[3]!.points)).path,
      basinRegressionConfig,
    );

    expect(result.status).toBe("valid");
    expect(result.stats.algorithm).toBe("interactive-global");
    expect(["converged", "global-recovery"]).toContain(
      result.stats.terminationReason,
    );
    expect(result.stats.evaluations).toBeLessThanOrEqual(
      result.stats.evaluationBudget,
    );
  }, 30_000);

  it("keeps a straight-through anchor canonical instead of inventing a tiny corner", () => {
    const path = pathOf([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);

    const result = solveJointAutoConstraints(seedHandoffRadii(path).path, {});

    expect(result.status).toBe("valid");
    expect(result.profile.corners).toHaveLength(0);
    expect(result.path.path_elements[1]).toMatchObject({
      intermediate_handoff_radius_meters: null,
    });
    expect(result.profile.segmentCaps.slice(1).map((cap) => cap.value)).toEqual(
      [
        result.profile.usableMaxVelocityMps,
        result.profile.usableMaxVelocityMps,
      ],
    );
    expect(result.profile.diagnostics.reachedEnd).toBe(true);
  });

  it("clears a stale generated radius when its corner becomes straight", () => {
    const path = pathOf([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    path.path_elements[1] = setHandoffRadiusSource(
      createTranslationTarget({
        x_meters: 1,
        y_meters: 0,
        intermediate_handoff_radius_meters: 0.3,
      }),
      "auto",
    );

    const seeded = seedHandoffRadii(path).path;

    expect(seeded.path_elements[1]).toMatchObject({
      intermediate_handoff_radius_meters: null,
    });
    expect(getHandoffRadiusSource(seeded.path_elements[1])).toBeNull();
  });

  it("reports an unset corner whose incoming leg cannot fit the radius lattice", () => {
    const path = pathOf([
      [0, 0],
      [0.04, 0],
      [0.04, 1],
    ]);

    const result = solveJointAutoConstraints(seedHandoffRadii(path).path, {});

    expect(result.status).toBe("unsolvable");
    expect(result.path.path_elements[1]).toMatchObject({
      intermediate_handoff_radius_meters: null,
    });
  });

  it("preserves manual radius and velocity pins while solving neighboring coordinates", () => {
    const path = pathOf([
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ]);
    path.path_elements[1] = setHandoffRadiusSource(
      createTranslationTarget({
        x_meters: 1,
        y_meters: 0,
        intermediate_handoff_radius_meters: 0.3,
      }),
      "manual",
    );
    path.ranged_constraints = [
      {
        key: "max_velocity_meters_per_sec",
        value: 1.5,
        start_ordinal: 2,
        end_ordinal: 2,
      },
    ];

    const result = solveJointAutoConstraints(seedHandoffRadii(path).path, {});

    expect(result.path.path_elements[1]).toMatchObject({
      intermediate_handoff_radius_meters: 0.3,
    });
    expect(getHandoffRadiusSource(result.path.path_elements[1])).toBe("manual");
    expect(
      result.profile.segmentCaps.find((cap) => cap.targetOrdinal === 2)?.value,
    ).toBe(1.5);
    expect(result.status).toBe("valid");
  });

  it("returns the same persisted policy for identical inputs", () => {
    const seeded = seedHandoffRadii(
      pathOf([
        [0, 0],
        [1.4, 0],
        [1.4, 1.1],
        [2.8, 1.1],
      ]),
    ).path;

    expect(solveJointAutoConstraints(seeded, {})).toEqual(
      solveJointAutoConstraints(seeded, {}),
    );
  });

  it("produces a persisted policy that the production simulator completes", async () => {
    const path = pathOf([
      [0, 0],
      [1.4, 0],
      [1.4, 1.2],
      [2.8, 1.2],
      [2.8, 2.4],
    ]);

    const generated = await generatePersistedPolicy(path);
    const trace = simulatePathWithTrace(generated, {}, { dt_s: 0.02 });
    const lastSample = trace.trace.at(-1);

    expect(lastSample?.target_anchor_ordinal_1b).toBe(5);
    expect(lastSample?.global_s_m).toBeGreaterThanOrEqual(5.19);
    expect(
      trace.trace.every((sample) => Number.isFinite(sample.speed_mps)),
    ).toBe(true);
    expect(
      generated.ranged_constraints.some(
        (constraint) => constraint.source === "auto_velocity",
      ),
    ).toBe(true);
  });

  it("keeps a manual 0.05 meter straight trigger executable at runtime", async () => {
    const path = pathOf([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    path.path_elements[1] = setHandoffRadiusSource(
      createTranslationTarget({
        x_meters: 1,
        y_meters: 0,
        intermediate_handoff_radius_meters: 0.05,
      }),
      "manual",
    );

    const generated = await generatePersistedPolicy(path);
    const trace = simulatePathWithTrace(generated, {}, { dt_s: 0.02 });

    expect(trace.trace.at(-1)?.global_s_m).toBeGreaterThanOrEqual(1.98);
    expect(generated.path_elements[1]).toMatchObject({
      intermediate_handoff_radius_meters: 0.05,
    });
    expect(
      generated.ranged_constraints.some(
        (constraint) => constraint.source === "auto_velocity",
      ),
    ).toBe(true);
  });
});

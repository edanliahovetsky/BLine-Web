import { afterEach, describe, expect, it } from "vitest";
import {
  applyGeneratedAutoRadii,
  autoHandoffRadiusElementIndexes,
  autoRadiiCapSolveInput,
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
import { simulatePathWithTrace } from "../../../src/core/sim";
import {
  createPathModel,
  createTranslationTarget,
  createWaypoint,
  type PathModel,
} from "../../../src/core/model/path";

// Keep the core comfortably below the product's 500 ms Chromebook envelope so
// worker startup, structured cloning, rendering, and application still fit.
// CI runners are slower and noisier than the calibrated local machine.
const generationBudgetMs = process.env.CI ? 1_000 : 500;
const typicalPathBudgetMs = process.env.CI ? 1_000 : 250;
const enforceWallClockBudget =
  process.env.BLINE_ENFORCE_CONSTRAINT_PERFORMANCE === "1";

afterEach(() => resetAutoVelocityRunner());

function densePath(anchorCount: number): PathModel {
  const elements = [];
  for (let index = 0; index < anchorCount; index += 1) {
    // A weave with alternating leg lengths: dense corners plus longer runs.
    const x = 1 + index * 0.95;
    const y = 1.5 + (index % 2 === 0 ? 0 : 1.4) + (index % 3 === 0 ? 0.5 : 0);
    elements.push(
      index % 4 === 0
        ? createWaypoint({
            translation_target: createTranslationTarget({
              x_meters: x,
              y_meters: y,
            }),
          })
        : createTranslationTarget({ x_meters: x, y_meters: y }),
    );
  }
  return createPathModel({ path_elements: elements });
}

function translationOnlyPath(anchorCount: number): PathModel {
  const elements = [];
  for (let index = 0; index < anchorCount; index += 1) {
    const x = 1 + index * 0.95;
    const y = 1.5 + (index % 2 === 0 ? 0 : 1.4) + (index % 3 === 0 ? 0.5 : 0);
    elements.push(createTranslationTarget({ x_meters: x, y_meters: y }));
  }
  return createPathModel({ path_elements: elements });
}

describe("constraint generation performance", () => {
  it("keeps a typical 12-anchor solve interactive while scaling larger paths", () => {
    const expectedBudgets = new Map([
      [8, 8_000],
      [12, 6_784],
      [16, 7_268],
      [20, 7_844],
      [24, 8_676],
    ]);
    for (const anchorCount of [8, 12, 16, 20, 24]) {
      const path = translationOnlyPath(anchorCount);
      const settings = autoVelocitySettingsForPath(path, {});
      const startedAt = performance.now();
      const solved = autoRadiiCapSolveInput(path, {}, settings);
      const elapsedMs = performance.now() - startedAt;

      expect(solved.stats.searchableBlocks).toBe(anchorCount - 2);
      expect(solved.stats.evaluationBudget).toBe(
        expectedBudgets.get(anchorCount),
      );
      expect(solved.stats.evaluations).toBeLessThanOrEqual(
        solved.stats.evaluationBudget,
      );
      console.info(
        `joint solve, ${anchorCount} anchors, ${solved.stats.evaluationBudget} budget: ${elapsedMs.toFixed(0)} ms`,
      );
      if (anchorCount === 12 && enforceWallClockBudget) {
        expect(elapsedMs).toBeLessThan(typicalPathBudgetMs);
      }
    }
  }, 30_000);

  it("generates radii and caps for a 16-anchor path within budget", () => {
    // Rotation is final-validation-only for this translation-policy solver;
    // both shapes must still fit the same interactive core budget.
    for (const [label, path] of [
      ["translation-only", translationOnlyPath(16)],
      ["rotation-heavy", densePath(16)],
    ] as const) {
      const settings = autoVelocitySettingsForPath(path, {});
      const startedAt = performance.now();
      const solved = autoRadiiCapSolveInput(path, {}, settings);
      const elapsedMs = performance.now() - startedAt;

      expect(
        autoHandoffRadiusElementIndexes(solved.path.path_elements).length,
      ).toBeGreaterThanOrEqual(14);
      expect(solved.profile.segmentCaps.length).toBeGreaterThan(0);

      console.info(
        `generate (seed + validate + caps), 16 anchors, ${label}: ${elapsedMs.toFixed(0)} ms`,
      );
      if (enforceWallClockBudget) {
        expect(elapsedMs).toBeLessThan(generationBudgetMs);
      }
    }
  });

  it("applies and re-simulates a live generated policy within budget", async () => {
    const path = densePath(16);
    const settings = autoVelocitySettingsForPath(path, {});
    const run = await requestAutoRadiiAndCaps(path, {}, settings);
    if (run === supersededAutoVelocityProfile) {
      throw new Error("Expected the live generation request to complete");
    }

    const applyStartedAt = performance.now();
    const generated = refreshAutoVelocityConstraints(
      applyGeneratedAutoRadii(path, run.radii),
      {},
      { whenPresentOnly: false, settings },
    );
    const applyElapsedMs = performance.now() - applyStartedAt;

    expect(
      generated.ranged_constraints.some(
        (constraint) => constraint.source === "auto_velocity",
      ),
    ).toBe(true);
    console.info(
      `apply live worker result from primed cache: ${applyElapsedMs.toFixed(1)} ms`,
    );
    if (enforceWallClockBudget) {
      expect(applyElapsedMs).toBeLessThan(generationBudgetMs);
    }

    const simulationStartedAt = performance.now();
    const result = simulatePathWithTrace(generated, {}, { dt_s: 0.02 });
    const simulationElapsedMs = performance.now() - simulationStartedAt;

    expect(result.total_time_s).toBeGreaterThan(0);
    console.info(
      `single trace simulation, 16 anchors: ${simulationElapsedMs.toFixed(1)} ms`,
    );
    // The canvas re-simulates whenever the path changes; this must stay far
    // below a 60 Hz frame budget even on CI.
    expect(simulationElapsedMs).toBeLessThan(250);
  });
});

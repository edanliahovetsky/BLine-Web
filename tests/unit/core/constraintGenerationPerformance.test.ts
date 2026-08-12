import { describe, expect, it } from "vitest";
import {
  autoHandoffRadiusElementIndexes,
  autoRadiiCapSolveInput,
  generateAutoRadiiAndCaps,
  refreshAutoRadiiAndCaps,
} from "../../../src/core/constraints/autoConstraintGeneration";
import { autoVelocitySettingsForPath } from "../../../src/core/constraints/autoVelocityApply";
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
const generationBudgetMs = process.env.CI ? 1_000 : 250;
const typicalPathBudgetMs = process.env.CI ? 1_000 : 200;

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
    for (const anchorCount of [8, 12, 16, 20, 24]) {
      const path = translationOnlyPath(anchorCount);
      const settings = autoVelocitySettingsForPath(path, {});
      const startedAt = performance.now();
      const solved = autoRadiiCapSolveInput(path, {}, settings);
      const elapsedMs = performance.now() - startedAt;

      expect(solved.stats.searchableBlocks).toBe(anchorCount - 2);
      expect(solved.stats.evaluationBudget).toBe(
        4 + 32 * (anchorCount - 2),
      );
      expect(solved.stats.evaluations).toBeLessThanOrEqual(
        solved.stats.evaluationBudget,
      );
      console.info(
        `joint solve, ${anchorCount} anchors, ${solved.stats.evaluationBudget} budget: ${elapsedMs.toFixed(0)} ms`,
      );
      if (anchorCount === 12) {
        expect(elapsedMs).toBeLessThan(typicalPathBudgetMs);
      }
    }
  });

  it("generates radii and caps for a 16-anchor path within budget", () => {
    // Rotation is final-validation-only for this translation-policy solver;
    // both shapes must still fit the same interactive core budget.
    for (const [label, path] of [
      ["translation-only", translationOnlyPath(16)],
      ["rotation-heavy", densePath(16)],
    ] as const) {
      const startedAt = performance.now();
      const generated = generateAutoRadiiAndCaps(path, {});
      const elapsedMs = performance.now() - startedAt;

      expect(
        autoHandoffRadiusElementIndexes(generated.path_elements).length,
      ).toBeGreaterThanOrEqual(14);
      expect(
        generated.ranged_constraints.some(
          (constraint) => constraint.source === "auto_velocity",
        ),
      ).toBe(true);

      console.info(
        `generate (seed + validate + caps), 16 anchors, ${label}: ${elapsedMs.toFixed(0)} ms`,
      );
      expect(elapsedMs).toBeLessThan(generationBudgetMs);
    }
  });

  it("re-simulates a generated 16-anchor path fast enough for live preview", () => {
    const generated = generateAutoRadiiAndCaps(densePath(16), {});

    const startedAt = performance.now();
    const result = simulatePathWithTrace(generated, {}, { dt_s: 0.02 });
    const elapsedMs = performance.now() - startedAt;

    expect(result.total_time_s).toBeGreaterThan(0);
    console.info(
      `single trace simulation, 16 anchors: ${elapsedMs.toFixed(1)} ms`,
    );
    // The canvas re-simulates whenever the path changes; this must stay far
    // below a 60 Hz frame budget even on CI.
    expect(elapsedMs).toBeLessThan(250);
  });

  it("refreshes an already generated 16-anchor path from cache", () => {
    const generated = generateAutoRadiiAndCaps(densePath(16), {});

    const startedAt = performance.now();
    const refreshed = refreshAutoRadiiAndCaps(generated, {});
    const elapsedMs = performance.now() - startedAt;

    // The background sync re-runs the pipeline on its own output, so the
    // cached solve has to be the cheap path.
    expect(refreshed).toEqual(generated);
    console.info(
      `refresh (cached caps), 16 anchors, rotation-heavy: ${elapsedMs.toFixed(0)} ms`,
    );
    expect(elapsedMs).toBeLessThan(generationBudgetMs);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { autoRadiiCapSolveInput } from "../../../src/core/constraints/autoConstraintGeneration";
import { autoVelocitySettingsForPath } from "../../../src/core/constraints/autoVelocityApply";
import {
  createPathModel,
  createTranslationTarget,
  type PathModel,
} from "../../../src/core/model/path";
import type { SimulationConfig } from "../../../src/core/sim/types";

interface BaselineScenario {
  name: string;
  points: Array<[number, number]>;
  legacy_completion_time_s: number;
  legacy_status?: "valid" | "best-effort";
  expected: {
    status: "valid" | "best-effort";
    completion_time_s: number;
    evaluations: number;
    budget: number;
    radii: number[];
    caps: number[];
  };
}

interface BaselineFixture {
  config: SimulationConfig;
  scenarios: BaselineScenario[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/constraints/translation_generator_baseline.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as BaselineFixture;

function pathOf(points: Array<[number, number]>): PathModel {
  return createPathModel({
    path_elements: points.map(([x, y]) =>
      createTranslationTarget({ x_meters: x, y_meters: y }),
    ),
  });
}

describe("translation generator regression corpus", () => {
  it.each(fixture.scenarios)(
    "$name remains deterministic and translation-valid",
    (scenario) => {
      const path = pathOf(scenario.points);
      const result = autoRadiiCapSolveInput(
        path,
        fixture.config,
        autoVelocitySettingsForPath(path, fixture.config),
      );

      expect(result.status).toBe(scenario.expected.status);
      expect(result.profile.diagnostics.totalTimeS).toBe(
        scenario.expected.completion_time_s,
      );
      // A previously failing policy is not a useful speed target for a valid
      // solve; short legs can now trade a little traversal time for fidelity.
      if (scenario.legacy_status !== "best-effort") {
        expect(result.profile.diagnostics.totalTimeS).toBeLessThanOrEqual(
          scenario.legacy_completion_time_s + 0.02,
        );
      }
      expect(result.stats).toMatchObject({
        evaluations: scenario.expected.evaluations,
        evaluationBudget: scenario.expected.budget,
      });
      expect(result.radii.map((assignment) => assignment.radiusMeters)).toEqual(
        scenario.expected.radii,
      );
      expect(result.profile.segmentCaps.map((cap) => cap.value)).toEqual(
        scenario.expected.caps,
      );
      expect(result.profile.diagnostics.reachedEnd).toBe(true);
      if (scenario.expected.status === "valid") {
        expect(result.stats.stabilityValidationPassed).toBe(true);
        expect(
          result.profile.diagnostics.handoffs.every(
            (handoff) => handoff.passed,
          ),
        ).toBe(true);
      }
      expect(result.radii[0]).toMatchObject({
        elementIndex: 0,
        radiusMeters: 0.45,
      });
    },
    20_000,
  );
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { autoRadiiCapSolveInput } from "../../../src/core/constraints/autoConstraintGeneration";
import { autoVelocitySettingsForPath } from "../../../src/core/constraints/autoVelocityApply";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  type PathModel,
} from "../../../src/core/model/path";
import type { SimulationConfig } from "../../../src/core/sim/types";

interface BaselineScenario {
  name: string;
  points: Array<[number, number]>;
  legacy_completion_time_s: number;
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

function pathWithRotations(
  points: Array<[number, number]>,
  rotations: number[],
): PathModel {
  return createPathModel({
    path_elements: points.flatMap(([x, y], index) => [
      createTranslationTarget({ x_meters: x, y_meters: y }),
      ...(index < points.length - 1
        ? [
            createRotationTarget({
              rotation_radians: rotations[index] ?? 0,
              t_ratio: 0.55,
              profiled_rotation: true,
            }),
          ]
        : []),
    ]),
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
      expect(result.profile.diagnostics.totalTimeS).toBeLessThanOrEqual(
        scenario.legacy_completion_time_s + 0.02,
      );
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
      expect(result.profile.diagnostics.rotationTargets).toEqual([]);
      expect(result.radii[0]).toMatchObject({
        elementIndex: 0,
        radiusMeters: 0.45,
      });
    },
    20_000,
  );

  it.each([
    {
      name: "long-straight-overlay",
      points: fixture.scenarios[0]!.points,
      rotations: [Math.PI / 2, -Math.PI / 2, Math.PI],
    },
    {
      name: "shallow-sweep-overlay",
      points: fixture.scenarios[1]!.points,
      rotations: [Math.PI / 3, -Math.PI / 2, Math.PI / 2, 0],
    },
    {
      name: "alternating-corners-overlay",
      points: fixture.scenarios[2]!.points,
      rotations: [Math.PI / 2, Math.PI, -Math.PI / 2, 0, Math.PI / 3],
    },
  ])(
    "$name reaches every fixed rotation target",
    (scenario) => {
      const path = pathWithRotations(scenario.points, scenario.rotations);
      const result = autoRadiiCapSolveInput(
        path,
        fixture.config,
        autoVelocitySettingsForPath(path, fixture.config),
      );

      expect(result.status).toBe("valid");
      expect(result.profile.diagnostics.reachedEnd).toBe(true);
      expect(result.profile.diagnostics.rotationTargets).toHaveLength(
        scenario.rotations.length,
      );
      expect(
        result.profile.diagnostics.rotationTargets.every(
          (target) => target.passed,
        ),
      ).toBe(true);
    },
    20_000,
  );
});

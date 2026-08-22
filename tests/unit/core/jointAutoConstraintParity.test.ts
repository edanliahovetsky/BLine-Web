import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seedHandoffRadii } from "../../../src/core/bend/autoSeedHandoffRadii";
import {
  jointAutoConstraintSearchPlan,
  solveJointAutoConstraints,
  solveJointAutoConstraintsReference,
} from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createTranslationTarget,
  type PathModel,
} from "../../../src/core/model/path";
import type { SimulationConfig } from "../../../src/core/sim/types";

interface GeometryCorpus {
  paths: Array<{ name: string; points: Array<[number, number]> }>;
}

const drivetrainConfigs: Array<{
  name: string;
  config: SimulationConfig;
}> = [
  {
    name: "3.7mps-7mps2",
    config: drivetrainConfig(3.7, 7),
  },
  {
    name: "4.2mps-10.5mps2",
    config: drivetrainConfig(4.2, 10.5),
  },
  {
    name: "4.7mps-14mps2",
    config: drivetrainConfig(4.7, 14),
  },
];

function drivetrainConfig(
  maxVelocityMps: number,
  maxAccelerationMps2: number,
): SimulationConfig {
  return {
    kinematic_constraints: {
      default_max_velocity_meters_per_sec: maxVelocityMps,
      default_max_acceleration_meters_per_sec2: maxAccelerationMps2,
      default_auto_velocity_velocity_safety_factor: 1,
      default_auto_velocity_acceleration_safety_factor: 1,
    },
  };
}

function loadCorpus(filename: string): GeometryCorpus {
  return JSON.parse(
    readFileSync(
      new URL(`../../fixtures/simulation/${filename}`, import.meta.url),
      "utf8",
    ),
  ) as GeometryCorpus;
}

function pathOf(points: Array<[number, number]>): PathModel {
  return seedHandoffRadii(
    createPathModel({
      path_elements: points.map(([x, y]) =>
        createTranslationTarget({ x_meters: x, y_meters: y }),
      ),
    }),
  ).path;
}

function translatedPath(path: PathModel, dx: number, dy: number): PathModel {
  return {
    ...path,
    path_elements: path.path_elements.map((element) => {
      if (element.type === "translation") {
        return {
          ...element,
          x_meters: element.x_meters + dx,
          y_meters: element.y_meters + dy,
        };
      }
      if (element.type === "waypoint") {
        return {
          ...element,
          translation_target: {
            ...element.translation_target,
            x_meters: element.translation_target.x_meters + dx,
            y_meters: element.translation_target.y_meters + dy,
          },
        };
      }
      return element;
    }),
  };
}

function targetedGeometries(): GeometryCorpus["paths"] {
  return [
    {
      name: "generated-shallow-fast-chain",
      points: Array.from({ length: 12 }, (_, index): [number, number] => [
        index * 0.85,
        0.12 * Math.sin(index * 0.55),
      ]),
    },
    {
      name: "generated-alternating-corners",
      points: Array.from({ length: 12 }, (_, index): [number, number] => [
        index * 0.7,
        index % 2 === 0 ? 0 : 0.8,
      ]),
    },
    {
      name: "generated-reversal-chain",
      points: [
        [0, 0],
        [1.5, 0],
        [0.35, 0.05],
        [1.8, 0.15],
        [0.7, 0.25],
        [2.2, 0.4],
      ],
    },
    {
      name: "generated-self-crossing",
      points: [
        [0, 0],
        [2, 2],
        [0, 2],
        [2, 0],
        [3, 1.5],
        [1, 1.2],
        [3.5, 0.2],
      ],
    },
    {
      name: "generated-short-feasible-legs",
      points: [
        [0, 0],
        [0.06, 0],
        [0.06, 0.08],
        [0.15, 0.08],
        [0.15, 0.16],
      ],
    },
  ];
}

function heldOutPerturbations(
  source: GeometryCorpus["paths"],
): GeometryCorpus["paths"] {
  return source.slice(0, 6).map(({ name, points }, caseIndex) => ({
    name: `${name}-heldout-perturbation`,
    points: points.map(([x, y], pointIndex): [number, number] => {
      if (pointIndex === 0 || pointIndex === points.length - 1) {
        return [x, y];
      }
      return [
        x + 0.11 * Math.sin((caseIndex + 1) * (pointIndex + 2)),
        y + 0.09 * Math.cos((caseIndex + 2) * (pointIndex + 1)),
      ];
    }),
  }));
}

function expectValidAndStable(
  result: ReturnType<typeof solveJointAutoConstraints>,
  label?: string,
): void {
  expect(result.status, label).toBe("valid");
  expect(result.stats.genericValidationPassed, label).toBe(true);
  expect(result.stats.stabilityValidationPassed, label).toBe(true);
  expect(result.profile.diagnostics.reachedEnd, label).toBe(true);
  expect(
    result.profile.diagnostics.handoffs.every(
      (handoff) => handoff.passed && !handoff.skippedOutgoingSegment,
    ),
    label,
  ).toBe(true);
}

describe("production joint optimizer parity", () => {
  it("validates representative robot-code and targeted paths", () => {
    const robotPaths = loadCorpus("auto_joint_robot_2026_corpus.json").paths;
    const selected = [
      robotPaths.find(({ name }) => name === "bottom_sweep_long")!,
      robotPaths.find(({ name }) => name === "top_sweep_short_depo")!,
      ...targetedGeometries().slice(0, 3),
    ];
    for (const { points } of selected) {
      expectValidAndStable(
        solveJointAutoConstraints(pathOf(points), drivetrainConfigs[1]!.config),
      );
    }
  }, 30_000);

  it("uses a deterministic workload that scales with path size", () => {
    const twelveAnchor = pathOf(
      targetedGeometries().find(
        ({ name }) => name === "generated-shallow-fast-chain",
      )!.points,
    );
    const thirtyAnchor = pathOf(
      Array.from({ length: 30 }, (_, index): [number, number] => [
        index * 0.7,
        index % 2 === 0 ? 0 : 0.8,
      ]),
    );
    const fortyAnchor = pathOf(
      Array.from({ length: 40 }, (_, index): [number, number] => [
        index * 0.7,
        index % 2 === 0 ? 0 : 0.8,
      ]),
    );
    const twelvePlan = jointAutoConstraintSearchPlan(twelveAnchor, {});
    const thirtyPlan = jointAutoConstraintSearchPlan(thirtyAnchor, {});
    const fortyPlan = jointAutoConstraintSearchPlan(fortyAnchor, {});

    expect(thirtyPlan.evaluationBudget).toBeGreaterThan(
      twelvePlan.evaluationBudget,
    );
    expect(
      (fortyPlan.evaluationBudget - thirtyPlan.evaluationBudget) /
        (fortyPlan.searchableBlocks - thirtyPlan.searchableBlocks),
    ).toBe(376);
  });

  it.runIf(process.env.BLINE_ENFORCE_JOINT_PRODUCTION_PERF === "1")(
    "meets the warm production latency envelope for 12 anchors",
    () => {
      const geometry = loadCorpus(
        "auto_joint_robot_2026_corpus.json",
      ).paths.find(({ name }) => name === "bottom_sweep_long")!;
      const path = pathOf(geometry.points);
      const config = drivetrainConfigs[1]!.config;
      solveJointAutoConstraints(path, config);
      const elapsedMs = Array.from({ length: 7 }, (_, index) => {
        const translated = translatedPath(path, index * 0.013, -index * 0.009);
        const startedAt = performance.now();
        const result = solveJointAutoConstraints(translated, config);
        expectValidAndStable(result);
        return performance.now() - startedAt;
      }).sort((left, right) => left - right);
      const median = elapsedMs[Math.floor(elapsedMs.length / 2)]!;
      const p95 = elapsedMs[Math.ceil(elapsedMs.length * 0.95) - 1]!;
      console.log(
        `JOINT_PRODUCTION_PERF=${JSON.stringify({ elapsedMs, median, p95 })}`,
      );
      expect(median).toBeLessThanOrEqual(200);
      expect(p95).toBeLessThanOrEqual(250);
    },
    30_000,
  );

  it.runIf(process.env.BLINE_RUN_JOINT_PARITY_CORPUS === "1")(
    "matches or beats the shared 8,000-evaluation global-search reference",
    () => {
      const supplied = loadCorpus("auto_joint_reference_corpus.json").paths;
      const robot = loadCorpus(
        "auto_joint_robot_2026_corpus.json",
      ).paths.filter(({ points }) => points.length >= 3);
      const targeted = targetedGeometries();
      const allCases = [
        ...supplied,
        ...robot,
        ...targeted,
        ...heldOutPerturbations([...supplied, ...robot]),
      ];
      const caseFilter = process.env.BLINE_JOINT_PARITY_FILTER;
      const configFilter = process.env.BLINE_JOINT_PARITY_CONFIG_FILTER;
      const cases = caseFilter
        ? allCases.filter(({ name }) => name.includes(caseFilter))
        : allCases;
      const configs = configFilter
        ? drivetrainConfigs.filter(({ name }) => name.includes(configFilter))
        : drivetrainConfigs;
      const report = [];
      for (const { name, points } of cases) {
        for (const { name: configName, config } of configs) {
          const path = pathOf(points);
          const startedAt = performance.now();
          const production = solveJointAutoConstraints(path, config);
          const productionMs = performance.now() - startedAt;
          const reference = solveJointAutoConstraintsReference(
            path,
            config,
            {},
            { maxEvaluations: 8_000 },
          );
          expectValidAndStable(production, `${name} at ${configName}`);
          expect(
            production.stats.objectiveCost,
            `${name} at ${configName}`,
          ).toBeLessThanOrEqual(reference.stats.objectiveCost + 1e-6);
          report.push({
            name,
            config: configName,
            productionCost: production.stats.objectiveCost,
            referenceCost: reference.stats.objectiveCost,
            productionMs,
            evaluations: production.stats.evaluations,
          });
        }
      }
      console.log(`JOINT_PARITY_REPORT=${JSON.stringify(report)}`);
    },
    360_000,
  );
});

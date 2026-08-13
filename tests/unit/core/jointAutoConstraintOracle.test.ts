import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seedHandoffRadii } from "../../../src/core/bend/autoSeedHandoffRadii";
import {
  solveJointAutoConstraints,
  solveJointAutoConstraintsOracle,
} from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createTranslationTarget,
  type PathModel,
} from "../../../src/core/model/path";

interface OracleCorpus {
  paths: Array<{ name: string; points: Array<[number, number]> }>;
}

function loadCorpus(): OracleCorpus {
  return JSON.parse(
    readFileSync(
      new URL(
        "../../fixtures/simulation/auto_joint_oracle_corpus.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as OracleCorpus;
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

function generatedRadii(path: PathModel): number[] {
  return path.path_elements.flatMap((element) => {
    if (element.type === "translation") {
      return element.intermediate_handoff_radius_meters ?? [];
    }
    if (element.type === "waypoint") {
      return (
        element.translation_target.intermediate_handoff_radius_meters ?? []
      );
    }
    return [];
  });
}

function radiusAtOrdinal(path: PathModel, ordinal: number): number | null {
  const element = path.path_elements[ordinal - 1];
  if (element?.type === "translation") {
    return element.intermediate_handoff_radius_meters;
  }
  return element?.type === "waypoint"
    ? element.translation_target.intermediate_handoff_radius_meters
    : null;
}

describe("solveJointAutoConstraintsOracle", () => {
  it("is deterministic and ignores the public seed option", () => {
    const path = pathOf([
      [0, 0],
      [1.4, 0],
      [1.4, 1.1],
      [2.8, 1.1],
    ]);
    const first = solveJointAutoConstraintsOracle(
      path,
      {},
      {},
      {
        maxEvaluations: 180,
        seed: 42,
      },
    );
    const second = solveJointAutoConstraintsOracle(
      path,
      {},
      {},
      {
        maxEvaluations: 180,
        seed: 9_999,
      },
    );

    expect(first).toEqual(second);
    expect(first.stats.algorithm).toBe("oracle");
    expect(first.profile.diagnostics.reachedEnd).toBe(true);
  });

  it("converges to the same Path 2 basin from independent initial policies", () => {
    const pathTwo = loadCorpus().paths[1];
    expect(pathTwo).toBeDefined();
    const geometric = pathOf(pathTwo!.points);
    const alternate = solveJointAutoConstraints(geometric, {}).path;
    const first = solveJointAutoConstraintsOracle(
      geometric,
      {},
      {},
      { maxEvaluations: 8_000, seed: 1 },
    );
    const second = solveJointAutoConstraintsOracle(
      alternate,
      {},
      {},
      { maxEvaluations: 8_000, seed: 2 },
    );

    expect(second.stats.objectiveCost).toBeCloseTo(
      first.stats.objectiveCost,
      6,
    );
    expect(generatedRadii(second.path)).toEqual(generatedRadii(first.path));
    expect(second.profile.segmentCaps).toEqual(first.profile.segmentCaps);
  }, 120_000);

  it("produces runtime-valid policies for the first two exported paths", () => {
    const [pathOne, pathTwo] = loadCorpus().paths;
    expect(pathOne).toBeDefined();
    expect(pathTwo).toBeDefined();

    const first = solveJointAutoConstraints(pathOf(pathOne!.points), {});
    const second = solveJointAutoConstraints(pathOf(pathTwo!.points), {});

    expect(first.status).toBe("valid");
    expect(first.stats.stabilityValidationPassed).toBe(true);
    expect(second.status).toBe("valid");
    expect(second.stats.stabilityValidationPassed).toBe(true);
  });

  it.runIf(process.env.BLINE_RUN_ORACLE_CORPUS === "1")(
    "compares the five exported large paths",
    () => {
      const corpus = loadCorpus();
      const report = corpus.paths.map(({ name, points }, index) => {
        const path = pathOf(points);
        const interactive = solveJointAutoConstraints(path, {});
        const oracle = solveJointAutoConstraintsOracle(
          path,
          {},
          {},
          {
            maxEvaluations: 8_000,
            seed: 10_000 + index,
          },
        );
        expect(oracle.stats.objectiveCost).toBeLessThanOrEqual(
          interactive.stats.objectiveCost + 1e-9,
        );
        return {
          name,
          interactiveCost: Number(interactive.stats.objectiveCost.toFixed(3)),
          oracleCost: Number(oracle.stats.objectiveCost.toFixed(3)),
          costDelta: Number(
            (
              oracle.stats.objectiveCost - interactive.stats.objectiveCost
            ).toFixed(3),
          ),
          interactiveTimeS: Number(
            interactive.profile.diagnostics.totalTimeS.toFixed(2),
          ),
          oracleTimeS: Number(oracle.profile.diagnostics.totalTimeS.toFixed(2)),
          interactiveRadii: generatedRadii(interactive.path),
          oracleRadii: generatedRadii(oracle.path),
          interactiveStatus: interactive.status,
          oracleStatus: oracle.status,
          validation: {
            interactiveGeneric: interactive.stats.genericValidationPassed,
            interactiveStability: interactive.stats.stabilityValidationPassed,
            oracleGeneric: oracle.stats.genericValidationPassed,
            oracleStability: oracle.stats.stabilityValidationPassed,
          },
          smallHandoffs: interactive.profile.diagnostics.handoffs.flatMap(
            (handoff) => {
              const radius = radiusAtOrdinal(
                interactive.path,
                handoff.anchorOrdinal,
              );
              return radius !== null && radius < 0.22
                ? [
                    {
                      ordinal: handoff.anchorOrdinal,
                      radius,
                      early: Number(handoff.earlyHandoffRatio.toFixed(2)),
                      tracking: Number(
                        (
                          handoff.combinedErrorMeters / handoff.toleranceMeters
                        ).toFixed(2),
                      ),
                      post: Number(
                        (
                          handoff.postHandoffPeakErrorMeters /
                          handoff.postHandoffToleranceMeters
                        ).toFixed(2),
                      ),
                      overshoot: Number(
                        (
                          handoff.overshootErrorMeters /
                          handoff.overshootToleranceMeters
                        ).toFixed(2),
                      ),
                      corridor: Number(
                        (
                          handoff.corridorDeviationMeters /
                          handoff.corridorToleranceMeters
                        ).toFixed(2),
                      ),
                      passed: handoff.passed,
                    },
                  ]
                : [];
            },
          ),
        };
      });
      console.log(`ORACLE_CORPUS_REPORT=${JSON.stringify(report)}`);
    },
    360_000,
  );
});

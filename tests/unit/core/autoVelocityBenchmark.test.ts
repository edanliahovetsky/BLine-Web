import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  generateAutoVelocityProfile,
  type AutoVelocityCorner,
  type AutoVelocityProfile,
} from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  type PathModel,
  type RangedConstraint,
} from "../../../src/core/model/path";
import {
  buildSegments,
  simulatePathWithTrace,
  type Segment,
  type SimulationConfig,
  type SimulationTraceSample,
} from "../../../src/core/sim";

interface BenchmarkCase {
  name: string;
  path: PathModel;
  compareOracle: boolean;
  typicalRuntimePath: boolean;
}

interface Evaluation {
  safe: boolean;
  reachedEnd: boolean;
  totalTimeS: number;
  maxHandoffRatio: number;
  maxPostHandoffRatio: number;
  capSum: number;
  capsByOrdinal: Map<number, number>;
}

const benchmarkConfig: SimulationConfig = {
  default_max_velocity_meters_per_sec: 4.5,
  default_max_acceleration_meters_per_sec2: 12,
  default_intermediate_handoff_radius_meters: 0.25,
  default_max_velocity_deg_per_sec: 720,
  default_max_acceleration_deg_per_sec2: 2000,
};

const benchmarkOptions = {
  velocitySafetyFactor: 0.9,
  accelerationSafetyFactor: 0.8,
};
// Runtime budgets are CPU-specific, so they are opt-in instead of CI correctness.
const maxTypicalRuntimeMs = readRuntimeBudgetMs();

describe("auto velocity benchmark", () => {
  it("generates safe caps that stay close to a slow local oracle", () => {
    const results = benchmarkCases().map((benchmark) => {
      const shouldMeasureRuntime =
        maxTypicalRuntimeMs !== null && benchmark.typicalRuntimePath;
      const startedAt = shouldMeasureRuntime ? performance.now() : 0;
      const profile = generateAutoVelocityProfile(
        benchmark.path,
        benchmarkConfig,
        benchmarkOptions,
      );
      const runtimeMs = shouldMeasureRuntime ? performance.now() - startedAt : 0;
      const cachedProfile = generateAutoVelocityProfile(
        benchmark.path,
        benchmarkConfig,
        benchmarkOptions,
      );
      expect(cachedProfile).toBe(profile);
      const auto = evaluateProfileCaps(benchmark.path, profile);
      const oracle = benchmark.compareOracle
        ? optimizeOracle(benchmark.path, profile)
        : auto;

      return {
        name: benchmark.name,
        auto,
        oracle,
        runtimeMs,
        compareOracle: benchmark.compareOracle,
        typicalRuntimePath: benchmark.typicalRuntimePath,
      };
    });

    const safetyFailures = results.filter((result) => !result.auto.safe);
    expect(formatSafetyFailures(safetyFailures)).toEqual([]);
    expectMixedWaypointRotationCap(results);

    const compared = results.filter((result) => result.compareOracle);
    const timeFailures = compared.filter(
      ({ auto, oracle }) => auto.totalTimeS > oracle.totalTimeS * 1.03 + 0.02,
    );
    const passRate =
      compared.length === 0
        ? 1
        : (compared.length - timeFailures.length) / compared.length;
    if (passRate < 0.95) {
      expect(
        timeFailures.map((failure) => ({
          name: failure.name,
          autoTime: failure.auto.totalTimeS,
          oracleTime: failure.oracle.totalTimeS,
        })),
      ).toEqual([]);
    }
    expect(passRate).toBeGreaterThanOrEqual(0.95);

    const capFailures = compared.flatMap(({ name, auto, oracle }) =>
      capConservatismFailures(name, auto, oracle),
    );
    expect(capFailures).toEqual([]);

    if (maxTypicalRuntimeMs !== null) {
      const worstTypicalRuntime = Math.max(
        0,
        ...results
          .filter((result) => result.typicalRuntimePath)
          .map((result) => result.runtimeMs),
      );
      expect(worstTypicalRuntime).toBeLessThan(maxTypicalRuntimeMs);
    }
  }, 120_000);
});

function readRuntimeBudgetMs(): number | null {
  const value = process.env.BLINE_AUTO_VELOCITY_MAX_TYPICAL_RUNTIME_MS;
  if (!value) {
    return null;
  }

  const budgetMs = Number(value);
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error(
      "BLINE_AUTO_VELOCITY_MAX_TYPICAL_RUNTIME_MS must be a positive number",
    );
  }

  return budgetMs;
}

function benchmarkCases(): BenchmarkCase[] {
  return [
    {
      name: "straight two anchor",
      path: pathFromPoints([
        [0, 0],
        [4, 0],
      ]),
      compareOracle: true,
      typicalRuntimePath: false,
    },
    {
      name: "single 90 degree handoff",
      path: pathFromPoints([
        [0, 0],
        [1.4, 0, 0.3],
        [1.4, 1.4],
      ]),
      compareOracle: true,
      typicalRuntimePath: false,
    },
    {
      name: "shallow sweep",
      path: pathFromPoints([
        [0, 0],
        [2.2, 0, 0.4],
        [4.4, 0.9],
      ]),
      compareOracle: true,
      typicalRuntimePath: false,
    },
    {
      name: "sharp reversal",
      path: pathFromPoints([
        [0, 0],
        [1.2, 0, 0.25],
        [0.45, 0.75],
      ]),
      compareOracle: true,
      typicalRuntimePath: false,
    },
    {
      name: "five anchor s curve",
      path: pathFromPoints([
        [0, 0],
        [1.2, 0.25, 0.28],
        [2.0, -0.45, 0.25],
        [3.0, 0.45, 0.3],
        [4.2, 0.2],
      ]),
      compareOracle: true,
      typicalRuntimePath: false,
    },
    {
      name: "eight anchor zigzag",
      path: pathFromPoints([
        [0, 0],
        [0.9, 0.55, 0.22],
        [1.7, -0.45, 0.18],
        [2.5, 0.6, 0.28],
        [3.3, -0.35, 0.2],
        [4.0, 0.5, 0.24],
        [4.8, 0.05, 0.3],
        [5.7, 0.2],
      ]),
      compareOracle: true,
      typicalRuntimePath: false,
    },
    {
      name: "short segment cluster",
      path: pathFromPoints([
        [0, 0],
        [0.6, 0, 0.25],
        [0.85, 0.35, 0.2],
        [1.15, 0.05, 0.18],
        [1.45, 0.4, 0.2],
        [1.9, 0.15, 0.22],
        [2.8, 0.2],
      ]),
      compareOracle: true,
      typicalRuntimePath: false,
    },
    {
      name: "ten anchor alternating radii",
      path: pathFromPoints([
        [0, 0],
        [1.1, 0.2, 0.3],
        [2.2, 0.85, 0.35],
        [3.4, 0.35, 0.3],
        [4.5, 1.0, 0.35],
        [5.7, 0.5, 0.3],
        [6.8, 1.05, 0.35],
        [8.0, 0.65, 0.3],
        [9.0, 0.85, 0.35],
        [10.2, 0.7],
      ]),
      compareOracle: true,
      typicalRuntimePath: true,
    },
    {
      name: "fifteen anchor serpentine",
      path: pathFromPoints([
        [0, 0],
        [0.9, 0.35, 0.4],
        [1.8, -0.25, 0.4],
        [2.7, 0.5, 0.35],
        [3.6, -0.35, 0.4],
        [4.5, 0.45, 0.4],
        [5.4, -0.25, 0.45],
        [6.3, 0.4, 0.3],
        [7.2, -0.2, 0.4],
        [8.1, 0.35, 0.4],
        [9.0, -0.1, 0.55],
        [9.9, 0.55, 0.4],
        [10.8, 0.05, 0.35],
        [11.7, 0.45, 0.7],
        [12.6, 0.25],
      ]),
      compareOracle: true,
      typicalRuntimePath: true,
    },
    {
      name: "twelve anchor mixed radius sweep",
      path: pathFromPoints([
        [0, 0],
        [0.9, 0.25, 0.4],
        [1.8, 0.9, 0.4],
        [2.8, 0.45, 0.35],
        [3.6, 1.2, 0.4],
        [4.8, 0.65, 0.55],
        [5.7, 1.3, 0.4],
        [6.8, 0.75, 0.3],
        [7.9, 1.15, 0.4],
        [8.8, 0.35, 0.45],
        [9.9, 0.85, 0.7],
        [11.0, 0.6],
      ]),
      compareOracle: true,
      typicalRuntimePath: true,
    },
    {
      name: "fourteen anchor radius varied chicane",
      path: pathFromPoints([
        [0, 0],
        [0.8, 0.2, 0.4],
        [1.7, -0.35, 0.4],
        [2.6, 0.45, 0.35],
        [3.5, -0.25, 0.4],
        [4.4, 0.55, 0.45],
        [5.4, -0.1, 0.4],
        [6.2, 0.7, 0.3],
        [7.1, 0.05, 0.4],
        [8.0, 0.8, 0.55],
        [9.1, 0.2, 0.4],
        [10.0, 0.95, 0.7],
        [11.1, 0.45, 0.4],
        [12.2, 0.65],
      ]),
      compareOracle: true,
      typicalRuntimePath: true,
    },
    {
      name: "wide handoff sweep",
      path: pathFromPoints([
        [7.41, 2.14],
        [10.35, 6.47, 1.1],
        [16.13, 4.68],
      ]),
      compareOracle: true,
      typicalRuntimePath: false,
    },
    {
      name: "mixed waypoint rotation events",
      path: mixedWaypointPath(),
      compareOracle: true,
      typicalRuntimePath: true,
    },
  ];
}

function mixedWaypointPath(): PathModel {
  return createPathModel({
    path_elements: [
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 0,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.3,
        }),
        rotation_target: createRotationTarget({ rotation_radians: 0 }),
      }),
      createEventTrigger({ t_ratio: 0.2, lib_key: "intake" }),
      createRotationTarget({ rotation_radians: Math.PI / 5, t_ratio: 0.45 }),
      createTranslationTarget({
        x_meters: 1.2,
        y_meters: 0.3,
        intermediate_handoff_radius_meters: 0.3,
      }),
      createTranslationTarget({
        x_meters: 2.4,
        y_meters: 1.0,
        intermediate_handoff_radius_meters: 0.35,
      }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 3.7,
          y_meters: 0.6,
          intermediate_handoff_radius_meters: 0.3,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: -Math.PI / 2,
        }),
      }),
      createEventTrigger({ t_ratio: 0.7, lib_key: "handoff" }),
      createTranslationTarget({
        x_meters: 4.9,
        y_meters: 1.1,
        intermediate_handoff_radius_meters: 0.32,
      }),
      createTranslationTarget({
        x_meters: 6.2,
        y_meters: 0.8,
        intermediate_handoff_radius_meters: 0.3,
      }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 7.4,
          y_meters: 1.0,
          intermediate_handoff_radius_meters: 0.3,
        }),
        rotation_target: createRotationTarget({ rotation_radians: Math.PI }),
      }),
    ],
  });
}

function optimizeOracle(
  path: PathModel,
  profile: AutoVelocityProfile,
): Evaluation {
  let best = evaluateProfileCaps(path, profile);
  const ordinals = profile.segmentCaps
    .map((cap) => cap.targetOrdinal)
    .filter((ordinal) => ordinal > 1);

  for (let pass = 0; pass < 3; pass += 1) {
    const ordered = pass % 2 === 0 ? ordinals : [...ordinals].reverse();
    for (const ordinal of ordered) {
      for (const value of oracleCandidates(
        best.capsByOrdinal.get(ordinal) ?? profile.usableMaxVelocityMps,
        profile.usableMaxVelocityMps,
      )) {
        const trialCaps = new Map(best.capsByOrdinal);
        trialCaps.set(ordinal, value);
        const trial = evaluateCaps(path, profile, trialCaps);
        if (betterOracleEvaluation(trial, best)) {
          best = trial;
        }
      }
    }
  }

  return best;
}

function expectMixedWaypointRotationCap(
  results: ReadonlyArray<{
    name: string;
    auto: Evaluation;
  }>,
) {
  const mixed = results.find(
    (result) => result.name === "mixed waypoint rotation events",
  );
  expect(mixed?.auto.capsByOrdinal.get(4)).toBeGreaterThanOrEqual(3.5);
}

function betterOracleEvaluation(
  candidate: Evaluation,
  current: Evaluation,
): boolean {
  if (candidate.safe !== current.safe) {
    return candidate.safe;
  }

  const candidateViolation = Math.max(
    candidate.maxHandoffRatio,
    candidate.maxPostHandoffRatio,
  );
  const currentViolation = Math.max(
    current.maxHandoffRatio,
    current.maxPostHandoffRatio,
  );

  if (!candidate.safe) {
    return candidateViolation < currentViolation - 0.01;
  }

  if (candidate.totalTimeS < current.totalTimeS - 0.005) {
    return true;
  }
  if (candidate.totalTimeS > current.totalTimeS + 0.005) {
    return false;
  }
  if (candidateViolation < currentViolation - 0.02) {
    return true;
  }

  return candidate.capSum > current.capSum + 0.01;
}

function oracleCandidates(current: number, maxVelocity: number): number[] {
  const minVelocity = Math.max(0.05, maxVelocity * 0.05);
  const neighborhood = [
    current - maxVelocity * 0.2,
    current - maxVelocity * 0.1,
    current - maxVelocity * 0.05,
    current,
    current + maxVelocity * 0.05,
    current + maxVelocity * 0.1,
    current + maxVelocity * 0.2,
  ];
  const ratios = [
    0.05, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85,
    0.92, 1,
  ].map((ratio) => ratio * maxVelocity);

  return uniqueSortedVelocities(
    [...neighborhood, ...ratios],
    minVelocity,
    maxVelocity,
  );
}

function evaluateProfileCaps(
  path: PathModel,
  profile: AutoVelocityProfile,
): Evaluation {
  return evaluateCaps(path, profile, capsFromProfile(profile));
}

function evaluateCaps(
  path: PathModel,
  profile: AutoVelocityProfile,
  capsByOrdinal: ReadonlyMap<number, number>,
): Evaluation {
  const result = simulatePathWithTrace(
    pathWithVelocityCaps(
      path,
      capsByOrdinal,
      profile.usableMaxVelocityMps,
      profile.usableMaxAccelerationMps2,
    ),
    benchmarkConfig,
    { dt_s: 0.02 },
  );
  const { segments, cumulativeLengths } = buildSegments(path);
  const finalGlobalS =
    result.global_s_by_time.get(result.times_sorted.at(-1) ?? 0) ?? 0;
  const totalLength = cumulativeLengths.at(-1) ?? 0;
  const reachedEnd = totalLength <= 1e-9 || finalGlobalS >= totalLength - 0.02;
  let maxHandoffRatio = 0;
  let maxPostHandoffRatio = 0;

  for (const corner of profile.corners) {
    const incoming = segments[corner.anchorOrdinal - 2];
    const outgoing = segments[corner.anchorOrdinal - 1];
    const entry = sampleTraceAtS(result.trace, corner.startS);
    const exit = sampleTraceAtS(result.trace, corner.endS);
    const handoffTolerance = handoffBudget(corner.handoffDistanceMeters);
    const postTolerance = postHandoffBudget(corner.handoffDistanceMeters);
    const entryError =
      entry && incoming
        ? crossTrackError(entry.x, entry.y, incoming)
        : Infinity;
    const exitError =
      exit && outgoing ? crossTrackError(exit.x, exit.y, outgoing) : Infinity;
    const handoffRatio =
      Math.hypot(entryError, exitError) / Math.max(handoffTolerance, 1e-9);
    const outgoingEndS = cumulativeLengths[corner.anchorOrdinal] ?? corner.endS;
    const postRatio = outgoing
      ? postHandoffPeakError(corner, outgoing, outgoingEndS, result.trace) /
        Math.max(postTolerance, 1e-9)
      : Infinity;
    maxHandoffRatio = Math.max(maxHandoffRatio, handoffRatio);
    maxPostHandoffRatio = Math.max(maxPostHandoffRatio, postRatio);
  }

  return {
    safe: reachedEnd && maxHandoffRatio <= 1 && maxPostHandoffRatio <= 1,
    reachedEnd,
    totalTimeS: result.total_time_s,
    maxHandoffRatio,
    maxPostHandoffRatio,
    capSum: capSum(capsByOrdinal),
    capsByOrdinal: new Map(capsByOrdinal),
  };
}

function pathWithVelocityCaps(
  path: PathModel,
  capsByOrdinal: ReadonlyMap<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): PathModel {
  const generated: RangedConstraint[] = [...capsByOrdinal.entries()].map(
    ([ordinal, value]) => ({
      key: "max_velocity_meters_per_sec",
      value,
      start_ordinal: ordinal,
      end_ordinal: ordinal,
    }),
  );

  return {
    ...path,
    constraints: {
      ...path.constraints,
      max_velocity_meters_per_sec: usableMaxVelocityMps,
      max_acceleration_meters_per_sec2: usableMaxAccelerationMps2,
    },
    ranged_constraints: path.ranged_constraints
      .filter(
        (constraint) =>
          constraint.key !== "max_velocity_meters_per_sec" &&
          constraint.key !== "max_acceleration_meters_per_sec2",
      )
      .concat(generated),
  };
}

function capsFromProfile(profile: AutoVelocityProfile): Map<number, number> {
  const capsByOrdinal = new Map<number, number>();
  for (const cap of profile.segmentCaps) {
    if (cap.targetOrdinal > 1) {
      capsByOrdinal.set(cap.targetOrdinal, cap.value);
    }
  }
  return capsByOrdinal;
}

function capConservatismFailures(
  name: string,
  auto: Evaluation,
  oracle: Evaluation,
): Array<{
  name: string;
  ordinal: number;
  autoCap: number;
  oracleCap: number;
}> {
  const failures: Array<{
    name: string;
    ordinal: number;
    autoCap: number;
    oracleCap: number;
  }> = [];
  for (const [ordinal, oracleCap] of oracle.capsByOrdinal) {
    const autoCap = auto.capsByOrdinal.get(ordinal);
    if (autoCap === undefined) {
      continue;
    }
    if (autoCap + 0.02 < oracleCap * 0.85) {
      failures.push({ name, ordinal, autoCap, oracleCap });
    }
  }
  return failures;
}

function formatSafetyFailures(
  failures: Array<{ name: string; auto: Evaluation; oracle: Evaluation }>,
): Array<{
  name: string;
  reachedEnd: boolean;
  oracleSafe: boolean;
  maxHandoffRatio: number;
  maxPostHandoffRatio: number;
  oracleMaxHandoffRatio: number;
  oracleMaxPostHandoffRatio: number;
}> {
  return failures.map(({ name, auto, oracle }) => ({
    name,
    reachedEnd: auto.reachedEnd,
    oracleSafe: oracle.safe,
    maxHandoffRatio: round(auto.maxHandoffRatio),
    maxPostHandoffRatio: round(auto.maxPostHandoffRatio),
    oracleMaxHandoffRatio: round(oracle.maxHandoffRatio),
    oracleMaxPostHandoffRatio: round(oracle.maxPostHandoffRatio),
  }));
}

function pathFromPoints(
  points: ReadonlyArray<readonly [x: number, y: number, radius?: number]>,
): PathModel {
  return createPathModel({
    path_elements: points.map(([xMeters, yMeters, radius]) =>
      createTranslationTarget({
        x_meters: xMeters,
        y_meters: yMeters,
        intermediate_handoff_radius_meters: radius ?? null,
      }),
    ),
  });
}

function sampleTraceAtS(
  trace: readonly SimulationTraceSample[],
  sMeters: number,
): { x: number; y: number } | null {
  for (let index = 1; index < trace.length; index += 1) {
    const previous = trace[index - 1];
    const current = trace[index];
    if (!previous || !current) {
      continue;
    }

    const lower = Math.min(previous.global_s_m, current.global_s_m);
    const upper = Math.max(previous.global_s_m, current.global_s_m);
    if (sMeters < lower - 1e-6 || sMeters > upper + 1e-6) {
      continue;
    }

    const ds = current.global_s_m - previous.global_s_m;
    if (Math.abs(ds) <= 1e-9) {
      return { x: current.x_m, y: current.y_m };
    }

    const alpha = Math.max(
      0,
      Math.min((sMeters - previous.global_s_m) / ds, 1),
    );
    return {
      x: previous.x_m + (current.x_m - previous.x_m) * alpha,
      y: previous.y_m + (current.y_m - previous.y_m) * alpha,
    };
  }

  return null;
}

function postHandoffPeakError(
  corner: AutoVelocityCorner,
  outgoing: Segment,
  outgoingEndS: number,
  trace: readonly SimulationTraceSample[],
): number {
  const startS = corner.endS;
  const endS = Math.min(startS + 0.6, outgoingEndS);
  let peak = 0;
  let found = false;

  for (const sMeters of [startS, endS]) {
    const point = sampleTraceAtS(trace, sMeters);
    if (point) {
      peak = Math.max(peak, crossTrackError(point.x, point.y, outgoing));
      found = true;
    }
  }

  for (const sample of trace) {
    if (sample.global_s_m < startS - 1e-6 || sample.global_s_m > endS + 1e-6) {
      continue;
    }

    peak = Math.max(peak, crossTrackError(sample.x_m, sample.y_m, outgoing));
    found = true;
  }

  return found ? peak : Infinity;
}

function crossTrackError(x: number, y: number, segment: Segment): number {
  const dx = x - segment.ax;
  const dy = y - segment.ay;
  return Math.abs(dx * segment.uy - dy * segment.ux);
}

function handoffBudget(radiusMeters: number): number {
  return Math.max(0.05, 0.25 * radiusMeters);
}

function postHandoffBudget(radiusMeters: number): number {
  return Math.max(0.08, 0.35 * radiusMeters);
}

function uniqueSortedVelocities(
  values: readonly number[],
  minValue: number,
  maxValue: number,
): number[] {
  return [
    ...new Set(
      values.map((value) =>
        round(Math.max(minValue, Math.min(value, maxValue))),
      ),
    ),
  ].sort((left, right) => left - right);
}

function capSum(capsByOrdinal: ReadonlyMap<number, number>): number {
  let sum = 0;
  for (const cap of capsByOrdinal.values()) {
    sum += cap;
  }
  return sum;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

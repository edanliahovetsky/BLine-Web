import {
  defaultAutoVelocityAccelerationSafetyFactor,
  defaultAutoVelocityVelocitySafetyFactor,
  getDefaultOptionalConfigValue,
} from "../config/projectConfig";
import {
  isTranslationTarget,
  isWaypoint,
  type AutoVelocityConstraintMetadata,
  type PathElement,
  type PathModel,
  type RangedConstraintKey,
  type RangedConstraint,
} from "../model/path";
import { simulatePathWithTrace } from "../sim/simulatePath";
import type { SimulationTraceSample } from "../sim/types";

export interface AutoVelocityGenerationOptions {
  velocitySafetyFactor?: number;
  accelerationSafetyFactor?: number;
  sampleStepMeters?: number;
}

export interface AutoVelocityAnchor {
  x: number;
  y: number;
  pathIndex: number;
}

export interface AutoVelocityCorner {
  anchorOrdinal: number;
  turnAngleRadians: number;
  handoffDistanceMeters: number;
  effectiveRadiusMeters: number;
  curvature: number;
  startS: number;
  endS: number;
  clamped: boolean;
}

export interface AutoVelocitySample {
  sMeters: number;
  curvature: number;
  velocityLimitMps: number;
  velocityMps: number;
}

export interface AutoVelocitySegmentCap {
  segmentIndex: number;
  targetOrdinal: number;
  value: number;
  minVelocityLimitMps: number;
}

export interface AutoVelocityProfile {
  anchors: AutoVelocityAnchor[];
  corners: AutoVelocityCorner[];
  samples: AutoVelocitySample[];
  segmentCaps: AutoVelocitySegmentCap[];
  settings: Required<
    Pick<
      AutoVelocityGenerationOptions,
      "velocitySafetyFactor" | "accelerationSafetyFactor" | "sampleStepMeters"
    >
  >;
  usableMaxVelocityMps: number;
  usableMaxAccelerationMps2: number;
}

interface SegmentGeometry {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  lengthMeters: number;
  ux: number;
  uy: number;
  startS: number;
  endS: number;
}

interface AutoVelocitySolverResult {
  capsByOrdinal: Map<number, number>;
  trace: SimulationTraceSample[];
}

interface HandoffEvaluation {
  corner: AutoVelocityCorner;
  incomingOrdinal: number;
  outgoingOrdinal: number;
  toleranceMeters: number;
  entryErrorMeters: number;
  exitErrorMeters: number;
  combinedErrorMeters: number;
  passed: boolean;
}

interface VelocityCapEvaluation {
  handoffs: HandoffEvaluation[];
  passed: boolean;
  trace: SimulationTraceSample[];
}

const defaultMaxVelocityMps = 4.5;
const defaultMaxAccelerationMps2 = 7;
const defaultHandoffRadiusMeters = 0.2;
const defaultSampleStepMeters = 0.05;
const defaultFirstOrdinalVelocityRatio = 0.5;
const solverDtSeconds = 0.02;
const solverPairPasses = 2;
const solverRefinementRounds = 1;
const solverCapToleranceMps = 0.01;
const solverMinVelocityRatio = 0.05;
const gateToleranceFloorMeters = 0.05;
const gateToleranceRatio = 0.25;
const minPositive = 1e-9;

export function generateAutoVelocityProfile(
  path: PathModel,
  config: unknown,
  options: AutoVelocityGenerationOptions = {},
): AutoVelocityProfile {
  const anchors = translationAnchors(path.path_elements);
  const segments = buildSegmentGeometry(anchors);
  const settings = {
    velocitySafetyFactor: clampSafetyFactor(
      options.velocitySafetyFactor,
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_velocity_safety_factor",
      ) ?? defaultAutoVelocityVelocitySafetyFactor,
    ),
    accelerationSafetyFactor: clampSafetyFactor(
      options.accelerationSafetyFactor,
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_acceleration_safety_factor",
      ) ?? defaultAutoVelocityAccelerationSafetyFactor,
    ),
    sampleStepMeters: positiveNumber(
      options.sampleStepMeters,
      defaultSampleStepMeters,
    ),
  };
  const baseMaxVelocity = resolvePositive(
    path.constraints.max_velocity_meters_per_sec,
    getDefaultOptionalConfigValue(config, "max_velocity_meters_per_sec"),
    defaultMaxVelocityMps,
  );
  const baseMaxAcceleration = resolvePositive(
    path.constraints.max_acceleration_meters_per_sec2,
    getDefaultOptionalConfigValue(config, "max_acceleration_meters_per_sec2"),
    defaultMaxAccelerationMps2,
  );
  const defaultHandoffRadius = resolvePositive(
    null,
    getDefaultOptionalConfigValue(config, "intermediate_handoff_radius_meters"),
    defaultHandoffRadiusMeters,
  );
  const usableMaxVelocityMps = baseMaxVelocity * settings.velocitySafetyFactor;
  const usableMaxAccelerationMps2 =
    baseMaxAcceleration * settings.accelerationSafetyFactor;
  const cumulative = segments.map((segment) => segment.startS);
  cumulative.push(segments.at(-1)?.endS ?? 0);
  const corners = buildCorners(
    path,
    anchors,
    segments,
    cumulative,
    defaultHandoffRadius,
  );
  const solver = solveSegmentCapsWithSimulation(
    path,
    config,
    anchors,
    segments,
    corners,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  const samples = samplesFromTrace(solver.trace, usableMaxVelocityMps);
  const segmentCaps = segmentCapsFromSolvedCaps(
    anchors,
    segments,
    solver.capsByOrdinal,
    baseMaxVelocity,
    usableMaxVelocityMps,
  );

  return {
    anchors,
    corners,
    samples,
    segmentCaps,
    settings,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  };
}

export function autoVelocityMetadata(
  settings: Pick<
    AutoVelocityConstraintMetadata,
    | "velocity_safety_factor"
    | "acceleration_safety_factor"
    | "merge_tolerance_meters_per_sec"
  >,
): AutoVelocityConstraintMetadata {
  return {
    velocity_safety_factor: settings.velocity_safety_factor,
    acceleration_safety_factor: settings.acceleration_safety_factor,
    merge_tolerance_meters_per_sec: settings.merge_tolerance_meters_per_sec,
  };
}

export function autoVelocityConstraintForCap(
  cap: AutoVelocitySegmentCap,
  metadata: AutoVelocityConstraintMetadata,
): RangedConstraint {
  return {
    key: "max_velocity_meters_per_sec",
    value: cap.value,
    start_ordinal: cap.targetOrdinal,
    end_ordinal: cap.targetOrdinal,
    source: "auto_velocity",
    auto_velocity: metadata,
  };
}

function translationAnchors(
  elements: readonly PathElement[],
): AutoVelocityAnchor[] {
  return elements.flatMap((element, pathIndex) => {
    if (isTranslationTarget(element)) {
      return [{ x: element.x_meters, y: element.y_meters, pathIndex }];
    }

    if (isWaypoint(element)) {
      return [
        {
          x: element.translation_target.x_meters,
          y: element.translation_target.y_meters,
          pathIndex,
        },
      ];
    }

    return [];
  });
}

function buildSegmentGeometry(
  anchors: readonly AutoVelocityAnchor[],
): SegmentGeometry[] {
  const segments: SegmentGeometry[] = [];
  let s = 0;

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index];
    const end = anchors[index + 1];
    if (!start || !end) {
      continue;
    }

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const segment =
      length <= minPositive
        ? {
            ax: start.x,
            ay: start.y,
            bx: end.x,
            by: end.y,
            lengthMeters: 0,
            ux: 1,
            uy: 0,
            startS: s,
            endS: s,
          }
        : {
            ax: start.x,
            ay: start.y,
            bx: end.x,
            by: end.y,
            lengthMeters: length,
            ux: dx / length,
            uy: dy / length,
            startS: s,
            endS: s + length,
          };
    segments.push(segment);
    s += length;
  }

  return segments;
}

function buildCorners(
  path: PathModel,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  cumulativeLengths: readonly number[],
  defaultHandoffRadius: number,
): AutoVelocityCorner[] {
  const corners: AutoVelocityCorner[] = [];

  for (
    let anchorIndex = 1;
    anchorIndex < anchors.length - 1;
    anchorIndex += 1
  ) {
    const incoming = segments[anchorIndex - 1];
    const outgoing = segments[anchorIndex];
    const anchor = anchors[anchorIndex];
    if (!incoming || !outgoing || !anchor) {
      continue;
    }

    const dot = clamp(
      incoming.ux * outgoing.ux + incoming.uy * outgoing.uy,
      -1,
      1,
    );
    const turnAngle = Math.acos(dot);
    if (turnAngle < 1e-4) {
      continue;
    }

    const requestedHandoff = handoffRadiusForAnchor(
      path.path_elements[anchor.pathIndex],
      defaultHandoffRadius,
    );
    const maxHandoff = Math.max(
      0,
      Math.min(incoming.lengthMeters, outgoing.lengthMeters) * 0.49,
    );
    const handoffDistance = Math.min(requestedHandoff, maxHandoff);
    if (handoffDistance <= minPositive) {
      continue;
    }

    const tanHalfAngle = Math.tan(turnAngle / 2);
    if (!Number.isFinite(tanHalfAngle) || tanHalfAngle <= minPositive) {
      continue;
    }

    const tangentFilletRadius = handoffDistance / tanHalfAngle;
    const effectiveRadius = Math.max(
      handoffDistance,
      tangentFilletRadius,
      1e-4,
    );
    const anchorS = cumulativeLengths[anchorIndex] ?? 0;
    corners.push({
      anchorOrdinal: anchorIndex + 1,
      turnAngleRadians: turnAngle,
      handoffDistanceMeters: handoffDistance,
      effectiveRadiusMeters: effectiveRadius,
      curvature: 1 / effectiveRadius,
      startS: Math.max(0, anchorS - handoffDistance),
      endS: Math.min(
        cumulativeLengths.at(-1) ?? anchorS,
        anchorS + handoffDistance,
      ),
      clamped: handoffDistance < requestedHandoff - 1e-9,
    });
  }

  return corners;
}

function solveSegmentCapsWithSimulation(
  path: PathModel,
  config: unknown,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): AutoVelocitySolverResult {
  const capsByOrdinal = initialCapsByOrdinal(anchors, usableMaxVelocityMps);
  let evaluation = evaluateVelocityCaps(
    path,
    config,
    segments,
    corners,
    capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );

  if (corners.length === 0 || evaluation.passed) {
    return { capsByOrdinal, trace: evaluation.trace };
  }

  const minCap = minimumSolverCap(usableMaxVelocityMps);
  for (let pass = 0; pass < solverPairPasses; pass += 1) {
    let changed = false;
    const orderedCorners = pass % 2 === 0 ? corners : [...corners].reverse();

    for (const corner of orderedCorners) {
      const handoff = evaluation.handoffs.find(
        (candidate) => candidate.corner.anchorOrdinal === corner.anchorOrdinal,
      );
      if (handoff?.passed) {
        continue;
      }

      const optimized = optimizeHandoffPair(
        path,
        config,
        segments,
        corners,
        capsByOrdinal,
        corner,
        minCap,
        usableMaxVelocityMps,
        usableMaxAccelerationMps2,
        evaluation,
      );
      if (optimized.changed) {
        capsByOrdinal.set(corner.anchorOrdinal, optimized.incomingCap);
        capsByOrdinal.set(corner.anchorOrdinal + 1, optimized.outgoingCap);
        evaluation = optimized.evaluation;
        changed = true;
      }
    }

    if (evaluation.passed || !changed) {
      break;
    }
  }

  evaluation = refineVelocityCaps(
    path,
    config,
    anchors,
    segments,
    corners,
    capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
    evaluation,
  );

  return { capsByOrdinal, trace: evaluation.trace };
}

function initialCapsByOrdinal(
  anchors: readonly AutoVelocityAnchor[],
  usableMaxVelocityMps: number,
): Map<number, number> {
  const capsByOrdinal = new Map<number, number>();
  for (let ordinal = 2; ordinal <= anchors.length; ordinal += 1) {
    capsByOrdinal.set(ordinal, usableMaxVelocityMps);
  }
  return capsByOrdinal;
}

function refineVelocityCaps(
  path: PathModel,
  config: unknown,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  capsByOrdinal: Map<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
  currentEvaluation: VelocityCapEvaluation,
): VelocityCapEvaluation {
  let evaluation = currentEvaluation;
  const ordinals = Array.from(
    { length: Math.max(0, anchors.length - 1) },
    (_, index) => index + 2,
  );

  for (let round = 0; round < solverRefinementRounds; round += 1) {
    const orders =
      round % 2 === 0
        ? [ordinals, [...ordinals].reverse()]
        : [[...ordinals].reverse(), ordinals];
    for (const order of orders) {
      for (const ordinal of order) {
        const current = capsByOrdinal.get(ordinal);
        if (
          current === undefined ||
          usableMaxVelocityMps - current <= solverCapToleranceMps
        ) {
          continue;
        }

        let bestEvaluation = evaluation;
        let bestValue = current;

        for (const candidate of refinementVelocityGrid(
          current,
          usableMaxVelocityMps,
        )) {
          const trialCaps = new Map(capsByOrdinal);
          trialCaps.set(ordinal, candidate);
          const trialEvaluation = evaluateVelocityCaps(
            path,
            config,
            segments,
            corners,
            trialCaps,
            usableMaxVelocityMps,
            usableMaxAccelerationMps2,
          );

          if (
            isBetterEvaluation(
              trialEvaluation,
              trialCaps,
              bestEvaluation,
              capsByOrdinal,
            )
          ) {
            bestValue = candidate;
            bestEvaluation = trialEvaluation;
          }
        }

        capsByOrdinal.set(ordinal, bestValue);
        evaluation = bestEvaluation;
      }
    }
  }

  return evaluation;
}

function optimizeHandoffPair(
  path: PathModel,
  config: unknown,
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  capsByOrdinal: ReadonlyMap<number, number>,
  corner: AutoVelocityCorner,
  minCap: number,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
  currentEvaluation: VelocityCapEvaluation,
): {
  changed: boolean;
  incomingCap: number;
  outgoingCap: number;
  evaluation: VelocityCapEvaluation;
} {
  const incomingOrdinal = corner.anchorOrdinal;
  const outgoingOrdinal = corner.anchorOrdinal + 1;
  const currentIncoming =
    capsByOrdinal.get(incomingOrdinal) ?? usableMaxVelocityMps;
  const currentOutgoing =
    capsByOrdinal.get(outgoingOrdinal) ?? usableMaxVelocityMps;
  let bestIncoming = currentIncoming;
  let bestOutgoing = currentOutgoing;
  let bestEvaluation = currentEvaluation;
  let bestCaps = capsByOrdinal;
  const incomingCandidates = velocityGrid(
    currentIncoming,
    minCap,
    usableMaxVelocityMps,
  );
  const outgoingCandidates = velocityGrid(
    currentOutgoing,
    minCap,
    usableMaxVelocityMps,
  );

  // Gate error is not monotonic: going too slowly can miss the exit gate too.
  // Search the adjacent cap pair and prefer the fastest candidate that passes.
  for (const incoming of incomingCandidates) {
    for (const outgoing of outgoingCandidates) {
      const trialCaps = new Map(capsByOrdinal);
      trialCaps.set(incomingOrdinal, incoming);
      trialCaps.set(outgoingOrdinal, outgoing);
      const trialEvaluation = evaluateVelocityCaps(
        path,
        config,
        segments,
        corners,
        trialCaps,
        usableMaxVelocityMps,
        usableMaxAccelerationMps2,
      );

      if (
        isBetterEvaluation(trialEvaluation, trialCaps, bestEvaluation, bestCaps)
      ) {
        bestIncoming = incoming;
        bestOutgoing = outgoing;
        bestEvaluation = trialEvaluation;
        bestCaps = trialCaps;
      }
    }
  }

  return {
    changed:
      Math.abs(bestIncoming - currentIncoming) > solverCapToleranceMps ||
      Math.abs(bestOutgoing - currentOutgoing) > solverCapToleranceMps,
    incomingCap: bestIncoming,
    outgoingCap: bestOutgoing,
    evaluation: bestEvaluation,
  };
}

function evaluateVelocityCaps(
  path: PathModel,
  config: unknown,
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  capsByOrdinal: ReadonlyMap<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): VelocityCapEvaluation {
  const candidate = pathWithVelocityCaps(
    path,
    capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  const result = simulatePathWithTrace(candidate, config, {
    dt_s: solverDtSeconds,
  });
  const finalGlobalS =
    result.global_s_by_time.get(result.times_sorted.at(-1) ?? 0) ?? 0;
  const totalLength = segments.at(-1)?.endS ?? 0;
  const reachedEnd =
    totalLength <= minPositive || finalGlobalS >= totalLength - 0.02;
  const handoffs = corners.map((corner) =>
    evaluateHandoff(corner, segments, result.trace),
  );

  return {
    handoffs,
    passed: reachedEnd && handoffs.every((handoff) => handoff.passed),
    trace: result.trace,
  };
}

function evaluateHandoff(
  corner: AutoVelocityCorner,
  segments: readonly SegmentGeometry[],
  trace: readonly SimulationTraceSample[],
): HandoffEvaluation {
  const incomingSegment = segments[corner.anchorOrdinal - 2];
  const outgoingSegment = segments[corner.anchorOrdinal - 1];
  const tolerance = handoffTolerance(corner.handoffDistanceMeters);
  const entryPoint = sampleTraceAtS(trace, corner.startS);
  const exitPoint = sampleTraceAtS(trace, corner.endS);
  const entryError =
    entryPoint && incomingSegment
      ? crossTrackError(entryPoint.x, entryPoint.y, incomingSegment)
      : Number.POSITIVE_INFINITY;
  const exitError =
    exitPoint && outgoingSegment
      ? crossTrackError(exitPoint.x, exitPoint.y, outgoingSegment)
      : Number.POSITIVE_INFINITY;
  const combinedError = Math.hypot(entryError, exitError);

  return {
    corner,
    incomingOrdinal: corner.anchorOrdinal,
    outgoingOrdinal: corner.anchorOrdinal + 1,
    toleranceMeters: tolerance,
    entryErrorMeters: entryError,
    exitErrorMeters: exitError,
    combinedErrorMeters: combinedError,
    passed: combinedError <= tolerance,
  };
}

function pathWithVelocityCaps(
  path: PathModel,
  capsByOrdinal: ReadonlyMap<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): PathModel {
  const generated = [...capsByOrdinal.entries()].map(([ordinal, value]) => ({
    key: "max_velocity_meters_per_sec" as const,
    value,
    start_ordinal: ordinal,
    end_ordinal: ordinal,
  }));

  return {
    ...path,
    constraints: {
      ...path.constraints,
      max_velocity_meters_per_sec: usableMaxVelocityMps,
      max_acceleration_meters_per_sec2: usableMaxAccelerationMps2,
    },
    ranged_constraints: path.ranged_constraints
      .filter((constraint) => !isTranslationRangedConstraintKey(constraint.key))
      .concat(generated),
  };
}

function segmentCapsFromSolvedCaps(
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  capsByOrdinal: ReadonlyMap<number, number>,
  baseMaxVelocityMps: number,
  usableMaxVelocityMps: number,
): AutoVelocitySegmentCap[] {
  const firstOrdinalValue = Math.min(
    baseMaxVelocityMps * defaultFirstOrdinalVelocityRatio,
    usableMaxVelocityMps,
  );
  const firstOrdinalCap =
    anchors.length > 0
      ? [
          {
            segmentIndex: 0,
            targetOrdinal: 1,
            value: roundConstraintValue(firstOrdinalValue),
            minVelocityLimitMps: roundConstraintValue(firstOrdinalValue),
          },
        ]
      : [];

  return firstOrdinalCap.concat(
    segments.map((_, segmentIndex) => {
      const targetOrdinal = segmentIndex + 2;
      const value = capsByOrdinal.get(targetOrdinal) ?? usableMaxVelocityMps;

      return {
        segmentIndex,
        targetOrdinal,
        value: roundConstraintValue(Math.min(usableMaxVelocityMps, value)),
        minVelocityLimitMps: roundConstraintValue(
          Math.min(usableMaxVelocityMps, value),
        ),
      };
    }),
  );
}

function samplesFromTrace(
  trace: readonly SimulationTraceSample[],
  usableMaxVelocityMps: number,
): AutoVelocitySample[] {
  return trace.map((sample) => ({
    sMeters: roundDistance(sample.global_s_m),
    curvature: 0,
    velocityLimitMps: usableMaxVelocityMps,
    velocityMps: Math.min(sample.speed_mps, usableMaxVelocityMps),
  }));
}

function sampleTraceAtS(
  trace: readonly SimulationTraceSample[],
  sMeters: number,
): { x: number; y: number } | null {
  if (trace.length === 0) {
    return null;
  }

  const target = roundDistance(sMeters);
  for (let index = 1; index < trace.length; index += 1) {
    const previous = trace[index - 1];
    const current = trace[index];
    if (!previous || !current) {
      continue;
    }

    const lower = Math.min(previous.global_s_m, current.global_s_m);
    const upper = Math.max(previous.global_s_m, current.global_s_m);
    if (target < lower - 1e-6 || target > upper + 1e-6) {
      continue;
    }

    const ds = current.global_s_m - previous.global_s_m;
    if (Math.abs(ds) <= minPositive) {
      return { x: current.x_m, y: current.y_m };
    }

    const alpha = clamp((target - previous.global_s_m) / ds, 0, 1);
    return {
      x: previous.x_m + (current.x_m - previous.x_m) * alpha,
      y: previous.y_m + (current.y_m - previous.y_m) * alpha,
    };
  }

  return null;
}

function crossTrackError(
  x: number,
  y: number,
  segment: SegmentGeometry,
): number {
  const dx = x - segment.ax;
  const dy = y - segment.ay;
  return Math.abs(dx * segment.uy - dy * segment.ux);
}

function handoffTolerance(handoffDistanceMeters: number): number {
  return Math.max(
    gateToleranceFloorMeters,
    handoffDistanceMeters * gateToleranceRatio,
  );
}

function minimumSolverCap(usableMaxVelocityMps: number): number {
  return Math.max(0.05, usableMaxVelocityMps * solverMinVelocityRatio);
}

function velocityGrid(
  current: number,
  minCap: number,
  usableMaxVelocityMps: number,
): number[] {
  return uniqueSortedVelocities(
    [
      current,
      minCap,
      usableMaxVelocityMps,
      usableMaxVelocityMps * 0.2,
      usableMaxVelocityMps * 0.35,
      usableMaxVelocityMps * 0.5,
      usableMaxVelocityMps * 0.7,
    ],
    minCap,
    usableMaxVelocityMps,
  );
}

function refinementVelocityGrid(
  current: number,
  usableMaxVelocityMps: number,
): number[] {
  const delta = usableMaxVelocityMps - current;
  return uniqueSortedVelocities(
    [
      current + delta * 0.1,
      current + delta * 0.25,
      current + delta * 0.75,
      usableMaxVelocityMps,
    ],
    current,
    usableMaxVelocityMps,
  );
}

function uniqueSortedVelocities(
  values: readonly number[],
  minValue: number,
  maxValue: number,
): number[] {
  return [
    ...new Set(
      values
        .filter((value) => Number.isFinite(value))
        .map((value) => roundSolverVelocity(clamp(value, minValue, maxValue))),
    ),
  ].sort((left, right) => left - right);
}

function isBetterEvaluation(
  candidate: VelocityCapEvaluation,
  candidateCaps: ReadonlyMap<number, number>,
  current: VelocityCapEvaluation,
  currentCaps: ReadonlyMap<number, number>,
): boolean {
  const candidateQuality = evaluationQuality(candidate);
  const currentQuality = evaluationQuality(current);

  if (candidate.passed !== current.passed) {
    return candidate.passed;
  }

  if (!candidate.passed) {
    if (candidateQuality.maxRatio < currentQuality.maxRatio - 0.02) {
      return true;
    }
    if (candidateQuality.maxRatio > currentQuality.maxRatio + 0.02) {
      return false;
    }
    if (
      candidateQuality.sumSquaredRatio <
      currentQuality.sumSquaredRatio - 0.05
    ) {
      return true;
    }
    if (
      candidateQuality.sumSquaredRatio >
      currentQuality.sumSquaredRatio + 0.05
    ) {
      return false;
    }
  } else if (
    candidateQuality.sumSquaredRatio < currentQuality.sumSquaredRatio - 0.05 &&
    capSum(candidateCaps) >= capSum(currentCaps) - solverCapToleranceMps
  ) {
    return true;
  }

  return capSum(candidateCaps) > capSum(currentCaps) + solverCapToleranceMps;
}

function evaluationQuality(evaluation: VelocityCapEvaluation): {
  maxRatio: number;
  sumSquaredRatio: number;
} {
  if (evaluation.handoffs.length === 0) {
    return { maxRatio: 0, sumSquaredRatio: 0 };
  }

  let maxRatio = 0;
  let sumSquaredRatio = 0;
  for (const handoff of evaluation.handoffs) {
    const ratio =
      handoff.combinedErrorMeters /
      Math.max(handoff.toleranceMeters, minPositive);
    maxRatio = Math.max(maxRatio, ratio);
    sumSquaredRatio += ratio ** 2;
  }

  return { maxRatio, sumSquaredRatio };
}

function capSum(caps: ReadonlyMap<number, number>): number {
  let sum = 0;
  for (const value of caps.values()) {
    sum += value;
  }
  return sum;
}

function isTranslationRangedConstraintKey(key: RangedConstraintKey): boolean {
  return (
    key === "max_velocity_meters_per_sec" ||
    key === "max_acceleration_meters_per_sec2"
  );
}

function handoffRadiusForAnchor(
  element: PathElement | undefined,
  defaultHandoffRadius: number,
): number {
  const value =
    element && isTranslationTarget(element)
      ? element.intermediate_handoff_radius_meters
      : element && isWaypoint(element)
        ? element.translation_target.intermediate_handoff_radius_meters
        : null;
  return resolvePositive(value, null, defaultHandoffRadius);
}

function resolvePositive(
  value: unknown,
  fallback: unknown,
  defaultValue: number,
): number {
  return positiveNumber(value, positiveNumber(fallback, defaultValue));
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampSafetyFactor(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0.05, 1) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function roundDistance(value: number): number {
  return Number(value.toFixed(6));
}

function roundSolverVelocity(value: number): number {
  return Number(value.toFixed(3));
}

function roundConstraintValue(value: number): number {
  return Number(Math.max(0.01, value).toFixed(2));
}

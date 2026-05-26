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
import type { SimulationConfig, SimulationTraceSample } from "../sim/types";

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

export interface AutoVelocityHandoffDiagnostic {
  anchorOrdinal: number;
  incomingOrdinal: number;
  outgoingOrdinal: number;
  toleranceMeters: number;
  postHandoffToleranceMeters: number;
  entryErrorMeters: number;
  exitErrorMeters: number;
  combinedErrorMeters: number;
  postHandoffPeakErrorMeters: number;
  passed: boolean;
}

export interface AutoVelocityDiagnostics {
  reachedEnd: boolean;
  totalTimeS: number;
  finalGlobalSMeters: number;
  totalLengthMeters: number;
  maxHandoffErrorRatio: number;
  maxPostHandoffErrorRatio: number;
  handoffs: AutoVelocityHandoffDiagnostic[];
}

export interface AutoVelocityProfile {
  anchors: AutoVelocityAnchor[];
  corners: AutoVelocityCorner[];
  samples: AutoVelocitySample[];
  segmentCaps: AutoVelocitySegmentCap[];
  diagnostics: AutoVelocityDiagnostics;
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
  evaluation: VelocityCapEvaluation;
  trace: SimulationTraceSample[];
}

interface HandoffEvaluation {
  corner: AutoVelocityCorner;
  incomingOrdinal: number;
  outgoingOrdinal: number;
  toleranceMeters: number;
  postHandoffToleranceMeters: number;
  entryErrorMeters: number;
  exitErrorMeters: number;
  postHandoffPeakErrorMeters: number;
  combinedErrorMeters: number;
  passed: boolean;
}

interface VelocityCapEvaluation {
  handoffs: HandoffEvaluation[];
  passed: boolean;
  reachedEnd: boolean;
  totalTimeS: number;
  finalGlobalSMeters: number;
  totalLengthMeters: number;
  trace: SimulationTraceSample[];
}

const defaultMaxVelocityMps = 4.5;
const defaultMaxAccelerationMps2 = 7;
const defaultHandoffRadiusMeters = 0.2;
const defaultSampleStepMeters = 0.05;
const defaultFirstOrdinalVelocityRatio = 0.5;
const solverDtSeconds = 0.02;
const solverPairPasses = 3;
const solverRefinementRounds = 3;
const solverWindowPasses = 2;
const solverCapToleranceMps = 0.01;
const solverMinVelocityRatio = 0.05;
const gateToleranceFloorMeters = 0.05;
const gateToleranceRatio = 0.25;
const postHandoffLookaheadMeters = 0.6;
const postHandoffToleranceFloorMeters = 0.08;
const postHandoffToleranceRatio = 0.35;
const maxProfileCacheEntries = 32;
const minPositive = 1e-9;
const profileCache = new Map<string, AutoVelocityProfile>();

export function generateAutoVelocityProfile(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions = {},
): AutoVelocityProfile {
  const cacheKey = autoVelocityProfileCacheKey(path, config, options);
  const cached = cacheKey === null ? undefined : profileCache.get(cacheKey);
  if (cacheKey !== null && cached) {
    profileCache.delete(cacheKey);
    profileCache.set(cacheKey, cached);
    return cached;
  }

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
  const segmentCaps = segmentCapsFromSolvedCaps(
    anchors,
    segments,
    solver.capsByOrdinal,
    baseMaxVelocity,
    usableMaxVelocityMps,
  );
  const generatedCapsByOrdinal = capsByOrdinalFromSegmentCaps(segmentCaps);
  const generatedEvaluation = evaluateVelocityCaps(
    path,
    config,
    segments,
    corners,
    generatedCapsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  const samples = samplesFromTrace(
    generatedEvaluation.trace,
    usableMaxVelocityMps,
  );

  const profile = {
    anchors,
    corners,
    samples,
    segmentCaps,
    diagnostics: diagnosticsFromEvaluation(generatedEvaluation),
    settings,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  };

  if (cacheKey !== null) {
    profileCache.set(cacheKey, profile);
    while (profileCache.size > maxProfileCacheEntries) {
      const oldestKey = profileCache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      profileCache.delete(oldestKey);
    }
  }

  return profile;
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

function autoVelocityProfileCacheKey(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions,
): string | null {
  try {
    return JSON.stringify({ path, config, options });
  } catch {
    return null;
  }
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
  config: SimulationConfig,
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
    return { capsByOrdinal, evaluation, trace: evaluation.trace };
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

  if (!evaluation.passed) {
    evaluation = applyGlobalVelocitySeeds(
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

  if (!evaluation.passed) {
    evaluation = applyGlobalVelocitySeeds(
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
  }

  evaluation = optimizeVelocityWindows(
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

  evaluation = relaxVelocityWindowDipsWithinTimeBudget(
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

  evaluation = liftVelocityCapsWithinTimeBudget(
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

  return { capsByOrdinal, evaluation, trace: evaluation.trace };
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

function applyGlobalVelocitySeeds(
  path: PathModel,
  config: SimulationConfig,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  capsByOrdinal: Map<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
  currentEvaluation: VelocityCapEvaluation,
): VelocityCapEvaluation {
  let bestCaps = new Map(capsByOrdinal);
  let bestEvaluation = currentEvaluation;
  const minCap = minimumSolverCap(usableMaxVelocityMps);
  const ratios = [0.9, 0.8, 0.65, 0.5, 0.35, 0.25, 0.18, 0.12, 0.08];

  for (const ratio of ratios) {
    const value = clamp(
      usableMaxVelocityMps * ratio,
      minCap,
      usableMaxVelocityMps,
    );
    const trialCaps = new Map<number, number>();
    for (let ordinal = 2; ordinal <= anchors.length; ordinal += 1) {
      trialCaps.set(ordinal, value);
    }
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
      bestCaps = trialCaps;
      bestEvaluation = trialEvaluation;
    }
  }

  capsByOrdinal.clear();
  for (const [ordinal, value] of bestCaps) {
    capsByOrdinal.set(ordinal, value);
  }
  return bestEvaluation;
}

function liftVelocityCapsWithinTimeBudget(
  path: PathModel,
  config: SimulationConfig,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  capsByOrdinal: Map<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
  currentEvaluation: VelocityCapEvaluation,
): VelocityCapEvaluation {
  if (!currentEvaluation.passed) {
    return currentEvaluation;
  }

  let evaluation = currentEvaluation;
  const maxAllowedTimeS = currentEvaluation.totalTimeS * 1.05 + solverDtSeconds;
  const ordinals = Array.from(
    { length: Math.max(0, anchors.length - 1) },
    (_, index) => index + 2,
  );

  for (const order of [ordinals, [...ordinals].reverse()]) {
    for (const ordinal of order) {
      const current = capsByOrdinal.get(ordinal);
      if (
        current === undefined ||
        usableMaxVelocityMps - current <= solverCapToleranceMps
      ) {
        continue;
      }

      let bestValue = current;
      let bestEvaluation = evaluation;
      for (const candidate of liftVelocityGrid(current, usableMaxVelocityMps)) {
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
          trialEvaluation.passed &&
          trialEvaluation.totalTimeS <= maxAllowedTimeS
        ) {
          bestValue = candidate;
          bestEvaluation = trialEvaluation;
          break;
        }
      }

      capsByOrdinal.set(ordinal, bestValue);
      evaluation = bestEvaluation;
    }
  }

  return evaluation;
}

function optimizeVelocityWindows(
  path: PathModel,
  config: SimulationConfig,
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
  if (ordinals.length < 3) {
    return evaluation;
  }

  for (let pass = 0; pass < solverWindowPasses; pass += 1) {
    const starts =
      pass % 2 === 0 ? ordinals.slice(0, -2) : ordinals.slice(0, -2).reverse();

    for (const startOrdinal of starts) {
      const windowOrdinals = [startOrdinal, startOrdinal + 1, startOrdinal + 2];
      const candidates = windowOrdinals.map((ordinal) =>
        windowVelocityGrid(
          capsByOrdinal.get(ordinal) ?? usableMaxVelocityMps,
          minimumSolverCap(usableMaxVelocityMps),
          usableMaxVelocityMps,
        ),
      );
      let bestCaps = new Map(capsByOrdinal);
      let bestEvaluation = evaluation;

      for (const first of candidates[0] ?? []) {
        for (const second of candidates[1] ?? []) {
          for (const third of candidates[2] ?? []) {
            const trialCaps = new Map(capsByOrdinal);
            trialCaps.set(windowOrdinals[0], first);
            trialCaps.set(windowOrdinals[1], second);
            trialCaps.set(windowOrdinals[2], third);
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
                bestCaps,
              )
            ) {
              bestCaps = trialCaps;
              bestEvaluation = trialEvaluation;
            }
          }
        }
      }

      if (bestEvaluation !== evaluation) {
        for (const ordinal of windowOrdinals) {
          const value = bestCaps.get(ordinal);
          if (value !== undefined) {
            capsByOrdinal.set(ordinal, value);
          }
        }
        evaluation = bestEvaluation;
      }
    }
  }

  return evaluation;
}

function relaxVelocityWindowDipsWithinTimeBudget(
  path: PathModel,
  config: SimulationConfig,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  capsByOrdinal: Map<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
  currentEvaluation: VelocityCapEvaluation,
): VelocityCapEvaluation {
  if (!currentEvaluation.passed) {
    return currentEvaluation;
  }

  let evaluation = currentEvaluation;
  const maxAllowedTimeS = currentEvaluation.totalTimeS * 1.03 + solverDtSeconds;
  const ordinals = Array.from(
    { length: Math.max(0, anchors.length - 1) },
    (_, index) => index + 2,
  );
  if (ordinals.length < 3) {
    return evaluation;
  }

  for (const centerOrdinal of ordinals.slice(1, -1)) {
    const windowOrdinals = [
      centerOrdinal - 1,
      centerOrdinal,
      centerOrdinal + 1,
    ];
    const centerCurrent = capsByOrdinal.get(centerOrdinal);
    if (
      centerCurrent === undefined ||
      usableMaxVelocityMps - centerCurrent <= solverCapToleranceMps
    ) {
      continue;
    }

    const candidates = windowOrdinals.map((ordinal) =>
      windowVelocityGrid(
        capsByOrdinal.get(ordinal) ?? usableMaxVelocityMps,
        minimumSolverCap(usableMaxVelocityMps),
        usableMaxVelocityMps,
      ),
    );
    let bestCaps = new Map(capsByOrdinal);
    let bestEvaluation = evaluation;
    let bestCenter = centerCurrent;
    let bestWindowSum = windowCapSum(bestCaps, windowOrdinals);

    for (const first of candidates[0] ?? []) {
      for (const second of candidates[1] ?? []) {
        if (second < bestCenter + solverCapToleranceMps) {
          continue;
        }
        for (const third of candidates[2] ?? []) {
          const trialCaps = new Map(capsByOrdinal);
          trialCaps.set(windowOrdinals[0], first);
          trialCaps.set(windowOrdinals[1], second);
          trialCaps.set(windowOrdinals[2], third);
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
            !trialEvaluation.passed ||
            trialEvaluation.totalTimeS > maxAllowedTimeS
          ) {
            continue;
          }

          const trialWindowSum = windowCapSum(trialCaps, windowOrdinals);
          if (
            second > bestCenter + solverCapToleranceMps ||
            (Math.abs(second - bestCenter) <= solverCapToleranceMps &&
              trialWindowSum > bestWindowSum + solverCapToleranceMps)
          ) {
            bestCaps = trialCaps;
            bestEvaluation = trialEvaluation;
            bestCenter = second;
            bestWindowSum = trialWindowSum;
          }
        }
      }
    }

    if (bestCenter > centerCurrent + solverCapToleranceMps) {
      for (const ordinal of windowOrdinals) {
        const value = bestCaps.get(ordinal);
        if (value !== undefined) {
          capsByOrdinal.set(ordinal, value);
        }
      }
      evaluation = bestEvaluation;
    }
  }

  return evaluation;
}

function refineVelocityCaps(
  path: PathModel,
  config: SimulationConfig,
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
        let bestCaps = new Map(capsByOrdinal);

        for (const candidate of refinementVelocityGrid(
          current,
          minimumSolverCap(usableMaxVelocityMps),
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
              bestCaps,
            )
          ) {
            bestValue = candidate;
            bestEvaluation = trialEvaluation;
            bestCaps = trialCaps;
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
  config: SimulationConfig,
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
  config: SimulationConfig,
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
    reachedEnd,
    totalTimeS: result.total_time_s,
    finalGlobalSMeters: finalGlobalS,
    totalLengthMeters: totalLength,
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
  const postHandoffTolerance = postHandoffToleranceMeters(
    corner.handoffDistanceMeters,
  );
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
  const postHandoffPeakError = outgoingSegment
    ? postHandoffPeakCrossTrackError(corner, outgoingSegment, trace)
    : Number.POSITIVE_INFINITY;
  const combinedError = Math.hypot(entryError, exitError);

  return {
    corner,
    incomingOrdinal: corner.anchorOrdinal,
    outgoingOrdinal: corner.anchorOrdinal + 1,
    toleranceMeters: tolerance,
    postHandoffToleranceMeters: postHandoffTolerance,
    entryErrorMeters: entryError,
    exitErrorMeters: exitError,
    postHandoffPeakErrorMeters: postHandoffPeakError,
    combinedErrorMeters: combinedError,
    passed:
      combinedError <= tolerance &&
      postHandoffPeakError <= postHandoffTolerance,
  };
}

function diagnosticsFromEvaluation(
  evaluation: VelocityCapEvaluation,
): AutoVelocityDiagnostics {
  let maxHandoffErrorRatio = 0;
  let maxPostHandoffErrorRatio = 0;
  const handoffs = evaluation.handoffs.map((handoff) => {
    const handoffRatio =
      handoff.combinedErrorMeters /
      Math.max(handoff.toleranceMeters, minPositive);
    const postHandoffRatio =
      handoff.postHandoffPeakErrorMeters /
      Math.max(handoff.postHandoffToleranceMeters, minPositive);
    maxHandoffErrorRatio = Math.max(maxHandoffErrorRatio, handoffRatio);
    maxPostHandoffErrorRatio = Math.max(
      maxPostHandoffErrorRatio,
      postHandoffRatio,
    );

    return {
      anchorOrdinal: handoff.corner.anchorOrdinal,
      incomingOrdinal: handoff.incomingOrdinal,
      outgoingOrdinal: handoff.outgoingOrdinal,
      toleranceMeters: roundDistance(handoff.toleranceMeters),
      postHandoffToleranceMeters: roundDistance(
        handoff.postHandoffToleranceMeters,
      ),
      entryErrorMeters: roundDistance(handoff.entryErrorMeters),
      exitErrorMeters: roundDistance(handoff.exitErrorMeters),
      combinedErrorMeters: roundDistance(handoff.combinedErrorMeters),
      postHandoffPeakErrorMeters: roundDistance(
        handoff.postHandoffPeakErrorMeters,
      ),
      passed: handoff.passed,
    };
  });

  return {
    reachedEnd: evaluation.reachedEnd,
    totalTimeS: roundDistance(evaluation.totalTimeS),
    finalGlobalSMeters: roundDistance(evaluation.finalGlobalSMeters),
    totalLengthMeters: roundDistance(evaluation.totalLengthMeters),
    maxHandoffErrorRatio: roundDistance(maxHandoffErrorRatio),
    maxPostHandoffErrorRatio: roundDistance(maxPostHandoffErrorRatio),
    handoffs,
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
    value: roundConstraintValue(value),
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

function capsByOrdinalFromSegmentCaps(
  segmentCaps: readonly AutoVelocitySegmentCap[],
): Map<number, number> {
  const capsByOrdinal = new Map<number, number>();
  for (const cap of segmentCaps) {
    if (cap.targetOrdinal > 1) {
      capsByOrdinal.set(cap.targetOrdinal, cap.value);
    }
  }
  return capsByOrdinal;
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

function postHandoffPeakCrossTrackError(
  corner: AutoVelocityCorner,
  outgoingSegment: SegmentGeometry,
  trace: readonly SimulationTraceSample[],
): number {
  const startS = corner.endS;
  const endS = Math.min(
    outgoingSegment.endS,
    startS + postHandoffLookaheadMeters,
  );
  let peak = 0;
  let foundSample = false;

  for (const sMeters of [startS, endS]) {
    const point = sampleTraceAtS(trace, sMeters);
    if (point) {
      peak = Math.max(peak, crossTrackError(point.x, point.y, outgoingSegment));
      foundSample = true;
    }
  }

  for (const sample of trace) {
    if (sample.global_s_m < startS - 1e-6 || sample.global_s_m > endS + 1e-6) {
      continue;
    }

    peak = Math.max(
      peak,
      crossTrackError(sample.x_m, sample.y_m, outgoingSegment),
    );
    foundSample = true;
  }

  return foundSample ? peak : Number.POSITIVE_INFINITY;
}

function handoffTolerance(handoffDistanceMeters: number): number {
  return Math.max(
    gateToleranceFloorMeters,
    handoffDistanceMeters * gateToleranceRatio,
  );
}

function postHandoffToleranceMeters(handoffDistanceMeters: number): number {
  return Math.max(
    postHandoffToleranceFloorMeters,
    handoffDistanceMeters * postHandoffToleranceRatio,
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
      usableMaxVelocityMps * 0.12,
      usableMaxVelocityMps * 0.18,
      usableMaxVelocityMps * 0.25,
      usableMaxVelocityMps * 0.35,
      usableMaxVelocityMps * 0.5,
      usableMaxVelocityMps * 0.65,
      usableMaxVelocityMps * 0.8,
      usableMaxVelocityMps * 0.9,
    ],
    minCap,
    usableMaxVelocityMps,
  );
}

function refinementVelocityGrid(
  current: number,
  minCap: number,
  usableMaxVelocityMps: number,
): number[] {
  const delta = usableMaxVelocityMps - current;
  return uniqueSortedVelocities(
    [
      current - usableMaxVelocityMps * 0.2,
      current - usableMaxVelocityMps * 0.1,
      current - usableMaxVelocityMps * 0.05,
      current,
      current + delta * 0.1,
      current + delta * 0.2,
      current + delta * 0.35,
      current + delta * 0.5,
      current + delta * 0.7,
      current + delta * 0.85,
      usableMaxVelocityMps * 0.12,
      usableMaxVelocityMps * 0.18,
      usableMaxVelocityMps * 0.25,
      usableMaxVelocityMps * 0.35,
      usableMaxVelocityMps * 0.5,
      usableMaxVelocityMps * 0.65,
      usableMaxVelocityMps * 0.8,
      usableMaxVelocityMps * 0.9,
      usableMaxVelocityMps,
    ],
    minCap,
    usableMaxVelocityMps,
  );
}

function liftVelocityGrid(
  current: number,
  usableMaxVelocityMps: number,
): number[] {
  return uniqueSortedVelocities(
    [
      usableMaxVelocityMps,
      usableMaxVelocityMps * 0.95,
      usableMaxVelocityMps * 0.9,
      usableMaxVelocityMps * 0.85,
      usableMaxVelocityMps * 0.8,
      usableMaxVelocityMps * 0.75,
      usableMaxVelocityMps * 0.65,
      usableMaxVelocityMps * 0.5,
      current + (usableMaxVelocityMps - current) * 0.2,
      current + (usableMaxVelocityMps - current) * 0.15,
      current + (usableMaxVelocityMps - current) * 0.1,
      current + (usableMaxVelocityMps - current) * 0.85,
      current + (usableMaxVelocityMps - current) * 0.7,
      current + (usableMaxVelocityMps - current) * 0.5,
      current + (usableMaxVelocityMps - current) * 0.3,
      current,
    ],
    current,
    usableMaxVelocityMps,
  ).reverse();
}

function windowVelocityGrid(
  current: number,
  minCap: number,
  usableMaxVelocityMps: number,
): number[] {
  return uniqueSortedVelocities(
    [
      current,
      current - usableMaxVelocityMps * 0.2,
      current - usableMaxVelocityMps * 0.1,
      current + usableMaxVelocityMps * 0.1,
      current + usableMaxVelocityMps * 0.2,
      usableMaxVelocityMps * 0.35,
      usableMaxVelocityMps * 0.5,
      usableMaxVelocityMps * 0.65,
      usableMaxVelocityMps * 0.75,
      usableMaxVelocityMps * 0.85,
      usableMaxVelocityMps * 0.865,
      usableMaxVelocityMps * 0.9,
      usableMaxVelocityMps,
    ],
    minCap,
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
    if (candidate.totalTimeS < current.totalTimeS - solverDtSeconds) {
      return true;
    }
    if (candidate.totalTimeS > current.totalTimeS + solverDtSeconds) {
      return false;
    }
  } else if (candidate.totalTimeS < current.totalTimeS - solverDtSeconds) {
    return true;
  } else if (candidate.totalTimeS > current.totalTimeS + solverDtSeconds) {
    return false;
  } else if (
    candidateQuality.sumSquaredRatio <
    currentQuality.sumSquaredRatio - 0.05
  ) {
    return true;
  } else if (
    candidateQuality.sumSquaredRatio >
    currentQuality.sumSquaredRatio + 0.05
  ) {
    return false;
  }

  return capSum(candidateCaps) > capSum(currentCaps) + solverCapToleranceMps;
}

function evaluationQuality(evaluation: VelocityCapEvaluation): {
  maxRatio: number;
  sumSquaredRatio: number;
} {
  if (evaluation.handoffs.length === 0) {
    const reachedRatio = reachedEndRatio(evaluation);
    return { maxRatio: reachedRatio, sumSquaredRatio: reachedRatio ** 2 };
  }

  let maxRatio = reachedEndRatio(evaluation);
  let sumSquaredRatio = maxRatio ** 2;
  for (const handoff of evaluation.handoffs) {
    const gateRatio =
      handoff.combinedErrorMeters /
      Math.max(handoff.toleranceMeters, minPositive);
    const postHandoffRatio =
      handoff.postHandoffPeakErrorMeters /
      Math.max(handoff.postHandoffToleranceMeters, minPositive);
    maxRatio = Math.max(maxRatio, gateRatio, postHandoffRatio);
    sumSquaredRatio += gateRatio ** 2 + postHandoffRatio ** 2;
  }

  return { maxRatio, sumSquaredRatio };
}

function reachedEndRatio(evaluation: VelocityCapEvaluation): number {
  if (evaluation.reachedEnd) {
    return 0;
  }

  const remainingMeters = Math.max(
    0,
    evaluation.totalLengthMeters - evaluation.finalGlobalSMeters,
  );
  return 1 + remainingMeters / 0.02;
}

function capSum(caps: ReadonlyMap<number, number>): number {
  let sum = 0;
  for (const value of caps.values()) {
    sum += value;
  }
  return sum;
}

function windowCapSum(
  caps: ReadonlyMap<number, number>,
  ordinals: readonly number[],
): number {
  let sum = 0;
  for (const ordinal of ordinals) {
    sum += caps.get(ordinal) ?? 0;
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
  return Number(Math.max(0.01, Math.floor(value * 100) / 100).toFixed(2));
}

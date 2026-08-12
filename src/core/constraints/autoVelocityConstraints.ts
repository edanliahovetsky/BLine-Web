import {
  defaultAutoVelocityAccelerationSafetyFactor,
  defaultAutoVelocityVelocitySafetyFactor,
  getDefaultOptionalConfigValue,
} from "../config/projectConfig";
import { autoCorridorDeviationBudgetMeters } from "../bend/cornerBend";
import {
  getHandoffRadiusSource,
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  setHandoffRadiusSource,
  type AutoVelocityConstraintMetadata,
  type PathElement,
  type PathModel,
  type RangedConstraintKey,
  type RangedConstraint,
} from "../model/path";
import {
  buildGlobalRotationKeyframes,
  buildRotationDomainEvents,
  desiredHeadingForGlobalS,
  simulatePathWithTrace,
} from "../sim/simulatePath";
import {
  degreesToRadians,
  limitAcceleration,
  shortestAngularDistance,
  wrapAngleRadians,
} from "../sim/simGeometry";
import {
  autoVelocityObjectiveCost,
  autoVelocityTieBreakCost,
} from "./autoVelocityObjective";
import {
  autoHandoffRadiusObjectiveCost,
  type AutoHandoffRadiusObjectiveInput,
} from "./autoHandoffRadiusObjective";
import type {
  ChassisSpeeds,
  RotationDomainEvent,
  RotationKeyframe,
  SimulationConfig,
  SimulationTraceSample,
} from "../sim/types";

export interface AutoVelocityGenerationOptions {
  velocitySafetyFactor?: number;
  accelerationSafetyFactor?: number;
  sampleStepMeters?: number;
  /**
   * Radius-search evaluations must distinguish generated radius candidates.
   * Normal refresh signatures deliberately omit those output values.
   */
  includeGeneratedRadiiInCacheKey?: boolean;
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
  overshootToleranceMeters: number;
  corridorToleranceMeters: number;
  entryErrorMeters: number;
  exitErrorMeters: number;
  combinedErrorMeters: number;
  postHandoffPeakErrorMeters: number;
  overshootErrorMeters: number;
  corridorDeviationMeters: number;
  /** Fraction of the incoming segment completed when the runtime switched. */
  incomingProgressRatio: number;
  /** Fraction of the incoming segment intentionally left untraveled. */
  earlyHandoffRatio: number;
  /** True when one trigger entered and exited the outgoing segment at once. */
  skippedOutgoingSegment: boolean;
  passed: boolean;
}

export interface AutoVelocityDiagnostics {
  reachedEnd: boolean;
  totalTimeS: number;
  finalGlobalSMeters: number;
  totalLengthMeters: number;
  maxHandoffErrorRatio: number;
  maxPostHandoffErrorRatio: number;
  maxOvershootErrorRatio: number;
  maxCorridorDeviationRatio: number;
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

export type JointAutoConstraintSolveStatus =
  | "valid"
  | "best-effort"
  | "unsolvable";

export interface JointAutoConstraintSolveStats {
  algorithm: "interactive" | "oracle";
  evaluations: number;
  evaluationBudget: number;
  searchableBlocks: number;
  cacheHits: number;
  genericEvaluations: number;
  objectiveCost: number;
  genericValidationPassed: boolean;
  stabilityValidationPassed: boolean;
  terminationReason: "converged" | "evaluation-budget" | "no-coordinates";
}

export interface JointAutoConstraintSearchPlan {
  evaluationBudget: number;
  searchableBlocks: number;
}

export interface JointAutoConstraintSolveResult {
  path: PathModel;
  profile: AutoVelocityProfile;
  status: JointAutoConstraintSolveStatus;
  stats: JointAutoConstraintSolveStats;
}

export interface JointAutoConstraintOracleOptions {
  /** Offline reference budget. The production solver never uses this value. */
  maxEvaluations?: number;
  /** Deterministic pseudo-random seed for reproducible comparisons. */
  seed?: number;
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

interface RotationLimitConstraint {
  startOrdinal: number;
  endOrdinal: number;
  value: number;
}

interface AutoVelocitySimulationContext {
  path: PathModel;
  config: SimulationConfig;
  segments: readonly SegmentGeometry[];
  cumulativeLengths: readonly number[];
  rotationKeyframes: readonly RotationKeyframe[];
  rotationDomainEvents: readonly RotationDomainEvent[];
  maxRotationVelocityConstraints: readonly RotationLimitConstraint[];
  maxRotationAccelerationConstraints: readonly RotationLimitConstraint[];
  handoffRadiiBySegmentIndex: readonly number[];
  /**
   * Manual max-velocity caps by target ordinal. The apply step never overwrites
   * a manual constraint, so at these ordinals the pin — not whatever a solver
   * stage tried — is what the robot will run. Every evaluation substitutes them
   * in, which keeps all stages honest without teaching each grid about pins.
   */
  pinnedCapsByOrdinal: ReadonlyMap<number, number>;
  totalPathLength: number;
  startHeadingBase: number;
  initialHeading: number;
  endHeadingTarget: number;
  endX: number;
  endY: number;
  baseMaxOmegaRadps: number;
  baseMaxAlphaRadps2: number;
  defaultHandoffRadiusMeters: number;
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
  overshootToleranceMeters: number;
  corridorToleranceMeters: number;
  entryErrorMeters: number;
  exitErrorMeters: number;
  postHandoffPeakErrorMeters: number;
  overshootErrorMeters: number;
  corridorDeviationMeters: number;
  combinedErrorMeters: number;
  incomingProgressRatio: number;
  earlyHandoffRatio: number;
  skippedOutgoingSegment: boolean;
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
const defaultMaxOmegaDegPerSec = 180;
const defaultMaxAlphaDegPerSec2 = 360;
const defaultHandoffRadiusMeters = 0.45;
const defaultSampleStepMeters = 0.05;
const defaultFirstOrdinalVelocityRatio = 0.5;
const solverDtSeconds = 0.02;
const solverPairPasses = 1;
const solverRefinementRounds = 1;
const solverWindowPasses = 0;
const solverCapToleranceMps = 0.01;
const solverMinVelocityRatio = 0.05;
const gateToleranceFloorMeters = 0.05;
const gateToleranceRatio = 0.25;
const postHandoffLookaheadMeters = 0.6;
const postHandoffToleranceFloorMeters = 0.08;
const postHandoffToleranceRatio = 0.35;
const overshootToleranceFloorMeters = 0.08;
const overshootToleranceRatio = 0.35;
const fastSimulationPassToleranceRatio = 0.97;
/** Uniform caps the solver seeds from, and the ladder the gates sweep. */
const globalVelocitySeedRatios: readonly number[] = [
  0.9, 0.8, 0.65, 0.5, 0.35, 0.25, 0.18, 0.12, 0.08,
];
const radiusObjectiveVelocityRatios: readonly number[] = [0.8, 0.5, 0.25];
const jointSolverStartCandidates = 4;
const jointSolverMovesPerBlock = 8;
const jointSolverSweepCount = 2;
const jointSolverBeamWidth = 2;
const jointRadiusQuantumMeters = 0.001;
const jointVelocityQuantumMps = 0.01;
const jointRadiusFloorMeters = 0.05;
const jointRadiusIncomingLegRatio = 0.9;
const jointObjectiveIndifference = 1e-6;
const jointRobustRadiusMeters = 0.25;
const jointRobustRadiusWeight = 4;
const autoConstraintSolverVersion = 4;
const maxProfileCacheEntries = 32;
const minPositive = 1e-9;
const profileCache = new Map<string, AutoVelocityProfile>();

export function generateAutoVelocityProfile(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions = {},
): AutoVelocityProfile {
  const cacheKey = autoVelocityInputSignature(path, config, options);
  const cached = cacheKey === null ? undefined : profileCache.get(cacheKey);
  if (cacheKey !== null && cached) {
    profileCache.delete(cacheKey);
    profileCache.set(cacheKey, cached);
    return cached;
  }

  const {
    anchors,
    segments,
    corners,
    simulationContext,
    settings,
    baseMaxVelocityMps: baseMaxVelocity,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  } = createAutoVelocitySolveSetup(path, config, options);
  const solver = solveSegmentCapsWithSimulation(
    simulationContext,
    anchors,
    segments,
    corners,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  ensureCapsPassGenericSimulation(
    simulationContext,
    segments,
    corners,
    solver.capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  const postValidationEvaluation = evaluateVelocityCaps(
    simulationContext,
    segments,
    corners,
    solver.capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  const postLiftEvaluation = liftVelocityCapsWithinTimeBudget(
    simulationContext,
    anchors,
    segments,
    corners,
    solver.capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
    postValidationEvaluation,
  );
  liftBudgetCapsAtObjectiveRatios(
    simulationContext,
    anchors,
    segments,
    corners,
    solver.capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
    postLiftEvaluation,
  );
  optimizeSmallPathCapsWithGenericSimulation(
    simulationContext,
    anchors,
    segments,
    corners,
    solver.capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  ensureCapsPassGenericSimulation(
    simulationContext,
    segments,
    corners,
    solver.capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  preserveTightSingleHandoffIncomingCap(
    solver.capsByOrdinal,
    corners,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  applyPinnedCaps(
    solver.capsByOrdinal,
    simulationContext,
    usableMaxVelocityMps,
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
    simulationContext,
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
  cacheProfile(cacheKey, profile);

  return profile;
}

interface JointRadiusCoordinate {
  cornerIndex: number;
  anchorOrdinal: number;
  elementIndex: number;
  segmentIndex: number;
  incomingLegMeters: number;
  minRadiusMeters: number;
  maxRadiusMeters: number;
}

function jointRadiusCoordinates(
  path: PathModel,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
): JointRadiusCoordinate[] {
  return corners.flatMap((corner, cornerIndex) => {
    const anchor = anchors[corner.anchorOrdinal - 1];
    const incoming = segments[corner.anchorOrdinal - 2];
    if (
      !anchor ||
      !incoming ||
      incoming.lengthMeters <= minPositive ||
      getHandoffRadiusSource(path.path_elements[anchor.pathIndex]) !== "auto"
    ) {
      return [];
    }

    return [
      {
        cornerIndex,
        anchorOrdinal: corner.anchorOrdinal,
        elementIndex: anchor.pathIndex,
        segmentIndex: corner.anchorOrdinal - 2,
        incomingLegMeters: incoming.lengthMeters,
        minRadiusMeters: jointRadiusFloorMeters,
        maxRadiusMeters:
          Math.floor(
            jointRadiusIncomingLegRatio *
              incoming.lengthMeters *
              (1 / jointRadiusQuantumMeters) +
              1e-9,
          ) * jointRadiusQuantumMeters,
      },
    ];
  });
}

/**
 * The joint search completes both directional passes for every searchable
 * handoff. Deliberately uncapped: unusually large paths take proportionally
 * longer instead of receiving a path-order-dependent partial refinement.
 */
export function jointAutoConstraintSearchPlan(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions = {},
): JointAutoConstraintSearchPlan {
  const setup = createAutoVelocitySolveSetup(path, config, options);
  const searchableBlocks = jointRadiusCoordinates(
    path,
    setup.anchors,
    setup.segments,
    setup.corners,
  ).filter(
    (coordinate) => coordinate.maxRadiusMeters >= coordinate.minRadiusMeters,
  ).length;
  return {
    searchableBlocks,
    evaluationBudget: jointEvaluationBudget(searchableBlocks),
  };
}

function jointEvaluationBudget(searchableBlocks: number): number {
  return (
    jointSolverStartCandidates +
    jointSolverBeamWidth *
      jointSolverMovesPerBlock *
      jointSolverSweepCount *
      searchableBlocks
  );
}

function hasImpossibleJointRadius(
  path: PathModel,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
): boolean {
  return corners.some((corner) => {
    const anchor = anchors[corner.anchorOrdinal - 1];
    const incoming = segments[corner.anchorOrdinal - 2];
    const element = anchor ? path.path_elements[anchor.pathIndex] : undefined;
    if (!anchor || !incoming || !element) {
      return true;
    }
    const rawRadius = isTranslationTarget(element)
      ? element.intermediate_handoff_radius_meters
      : isWaypoint(element)
        ? element.translation_target.intermediate_handoff_radius_meters
        : null;
    const generatorOwnsRadius =
      getHandoffRadiusSource(element) === "auto" ||
      !(typeof rawRadius === "number" && rawRadius > 0);
    return (
      generatorOwnsRadius &&
      jointRadiusIncomingLegRatio * incoming.lengthMeters <
        jointRadiusFloorMeters - minPositive
    );
  });
}

function normalizeJointCandidate(
  candidate: JointCandidate,
  coordinates: readonly JointRadiusCoordinate[],
  pinnedCaps: ReadonlyMap<number, number>,
  usableMaxVelocityMps: number,
): JointCandidate {
  const radiiBySegmentIndex = [...candidate.radiiBySegmentIndex];
  for (const coordinate of coordinates) {
    radiiBySegmentIndex[coordinate.segmentIndex] = quantizeJointRadius(
      radiiBySegmentIndex[coordinate.segmentIndex] ??
        coordinate.minRadiusMeters,
      coordinate.minRadiusMeters,
      coordinate.maxRadiusMeters,
    );
  }

  const capsByOrdinal = new Map<number, number>();
  for (const [ordinal, value] of candidate.capsByOrdinal) {
    capsByOrdinal.set(
      ordinal,
      quantizeJointVelocity(value, usableMaxVelocityMps),
    );
  }
  for (const [ordinal, value] of pinnedCaps) {
    capsByOrdinal.set(
      ordinal,
      quantizeJointVelocity(value, usableMaxVelocityMps),
    );
  }
  return { radiiBySegmentIndex, capsByOrdinal };
}

function jointCorners(
  baseCorners: readonly AutoVelocityCorner[],
  segments: readonly SegmentGeometry[],
  radiiBySegmentIndex: readonly number[],
): AutoVelocityCorner[] {
  return baseCorners.map((corner) => {
    const segmentIndex = corner.anchorOrdinal - 2;
    const incoming = segments[segmentIndex];
    const handoffDistanceMeters =
      radiiBySegmentIndex[segmentIndex] ?? corner.handoffDistanceMeters;
    const tangentRadius =
      handoffDistanceMeters / Math.tan(corner.turnAngleRadians / 2);
    const effectiveRadiusMeters = Math.max(
      handoffDistanceMeters,
      Number.isFinite(tangentRadius) ? tangentRadius : 0,
      1e-4,
    );
    const anchorS =
      incoming?.endS ?? corner.startS + corner.handoffDistanceMeters;
    return {
      ...corner,
      handoffDistanceMeters,
      effectiveRadiusMeters,
      curvature: 1 / effectiveRadiusMeters,
      startS: Math.max(0, anchorS - handoffDistanceMeters),
      endS: Math.min(
        segments.at(-1)?.endS ?? anchorS,
        anchorS + handoffDistanceMeters,
      ),
    };
  });
}

function jointStartCandidates(
  base: JointCandidate,
  coordinates: readonly JointRadiusCoordinate[],
  anchorCount: number,
  usableMaxVelocityMps: number,
): JointCandidate[] {
  const uniform = (ratio: number): JointCandidate => {
    const capsByOrdinal = new Map(base.capsByOrdinal);
    for (let ordinal = 2; ordinal <= anchorCount; ordinal += 1) {
      capsByOrdinal.set(ordinal, usableMaxVelocityMps * ratio);
    }
    return {
      radiiBySegmentIndex: [...base.radiiBySegmentIndex],
      capsByOrdinal,
    };
  };
  const moderate = uniform(0.65);
  for (const coordinate of coordinates) {
    moderate.radiiBySegmentIndex[coordinate.segmentIndex] =
      coordinate.incomingLegMeters * 0.25;
  }
  return [base, uniform(0.8), uniform(0.5), moderate];
}

function jointBlockCandidates(
  base: JointCandidate,
  coordinate: JointRadiusCoordinate,
  radiusStepRatio: number,
  velocityStepRatio: number,
  pinnedCaps: ReadonlyMap<number, number>,
  usableMaxVelocityMps: number,
): JointCandidate[] {
  const incomingOrdinal = coordinate.anchorOrdinal;
  const outgoingOrdinal = coordinate.anchorOrdinal + 1;
  const radiusDelta = coordinate.incomingLegMeters * radiusStepRatio;
  const velocityDelta = usableMaxVelocityMps * velocityStepRatio;
  const moves: Array<[number, number, number]> = [
    [-radiusDelta, 0, 0],
    [radiusDelta, 0, 0],
    [0, -velocityDelta, 0],
    [0, velocityDelta, 0],
    [0, 0, -velocityDelta],
    [0, 0, velocityDelta],
    [radiusDelta, -velocityDelta, -velocityDelta],
    [-radiusDelta, velocityDelta, velocityDelta],
  ];

  return moves.map(([radiusChange, incomingChange, outgoingChange]) => {
    const radiiBySegmentIndex = [...base.radiiBySegmentIndex];
    radiiBySegmentIndex[coordinate.segmentIndex] =
      (radiiBySegmentIndex[coordinate.segmentIndex] ??
        coordinate.minRadiusMeters) + radiusChange;
    const capsByOrdinal = new Map(base.capsByOrdinal);
    if (!pinnedCaps.has(incomingOrdinal)) {
      capsByOrdinal.set(
        incomingOrdinal,
        (capsByOrdinal.get(incomingOrdinal) ?? usableMaxVelocityMps) +
          incomingChange,
      );
    }
    if (!pinnedCaps.has(outgoingOrdinal)) {
      capsByOrdinal.set(
        outgoingOrdinal,
        (capsByOrdinal.get(outgoingOrdinal) ?? usableMaxVelocityMps) +
          outgoingChange,
      );
    }
    return { radiiBySegmentIndex, capsByOrdinal };
  });
}

function jointCandidateSignature(
  candidate: JointCandidate,
  anchorCount: number,
): string {
  const caps = Array.from(
    { length: Math.max(0, anchorCount - 1) },
    (_, index) => candidate.capsByOrdinal.get(index + 2) ?? 0,
  );
  return `${candidate.radiiBySegmentIndex.join(",")}|${caps.join(",")}`;
}

function jointCanonicalDistance(
  candidate: JointCandidate,
  canonicalRadii: readonly number[],
  canonicalCaps: ReadonlyMap<number, number>,
  coordinates: readonly JointRadiusCoordinate[],
  usableMaxVelocityMps: number,
): number {
  let distance = 0;
  for (const coordinate of coordinates) {
    distance +=
      Math.abs(
        (candidate.radiiBySegmentIndex[coordinate.segmentIndex] ?? 0) -
          (canonicalRadii[coordinate.segmentIndex] ?? 0),
      ) / Math.max(coordinate.incomingLegMeters, minPositive);
  }
  for (const [ordinal, value] of candidate.capsByOrdinal) {
    distance +=
      Math.abs(value - (canonicalCaps.get(ordinal) ?? usableMaxVelocityMps)) /
      Math.max(usableMaxVelocityMps, minPositive);
  }
  return distance;
}

function isBetterJointCandidate(
  candidate: JointCandidateEvaluation,
  current: JointCandidateEvaluation,
): boolean {
  if (candidate.cost < current.cost - jointObjectiveIndifference) {
    return true;
  }
  if (Math.abs(candidate.cost - current.cost) > jointObjectiveIndifference) {
    return false;
  }
  if (
    candidate.canonicalDistance <
    current.canonicalDistance - jointObjectiveIndifference
  ) {
    return true;
  }
  if (
    Math.abs(candidate.canonicalDistance - current.canonicalDistance) >
    jointObjectiveIndifference
  ) {
    return false;
  }
  return candidate.signature < current.signature;
}

function quantizeJointRadius(value: number, min: number, max: number): number {
  const clamped = clamp(value, min, max);
  return Number(
    (
      Math.round(clamped / jointRadiusQuantumMeters) * jointRadiusQuantumMeters
    ).toFixed(3),
  );
}

function quantizeJointVelocity(
  value: number,
  usableMaxVelocityMps: number,
): number {
  return Number(
    (
      Math.floor(
        clamp(
          value,
          minimumSolverCap(usableMaxVelocityMps),
          usableMaxVelocityMps,
        ) /
          jointVelocityQuantumMps +
          1e-9,
      ) * jointVelocityQuantumMps
    ).toFixed(2),
  );
}

function pathWithJointRadii(
  path: PathModel,
  anchors: readonly AutoVelocityAnchor[],
  radiiBySegmentIndex: readonly number[],
): PathModel {
  const radiiByElementIndex = new Map<number, number>();
  for (
    let segmentIndex = 0;
    segmentIndex < radiiBySegmentIndex.length;
    segmentIndex += 1
  ) {
    const target = anchors[segmentIndex + 1];
    const element = target ? path.path_elements[target.pathIndex] : undefined;
    if (
      target &&
      element &&
      getHandoffRadiusSource(element) === "auto" &&
      Number.isFinite(radiiBySegmentIndex[segmentIndex])
    ) {
      radiiByElementIndex.set(
        target.pathIndex,
        radiiBySegmentIndex[segmentIndex],
      );
    }
  }
  return {
    ...path,
    path_elements: path.path_elements.map((element, elementIndex) => {
      const radius = radiiByElementIndex.get(elementIndex);
      if (radius === undefined) {
        return element;
      }
      if (isTranslationTarget(element)) {
        return setHandoffRadiusSource(
          { ...element, intermediate_handoff_radius_meters: radius },
          "auto",
        );
      }
      if (isWaypoint(element)) {
        return setHandoffRadiusSource(
          {
            ...element,
            translation_target: {
              ...element.translation_target,
              intermediate_handoff_radius_meters: radius,
            },
          },
          "auto",
        );
      }
      return element;
    }),
  };
}

interface JointCandidate {
  radiiBySegmentIndex: number[];
  capsByOrdinal: Map<number, number>;
}

interface JointCandidateEvaluation {
  candidate: JointCandidate;
  corners: AutoVelocityCorner[];
  evaluation: VelocityCapEvaluation;
  cost: number;
  canonicalDistance: number;
  signature: string;
}

interface JointSearchProblem {
  setup: AutoVelocitySolveSetup;
  searchableCoordinates: JointRadiusCoordinate[];
  canonicalRadii: number[];
  canonicalCaps: Map<number, number>;
  hasImpossibleCoordinate: boolean;
}

interface JointCandidateEvaluator {
  evaluationBudget: number;
  evaluations: number;
  cacheHits: number;
  budgetReached: boolean;
  evaluate(candidate: JointCandidate): JointCandidateEvaluation | null;
  rankedCandidates(limit: number): JointCandidateEvaluation[];
}

function createJointSearchProblem(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions,
): JointSearchProblem {
  const setup = createAutoVelocitySolveSetup(path, config, options);
  const searchableCoordinates = jointRadiusCoordinates(
    path,
    setup.anchors,
    setup.segments,
    setup.corners,
  ).filter(
    (coordinate) => coordinate.maxRadiusMeters >= coordinate.minRadiusMeters,
  );
  const canonicalRadii = [
    ...setup.simulationContext.handoffRadiiBySegmentIndex,
  ];
  const canonicalCaps = initialCapsByOrdinal(
    setup.anchors,
    setup.usableMaxVelocityMps,
  );
  applyPinnedCaps(
    canonicalCaps,
    setup.simulationContext,
    setup.usableMaxVelocityMps,
  );
  if (setup.simulationContext.rotationKeyframes.length === 0) {
    seedCapsFromCorners(
      canonicalCaps,
      setup.corners,
      setup.usableMaxVelocityMps,
      setup.usableMaxAccelerationMps2,
      setup.anchors.length <= 7 ? 0.85 : 1.6,
    );
  }
  return {
    setup,
    searchableCoordinates,
    canonicalRadii,
    canonicalCaps,
    hasImpossibleCoordinate: hasImpossibleJointRadius(
      path,
      setup.anchors,
      setup.segments,
      setup.corners,
    ),
  };
}

function createJointCandidateEvaluator(
  problem: JointSearchProblem,
  evaluationBudget: number,
): JointCandidateEvaluator {
  const { setup, searchableCoordinates, canonicalRadii, canonicalCaps } =
    problem;
  const cache = new Map<string, JointCandidateEvaluation>();
  const evaluator: JointCandidateEvaluator = {
    evaluationBudget,
    evaluations: 0,
    cacheHits: 0,
    budgetReached: false,
    rankedCandidates(limit) {
      return [...cache.values()]
        .sort((left, right) => (isBetterJointCandidate(left, right) ? -1 : 1))
        .slice(0, limit);
    },
    evaluate(candidate) {
      const normalized = normalizeJointCandidate(
        candidate,
        searchableCoordinates,
        setup.simulationContext.pinnedCapsByOrdinal,
        setup.usableMaxVelocityMps,
      );
      const signature = jointCandidateSignature(
        normalized,
        setup.anchors.length,
      );
      const cached = cache.get(signature);
      if (cached) {
        evaluator.cacheHits += 1;
        return cached;
      }
      if (evaluator.evaluations >= evaluationBudget) {
        evaluator.budgetReached = true;
        return null;
      }

      const corners = jointCorners(
        setup.corners,
        setup.segments,
        normalized.radiiBySegmentIndex,
      );
      const context: AutoVelocitySimulationContext = {
        ...setup.simulationContext,
        handoffRadiiBySegmentIndex: normalized.radiiBySegmentIndex,
      };
      const evaluation = evaluateVelocityCapsFast(
        context,
        setup.segments,
        corners,
        normalized.capsByOrdinal,
        setup.usableMaxVelocityMps,
        setup.usableMaxAccelerationMps2,
      );
      evaluator.evaluations += 1;
      const diagnostics = diagnosticsFromEvaluation(evaluation);
      const result: JointCandidateEvaluation = {
        candidate: normalized,
        corners,
        evaluation,
        cost:
          autoHandoffRadiusObjectiveCost({ corners, diagnostics }) +
          jointRadiusRobustnessCost(corners) +
          autoVelocityTieBreakCost({
            reachedEndRatio: reachedEndRatio(evaluation),
            handoffRatios: evaluationHandoffRatios(evaluation),
            totalTimeS: evaluation.totalTimeS,
            capsByOrdinal: normalized.capsByOrdinal,
          }),
        canonicalDistance: jointCanonicalDistance(
          normalized,
          canonicalRadii,
          canonicalCaps,
          searchableCoordinates,
          setup.usableMaxVelocityMps,
        ),
        signature,
      };
      cache.set(signature, result);
      return result;
    },
  };
  return evaluator;
}

/**
 * Jointly searches generated handoff radii and the velocity caps adjacent to
 * each handoff. Geometry is compiled once, all inner trials use the same fast
 * translation follower, and only the persisted winner is validated through
 * the generic preview simulator.
 */
export function solveJointAutoConstraints(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions = {},
): JointAutoConstraintSolveResult {
  const problem = createJointSearchProblem(path, config, options);
  const { setup, searchableCoordinates, canonicalRadii, canonicalCaps } =
    problem;
  const evaluationBudget = jointEvaluationBudget(searchableCoordinates.length);
  const evaluator = createJointCandidateEvaluator(problem, evaluationBudget);

  const baseCandidate: JointCandidate = {
    radiiBySegmentIndex: canonicalRadii,
    capsByOrdinal: canonicalCaps,
  };
  const starts = jointStartCandidates(
    baseCandidate,
    searchableCoordinates,
    setup.anchors.length,
    setup.usableMaxVelocityMps,
  );
  let beam = starts
    .map((candidate) => evaluator.evaluate(candidate))
    .filter((candidate): candidate is JointCandidateEvaluation => !!candidate)
    .sort((left, right) => (isBetterJointCandidate(left, right) ? -1 : 1))
    .slice(0, jointSolverBeamWidth);

  const sweeps = [
    {
      coordinates: searchableCoordinates,
      radiusStepRatio: 0.1,
      velocityStepRatio: 0.15,
    },
    {
      coordinates: [...searchableCoordinates].reverse(),
      radiusStepRatio: 0.05,
      velocityStepRatio: 0.075,
    },
  ];
  for (const sweep of sweeps) {
    for (const coordinate of sweep.coordinates) {
      if (evaluator.budgetReached) {
        break;
      }
      const candidates = jointBlockCandidates(
        beam[0]!.candidate,
        coordinate,
        sweep.radiusStepRatio,
        sweep.velocityStepRatio,
        setup.simulationContext.pinnedCapsByOrdinal,
        setup.usableMaxVelocityMps,
      );
      const pool = [...beam];
      for (const incumbent of beam) {
        const blockCandidates =
          incumbent === beam[0]
            ? candidates
            : jointBlockCandidates(
                incumbent.candidate,
                coordinate,
                sweep.radiusStepRatio,
                sweep.velocityStepRatio,
                setup.simulationContext.pinnedCapsByOrdinal,
                setup.usableMaxVelocityMps,
              );
        for (const candidate of blockCandidates) {
          const candidateEvaluation = evaluator.evaluate(candidate);
          if (candidateEvaluation) {
            pool.push(candidateEvaluation);
          }
        }
      }
      const unique = new Map(
        pool.map((candidate) => [candidate.signature, candidate]),
      );
      beam = [...unique.values()]
        .sort((left, right) => (isBetterJointCandidate(left, right) ? -1 : 1))
        .slice(0, jointSolverBeamWidth);
    }
  }
  return finalizeJointCandidates(
    path,
    config,
    options,
    problem,
    beam,
    evaluator,
    "interactive",
  );
}

type JointOracleVariable =
  | { kind: "radius"; coordinate: JointRadiusCoordinate }
  | { kind: "cap"; ordinal: number; min: number; max: number };

/**
 * Deterministic, offline CMA-ES reference solver. It deliberately
 * spends far more evaluations than the interactive optimizer and searches the
 * complete persisted radius/cap domains. Production generation never calls it.
 */
export function solveJointAutoConstraintsOracle(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions = {},
  oracleOptions: JointAutoConstraintOracleOptions = {},
): JointAutoConstraintSolveResult {
  const productionSeed = solveJointAutoConstraints(path, config, options);
  const problem = createJointSearchProblem(path, config, options);
  const variables = jointOracleVariables(problem);
  const evaluationBudget = Math.max(
    1,
    Math.floor(
      oracleOptions.maxEvaluations ?? Math.max(1_200, variables.length * 80),
    ),
  );
  const evaluator = createJointCandidateEvaluator(problem, evaluationBudget);
  const seedSetup = createAutoVelocitySolveSetup(
    productionSeed.path,
    config,
    options,
  );
  const seedCandidate: JointCandidate = {
    radiiBySegmentIndex: [
      ...seedSetup.simulationContext.handoffRadiiBySegmentIndex,
    ],
    capsByOrdinal: capsByOrdinalFromSegmentCaps(
      productionSeed.profile.segmentCaps,
    ),
  };
  let best = evaluator.evaluate(seedCandidate);
  if (!best) {
    throw new Error("Joint oracle could not evaluate its production seed");
  }

  if (variables.length > 0 && evaluationBudget > 1) {
    const seedVector = encodeJointOracleCandidate(best.candidate, variables);
    for (const fraction of [0.2, 0.5, 0.8]) {
      const broad = decodeJointOracleCandidate(
        variables.map((variable) =>
          variable.kind === "radius" ? fraction : 0.25 + fraction * 0.75,
        ),
        variables,
        best.candidate,
      );
      const evaluation = evaluator.evaluate(broad);
      if (evaluation && isBetterJointCandidate(evaluation, best)) {
        best = evaluation;
      }
    }

    const random = createJointOracleRandom(oracleOptions.seed ?? 0x4b1_1e);
    const dimension = variables.length;
    const populationSize = Math.max(6, 4 + Math.floor(3 * Math.log(dimension)));
    const parentCount = Math.floor(populationSize / 2);
    const rawWeights = Array.from(
      { length: parentCount },
      (_, index) => Math.log(parentCount + 0.5) - Math.log(index + 1),
    );
    const weightSum = rawWeights.reduce((sum, value) => sum + value, 0);
    const weights = rawWeights.map((value) => value / weightSum);
    const effectiveParents =
      1 / weights.reduce((sum, value) => sum + value * value, 0);
    const cc =
      (4 + effectiveParents / dimension) /
      (dimension + 4 + (2 * effectiveParents) / dimension);
    const cs = (effectiveParents + 2) / (dimension + effectiveParents + 5);
    const c1 = 2 / (Math.pow(dimension + 1.3, 2) + effectiveParents);
    const cmu = Math.min(
      1 - c1,
      (2 * (effectiveParents - 2 + 1 / effectiveParents)) /
        (Math.pow(dimension + 2, 2) + effectiveParents),
    );
    const damping =
      1 +
      2 * Math.max(0, Math.sqrt((effectiveParents - 1) / (dimension + 1)) - 1) +
      cs;
    const expectedNormalLength =
      Math.sqrt(dimension) *
      (1 - 1 / (4 * dimension) + 1 / (21 * dimension * dimension));
    let mean = seedVector;
    let sigma = 0.28;
    let covariance = identityMatrix(dimension);
    let evolutionPath = Array<number>(dimension).fill(0);
    let sigmaPath = Array<number>(dimension).fill(0);
    let generation = 0;
    let generationsWithoutImprovement = 0;

    while (
      !evaluator.budgetReached &&
      sigma > 0.002 &&
      generationsWithoutImprovement < 45
    ) {
      const decomposition = symmetricEigenDecomposition(covariance);
      const population: Array<{
        vector: number[];
        evaluation: JointCandidateEvaluation;
      }> = [];
      for (
        let member = 0;
        member < populationSize && !evaluator.budgetReached;
        member += 1
      ) {
        const normal = Array.from({ length: dimension }, () => random.normal());
        const step = multiplyEigenBasis(
          decomposition.vectors,
          decomposition.values.map((value) =>
            Math.sqrt(Math.max(value, 1e-12)),
          ),
          normal,
        );
        const vector = mean.map((value, index) =>
          reflectUnitInterval(value + sigma * (step[index] ?? 0)),
        );
        const evaluation = evaluator.evaluate(
          decodeJointOracleCandidate(vector, variables, best.candidate),
        );
        if (evaluation) {
          population.push({ vector, evaluation });
        }
      }
      if (population.length < parentCount) {
        break;
      }
      population.sort((left, right) =>
        isBetterJointCandidate(left.evaluation, right.evaluation) ? -1 : 1,
      );
      const previousBest = best;
      if (isBetterJointCandidate(population[0]!.evaluation, best)) {
        best = population[0]!.evaluation;
      }
      generationsWithoutImprovement =
        best.signature === previousBest.signature
          ? generationsWithoutImprovement + 1
          : 0;

      const oldMean = mean;
      mean = Array<number>(dimension).fill(0);
      for (let parent = 0; parent < parentCount; parent += 1) {
        for (let index = 0; index < dimension; index += 1) {
          mean[index] +=
            (weights[parent] ?? 0) * (population[parent]?.vector[index] ?? 0);
        }
      }
      const weightedStep = mean.map(
        (value, index) => (value - (oldMean[index] ?? 0)) / sigma,
      );
      const inverseStep = multiplyEigenBasis(
        decomposition.vectors,
        decomposition.values.map(
          (value) => 1 / Math.sqrt(Math.max(value, 1e-12)),
        ),
        weightedStep,
        true,
      );
      const sigmaPathFactor = Math.sqrt(cs * (2 - cs) * effectiveParents);
      sigmaPath = sigmaPath.map(
        (value, index) =>
          (1 - cs) * value + sigmaPathFactor * (inverseStep[index] ?? 0),
      );
      const sigmaPathLength = vectorLength(sigmaPath);
      const hsig =
        sigmaPathLength /
          Math.sqrt(1 - Math.pow(1 - cs, 2 * (generation + 1))) /
          expectedNormalLength <
        1.4 + 2 / (dimension + 1)
          ? 1
          : 0;
      const evolutionFactor = Math.sqrt(cc * (2 - cc) * effectiveParents);
      evolutionPath = evolutionPath.map(
        (value, index) =>
          (1 - cc) * value +
          hsig * evolutionFactor * (weightedStep[index] ?? 0),
      );
      const oldCovariance = covariance;
      covariance = Array.from({ length: dimension }, (_, row) =>
        Array.from({ length: dimension }, (_, column) => {
          let rankMu = 0;
          for (let parent = 0; parent < parentCount; parent += 1) {
            const parentVector = population[parent]?.vector;
            const rowStep =
              ((parentVector?.[row] ?? 0) - (oldMean[row] ?? 0)) / sigma;
            const columnStep =
              ((parentVector?.[column] ?? 0) - (oldMean[column] ?? 0)) / sigma;
            rankMu += (weights[parent] ?? 0) * rowStep * columnStep;
          }
          const oldValue = oldCovariance[row]?.[column] ?? 0;
          return (
            (1 - c1 - cmu) * oldValue +
            c1 *
              ((evolutionPath[row] ?? 0) * (evolutionPath[column] ?? 0) +
                (1 - hsig) * cc * (2 - cc) * oldValue) +
            cmu * rankMu
          );
        }),
      );
      sigma *= Math.exp(
        (cs / damping) * (sigmaPathLength / expectedNormalLength - 1),
      );
      generation += 1;
    }
  }

  const oracleResult = finalizeJointCandidates(
    path,
    config,
    options,
    problem,
    evaluator.rankedCandidates(4),
    evaluator,
    "oracle",
  );
  oracleResult.stats.genericEvaluations +=
    productionSeed.stats.genericEvaluations;
  if (
    oracleResult.stats.objectiveCost >
    productionSeed.stats.objectiveCost + jointObjectiveIndifference
  ) {
    return {
      ...productionSeed,
      stats: {
        ...oracleResult.stats,
        objectiveCost: productionSeed.stats.objectiveCost,
        genericValidationPassed: productionSeed.stats.genericValidationPassed,
        stabilityValidationPassed:
          productionSeed.stats.stabilityValidationPassed,
      },
    };
  }
  return oracleResult;
}

function finalizeJointCandidates(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions,
  problem: JointSearchProblem,
  candidates: readonly JointCandidateEvaluation[],
  evaluator: JointCandidateEvaluator,
  algorithm: JointAutoConstraintSolveStats["algorithm"],
): JointAutoConstraintSolveResult {
  const finalized = candidates.map((candidate) =>
    finalizeJointCandidate(
      path,
      config,
      options,
      problem,
      candidate,
      evaluator,
      algorithm,
    ),
  );
  const statusRank = (status: JointAutoConstraintSolveStatus): number =>
    status === "valid" ? 0 : status === "best-effort" ? 1 : 2;
  finalized.sort((left, right) => {
    const rankDelta = statusRank(left.status) - statusRank(right.status);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return left.stats.objectiveCost - right.stats.objectiveCost;
  });
  const result = finalized[0];
  if (!result) {
    throw new Error("Joint solver produced no candidate to finalize");
  }
  return {
    ...result,
    stats: {
      ...result.stats,
      genericEvaluations: finalized.length * 2,
    },
  };
}

function jointOracleVariables(
  problem: JointSearchProblem,
): JointOracleVariable[] {
  const variables: JointOracleVariable[] = problem.searchableCoordinates.map(
    (coordinate) => ({ kind: "radius", coordinate }),
  );
  const capOrdinals = new Set<number>();
  for (const coordinate of problem.searchableCoordinates) {
    capOrdinals.add(coordinate.anchorOrdinal);
    capOrdinals.add(coordinate.anchorOrdinal + 1);
  }
  for (const ordinal of [...capOrdinals].sort((left, right) => left - right)) {
    if (!problem.setup.simulationContext.pinnedCapsByOrdinal.has(ordinal)) {
      variables.push({
        kind: "cap",
        ordinal,
        min: minimumSolverCap(problem.setup.usableMaxVelocityMps),
        max: problem.setup.usableMaxVelocityMps,
      });
    }
  }
  return variables;
}

function encodeJointOracleCandidate(
  candidate: JointCandidate,
  variables: readonly JointOracleVariable[],
): number[] {
  return variables.map((variable) => {
    const min =
      variable.kind === "radius"
        ? variable.coordinate.minRadiusMeters
        : variable.min;
    const max =
      variable.kind === "radius"
        ? variable.coordinate.maxRadiusMeters
        : variable.max;
    const value =
      variable.kind === "radius"
        ? (candidate.radiiBySegmentIndex[variable.coordinate.segmentIndex] ??
          min)
        : (candidate.capsByOrdinal.get(variable.ordinal) ?? max);
    return clamp((value - min) / Math.max(max - min, minPositive), 0, 1);
  });
}

function decodeJointOracleCandidate(
  vector: readonly number[],
  variables: readonly JointOracleVariable[],
  base: JointCandidate,
): JointCandidate {
  const candidate: JointCandidate = {
    radiiBySegmentIndex: [...base.radiiBySegmentIndex],
    capsByOrdinal: new Map(base.capsByOrdinal),
  };
  variables.forEach((variable, index) => {
    const unit = reflectUnitInterval(vector[index] ?? 0.5);
    if (variable.kind === "radius") {
      candidate.radiiBySegmentIndex[variable.coordinate.segmentIndex] =
        variable.coordinate.minRadiusMeters +
        unit *
          (variable.coordinate.maxRadiusMeters -
            variable.coordinate.minRadiusMeters);
    } else {
      candidate.capsByOrdinal.set(
        variable.ordinal,
        variable.min + unit * (variable.max - variable.min),
      );
    }
  });
  return candidate;
}

function reflectUnitInterval(value: number): number {
  const period = ((value % 2) + 2) % 2;
  return period <= 1 ? period : 2 - period;
}

function identityMatrix(size: number): number[][] {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => (row === column ? 1 : 0)),
  );
}

function vectorLength(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function symmetricEigenDecomposition(matrix: readonly number[][]): {
  values: number[];
  vectors: number[][];
} {
  const size = matrix.length;
  const values = matrix.map((row) => [...row]);
  const vectors = identityMatrix(size);
  for (
    let iteration = 0;
    iteration < Math.max(12, size * size * 8);
    iteration += 1
  ) {
    let pivotRow = 0;
    let pivotColumn = 0;
    let largest = 0;
    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const magnitude = Math.abs(values[row]?.[column] ?? 0);
        if (magnitude > largest) {
          largest = magnitude;
          pivotRow = row;
          pivotColumn = column;
        }
      }
    }
    if (largest < 1e-10) {
      break;
    }
    const app = values[pivotRow]?.[pivotRow] ?? 0;
    const aqq = values[pivotColumn]?.[pivotColumn] ?? 0;
    const apq = values[pivotRow]?.[pivotColumn] ?? 0;
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let index = 0; index < size; index += 1) {
      const vip = values[index]?.[pivotRow] ?? 0;
      const viq = values[index]?.[pivotColumn] ?? 0;
      values[index]![pivotRow] = cosine * vip - sine * viq;
      values[index]![pivotColumn] = sine * vip + cosine * viq;
    }
    for (let index = 0; index < size; index += 1) {
      const vpi = values[pivotRow]?.[index] ?? 0;
      const vqi = values[pivotColumn]?.[index] ?? 0;
      values[pivotRow]![index] = cosine * vpi - sine * vqi;
      values[pivotColumn]![index] = sine * vpi + cosine * vqi;
    }
    for (let index = 0; index < size; index += 1) {
      const vip = vectors[index]?.[pivotRow] ?? 0;
      const viq = vectors[index]?.[pivotColumn] ?? 0;
      vectors[index]![pivotRow] = cosine * vip - sine * viq;
      vectors[index]![pivotColumn] = sine * vip + cosine * viq;
    }
  }
  return {
    values: Array.from({ length: size }, (_, index) =>
      Math.max(values[index]?.[index] ?? 0, 1e-12),
    ),
    vectors,
  };
}

function multiplyEigenBasis(
  vectors: readonly number[][],
  scales: readonly number[],
  input: readonly number[],
  inverseOrder = false,
): number[] {
  const size = input.length;
  if (inverseOrder) {
    const projected = Array.from(
      { length: size },
      (_, column) =>
        vectors.reduce(
          (sum, row, rowIndex) =>
            sum + (row[column] ?? 0) * (input[rowIndex] ?? 0),
          0,
        ) * (scales[column] ?? 0),
    );
    return Array.from({ length: size }, (_, row) =>
      projected.reduce(
        (sum, value, column) => sum + (vectors[row]?.[column] ?? 0) * value,
        0,
      ),
    );
  }
  return Array.from({ length: size }, (_, row) =>
    input.reduce(
      (sum, value, column) =>
        sum + (vectors[row]?.[column] ?? 0) * (scales[column] ?? 0) * value,
      0,
    ),
  );
}

function createJointOracleRandom(seed: number): { normal(): number } {
  let state = seed >>> 0;
  let spare: number | null = null;
  const uniform = (): number => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    normal() {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return value;
      }
      const radius = Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-12)));
      const angle = 2 * Math.PI * uniform();
      spare = radius * Math.sin(angle);
      return radius * Math.cos(angle);
    },
  };
}

/** Softly avoids fragile trigger circles while preserving short-leg solves. */
function jointRadiusRobustnessCost(
  corners: readonly AutoVelocityCorner[],
): number {
  return corners.reduce((cost, corner) => {
    const deficit = Math.max(
      0,
      (jointRobustRadiusMeters - corner.handoffDistanceMeters) /
        jointRobustRadiusMeters,
    );
    return cost + jointRobustRadiusWeight * deficit * deficit;
  }, 0);
}

function finalizeJointCandidate(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions,
  problem: JointSearchProblem,
  best: JointCandidateEvaluation,
  evaluator: JointCandidateEvaluator,
  algorithm: JointAutoConstraintSolveStats["algorithm"],
): JointAutoConstraintSolveResult {
  const solvedPath = pathWithJointRadii(
    path,
    problem.setup.anchors,
    best.candidate.radiiBySegmentIndex,
  );
  const finalSetup = createAutoVelocitySolveSetup(solvedPath, config, options);
  const persistedCaps = capsByOrdinalFromSegmentCaps(
    segmentCapsFromSolvedCaps(
      finalSetup.anchors,
      finalSetup.segments,
      best.candidate.capsByOrdinal,
      finalSetup.baseMaxVelocityMps,
      finalSetup.usableMaxVelocityMps,
    ),
  );
  const finalEvaluation = evaluateVelocityCapsWithGenericSimulation(
    finalSetup.simulationContext,
    finalSetup.segments,
    finalSetup.corners,
    persistedCaps,
    finalSetup.usableMaxVelocityMps,
    finalSetup.usableMaxAccelerationMps2,
  );
  const stabilityEvaluation = evaluateVelocityCapsWithGenericSimulation(
    finalSetup.simulationContext,
    finalSetup.segments,
    finalSetup.corners,
    persistedCaps,
    finalSetup.usableMaxVelocityMps,
    finalSetup.usableMaxAccelerationMps2,
    solverDtSeconds / 2,
  );
  const segmentCaps = segmentCapsFromSolvedCaps(
    finalSetup.anchors,
    finalSetup.segments,
    persistedCaps,
    finalSetup.baseMaxVelocityMps,
    finalSetup.usableMaxVelocityMps,
  );
  const profile: AutoVelocityProfile = {
    anchors: finalSetup.anchors,
    corners: finalSetup.corners,
    samples: samplesFromTrace(
      finalEvaluation.trace,
      finalSetup.usableMaxVelocityMps,
    ),
    segmentCaps,
    diagnostics: diagnosticsFromEvaluation(finalEvaluation),
    settings: finalSetup.settings,
    usableMaxVelocityMps: finalSetup.usableMaxVelocityMps,
    usableMaxAccelerationMps2: finalSetup.usableMaxAccelerationMps2,
  };
  const persistedObjectiveCost =
    autoHandoffRadiusObjectiveCost({
      corners: finalSetup.corners,
      diagnostics: profile.diagnostics,
    }) +
    jointRadiusRobustnessCost(finalSetup.corners) +
    autoVelocityTieBreakCost({
      reachedEndRatio: reachedEndRatio(finalEvaluation),
      handoffRatios: evaluationHandoffRatios(finalEvaluation),
      totalTimeS: finalEvaluation.totalTimeS,
      capsByOrdinal: persistedCaps,
    });

  return {
    path: solvedPath,
    profile,
    status: problem.hasImpossibleCoordinate
      ? "unsolvable"
      : finalEvaluation.passed && stabilityEvaluation.passed
        ? "valid"
        : "best-effort",
    stats: {
      algorithm,
      evaluations: evaluator.evaluations,
      evaluationBudget: evaluator.evaluationBudget,
      searchableBlocks: problem.searchableCoordinates.length,
      cacheHits: evaluator.cacheHits,
      genericEvaluations: 2,
      objectiveCost: persistedObjectiveCost,
      genericValidationPassed: finalEvaluation.passed,
      stabilityValidationPassed: stabilityEvaluation.passed,
      terminationReason:
        problem.searchableCoordinates.length === 0
          ? "no-coordinates"
          : evaluator.budgetReached
            ? "evaluation-budget"
            : "converged",
    },
  };
}

interface AutoVelocitySolveSetup {
  anchors: AutoVelocityAnchor[];
  segments: SegmentGeometry[];
  corners: AutoVelocityCorner[];
  simulationContext: AutoVelocitySimulationContext;
  settings: AutoVelocityProfile["settings"];
  baseMaxVelocityMps: number;
  usableMaxVelocityMps: number;
  usableMaxAccelerationMps2: number;
}

/** Everything a solve or a gate check needs derived from the path once. */
function createAutoVelocitySolveSetup(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions,
): AutoVelocitySolveSetup {
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
  const cumulative = segments.map((segment) => segment.startS);
  cumulative.push(segments.at(-1)?.endS ?? 0);

  return {
    anchors,
    segments,
    corners: buildCorners(
      path,
      anchors,
      segments,
      cumulative,
      defaultHandoffRadius,
    ),
    simulationContext: createAutoVelocitySimulationContext(
      path,
      config,
      anchors,
      segments,
      cumulative,
      defaultHandoffRadius,
    ),
    settings,
    baseMaxVelocityMps: baseMaxVelocity,
    usableMaxVelocityMps: baseMaxVelocity * settings.velocitySafetyFactor,
    usableMaxAccelerationMps2:
      baseMaxAcceleration * settings.accelerationSafetyFactor,
  };
}

export interface HandoffFeasibility {
  anchorOrdinal: number;
  /** Index of the corner anchor in `path_elements`. */
  pathIndex: number;
  handoffDistanceMeters: number;
  /** True where some uniform cap the solver would try clears both gates. */
  feasible: boolean;
  /** Worst gate ratio at the corner's best uniform cap; 1 is the gate. */
  bestErrorRatio: number;
}

export interface HandoffLadderRung {
  seedRatio: number;
  /** Corner anchors (as `path_elements` indexes) failing at this rung. */
  failingPathIndexes: number[];
}

export interface HandoffFeasibilityLadder {
  corners: HandoffFeasibility[];
  rungs: HandoffLadderRung[];
}

/**
 * Asks, corner by corner, whether any speed clears the solver's own handoff
 * gates. The gates are not monotone in speed — a corner cut too slowly misses
 * its window as badly as one taken too fast — so a single reference speed says
 * nothing. Sweeping the uniform caps the solver itself seeds from does: a
 * corner that fails at every one of them is asking for a radius the follower
 * cannot honor at any speed.
 */
export function evaluateHandoffFeasibility(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions = {},
): HandoffFeasibility[] {
  return evaluateHandoffFeasibilityLadder(path, config, options).corners;
}

/**
 * The full rung-by-rung picture behind `evaluateHandoffFeasibility`. Per-corner
 * feasibility is not enough to pick radii: two corners each feasible only at
 * different speeds leave the cap solver no profile that satisfies both. The
 * rung with the fewest failing corners is the geometry's best joint offer, and
 * radius selection descends against that.
 */
export function evaluateHandoffFeasibilityLadder(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions = {},
): HandoffFeasibilityLadder {
  const setup = createAutoVelocitySolveSetup(path, config, options);
  if (setup.corners.length === 0) {
    return { corners: [], rungs: [] };
  }

  const results = setup.corners.map((corner) => ({
    anchorOrdinal: corner.anchorOrdinal,
    pathIndex: setup.anchors[corner.anchorOrdinal - 1]?.pathIndex ?? -1,
    handoffDistanceMeters: corner.handoffDistanceMeters,
    feasible: false,
    bestErrorRatio: Number.POSITIVE_INFINITY,
  }));
  const byOrdinal = new Map(
    results.map((result) => [result.anchorOrdinal, result]),
  );
  const rungs: HandoffLadderRung[] = [];
  const minCap = minimumSolverCap(setup.usableMaxVelocityMps);

  for (const ratio of globalVelocitySeedRatios) {
    const capValue = clamp(
      setup.usableMaxVelocityMps * ratio,
      minCap,
      setup.usableMaxVelocityMps,
    );
    const capsByOrdinal = new Map<number, number>();
    for (let ordinal = 2; ordinal <= setup.anchors.length; ordinal += 1) {
      capsByOrdinal.set(ordinal, capValue);
    }

    const evaluation = evaluateVelocityCaps(
      setup.simulationContext,
      setup.segments,
      setup.corners,
      capsByOrdinal,
      setup.usableMaxVelocityMps,
      setup.usableMaxAccelerationMps2,
    );
    const failingPathIndexes: number[] = [];

    for (const handoff of evaluation.handoffs) {
      const result = byOrdinal.get(handoff.corner.anchorOrdinal);
      if (!result) {
        continue;
      }
      result.feasible = result.feasible || handoff.passed;
      result.bestErrorRatio = Math.min(
        result.bestErrorRatio,
        handoffViolationRatio(handoff),
      );
      if (!handoff.passed) {
        failingPathIndexes.push(result.pathIndex);
      }
    }

    rungs.push({ seedRatio: ratio, failingPathIndexes });
  }

  return { corners: results, rungs };
}

/**
 * Lightweight whole-path traces for radius selection. A full velocity solve
 * for every radius candidate is prohibitively expensive; these representative
 * uniform caps preserve the important geometry/speed interaction, after which
 * the winning radius path receives one full cap solve.
 */
export function evaluateAutoHandoffRadiusObjectiveInputs(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions = {},
): AutoHandoffRadiusObjectiveInput[] {
  const setup = createAutoVelocitySolveSetup(path, config, options);
  if (setup.corners.length === 0) {
    return [];
  }

  const minCap = minimumSolverCap(setup.usableMaxVelocityMps);
  return radiusObjectiveVelocityRatios.map((ratio) => {
    const capValue = clamp(
      setup.usableMaxVelocityMps * ratio,
      minCap,
      setup.usableMaxVelocityMps,
    );
    const capsByOrdinal = new Map<number, number>();
    for (let ordinal = 2; ordinal <= setup.anchors.length; ordinal += 1) {
      capsByOrdinal.set(ordinal, capValue);
    }
    const evaluation = evaluateVelocityCaps(
      setup.simulationContext,
      setup.segments,
      setup.corners,
      capsByOrdinal,
      setup.usableMaxVelocityMps,
      setup.usableMaxAccelerationMps2,
    );

    return {
      corners: setup.corners,
      diagnostics: diagnosticsFromEvaluation(evaluation),
    };
  });
}

/**
 * Records a profile computed elsewhere — a worker, say — against the same
 * cache the synchronous path uses, so a later call for the same inputs is a
 * lookup instead of a second solve.
 */
export function primeAutoVelocityProfileCache(
  cacheKey: string | null,
  profile: AutoVelocityProfile,
): void {
  cacheProfile(cacheKey, profile);
}

function cacheProfile(
  cacheKey: string | null,
  profile: AutoVelocityProfile,
): void {
  if (cacheKey === null) {
    return;
  }

  profileCache.set(cacheKey, profile);
  while (profileCache.size > maxProfileCacheEntries) {
    const oldestKey = profileCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    profileCache.delete(oldestKey);
  }
}

/** True when the exact inputs already have a solved profile in memory. */
export function hasCachedAutoVelocityProfile(cacheKey: string | null): boolean {
  return cacheKey !== null && profileCache.has(cacheKey);
}

export function autoVelocityMetadata(
  settings: Pick<
    AutoVelocityConstraintMetadata,
    | "velocity_safety_factor"
    | "acceleration_safety_factor"
    | "merge_tolerance_meters_per_sec"
    | "input_signature"
  >,
): AutoVelocityConstraintMetadata {
  const metadata: AutoVelocityConstraintMetadata = {
    velocity_safety_factor: settings.velocity_safety_factor,
    acceleration_safety_factor: settings.acceleration_safety_factor,
    merge_tolerance_meters_per_sec: settings.merge_tolerance_meters_per_sec,
  };
  if (settings.input_signature) {
    metadata.input_signature = settings.input_signature;
  }
  return metadata;
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

export function autoVelocityInputSignature(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions,
): string | null {
  try {
    return JSON.stringify({
      solverVersion: autoConstraintSolverVersion,
      pathElements: path.path_elements.map((element) =>
        autoVelocityElementCacheSignature(
          element,
          options.includeGeneratedRadiiInCacheKey === true,
        ),
      ),
      scalarConstraints: {
        maxVelocityMps: path.constraints.max_velocity_meters_per_sec,
        maxAccelerationMps2: path.constraints.max_acceleration_meters_per_sec2,
        maxVelocityDegPerSec: path.constraints.max_velocity_deg_per_sec,
        maxAccelerationDegPerSec:
          path.constraints.max_acceleration_deg_per_sec2,
      },
      rotationRangedConstraints: path.ranged_constraints
        .filter((constraint) => isRotationRangedConstraintKey(constraint.key))
        .map((constraint) => ({
          key: constraint.key,
          value: constraint.value,
          startOrdinal: constraint.start_ordinal,
          endOrdinal: constraint.end_ordinal,
        })),
      // Manual velocity caps are solver inputs (pins), so they must dirty the
      // signature; generated caps are output and must not, or refresh would
      // chase itself the way unsigned radii once did.
      manualVelocityRangedConstraints: path.ranged_constraints
        .filter(
          (constraint) =>
            constraint.key === "max_velocity_meters_per_sec" &&
            constraint.source !== "auto_velocity",
        )
        .map((constraint) => ({
          value: constraint.value,
          startOrdinal: constraint.start_ordinal,
          endOrdinal: constraint.end_ordinal,
        })),
      config: {
        maxVelocityMps: getDefaultOptionalConfigValue(
          config,
          "max_velocity_meters_per_sec",
        ),
        maxAccelerationMps2: getDefaultOptionalConfigValue(
          config,
          "max_acceleration_meters_per_sec2",
        ),
        handoffRadiusMeters: getDefaultOptionalConfigValue(
          config,
          "intermediate_handoff_radius_meters",
        ),
        maxVelocityDegPerSec: getDefaultOptionalConfigValue(
          config,
          "max_velocity_deg_per_sec",
        ),
        maxAccelerationDegPerSec: getDefaultOptionalConfigValue(
          config,
          "max_acceleration_deg_per_sec2",
        ),
        autoVelocityVelocitySafetyFactor: getDefaultOptionalConfigValue(
          config,
          "auto_velocity_velocity_safety_factor",
        ),
        autoVelocityAccelerationSafetyFactor: getDefaultOptionalConfigValue(
          config,
          "auto_velocity_acceleration_safety_factor",
        ),
      },
      options: {
        velocitySafetyFactor: options.velocitySafetyFactor ?? null,
        accelerationSafetyFactor: options.accelerationSafetyFactor ?? null,
        sampleStepMeters: options.sampleStepMeters ?? null,
        includeGeneratedRadiiInCacheKey:
          options.includeGeneratedRadiiInCacheKey ?? false,
      },
    });
  } catch {
    return null;
  }
}

/**
 * Generated radii are solver output, not solver input: signing their values
 * would make every regeneration look like a fresh edit and the background sync
 * would chase itself. The `auto` marker still distinguishes a generated corner
 * from a pinned one, because which is which decides what gets re-seeded.
 */
function handoffRadiusCacheSignature(
  element: PathElement,
  includeGeneratedRadius: boolean,
): number | string | null {
  if (getHandoffRadiusSource(element) === "auto" && !includeGeneratedRadius) {
    return "auto";
  }

  if (isTranslationTarget(element)) {
    return element.intermediate_handoff_radius_meters;
  }

  return isWaypoint(element)
    ? element.translation_target.intermediate_handoff_radius_meters
    : null;
}

function autoVelocityElementCacheSignature(
  element: PathElement,
  includeGeneratedRadius: boolean,
): unknown {
  if (isTranslationTarget(element)) {
    return {
      type: element.type,
      xMeters: element.x_meters,
      yMeters: element.y_meters,
      handoffRadiusMeters: handoffRadiusCacheSignature(
        element,
        includeGeneratedRadius,
      ),
    };
  }

  if (isRotationTarget(element)) {
    return {
      type: element.type,
      rotationRadians: element.rotation_radians,
      tRatio: element.t_ratio,
      profiledRotation: element.profiled_rotation,
    };
  }

  if (isEventTrigger(element)) {
    return {
      type: element.type,
      tRatio: element.t_ratio,
    };
  }

  if (isWaypoint(element)) {
    return {
      type: element.type,
      xMeters: element.translation_target.x_meters,
      yMeters: element.translation_target.y_meters,
      handoffRadiusMeters: handoffRadiusCacheSignature(
        element,
        includeGeneratedRadius,
      ),
      rotationRadians: element.rotation_target.rotation_radians,
      profiledRotation: element.rotation_target.profiled_rotation,
    };
  }

  return element;
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
    // This is the distance the runtime actually uses to leave the incoming
    // segment. It is not a fillet radius and does not need to fit inside the
    // outgoing leg. Clamping it to min(incoming, outgoing) made the optimizer
    // evaluate different geometry from the simulator for valid short exits.
    const handoffDistance = requestedHandoff;
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
      clamped: false,
    });
  }

  return corners;
}

function createAutoVelocitySimulationContext(
  path: PathModel,
  config: SimulationConfig,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  cumulativeLengths: readonly number[],
  defaultHandoffRadius: number,
): AutoVelocitySimulationContext {
  const totalPathLength = cumulativeLengths.at(-1) ?? 0;
  const firstSegment = segments[0];
  const startHeadingBase = firstSegment ? defaultHeading(firstSegment) : 0;
  const rotationKeyframes = buildGlobalRotationKeyframes(
    path,
    anchors,
    cumulativeLengths,
  );
  const rotationDomainEvents = buildRotationDomainEvents(
    path,
    anchors,
    cumulativeLengths,
  );
  const initialHeading = desiredHeadingForGlobalS(
    rotationKeyframes,
    0,
    startHeadingBase,
  ).desiredTheta;
  const endHeadingTarget = desiredHeadingForGlobalS(
    rotationKeyframes,
    totalPathLength,
    startHeadingBase,
  ).desiredTheta;
  const lastAnchor = anchors.at(-1);

  return {
    path,
    config,
    segments,
    cumulativeLengths,
    rotationKeyframes,
    rotationDomainEvents,
    maxRotationVelocityConstraints: rotationLimitConstraints(
      path,
      "max_velocity_deg_per_sec",
    ),
    maxRotationAccelerationConstraints: rotationLimitConstraints(
      path,
      "max_acceleration_deg_per_sec2",
    ),
    handoffRadiiBySegmentIndex: segments.map((_, segmentIndex) => {
      const targetAnchor = anchors[segmentIndex + 1];
      return handoffRadiusForAnchor(
        targetAnchor ? path.path_elements[targetAnchor.pathIndex] : undefined,
        defaultHandoffRadius,
      );
    }),
    pinnedCapsByOrdinal: pinnedVelocityCapsByOrdinal(path, anchors.length),
    totalPathLength,
    startHeadingBase,
    initialHeading,
    endHeadingTarget,
    endX: lastAnchor?.x ?? 0,
    endY: lastAnchor?.y ?? 0,
    baseMaxOmegaRadps: degreesToRadians(
      resolvePositive(
        path.constraints.max_velocity_deg_per_sec,
        getDefaultOptionalConfigValue(config, "max_velocity_deg_per_sec"),
        defaultMaxOmegaDegPerSec,
      ),
    ),
    baseMaxAlphaRadps2: degreesToRadians(
      resolvePositive(
        path.constraints.max_acceleration_deg_per_sec2,
        getDefaultOptionalConfigValue(config, "max_acceleration_deg_per_sec2"),
        defaultMaxAlphaDegPerSec2,
      ),
    ),
    defaultHandoffRadiusMeters: defaultHandoffRadius,
  };
}

/**
 * Manual max-velocity caps per target ordinal, minimum where ranges overlap.
 * Ordinal 1 is never a drive target, so pins there cannot bind the solver.
 */
function pinnedVelocityCapsByOrdinal(
  path: PathModel,
  anchorCount: number,
): Map<number, number> {
  const pins = new Map<number, number>();

  for (const constraint of path.ranged_constraints) {
    if (
      constraint.key !== "max_velocity_meters_per_sec" ||
      constraint.source === "auto_velocity"
    ) {
      continue;
    }

    const value = positiveNumber(constraint.value, 0);
    if (value <= 0) {
      continue;
    }

    const start = Math.min(constraint.start_ordinal, constraint.end_ordinal);
    const end = Math.max(constraint.start_ordinal, constraint.end_ordinal);
    for (
      let ordinal = Math.max(2, Math.trunc(start));
      ordinal <= Math.min(anchorCount, Math.trunc(end));
      ordinal += 1
    ) {
      const current = pins.get(ordinal);
      pins.set(
        ordinal,
        current === undefined ? value : Math.min(current, value),
      );
    }
  }

  return pins;
}

/**
 * Substitutes pinned values over whatever the solver is trying. A pin is not an
 * upper bound on the trial — it IS the cap the robot will run, because apply
 * drops generated caps at manually-constrained ordinals.
 */
/** In-place variant for the solver's own working map and the final output. */
function applyPinnedCaps(
  capsByOrdinal: Map<number, number>,
  simulationContext: AutoVelocitySimulationContext,
  usableMaxVelocityMps: number,
): void {
  for (const [ordinal, value] of simulationContext.pinnedCapsByOrdinal) {
    capsByOrdinal.set(ordinal, Math.min(value, usableMaxVelocityMps));
  }
}

function capsWithPins(
  capsByOrdinal: ReadonlyMap<number, number>,
  pinnedCapsByOrdinal: ReadonlyMap<number, number>,
  usableMaxVelocityMps: number,
): ReadonlyMap<number, number> {
  if (pinnedCapsByOrdinal.size === 0) {
    return capsByOrdinal;
  }

  const pinned = new Map(capsByOrdinal);
  for (const [ordinal, value] of pinnedCapsByOrdinal) {
    pinned.set(ordinal, Math.min(value, usableMaxVelocityMps));
  }
  return pinned;
}

function rotationLimitConstraints(
  path: PathModel,
  key: RangedConstraintKey,
): RotationLimitConstraint[] {
  return path.ranged_constraints.flatMap((constraint) => {
    if (constraint.key !== key) {
      return [];
    }

    const value = positiveNumber(constraint.value, 0);
    if (value <= 0) {
      return [];
    }

    const start = Math.trunc(constraint.start_ordinal);
    const end = Math.trunc(constraint.end_ordinal);
    return [
      {
        startOrdinal: Math.min(start, end),
        endOrdinal: Math.max(start, end),
        value,
      },
    ];
  });
}

function solveSegmentCapsWithSimulation(
  simulationContext: AutoVelocitySimulationContext,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): AutoVelocitySolverResult {
  const capsByOrdinal = initialCapsByOrdinal(anchors, usableMaxVelocityMps);
  applyPinnedCaps(capsByOrdinal, simulationContext, usableMaxVelocityMps);
  if (simulationContext.rotationKeyframes.length === 0) {
    seedCapsFromCorners(
      capsByOrdinal,
      corners,
      usableMaxVelocityMps,
      usableMaxAccelerationMps2,
      anchors.length <= 7 ? 0.85 : 1.6,
    );
  }
  let evaluation = evaluateVelocityCaps(
    simulationContext,
    segments,
    corners,
    capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );

  if (corners.length === 0) {
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
        simulationContext,
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
      simulationContext,
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
    simulationContext,
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
      simulationContext,
      anchors,
      segments,
      corners,
      capsByOrdinal,
      usableMaxVelocityMps,
      usableMaxAccelerationMps2,
      evaluation,
    );
    evaluation = refineVelocityCaps(
      simulationContext,
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
    simulationContext,
    anchors,
    segments,
    corners,
    capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
    evaluation,
  );

  evaluation = relaxVelocityWindowDipsWithinTimeBudget(
    simulationContext,
    anchors,
    segments,
    corners,
    capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
    evaluation,
  );

  evaluation = liftVelocityCapsWithinTimeBudget(
    simulationContext,
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
      simulationContext,
      anchors,
      segments,
      corners,
      capsByOrdinal,
      usableMaxVelocityMps,
      usableMaxAccelerationMps2,
      evaluation,
    );
    evaluation = refineVelocityCaps(
      simulationContext,
      anchors,
      segments,
      corners,
      capsByOrdinal,
      usableMaxVelocityMps,
      usableMaxAccelerationMps2,
      evaluation,
    );
  }

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

function seedCapsFromCorners(
  capsByOrdinal: Map<number, number>,
  corners: readonly AutoVelocityCorner[],
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
  lateralAccelerationFactor: number,
): void {
  for (const corner of corners) {
    const lateralCap = clamp(
      Math.sqrt(
        Math.max(
          0,
          usableMaxAccelerationMps2 *
            corner.effectiveRadiusMeters *
            lateralAccelerationFactor,
        ),
      ),
      minimumSolverCap(usableMaxVelocityMps),
      usableMaxVelocityMps,
    );
    const incomingOrdinal = corner.anchorOrdinal;
    const outgoingOrdinal = corner.anchorOrdinal + 1;
    capsByOrdinal.set(
      incomingOrdinal,
      Math.min(
        capsByOrdinal.get(incomingOrdinal) ?? usableMaxVelocityMps,
        lateralCap,
      ),
    );
    capsByOrdinal.set(
      outgoingOrdinal,
      Math.min(
        capsByOrdinal.get(outgoingOrdinal) ?? usableMaxVelocityMps,
        lateralCap,
      ),
    );
  }
}

function applyGlobalVelocitySeeds(
  simulationContext: AutoVelocitySimulationContext,
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

  for (const ratio of globalVelocitySeedRatios) {
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
      simulationContext,
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

function preserveTightSingleHandoffIncomingCap(
  capsByOrdinal: Map<number, number>,
  corners: readonly AutoVelocityCorner[],
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): void {
  const corner = corners[0];
  if (
    corners.length !== 1 ||
    !corner ||
    corner.turnAngleRadians <= Math.PI / 3 ||
    corner.turnAngleRadians > Math.PI / 2 + 1e-6 ||
    corner.effectiveRadiusMeters > 0.3
  ) {
    return;
  }

  const incomingCap = clamp(
    Math.sqrt(usableMaxAccelerationMps2 * corner.effectiveRadiusMeters * 0.85),
    minimumSolverCap(usableMaxVelocityMps),
    usableMaxVelocityMps,
  );
  capsByOrdinal.set(
    corner.anchorOrdinal,
    Math.min(
      capsByOrdinal.get(corner.anchorOrdinal) ?? incomingCap,
      incomingCap,
    ),
  );
}

function liftVelocityCapsWithinTimeBudget(
  simulationContext: AutoVelocitySimulationContext,
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
  if (
    corners.length === 1 &&
    (corners[0]?.turnAngleRadians ?? 0) > Math.PI / 3 &&
    (corners[0]?.effectiveRadiusMeters ?? Number.POSITIVE_INFINITY) <= 0.3
  ) {
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
          simulationContext,
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

function liftBudgetCapsAtObjectiveRatios(
  simulationContext: AutoVelocitySimulationContext,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  capsByOrdinal: Map<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
  currentEvaluation: VelocityCapEvaluation,
): VelocityCapEvaluation {
  if (
    currentEvaluation.passed ||
    !evaluationMeetsConstraintBudget(currentEvaluation)
  ) {
    return currentEvaluation;
  }

  let evaluation = currentEvaluation;
  const maxAllowedTimeS = currentEvaluation.totalTimeS * 1.05 + solverDtSeconds;
  const ordinals = Array.from(
    { length: Math.max(0, anchors.length - 1) },
    (_, index) => index + 2,
  );

  for (const ordinal of ordinals) {
    const current = capsByOrdinal.get(ordinal);
    if (
      current === undefined ||
      usableMaxVelocityMps - current <= solverCapToleranceMps
    ) {
      continue;
    }

    let bestValue = current;
    let bestEvaluation = evaluation;
    let bestCost = velocityObjectiveCost(evaluation, capsByOrdinal);

    for (const candidate of objectiveRatioLiftGrid(
      current,
      usableMaxVelocityMps,
    )) {
      if (candidate <= bestValue + solverCapToleranceMps) {
        continue;
      }

      const trialCaps = new Map(capsByOrdinal);
      trialCaps.set(ordinal, candidate);
      const trialEvaluation = evaluateVelocityCapsWithGenericSimulation(
        simulationContext,
        segments,
        corners,
        trialCaps,
        usableMaxVelocityMps,
        usableMaxAccelerationMps2,
      );

      if (
        !evaluationMeetsConstraintBudget(trialEvaluation) ||
        trialEvaluation.totalTimeS > maxAllowedTimeS
      ) {
        continue;
      }

      const trialCost = velocityObjectiveCost(trialEvaluation, trialCaps);
      if (trialCost < bestCost - minPositive) {
        bestValue = candidate;
        bestEvaluation = trialEvaluation;
        bestCost = trialCost;
      }
    }

    if (bestValue > current + solverCapToleranceMps) {
      capsByOrdinal.set(ordinal, bestValue);
      evaluation = bestEvaluation;
    }
  }

  return evaluation;
}

function optimizeVelocityWindows(
  simulationContext: AutoVelocitySimulationContext,
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
      let bestCaps = new Map(capsByOrdinal);
      let bestEvaluation = evaluation;
      const minCap = minimumSolverCap(usableMaxVelocityMps);

      for (const ordinal of windowOrdinals) {
        const current = bestCaps.get(ordinal) ?? usableMaxVelocityMps;
        for (const candidate of windowVelocityGrid(
          current,
          minCap,
          usableMaxVelocityMps,
        )) {
          const trialCaps = new Map(bestCaps);
          trialCaps.set(ordinal, candidate);
          const trialEvaluation = evaluateVelocityCaps(
            simulationContext,
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
  simulationContext: AutoVelocitySimulationContext,
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

    let bestCaps = new Map(capsByOrdinal);
    let bestEvaluation = evaluation;
    let bestCenter = centerCurrent;
    let bestWindowSum = windowCapSum(bestCaps, windowOrdinals);

    const leftCurrent = capsByOrdinal.get(windowOrdinals[0]) ?? centerCurrent;
    const rightCurrent = capsByOrdinal.get(windowOrdinals[2]) ?? centerCurrent;
    if (
      (simulationContext.rotationKeyframes.length > 0 ||
        ordinals.length <= 6) &&
      centerCurrent < Math.min(leftCurrent, rightCurrent) * 0.72
    ) {
      for (const first of neighborRelaxationGrid(
        leftCurrent,
        minimumSolverCap(usableMaxVelocityMps),
        usableMaxVelocityMps,
      )) {
        for (const second of liftVelocityGrid(
          centerCurrent,
          usableMaxVelocityMps,
        )) {
          if (second < bestCenter + solverCapToleranceMps) {
            continue;
          }
          for (const third of neighborRelaxationGrid(
            rightCurrent,
            minimumSolverCap(usableMaxVelocityMps),
            usableMaxVelocityMps,
          )) {
            const trialCaps = new Map(capsByOrdinal);
            trialCaps.set(windowOrdinals[0], first);
            trialCaps.set(centerOrdinal, second);
            trialCaps.set(windowOrdinals[2], third);
            const trialEvaluation = evaluateVelocityCaps(
              simulationContext,
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
    }

    for (const second of windowVelocityGrid(
      centerCurrent,
      minimumSolverCap(usableMaxVelocityMps),
      usableMaxVelocityMps,
    )) {
      if (second < bestCenter + solverCapToleranceMps) {
        continue;
      }

      const trialCaps = new Map(capsByOrdinal);
      trialCaps.set(centerOrdinal, second);
      const trialEvaluation = evaluateVelocityCaps(
        simulationContext,
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
      bestCaps = trialCaps;
      bestEvaluation = trialEvaluation;
      bestCenter = second;
      bestWindowSum = trialWindowSum;
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
  simulationContext: AutoVelocitySimulationContext,
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
            simulationContext,
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
  simulationContext: AutoVelocitySimulationContext,
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
  let bestCaps = new Map(capsByOrdinal);

  if (simulationContext.rotationKeyframes.length > 0) {
    for (const incoming of velocityGrid(
      currentIncoming,
      minCap,
      usableMaxVelocityMps,
    )) {
      for (const outgoing of velocityGrid(
        currentOutgoing,
        minCap,
        usableMaxVelocityMps,
      )) {
        const trialCaps = new Map(capsByOrdinal);
        trialCaps.set(incomingOrdinal, incoming);
        trialCaps.set(outgoingOrdinal, outgoing);
        const trialEvaluation = evaluateVelocityCaps(
          simulationContext,
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

  // With a scalar objective, a small coordinate search gives the pair room to
  // trade safety and speed without paying for the full quadratic grid.
  for (const ordinal of [incomingOrdinal, outgoingOrdinal]) {
    const current = bestCaps.get(ordinal) ?? usableMaxVelocityMps;
    let ordinalBestCaps = bestCaps;
    let ordinalBestEvaluation = bestEvaluation;

    for (const candidate of objectiveVelocityGrid(
      current,
      minCap,
      usableMaxVelocityMps,
    )) {
      const trialCaps = new Map(bestCaps);
      trialCaps.set(ordinal, candidate);
      const trialEvaluation = evaluateVelocityCaps(
        simulationContext,
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
          ordinalBestEvaluation,
          ordinalBestCaps,
        )
      ) {
        ordinalBestCaps = trialCaps;
        ordinalBestEvaluation = trialEvaluation;
      }
    }

    if (ordinalBestEvaluation !== bestEvaluation) {
      bestCaps = new Map(ordinalBestCaps);
      bestEvaluation = ordinalBestEvaluation;
      bestIncoming = bestCaps.get(incomingOrdinal) ?? currentIncoming;
      bestOutgoing = bestCaps.get(outgoingOrdinal) ?? currentOutgoing;
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

function ensureCapsPassGenericSimulation(
  simulationContext: AutoVelocitySimulationContext,
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  capsByOrdinal: Map<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): void {
  let evaluation = evaluateVelocityCapsWithGenericSimulation(
    simulationContext,
    segments,
    corners,
    capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  if (evaluation.passed) {
    return;
  }

  const minCap = minimumSolverCap(usableMaxVelocityMps);
  for (let pass = 0; pass < 2 && !evaluation.passed; pass += 1) {
    const failing = evaluation.handoffs
      .filter((handoff) => !handoff.passed)
      .sort(
        (left, right) =>
          handoffViolationRatio(right) - handoffViolationRatio(left),
      );

    for (const handoff of failing) {
      const optimized = optimizeHandoffPairWithGenericSimulation(
        simulationContext,
        segments,
        corners,
        capsByOrdinal,
        handoff.corner,
        minCap,
        usableMaxVelocityMps,
        usableMaxAccelerationMps2,
        evaluation,
      );
      if (optimized.changed) {
        capsByOrdinal.set(handoff.incomingOrdinal, optimized.incomingCap);
        capsByOrdinal.set(handoff.outgoingOrdinal, optimized.outgoingCap);
        evaluation = optimized.evaluation;
      }
      if (evaluation.passed) {
        return;
      }
    }
  }

  if (!evaluation.passed) {
    for (const handoff of evaluation.handoffs.filter(
      (candidate) => !candidate.passed,
    )) {
      const optimized = optimizeValidationWindows(
        simulationContext,
        segments,
        corners,
        capsByOrdinal,
        handoff,
        minCap,
        usableMaxVelocityMps,
        usableMaxAccelerationMps2,
        evaluation,
      );
      if (optimized.evaluation !== evaluation) {
        capsByOrdinal.clear();
        for (const [ordinal, value] of optimized.capsByOrdinal) {
          capsByOrdinal.set(ordinal, value);
        }
        evaluation = optimized.evaluation;
      }
      if (evaluation.passed) {
        return;
      }
    }
  }

  if (!evaluation.passed) {
    const globalSeed = genericGlobalVelocitySeed(
      simulationContext,
      segments,
      corners,
      capsByOrdinal,
      usableMaxVelocityMps,
      usableMaxAccelerationMps2,
    );
    if (globalSeed.evaluation.passed) {
      capsByOrdinal.clear();
      for (const [ordinal, value] of globalSeed.capsByOrdinal) {
        capsByOrdinal.set(ordinal, value);
      }
    }
  }
}

function optimizeValidationWindows(
  simulationContext: AutoVelocitySimulationContext,
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  capsByOrdinal: ReadonlyMap<number, number>,
  handoff: HandoffEvaluation,
  minCap: number,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
  currentEvaluation: VelocityCapEvaluation,
): { capsByOrdinal: Map<number, number>; evaluation: VelocityCapEvaluation } {
  let bestCaps = new Map(capsByOrdinal);
  let bestEvaluation = currentEvaluation;
  const windows = [
    [
      handoff.incomingOrdinal - 1,
      handoff.incomingOrdinal,
      handoff.outgoingOrdinal,
    ],
    [
      handoff.incomingOrdinal,
      handoff.outgoingOrdinal,
      handoff.outgoingOrdinal + 1,
    ],
  ].map((window) => window.filter((ordinal) => capsByOrdinal.has(ordinal)));

  for (const window of windows) {
    if (window.length < 2) {
      continue;
    }
    let windowCaps = new Map(bestCaps);
    let windowEvaluation = bestEvaluation;

    for (let pass = 0; pass < 3; pass += 1) {
      let changed = false;

      for (const ordinal of window) {
        const current = windowCaps.get(ordinal) ?? usableMaxVelocityMps;
        let ordinalBestCaps = windowCaps;
        let ordinalBestEvaluation = windowEvaluation;

        for (const candidate of localValidationGrid(
          current,
          minCap,
          usableMaxVelocityMps,
        )) {
          const trialCaps = new Map(windowCaps);
          trialCaps.set(ordinal, candidate);
          const trialEvaluation = evaluateVelocityCapsWithGenericSimulation(
            simulationContext,
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
              ordinalBestEvaluation,
              ordinalBestCaps,
            )
          ) {
            ordinalBestCaps = trialCaps;
            ordinalBestEvaluation = trialEvaluation;
          }
        }

        if (ordinalBestEvaluation !== windowEvaluation) {
          windowCaps = new Map(ordinalBestCaps);
          windowEvaluation = ordinalBestEvaluation;
          changed = true;
        }
      }

      if (!changed || windowEvaluation.passed) {
        break;
      }
    }

    if (
      isBetterEvaluation(windowEvaluation, windowCaps, bestEvaluation, bestCaps)
    ) {
      bestCaps = windowCaps;
      bestEvaluation = windowEvaluation;
    }
  }

  return { capsByOrdinal: bestCaps, evaluation: bestEvaluation };
}

function genericGlobalVelocitySeed(
  simulationContext: AutoVelocitySimulationContext,
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  capsByOrdinal: ReadonlyMap<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): { capsByOrdinal: Map<number, number>; evaluation: VelocityCapEvaluation } {
  let bestCaps = new Map(capsByOrdinal);
  let bestEvaluation = evaluateVelocityCapsWithGenericSimulation(
    simulationContext,
    segments,
    corners,
    bestCaps,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  const minCap = minimumSolverCap(usableMaxVelocityMps);

  for (const ratio of globalVelocitySeedRatios) {
    const value = clamp(
      usableMaxVelocityMps * ratio,
      minCap,
      usableMaxVelocityMps,
    );
    const trialCaps = new Map<number, number>();
    for (const ordinal of capsByOrdinal.keys()) {
      trialCaps.set(ordinal, value);
    }
    const trialEvaluation = evaluateVelocityCapsWithGenericSimulation(
      simulationContext,
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

  return { capsByOrdinal: bestCaps, evaluation: bestEvaluation };
}

function optimizeSmallPathCapsWithGenericSimulation(
  simulationContext: AutoVelocitySimulationContext,
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  capsByOrdinal: Map<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): void {
  if (anchors.length > 3 || simulationContext.rotationKeyframes.length > 0) {
    return;
  }

  let evaluation = evaluateVelocityCapsWithGenericSimulation(
    simulationContext,
    segments,
    corners,
    capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  const ordinals = Array.from(
    { length: Math.max(0, anchors.length - 1) },
    (_, index) => index + 2,
  );

  for (let pass = 0; pass < 3; pass += 1) {
    for (const ordinal of ordinals) {
      const current = capsByOrdinal.get(ordinal) ?? usableMaxVelocityMps;
      let bestCaps = new Map(capsByOrdinal);
      let bestEvaluation = evaluation;
      let bestValue = current;

      for (const candidate of smallPathOracleCandidates(
        current,
        usableMaxVelocityMps,
      )) {
        const trialCaps = new Map(capsByOrdinal);
        trialCaps.set(ordinal, candidate);
        const trialEvaluation = evaluateVelocityCapsWithGenericSimulation(
          simulationContext,
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
          bestValue = candidate;
        }
      }

      capsByOrdinal.set(ordinal, bestValue);
      evaluation = bestEvaluation;
    }
  }

  for (const handoff of evaluation.handoffs) {
    const optimized = optimizeValidationWindows(
      simulationContext,
      segments,
      corners,
      capsByOrdinal,
      handoff,
      minimumSolverCap(usableMaxVelocityMps),
      usableMaxVelocityMps,
      usableMaxAccelerationMps2,
      evaluation,
    );
    if (optimized.evaluation !== evaluation) {
      capsByOrdinal.clear();
      for (const [ordinal, value] of optimized.capsByOrdinal) {
        capsByOrdinal.set(ordinal, value);
      }
      evaluation = optimized.evaluation;
    }
  }
}

function optimizeHandoffPairWithGenericSimulation(
  simulationContext: AutoVelocitySimulationContext,
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
  let workingCaps = new Map(capsByOrdinal);
  let workingEvaluation = currentEvaluation;

  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;

    for (const ordinal of [incomingOrdinal, outgoingOrdinal]) {
      const current = workingCaps.get(ordinal) ?? usableMaxVelocityMps;
      let ordinalBestCaps = workingCaps;
      let ordinalBestEvaluation = workingEvaluation;

      for (const candidate of validationVelocityGrid(
        current,
        minCap,
        usableMaxVelocityMps,
      )) {
        const trialCaps = new Map(workingCaps);
        trialCaps.set(ordinal, candidate);
        const trialEvaluation = evaluateVelocityCapsWithGenericSimulation(
          simulationContext,
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
            ordinalBestEvaluation,
            ordinalBestCaps,
          )
        ) {
          ordinalBestCaps = trialCaps;
          ordinalBestEvaluation = trialEvaluation;
        }
      }

      if (ordinalBestEvaluation !== workingEvaluation) {
        workingCaps = new Map(ordinalBestCaps);
        workingEvaluation = ordinalBestEvaluation;
        changed = true;
      }
    }

    if (!changed || workingEvaluation.passed) {
      break;
    }
  }

  if (
    isBetterEvaluation(workingEvaluation, workingCaps, bestEvaluation, bestCaps)
  ) {
    bestCaps = workingCaps;
    bestEvaluation = workingEvaluation;
    bestIncoming = bestCaps.get(incomingOrdinal) ?? currentIncoming;
    bestOutgoing = bestCaps.get(outgoingOrdinal) ?? currentOutgoing;
  }

  if (!bestEvaluation.passed) {
    for (const incoming of coupledValidationGrid(
      currentIncoming,
      minCap,
      usableMaxVelocityMps,
    )) {
      for (const outgoing of coupledValidationGrid(
        currentOutgoing,
        minCap,
        usableMaxVelocityMps,
      )) {
        const trialCaps = new Map(capsByOrdinal);
        trialCaps.set(incomingOrdinal, incoming);
        trialCaps.set(outgoingOrdinal, outgoing);
        const trialEvaluation = evaluateVelocityCapsWithGenericSimulation(
          simulationContext,
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
          bestIncoming = incoming;
          bestOutgoing = outgoing;
          bestEvaluation = trialEvaluation;
          bestCaps = trialCaps;
        }
      }
    }
  }

  if (
    !bestEvaluation.passed &&
    evaluationQuality(bestEvaluation).maxRatio < 1.08
  ) {
    const incomingFineGrid = uniqueSortedVelocities(
      [
        bestIncoming,
        bestIncoming - 0.02,
        bestIncoming - 0.04,
        bestIncoming + 0.02,
      ],
      minCap,
      usableMaxVelocityMps,
    );
    const outgoingFineGrid = uniqueSortedVelocities(
      [
        bestOutgoing,
        bestOutgoing - 0.02,
        bestOutgoing - 0.04,
        bestOutgoing + 0.02,
      ],
      minCap,
      usableMaxVelocityMps,
    );

    for (const incoming of incomingFineGrid) {
      for (const outgoing of outgoingFineGrid) {
        const trialCaps = new Map(capsByOrdinal);
        trialCaps.set(incomingOrdinal, incoming);
        trialCaps.set(outgoingOrdinal, outgoing);
        const trialEvaluation = evaluateVelocityCapsWithGenericSimulation(
          simulationContext,
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
          bestIncoming = incoming;
          bestOutgoing = outgoing;
          bestEvaluation = trialEvaluation;
          bestCaps = trialCaps;
        }
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

function simulateAutoVelocityCaps(
  context: AutoVelocitySimulationContext,
  capsByOrdinal: ReadonlyMap<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): {
  trace: SimulationTraceSample[];
  totalTimeS: number;
  finalGlobalSMeters: number;
} {
  const firstSegment = context.segments[0];
  if (!firstSegment) {
    return { trace: [], totalTimeS: 0, finalGlobalSMeters: 0 };
  }

  const trace: SimulationTraceSample[] = [
    {
      time_s: 0,
      x_m: firstSegment.ax,
      y_m: firstSegment.ay,
      theta_rad: context.initialHeading,
      segment_index: 0,
      target_anchor_ordinal_1b: 2,
      global_s_m: 0,
      segment_s_m: 0,
      vx_mps: 0,
      vy_mps: 0,
      omega_radps: 0,
      speed_mps: 0,
      ax_mps2: 0,
      ay_mps2: 0,
      acceleration_mps2: 0,
      snapped_position: false,
      snapped_rotation: false,
    },
  ];

  let x = firstSegment.ax;
  let y = firstSegment.ay;
  let theta = context.initialHeading;
  let speeds: ChassisSpeeds = { vx_mps: 0, vy_mps: 0, omega_radps: 0 };
  let tS = 0;
  let segmentIndex = 0;
  let lastGlobalS = 0;
  const minTransV = minimumCapValue(capsByOrdinal, usableMaxVelocityMps);
  const minRotOmega = degreesToRadians(
    Math.max(
      0.001,
      minimumRotationLimitValue(
        context.maxRotationVelocityConstraints,
        context.baseMaxOmegaRadps / (Math.PI / 180),
      ),
    ),
  );
  const estTransTime =
    context.totalPathLength /
    Math.max(0.1, Math.min(minTransV, usableMaxVelocityMps));
  const estRotTime = Math.PI / minRotOmega;
  const guardTime = Math.max(3, 2 * estTransTime + 1.5 * estRotTime);
  const epsPos = 1e-3;
  const epsAng = degreesToRadians(0.5);

  while (tS <= guardTime) {
    if (segmentIndex >= context.segments.length) {
      break;
    }

    let segment = context.segments[segmentIndex];
    let dx = segment.bx - x;
    let dy = segment.by - y;
    let distToTarget = Math.hypot(dx, dy);
    let projectedS = projectedDistanceOnSegment(segment, x, y);
    let handoffRadius =
      context.handoffRadiiBySegmentIndex[segmentIndex] ??
      context.defaultHandoffRadiusMeters;

    while (
      segmentIndex < context.segments.length - 1 &&
      distToTarget <= handoffRadius
    ) {
      segmentIndex += 1;
      segment = context.segments[segmentIndex];
      dx = segment.bx - x;
      dy = segment.by - y;
      distToTarget = Math.hypot(dx, dy);
      projectedS = projectedDistanceOnSegment(segment, x, y);
      handoffRadius =
        context.handoffRadiiBySegmentIndex[segmentIndex] ??
        context.defaultHandoffRadiusMeters;
    }

    if (segmentIndex >= context.segments.length) {
      break;
    }

    const ux = distToTarget > 1e-9 ? dx / distToTarget : 1;
    const uy = distToTarget > 1e-9 ? dy / distToTarget : 0;
    const globalS = context.cumulativeLengths[segmentIndex] + projectedS;
    const desiredTheta = desiredHeadingForGlobalS(
      context.rotationKeyframes,
      globalS,
      context.startHeadingBase,
    ).desiredTheta;
    const remaining = remainingDistanceFrom(
      context.segments,
      segmentIndex,
      x,
      y,
    );
    const nextAnchorOrdinal = segmentIndex + 2;
    const maxV = effectiveCapValue(
      capsByOrdinal.get(nextAnchorOrdinal),
      usableMaxVelocityMps,
    );
    const maxA = usableMaxAccelerationMps2;
    const maxOmegaEff = activeRotationLimit(
      context.rotationDomainEvents,
      context.maxRotationVelocityConstraints,
      globalS,
    );
    const maxAlphaEff = activeRotationLimit(
      context.rotationDomainEvents,
      context.maxRotationAccelerationConstraints,
      globalS,
    );
    const maxOmega =
      maxOmegaEff === null
        ? context.baseMaxOmegaRadps
        : degreesToRadians(maxOmegaEff);
    const maxAlpha =
      maxAlphaEff === null
        ? context.baseMaxAlphaRadps2
        : degreesToRadians(maxAlphaEff);
    const vPControl = Math.sqrt(2 * usableMaxAccelerationMps2 * remaining);
    let vDesScalar = Math.max(0, Math.min(maxV, vPControl));
    const angularError = shortestAngularDistance(desiredTheta, theta);

    if (
      segmentIndex === context.segments.length - 1 &&
      vDesScalar <= 1e-9 &&
      distToTarget > epsPos
    ) {
      vDesScalar = Math.min(maxV, distToTarget / solverDtSeconds);
    }

    const omegaControl = Math.sqrt(2 * maxAlpha * Math.abs(angularError));
    const omegaDes =
      angularError < 0
        ? -Math.min(omegaControl, maxOmega)
        : Math.min(omegaControl, maxOmega);
    const previousSpeeds = speeds;
    let limited = limitAcceleration(
      {
        vx_mps: vDesScalar * ux,
        vy_mps: vDesScalar * uy,
        omega_radps: omegaDes,
      },
      speeds,
      solverDtSeconds,
      maxA,
      maxAlpha,
    );

    if (Math.abs(limited.omega_radps) > maxOmega && maxOmega > 0) {
      limited = {
        ...limited,
        omega_radps: Math.sign(limited.omega_radps) * maxOmega,
      };
    }

    const dynamicsLimited = limited;
    const axMps2 =
      (dynamicsLimited.vx_mps - previousSpeeds.vx_mps) / solverDtSeconds;
    const ayMps2 =
      (dynamicsLimited.vy_mps - previousSpeeds.vy_mps) / solverDtSeconds;
    const accelerationMps2 = Math.hypot(axMps2, ayMps2);
    const stepDx = limited.vx_mps * solverDtSeconds;
    const stepDy = limited.vy_mps * solverDtSeconds;
    let snappedPosition = false;
    let snappedRotation = false;

    if (segmentIndex === context.segments.length - 1) {
      if (Math.hypot(stepDx, stepDy) >= Math.max(0, distToTarget - epsPos)) {
        x = context.endX;
        y = context.endY;
        limited = {
          vx_mps: 0,
          vy_mps: 0,
          omega_radps: limited.omega_radps,
        };
        snappedPosition = true;
      } else {
        x += stepDx;
        y += stepDy;
      }
    } else {
      x += stepDx;
      y += stepDy;
    }
    theta = wrapAngleRadians(theta + limited.omega_radps * solverDtSeconds);

    // Project onto the segment the follower is actually driving, never the
    // globally nearest one: a path passing close to a later segment would
    // otherwise teleport global_s toward the end, and the monotone clamp
    // would pin it there, poisoning every gate sampled afterward.
    const poseGlobalS = Math.min(
      context.totalPathLength,
      Math.max(
        lastGlobalS,
        (context.cumulativeLengths[segmentIndex] ?? 0) +
          projectedDistanceOnSegment(segment, x, y),
      ),
    );
    lastGlobalS = poseGlobalS;
    const tKey = roundTime(tS);

    if (segmentIndex === context.segments.length - 1) {
      const distToFinal = Math.hypot(context.endX - x, context.endY - y);
      let rotErr = Math.abs(
        shortestAngularDistance(context.endHeadingTarget, theta),
      );
      let snappedPos = false;
      let snappedRot = false;

      if (distToFinal <= epsPos) {
        x = context.endX;
        y = context.endY;
        snappedPos = true;
      }

      if (distToFinal < 0.1 && rotErr <= epsAng) {
        theta = context.endHeadingTarget;
        rotErr = 0;
        snappedRot = true;
        snappedRotation = true;
      }

      if (snappedPos) {
        snappedPosition = true;
        lastGlobalS = context.totalPathLength;
      }
      if (snappedPos) {
        limited = { vx_mps: 0, vy_mps: 0, omega_radps: limited.omega_radps };
        speeds = { vx_mps: 0, vy_mps: 0, omega_radps: speeds.omega_radps };
      }
      if (snappedRot || rotErr === 0) {
        limited = { ...limited, omega_radps: 0 };
        speeds = { ...speeds, omega_radps: 0 };
      }
      if (snappedPos && snappedRot) {
        speeds = { vx_mps: 0, vy_mps: 0, omega_radps: 0 };
      }
    }

    const traceSegment =
      context.segments[Math.min(segmentIndex, context.segments.length - 1)];
    trace.push({
      time_s: tKey,
      x_m: x,
      y_m: y,
      theta_rad: theta,
      segment_index: segmentIndex,
      target_anchor_ordinal_1b: segmentIndex + 2,
      global_s_m: lastGlobalS,
      segment_s_m: traceSegment
        ? projectedDistanceOnSegment(traceSegment, x, y)
        : 0,
      vx_mps: dynamicsLimited.vx_mps,
      vy_mps: dynamicsLimited.vy_mps,
      omega_radps: dynamicsLimited.omega_radps,
      speed_mps: Math.hypot(dynamicsLimited.vx_mps, dynamicsLimited.vy_mps),
      ax_mps2: axMps2,
      ay_mps2: ayMps2,
      acceleration_mps2: accelerationMps2,
      snapped_position: snappedPosition,
      snapped_rotation: snappedRotation,
    });

    if (snappedPosition && snappedRotation) {
      break;
    }

    tS += solverDtSeconds;
    speeds = limited;
  }

  return {
    trace,
    totalTimeS: roundTime(tS),
    finalGlobalSMeters: lastGlobalS,
  };
}

function evaluateVelocityCaps(
  simulationContext: AutoVelocitySimulationContext,
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  trialCapsByOrdinal: ReadonlyMap<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): VelocityCapEvaluation {
  if (simulationContext.rotationKeyframes.length > 0) {
    return evaluateVelocityCapsWithGenericSimulation(
      simulationContext,
      segments,
      corners,
      trialCapsByOrdinal,
      usableMaxVelocityMps,
      usableMaxAccelerationMps2,
    );
  }

  return evaluateVelocityCapsFast(
    simulationContext,
    segments,
    corners,
    trialCapsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
}

function evaluateVelocityCapsFast(
  simulationContext: AutoVelocitySimulationContext,
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  trialCapsByOrdinal: ReadonlyMap<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
): VelocityCapEvaluation {
  const capsByOrdinal = capsWithPins(
    trialCapsByOrdinal,
    simulationContext.pinnedCapsByOrdinal,
    usableMaxVelocityMps,
  );
  const result = simulateAutoVelocityCaps(
    simulationContext,
    capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  const finalGlobalS = result.finalGlobalSMeters;
  const totalLength = segments.at(-1)?.endS ?? 0;
  const reachedEnd =
    totalLength <= minPositive || finalGlobalS >= totalLength - 0.02;
  const handoffs = corners.map((corner) => {
    const handoff = evaluateHandoff(corner, segments, result.trace);
    return {
      ...handoff,
      passed:
        handoff.combinedErrorMeters <=
          handoff.toleranceMeters * fastSimulationPassToleranceRatio &&
        handoff.postHandoffPeakErrorMeters <=
          handoff.postHandoffToleranceMeters *
            fastSimulationPassToleranceRatio &&
        handoff.overshootErrorMeters <=
          handoff.overshootToleranceMeters * fastSimulationPassToleranceRatio &&
        handoff.corridorDeviationMeters <=
          handoff.corridorToleranceMeters * fastSimulationPassToleranceRatio,
    };
  });

  return {
    handoffs,
    passed: reachedEnd && handoffs.every((handoff) => handoff.passed),
    reachedEnd,
    totalTimeS: result.totalTimeS,
    finalGlobalSMeters: finalGlobalS,
    totalLengthMeters: totalLength,
    trace: result.trace,
  };
}

function evaluateVelocityCapsWithGenericSimulation(
  simulationContext: AutoVelocitySimulationContext,
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  trialCapsByOrdinal: ReadonlyMap<number, number>,
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
  dtSeconds: number = solverDtSeconds,
): VelocityCapEvaluation {
  const capsByOrdinal = capsWithPins(
    trialCapsByOrdinal,
    simulationContext.pinnedCapsByOrdinal,
    usableMaxVelocityMps,
  );
  const candidate = pathWithVelocityCaps(
    simulationContext.path,
    capsByOrdinal,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
  );
  const result = simulatePathWithTrace(candidate, simulationContext.config, {
    dt_s: dtSeconds,
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
  const overshootTolerance = overshootToleranceMeters(
    corner.handoffDistanceMeters,
  );
  const corridorTolerance = autoCorridorDeviationBudgetMeters;
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
  const overshootError = incomingSegment
    ? cornerOvershootError(corner, incomingSegment, trace)
    : 0;
  const corridorDeviation =
    incomingSegment && outgoingSegment
      ? cornerCorridorDeviation(corner, incomingSegment, outgoingSegment, trace)
      : Number.POSITIVE_INFINITY;
  const combinedError = Math.hypot(entryError, exitError);
  const transition = observedHandoffTransition(corner, incomingSegment, trace);

  return {
    corner,
    incomingOrdinal: corner.anchorOrdinal,
    outgoingOrdinal: corner.anchorOrdinal + 1,
    toleranceMeters: tolerance,
    postHandoffToleranceMeters: postHandoffTolerance,
    overshootToleranceMeters: overshootTolerance,
    corridorToleranceMeters: corridorTolerance,
    entryErrorMeters: entryError,
    exitErrorMeters: exitError,
    postHandoffPeakErrorMeters: postHandoffPeakError,
    overshootErrorMeters: overshootError,
    corridorDeviationMeters: corridorDeviation,
    combinedErrorMeters: combinedError,
    incomingProgressRatio: transition.incomingProgressRatio,
    earlyHandoffRatio: transition.earlyHandoffRatio,
    skippedOutgoingSegment: transition.skippedOutgoingSegment,
    passed:
      !transition.skippedOutgoingSegment &&
      combinedError <= tolerance &&
      postHandoffPeakError <= postHandoffTolerance &&
      overshootError <= overshootTolerance &&
      corridorDeviation <= corridorTolerance,
  };
}

/**
 * Reads the runtime's actual segment change from the trace. This is the
 * longitudinal counterpart to corridor deviation: reversals can remain on the
 * same line while abandoning nearly half their incoming segment, which a
 * lateral-only metric cannot see.
 */
function observedHandoffTransition(
  corner: AutoVelocityCorner,
  incomingSegment: SegmentGeometry | undefined,
  trace: readonly SimulationTraceSample[],
): {
  incomingProgressRatio: number;
  earlyHandoffRatio: number;
  skippedOutgoingSegment: boolean;
} {
  if (!incomingSegment || incomingSegment.lengthMeters <= minPositive) {
    return {
      incomingProgressRatio: 0,
      earlyHandoffRatio: 1,
      skippedOutgoingSegment: true,
    };
  }

  const outgoingSegmentIndex = corner.anchorOrdinal - 1;
  const sample = trace.find(
    (candidate) => candidate.segment_index >= outgoingSegmentIndex,
  );
  if (!sample) {
    return {
      incomingProgressRatio: 0,
      earlyHandoffRatio: 1,
      skippedOutgoingSegment: true,
    };
  }

  const projectedMeters =
    (sample.x_m - incomingSegment.ax) * incomingSegment.ux +
    (sample.y_m - incomingSegment.ay) * incomingSegment.uy;
  const incomingProgressRatio = clamp(
    projectedMeters / incomingSegment.lengthMeters,
    0,
    1,
  );

  return {
    incomingProgressRatio,
    earlyHandoffRatio: 1 - incomingProgressRatio,
    skippedOutgoingSegment: sample.segment_index > outgoingSegmentIndex,
  };
}

/**
 * Largest centerline departure from the two polyline legs that define this
 * corner. Restricting samples to the handoff window keeps nearby legs from a
 * different corner from contaminating the measurement on dense paths.
 */
function cornerCorridorDeviation(
  corner: AutoVelocityCorner,
  incomingSegment: SegmentGeometry,
  outgoingSegment: SegmentGeometry,
  trace: readonly SimulationTraceSample[],
): number {
  let peak = Number.NEGATIVE_INFINITY;

  for (const sample of trace) {
    if (
      sample.global_s_m < corner.startS - 1e-6 ||
      sample.global_s_m > corner.endS + 1e-6
    ) {
      continue;
    }

    peak = Math.max(
      peak,
      Math.min(
        distanceToSegment(sample.x_m, sample.y_m, incomingSegment),
        distanceToSegment(sample.x_m, sample.y_m, outgoingSegment),
      ),
    );
  }

  return Number.isFinite(peak) ? peak : Number.POSITIVE_INFINITY;
}

function distanceToSegment(
  x: number,
  y: number,
  segment: SegmentGeometry,
): number {
  const along = clamp(
    (x - segment.ax) * segment.ux + (y - segment.ay) * segment.uy,
    0,
    segment.lengthMeters,
  );
  return Math.hypot(
    x - (segment.ax + along * segment.ux),
    y - (segment.ay + along * segment.uy),
  );
}

/**
 * Along-track overshoot through the corner: how far past the anchor, measured
 * along the incoming direction, the robot swings beyond what an ideal fillet
 * would. The ideal's peak projection past the anchor is max(0, R·cos φ) at
 * every turn angle — shallow corners legitimately cross the anchor plane by
 * R·cos φ, while at 90° and beyond (reversals included) the ideal never
 * crosses it — so only the excess is charged. Cross-track gates cannot see
 * this failure on a reversal, where blowing past the anchor is purely
 * along-track.
 */
function cornerOvershootError(
  corner: AutoVelocityCorner,
  incomingSegment: SegmentGeometry,
  trace: readonly SimulationTraceSample[],
): number {
  const expected = Math.max(
    0,
    corner.handoffDistanceMeters * Math.cos(corner.turnAngleRadians),
  );
  let peak = 0;

  for (const sample of trace) {
    if (
      sample.global_s_m < corner.startS - 1e-6 ||
      sample.global_s_m > corner.endS + 1e-6
    ) {
      continue;
    }

    const alongTrack =
      (sample.x_m - incomingSegment.bx) * incomingSegment.ux +
      (sample.y_m - incomingSegment.by) * incomingSegment.uy;
    peak = Math.max(peak, alongTrack - expected);
  }

  return peak;
}

function diagnosticsFromEvaluation(
  evaluation: VelocityCapEvaluation,
): AutoVelocityDiagnostics {
  let maxHandoffErrorRatio = 0;
  let maxPostHandoffErrorRatio = 0;
  let maxOvershootErrorRatio = 0;
  let maxCorridorDeviationRatio = 0;
  const handoffs = evaluation.handoffs.map((handoff) => {
    const handoffRatio =
      handoff.combinedErrorMeters /
      Math.max(handoff.toleranceMeters, minPositive);
    const postHandoffRatio =
      handoff.postHandoffPeakErrorMeters /
      Math.max(handoff.postHandoffToleranceMeters, minPositive);
    const overshootRatio =
      handoff.overshootErrorMeters /
      Math.max(handoff.overshootToleranceMeters, minPositive);
    const corridorRatio =
      handoff.corridorDeviationMeters /
      Math.max(handoff.corridorToleranceMeters, minPositive);
    maxHandoffErrorRatio = Math.max(maxHandoffErrorRatio, handoffRatio);
    maxPostHandoffErrorRatio = Math.max(
      maxPostHandoffErrorRatio,
      postHandoffRatio,
    );
    maxOvershootErrorRatio = Math.max(maxOvershootErrorRatio, overshootRatio);
    maxCorridorDeviationRatio = Math.max(
      maxCorridorDeviationRatio,
      corridorRatio,
    );

    return {
      anchorOrdinal: handoff.corner.anchorOrdinal,
      incomingOrdinal: handoff.incomingOrdinal,
      outgoingOrdinal: handoff.outgoingOrdinal,
      toleranceMeters: roundDistance(handoff.toleranceMeters),
      postHandoffToleranceMeters: roundDistance(
        handoff.postHandoffToleranceMeters,
      ),
      overshootToleranceMeters: roundDistance(handoff.overshootToleranceMeters),
      corridorToleranceMeters: roundDistance(handoff.corridorToleranceMeters),
      entryErrorMeters: roundDistance(handoff.entryErrorMeters),
      exitErrorMeters: roundDistance(handoff.exitErrorMeters),
      combinedErrorMeters: roundDistance(handoff.combinedErrorMeters),
      postHandoffPeakErrorMeters: roundDistance(
        handoff.postHandoffPeakErrorMeters,
      ),
      overshootErrorMeters: roundDistance(handoff.overshootErrorMeters),
      corridorDeviationMeters: roundDistance(handoff.corridorDeviationMeters),
      incomingProgressRatio: roundDistance(handoff.incomingProgressRatio),
      earlyHandoffRatio: roundDistance(handoff.earlyHandoffRatio),
      skippedOutgoingSegment: handoff.skippedOutgoingSegment,
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
    maxOvershootErrorRatio: roundDistance(maxOvershootErrorRatio),
    maxCorridorDeviationRatio: roundDistance(maxCorridorDeviationRatio),
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

function projectedDistanceOnSegment(
  segment: SegmentGeometry,
  x: number,
  y: number,
): number {
  const projected =
    (x - segment.ax) * segment.ux + (y - segment.ay) * segment.uy;
  return clamp(projected, 0, segment.lengthMeters);
}

function remainingDistanceFrom(
  segments: readonly SegmentGeometry[],
  segmentIndex: number,
  currentX: number,
  currentY: number,
): number {
  let remaining = 0;
  let previousX = currentX;
  let previousY = currentY;

  for (let index = segmentIndex; index < segments.length; index += 1) {
    const segment = segments[index];
    remaining += Math.hypot(segment.bx - previousX, segment.by - previousY);
    previousX = segment.bx;
    previousY = segment.by;
  }

  return remaining;
}

function activeRotationLimit(
  rotationDomainEvents: readonly RotationDomainEvent[],
  constraints: readonly RotationLimitConstraint[],
  globalSNow: number,
): number | null {
  if (constraints.length === 0) {
    return null;
  }

  const eventOrdinal = rotationTargetEventOrdinal(
    rotationDomainEvents,
    globalSNow,
  );
  if (eventOrdinal === null || eventOrdinal <= 0) {
    return null;
  }

  let best: number | null = null;
  for (const constraint of constraints) {
    if (
      constraint.startOrdinal <= eventOrdinal &&
      eventOrdinal <= constraint.endOrdinal
    ) {
      best =
        best === null ? constraint.value : Math.min(best, constraint.value);
    }
  }
  return best;
}

function rotationTargetEventOrdinal(
  events: readonly RotationDomainEvent[],
  globalSNow: number,
): number | null {
  if (events.length === 0) {
    return null;
  }

  const tolerance = 1e-6;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (globalSNow < event.s_m - tolerance) {
      return event.event_ordinal_1b;
    }
    if (Math.abs(globalSNow - event.s_m) <= tolerance) {
      return events[index + 1]?.event_ordinal_1b ?? event.event_ordinal_1b;
    }
  }

  return events[events.length - 1].event_ordinal_1b;
}

function minimumCapValue(
  capsByOrdinal: ReadonlyMap<number, number>,
  fallback: number,
): number {
  let best = roundConstraintValue(fallback);
  for (const value of capsByOrdinal.values()) {
    if (Number.isFinite(value) && value > 0) {
      best = Math.min(best, roundConstraintValue(value));
    }
  }
  return best;
}

function effectiveCapValue(
  value: number | undefined,
  fallback: number,
): number {
  return roundConstraintValue(value ?? fallback);
}

function minimumRotationLimitValue(
  constraints: readonly RotationLimitConstraint[],
  fallback: number,
): number {
  let best = fallback;
  for (const constraint of constraints) {
    best = Math.min(best, constraint.value);
  }
  return best;
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

function overshootToleranceMeters(handoffDistanceMeters: number): number {
  return Math.max(
    overshootToleranceFloorMeters,
    handoffDistanceMeters * overshootToleranceRatio,
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

function objectiveVelocityGrid(
  current: number,
  minCap: number,
  usableMaxVelocityMps: number,
): number[] {
  return uniqueSortedVelocities(
    [
      current,
      minCap,
      usableMaxVelocityMps * 0.18,
      usableMaxVelocityMps * 0.25,
      usableMaxVelocityMps * 0.35,
      usableMaxVelocityMps * 0.5,
      usableMaxVelocityMps * 0.65,
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

function objectiveRatioLiftGrid(
  current: number,
  usableMaxVelocityMps: number,
): number[] {
  return uniqueSortedVelocities(
    [
      usableMaxVelocityMps * 0.75,
      usableMaxVelocityMps * 0.6,
      current + usableMaxVelocityMps * 0.02,
      current,
    ],
    current,
    usableMaxVelocityMps,
  ).reverse();
}

function neighborRelaxationGrid(
  current: number,
  minCap: number,
  usableMaxVelocityMps: number,
): number[] {
  return uniqueSortedVelocities(
    [
      current,
      current * 0.9,
      current * 0.8,
      current * 0.7,
      usableMaxVelocityMps * 0.5,
      usableMaxVelocityMps * 0.65,
      usableMaxVelocityMps * 0.8,
      usableMaxVelocityMps,
    ],
    minCap,
    usableMaxVelocityMps,
  );
}

function validationVelocityGrid(
  current: number,
  minCap: number,
  usableMaxVelocityMps: number,
): number[] {
  return uniqueSortedVelocities(
    [
      current,
      current * 1.08,
      current * 1.16,
      current * 1.28,
      current * 1.45,
      current * 1.65,
      current * 0.92,
      current * 0.84,
      current * 0.76,
      current * 0.68,
      usableMaxVelocityMps * 0.25,
      usableMaxVelocityMps * 0.35,
      usableMaxVelocityMps * 0.5,
      usableMaxVelocityMps * 0.65,
      usableMaxVelocityMps * 0.8,
      usableMaxVelocityMps,
    ],
    minCap,
    usableMaxVelocityMps,
  );
}

function coupledValidationGrid(
  current: number,
  minCap: number,
  usableMaxVelocityMps: number,
): number[] {
  return uniqueSortedVelocities(
    [
      current,
      current * 0.92,
      current * 0.68,
      current * 1.16,
      current * 1.45,
      current * 1.65,
      usableMaxVelocityMps * 0.5,
      usableMaxVelocityMps * 0.65,
    ],
    minCap,
    usableMaxVelocityMps,
  );
}

function localValidationGrid(
  current: number,
  minCap: number,
  usableMaxVelocityMps: number,
): number[] {
  return uniqueSortedVelocities(
    [
      current,
      current * 0.75,
      current * 0.82,
      current * 0.9,
      current * 1.1,
      current * 1.2,
      usableMaxVelocityMps * 0.35,
      usableMaxVelocityMps * 0.5,
      usableMaxVelocityMps * 0.65,
      usableMaxVelocityMps * 0.8,
      usableMaxVelocityMps,
    ],
    minCap,
    usableMaxVelocityMps,
  );
}

function smallPathOracleCandidates(
  current: number,
  usableMaxVelocityMps: number,
): number[] {
  const minCap = minimumSolverCap(usableMaxVelocityMps);
  return uniqueSortedVelocities(
    [
      current - usableMaxVelocityMps * 0.2,
      current - usableMaxVelocityMps * 0.1,
      current - usableMaxVelocityMps * 0.05,
      current,
      current + usableMaxVelocityMps * 0.05,
      current + usableMaxVelocityMps * 0.1,
      current + usableMaxVelocityMps * 0.2,
      usableMaxVelocityMps * 0.05,
      usableMaxVelocityMps * 0.08,
      usableMaxVelocityMps * 0.12,
      usableMaxVelocityMps * 0.16,
      usableMaxVelocityMps * 0.2,
      usableMaxVelocityMps * 0.25,
      usableMaxVelocityMps * 0.3,
      usableMaxVelocityMps * 0.35,
      usableMaxVelocityMps * 0.45,
      usableMaxVelocityMps * 0.55,
      usableMaxVelocityMps * 0.65,
      usableMaxVelocityMps * 0.75,
      usableMaxVelocityMps * 0.85,
      usableMaxVelocityMps * 0.92,
      usableMaxVelocityMps,
    ],
    minCap,
    usableMaxVelocityMps,
  );
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
  return (
    velocityObjectiveCost(candidate, candidateCaps) <
    velocityObjectiveCost(current, currentCaps) - minPositive
  );
}

function velocityObjectiveCost(
  evaluation: VelocityCapEvaluation,
  caps: ReadonlyMap<number, number>,
): number {
  return autoVelocityObjectiveCost({
    reachedEndRatio: reachedEndRatio(evaluation),
    handoffRatios: evaluationHandoffRatios(evaluation),
    totalTimeS: evaluation.totalTimeS,
    capsByOrdinal: caps,
  });
}

function evaluationHandoffRatios(
  evaluation: VelocityCapEvaluation,
): readonly number[] {
  return evaluation.handoffs.flatMap((handoff) => [
    handoff.combinedErrorMeters /
      Math.max(handoff.toleranceMeters, minPositive),
    handoff.postHandoffPeakErrorMeters /
      Math.max(handoff.postHandoffToleranceMeters, minPositive),
    handoff.overshootErrorMeters /
      Math.max(handoff.overshootToleranceMeters, minPositive),
    handoff.corridorDeviationMeters /
      Math.max(handoff.corridorToleranceMeters, minPositive),
  ]);
}

function evaluationMeetsConstraintBudget(
  evaluation: VelocityCapEvaluation,
): boolean {
  return (
    evaluation.reachedEnd &&
    evaluation.handoffs.every(
      (handoff) =>
        handoff.combinedErrorMeters <= handoff.toleranceMeters &&
        handoff.postHandoffPeakErrorMeters <=
          handoff.postHandoffToleranceMeters &&
        handoff.overshootErrorMeters <= handoff.overshootToleranceMeters &&
        handoff.corridorDeviationMeters <= handoff.corridorToleranceMeters,
    )
  );
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
    const overshootRatio =
      handoff.overshootErrorMeters /
      Math.max(handoff.overshootToleranceMeters, minPositive);
    const corridorRatio =
      handoff.corridorDeviationMeters /
      Math.max(handoff.corridorToleranceMeters, minPositive);
    maxRatio = Math.max(
      maxRatio,
      gateRatio,
      postHandoffRatio,
      overshootRatio,
      corridorRatio,
    );
    sumSquaredRatio +=
      gateRatio ** 2 +
      postHandoffRatio ** 2 +
      overshootRatio ** 2 +
      corridorRatio ** 2;
  }

  return { maxRatio, sumSquaredRatio };
}

function handoffViolationRatio(handoff: HandoffEvaluation): number {
  return Math.max(
    handoff.combinedErrorMeters /
      Math.max(handoff.toleranceMeters, minPositive),
    handoff.postHandoffPeakErrorMeters /
      Math.max(handoff.postHandoffToleranceMeters, minPositive),
    handoff.overshootErrorMeters /
      Math.max(handoff.overshootToleranceMeters, minPositive),
    handoff.corridorDeviationMeters /
      Math.max(handoff.corridorToleranceMeters, minPositive),
  );
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

function isRotationRangedConstraintKey(key: RangedConstraintKey): boolean {
  return (
    key === "max_velocity_deg_per_sec" ||
    key === "max_acceleration_deg_per_sec2"
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

function defaultHeading(segment: SegmentGeometry): number {
  return Math.atan2(segment.by - segment.ay, segment.bx - segment.ax);
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

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundSolverVelocity(value: number): number {
  return Number(value.toFixed(3));
}

function roundConstraintValue(value: number): number {
  return Number(Math.max(0.01, Math.floor(value * 100) / 100).toFixed(2));
}

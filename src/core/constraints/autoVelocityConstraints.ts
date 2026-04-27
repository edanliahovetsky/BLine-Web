import {
  defaultAutoVelocityAccelerationSafetyFactor,
  defaultAutoVelocityVelocitySafetyFactor,
  getDefaultOptionalConfigValue
} from "../config/projectConfig";
import {
  isTranslationTarget,
  isWaypoint,
  type AutoVelocityConstraintMetadata,
  type PathElement,
  type PathModel,
  type RangedConstraint
} from "../model/path";

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
  settings: Required<Pick<
    AutoVelocityGenerationOptions,
    "velocitySafetyFactor" | "accelerationSafetyFactor" | "sampleStepMeters"
  >>;
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

const defaultMaxVelocityMps = 4.5;
const defaultMaxAccelerationMps2 = 7;
const defaultHandoffRadiusMeters = 0.2;
const defaultSampleStepMeters = 0.05;
const defaultFirstOrdinalVelocityRatio = 0.5;
const minPositive = 1e-9;

export function generateAutoVelocityProfile(
  path: PathModel,
  config: unknown,
  options: AutoVelocityGenerationOptions = {}
): AutoVelocityProfile {
  const anchors = translationAnchors(path.path_elements);
  const segments = buildSegmentGeometry(anchors);
  const settings = {
    velocitySafetyFactor: clampSafetyFactor(
      options.velocitySafetyFactor,
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_velocity_safety_factor"
      ) ?? defaultAutoVelocityVelocitySafetyFactor
    ),
    accelerationSafetyFactor: clampSafetyFactor(
      options.accelerationSafetyFactor,
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_acceleration_safety_factor"
      ) ?? defaultAutoVelocityAccelerationSafetyFactor
    ),
    sampleStepMeters: positiveNumber(options.sampleStepMeters, defaultSampleStepMeters)
  };
  const baseMaxVelocity = resolvePositive(
    path.constraints.max_velocity_meters_per_sec,
    getDefaultOptionalConfigValue(config, "max_velocity_meters_per_sec"),
    defaultMaxVelocityMps
  );
  const baseMaxAcceleration = resolvePositive(
    path.constraints.max_acceleration_meters_per_sec2,
    getDefaultOptionalConfigValue(config, "max_acceleration_meters_per_sec2"),
    defaultMaxAccelerationMps2
  );
  const defaultHandoffRadius = resolvePositive(
    null,
    getDefaultOptionalConfigValue(config, "intermediate_handoff_radius_meters"),
    defaultHandoffRadiusMeters
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
    defaultHandoffRadius
  );
  const samples = solveVelocitySamples(
    segments,
    corners,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2,
    settings.sampleStepMeters
  );
  const segmentCaps = segmentCapsFromSamples(
    anchors,
    segments,
    corners,
    samples,
    baseMaxVelocity,
    usableMaxVelocityMps
  );

  return {
    anchors,
    corners,
    samples,
    segmentCaps,
    settings,
    usableMaxVelocityMps,
    usableMaxAccelerationMps2
  };
}

export function autoVelocityMetadata(
  settings: Pick<
    AutoVelocityConstraintMetadata,
    | "velocity_safety_factor"
    | "acceleration_safety_factor"
    | "merge_tolerance_meters_per_sec"
  >
): AutoVelocityConstraintMetadata {
  return {
    velocity_safety_factor: settings.velocity_safety_factor,
    acceleration_safety_factor: settings.acceleration_safety_factor,
    merge_tolerance_meters_per_sec: settings.merge_tolerance_meters_per_sec
  };
}

export function autoVelocityConstraintForCap(
  cap: AutoVelocitySegmentCap,
  metadata: AutoVelocityConstraintMetadata
): RangedConstraint {
  return {
    key: "max_velocity_meters_per_sec",
    value: cap.value,
    start_ordinal: cap.targetOrdinal,
    end_ordinal: cap.targetOrdinal,
    source: "auto_velocity",
    auto_velocity: metadata
  };
}

function translationAnchors(
  elements: readonly PathElement[]
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
          pathIndex
        }
      ];
    }

    return [];
  });
}

function buildSegmentGeometry(
  anchors: readonly AutoVelocityAnchor[]
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
            endS: s
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
            endS: s + length
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
  defaultHandoffRadius: number
): AutoVelocityCorner[] {
  const corners: AutoVelocityCorner[] = [];

  for (let anchorIndex = 1; anchorIndex < anchors.length - 1; anchorIndex += 1) {
    const incoming = segments[anchorIndex - 1];
    const outgoing = segments[anchorIndex];
    const anchor = anchors[anchorIndex];
    if (!incoming || !outgoing || !anchor) {
      continue;
    }

    const dot = clamp(incoming.ux * outgoing.ux + incoming.uy * outgoing.uy, -1, 1);
    const turnAngle = Math.acos(dot);
    if (turnAngle < 1e-4) {
      continue;
    }

    const requestedHandoff = handoffRadiusForAnchor(
      path.path_elements[anchor.pathIndex],
      defaultHandoffRadius
    );
    const maxHandoff = Math.max(
      0,
      Math.min(incoming.lengthMeters, outgoing.lengthMeters) * 0.49
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
    const effectiveRadius = Math.max(handoffDistance, tangentFilletRadius, 1e-4);
    const anchorS = cumulativeLengths[anchorIndex] ?? 0;
    corners.push({
      anchorOrdinal: anchorIndex + 1,
      turnAngleRadians: turnAngle,
      handoffDistanceMeters: handoffDistance,
      effectiveRadiusMeters: effectiveRadius,
      curvature: 1 / effectiveRadius,
      startS: Math.max(0, anchorS - handoffDistance),
      endS: Math.min(cumulativeLengths.at(-1) ?? anchorS, anchorS + handoffDistance),
      clamped: handoffDistance < requestedHandoff - 1e-9
    });
  }

  return corners;
}

function solveVelocitySamples(
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  usableMaxVelocityMps: number,
  usableMaxAccelerationMps2: number,
  sampleStepMeters: number
): AutoVelocitySample[] {
  const totalLength = segments.at(-1)?.endS ?? 0;
  if (totalLength <= minPositive) {
    return [];
  }

  const sampleS = samplePositions(totalLength, segments, corners, sampleStepMeters);
  const curvatures = sampleS.map((s) => curvatureAt(s, corners));
  const qLimits = curvatures.map((curvature) => {
    if (curvature <= minPositive) {
      return usableMaxVelocityMps ** 2;
    }

    return Math.min(
      usableMaxVelocityMps ** 2,
      usableMaxAccelerationMps2 / curvature
    );
  });
  const q = [...qLimits];

  for (let pass = 0; pass < 24; pass += 1) {
    let maxDelta = 0;
    for (let index = 1; index < q.length; index += 1) {
      const ds = Math.max(sampleS[index] - sampleS[index - 1], minPositive);
      const accel = tangentialAccelerationLimit(
        q[index - 1],
        curvatures[index - 1],
        usableMaxAccelerationMps2
      );
      const next = Math.min(q[index], q[index - 1] + 2 * accel * ds);
      maxDelta = Math.max(maxDelta, Math.abs((q[index] ?? 0) - next));
      q[index] = next;
    }

    for (let index = q.length - 2; index >= 0; index -= 1) {
      const ds = Math.max(sampleS[index + 1] - sampleS[index], minPositive);
      const accel = tangentialAccelerationLimit(
        q[index + 1],
        curvatures[index + 1],
        usableMaxAccelerationMps2
      );
      const next = Math.min(q[index], q[index + 1] + 2 * accel * ds);
      maxDelta = Math.max(maxDelta, Math.abs((q[index] ?? 0) - next));
      q[index] = next;
    }

    if (maxDelta < 1e-6) {
      break;
    }
  }

  return sampleS.map((sMeters, index) => ({
    sMeters,
    curvature: curvatures[index] ?? 0,
    velocityLimitMps: Math.sqrt(Math.max(0, qLimits[index] ?? 0)),
    velocityMps: Math.sqrt(Math.max(0, q[index] ?? 0))
  }));
}

function samplePositions(
  totalLength: number,
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  sampleStepMeters: number
): number[] {
  const positions = new Set<number>([0, totalLength]);

  for (let s = sampleStepMeters; s < totalLength; s += sampleStepMeters) {
    positions.add(roundDistance(s));
  }
  for (const segment of segments) {
    positions.add(roundDistance(segment.startS));
    positions.add(roundDistance(segment.endS));
  }
  for (const corner of corners) {
    positions.add(roundDistance(corner.startS));
    positions.add(roundDistance(corner.endS));
  }

  return [...positions]
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= totalLength)
    .sort((left, right) => left - right);
}

function segmentCapsFromSamples(
  anchors: readonly AutoVelocityAnchor[],
  segments: readonly SegmentGeometry[],
  corners: readonly AutoVelocityCorner[],
  samples: readonly AutoVelocitySample[],
  baseMaxVelocityMps: number,
  usableMaxVelocityMps: number
): AutoVelocitySegmentCap[] {
  const firstOrdinalValue = Math.min(
    baseMaxVelocityMps * defaultFirstOrdinalVelocityRatio,
    usableMaxVelocityMps
  );
  const firstOrdinalCap =
    anchors.length > 0
      ? [
          {
            segmentIndex: 0,
            targetOrdinal: 1,
            value: roundConstraintValue(firstOrdinalValue),
            minVelocityLimitMps: roundConstraintValue(firstOrdinalValue)
          }
        ]
      : [];

  return firstOrdinalCap.concat(segments.map((_, segmentIndex) => {
    const targetOrdinal = segmentIndex + 2;
    const targetCorner = corners.find(
      (corner) => corner.anchorOrdinal === targetOrdinal
    );
    const targetSample = targetCorner
      ? sampleAtDistance(samples, targetCorner.startS)
      : null;
    const profileVelocity = targetSample?.velocityMps ?? usableMaxVelocityMps;
    const velocityLimit =
      targetSample?.velocityLimitMps ?? usableMaxVelocityMps;

    return {
      segmentIndex,
      targetOrdinal,
      value: roundConstraintValue(Math.min(usableMaxVelocityMps, profileVelocity)),
      minVelocityLimitMps: roundConstraintValue(
        Math.min(usableMaxVelocityMps, velocityLimit)
      )
    };
  }));
}

function sampleAtDistance(
  samples: readonly AutoVelocitySample[],
  sMeters: number
): AutoVelocitySample | null {
  if (samples.length === 0) {
    return null;
  }

  const target = roundDistance(sMeters);
  let closest = samples[0] ?? null;
  for (const sample of samples) {
    if (Math.abs(sample.sMeters - target) <= 1e-6) {
      return sample;
    }

    if (
      closest === null ||
      Math.abs(sample.sMeters - target) < Math.abs(closest.sMeters - target)
    ) {
      closest = sample;
    }
  }

  return closest;
}

function curvatureAt(
  sMeters: number,
  corners: readonly AutoVelocityCorner[]
): number {
  let curvature = 0;
  for (const corner of corners) {
    if (corner.startS - 1e-9 <= sMeters && sMeters <= corner.endS + 1e-9) {
      curvature = Math.max(curvature, corner.curvature);
    }
  }
  return curvature;
}

function tangentialAccelerationLimit(
  velocitySquared: number,
  curvature: number,
  usableMaxAccelerationMps2: number
): number {
  const lateralAcceleration = velocitySquared * curvature;
  const remainingSquared =
    usableMaxAccelerationMps2 ** 2 - lateralAcceleration ** 2;
  return Math.sqrt(Math.max(0, remainingSquared));
}

function handoffRadiusForAnchor(
  element: PathElement | undefined,
  defaultHandoffRadius: number
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
  defaultValue: number
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

function roundConstraintValue(value: number): number {
  return Number(Math.max(0.01, value).toFixed(2));
}

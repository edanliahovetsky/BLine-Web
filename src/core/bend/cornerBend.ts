export interface BendPoint {
  x: number;
  y: number;
}

export interface CornerGeometry {
  index: number;
  turnAngleRadians: number;
  legInMeters: number;
  legOutMeters: number;
  inUnitX: number;
  inUnitY: number;
  outUnitX: number;
  outUnitY: number;
  bisectorX: number;
  bisectorY: number;
}

export interface FeasibleRadiusRange {
  minMeters: number;
  maxMeters: number;
}

/** Internal centerline corridor the generated path may leave around a corner. */
export const autoCorridorDeviationBudgetMeters = 0.26;

const minRadiusMeters = 0.05;
const maxRadiusIncomingLegRatio = 0.9;
const seedRadiusIncomingLegRatio = 0.49;
const collinearTurnAngleRadians = 0.02;
const minLegLengthMeters = 1e-6;
const chainedLegRatio = 0.9;
const chainingRepairPasses = 2;

/**
 * Corner frame for an interior anchor of a polyline. Returns null where no
 * corner can be bent: endpoints, collinear runs, and coincident anchors.
 */
export function cornerGeometry(
  points: readonly BendPoint[],
  index: number,
): CornerGeometry | null {
  if (!Number.isInteger(index)) {
    return null;
  }

  const previous = points[index - 1];
  const corner = points[index];
  const next = points[index + 1];
  if (!previous || !corner || !next) {
    return null;
  }

  const legInMeters = Math.hypot(corner.x - previous.x, corner.y - previous.y);
  const legOutMeters = Math.hypot(next.x - corner.x, next.y - corner.y);
  if (legInMeters < minLegLengthMeters || legOutMeters < minLegLengthMeters) {
    return null;
  }

  const inUnitX = (corner.x - previous.x) / legInMeters;
  const inUnitY = (corner.y - previous.y) / legInMeters;
  const outUnitX = (next.x - corner.x) / legOutMeters;
  const outUnitY = (next.y - corner.y) / legOutMeters;
  const turnAngleRadians = Math.acos(
    clamp(inUnitX * outUnitX + inUnitY * outUnitY, -1, 1),
  );
  if (
    !Number.isFinite(turnAngleRadians) ||
    turnAngleRadians < collinearTurnAngleRadians
  ) {
    return null;
  }

  // The inner bisector runs from the anchor toward the fillet center, so a
  // deviation measured along it stays on the cut side of the corner.
  const bisectorRawX = outUnitX - inUnitX;
  const bisectorRawY = outUnitY - inUnitY;
  const bisectorLength = Math.hypot(bisectorRawX, bisectorRawY);
  if (bisectorLength < minLegLengthMeters) {
    return null;
  }

  return {
    index,
    turnAngleRadians,
    legInMeters,
    legOutMeters,
    inUnitX,
    inUnitY,
    outUnitX,
    outUnitY,
    bisectorX: bisectorRawX / bisectorLength,
    bisectorY: bisectorRawY / bisectorLength,
  };
}

/**
 * Handoff radii the follower can actually honor at this corner: the lower
 * bound keeps the corner from collapsing, while the upper bound prevents the
 * incoming segment from handing off immediately.
 *
 * A handoff radius is a trigger distance around the target anchor, not a
 * fillet that consumes equal room on both adjacent legs. It may therefore be
 * larger than the outgoing leg; only the distance available while approaching
 * the anchor is a local geometric limit.
 */
export function feasibleRadiusRange(
  geometry: CornerGeometry | null,
): FeasibleRadiusRange | null {
  if (!geometry) {
    return null;
  }

  const maxMeters = maxRadiusIncomingLegRatio * geometry.legInMeters;
  return maxMeters < minRadiusMeters
    ? null
    : { minMeters: minRadiusMeters, maxMeters };
}

/**
 * How far the emergent fillet leaves the anchor. With fillet radius
 * r = R / tan(phi/2) the sagitta is r * (sec(phi/2) - 1), which reduces to
 * R * tan(phi/4) — the form used here because it stays finite as phi
 * approaches 0 or PI.
 */
export function deviationForRadius(
  radiusMeters: number,
  turnAngleRadians: number,
): number {
  const radius = nonNegative(radiusMeters);
  const turnAngle = clampTurnAngle(turnAngleRadians);
  if (radius === 0 || turnAngle < collinearTurnAngleRadians) {
    return 0;
  }

  return radius * Math.tan(turnAngle / 4);
}

/**
 * Inverse of `deviationForRadius`. Callers clamp the result with
 * `feasibleRadiusRange` — the mapping itself is unbounded.
 */
export function radiusForDeviation(
  deviationMeters: number,
  turnAngleRadians: number,
): number {
  const deviation = nonNegative(deviationMeters);
  const turnAngle = clampTurnAngle(turnAngleRadians);
  if (deviation === 0 || turnAngle < collinearTurnAngleRadians) {
    return 0;
  }

  return deviation / Math.tan(turnAngle / 4);
}

/**
 * Perpendicular distance from the midpoint of an ideal tangent fillet to the
 * nearer polyline leg. `deviationForRadius` measures to the anchor vertex;
 * multiplying by cos(phi / 2) projects that distance onto the leg normal.
 *
 * Unlike vertex deviation, corridor deviation tends to zero at a reversal:
 * the incoming and outgoing legs occupy the same line even when the follower
 * turns around well before reaching their shared endpoint.
 */
export function corridorDeviationForRadius(
  radiusMeters: number,
  turnAngleRadians: number,
): number {
  const turnAngle = clampTurnAngle(turnAngleRadians);
  return (
    deviationForRadius(radiusMeters, turnAngle) *
    Math.max(0, Math.cos(turnAngle / 2))
  );
}

/**
 * Inverse of `corridorDeviationForRadius`. At a near-reversal the geometric
 * corridor cost approaches zero, so the returned radius can be unbounded;
 * callers must clamp it through `feasibleRadiusRange`.
 */
export function radiusForCorridorDeviation(
  deviationMeters: number,
  turnAngleRadians: number,
): number {
  const deviation = nonNegative(deviationMeters);
  const turnAngle = clampTurnAngle(turnAngleRadians);
  const coefficient =
    Math.tan(turnAngle / 4) * Math.max(0, Math.cos(turnAngle / 2));
  if (
    deviation === 0 ||
    turnAngle < collinearTurnAngleRadians ||
    coefficient <= Number.EPSILON
  ) {
    return coefficient <= Number.EPSILON && deviation > 0
      ? Number.POSITIVE_INFINITY
      : 0;
  }

  return deviation / coefficient;
}

/**
 * Fast starting point for a corner nobody has tuned. The seed is intentionally
 * below the interaction limit: the optimizer searches around it using the
 * actual handoff trace, so this is only a stable first candidate rather than a
 * claim that the radius is geometrically optimal.
 */
export function seedRadius(geometry: CornerGeometry | null): number | null {
  const range = feasibleRadiusRange(geometry);
  if (!geometry || !range) {
    return null;
  }

  return Math.min(
    range.maxMeters,
    seedRadiusIncomingLegRatio * geometry.legInMeters,
  );
}

/**
 * Scales down neighboring radii that would claim more of a shared leg than it
 * has, keeping their proportion. Radii are indexed alongside `points`; null
 * entries are untuned corners and stay untouched.
 */
export function repairChaining(
  radii: readonly (number | null)[],
  points: readonly BendPoint[],
): (number | null)[] {
  const repaired = radii.map((radius) =>
    radius === null || !Number.isFinite(radius) ? null : Math.max(0, radius),
  );

  for (let pass = 0; pass < chainingRepairPasses; pass += 1) {
    let changed = false;

    for (let index = 0; index < repaired.length - 1; index += 1) {
      const incoming = repaired[index];
      const outgoing = repaired[index + 1];
      const start = points[index];
      const end = points[index + 1];
      if (incoming === null || outgoing === null || !start || !end) {
        continue;
      }

      const budgetMeters =
        chainedLegRatio * Math.hypot(end.x - start.x, end.y - start.y);
      const requestedMeters = incoming + outgoing;
      if (requestedMeters <= budgetMeters || requestedMeters <= 0) {
        continue;
      }

      const scale = budgetMeters / requestedMeters;
      repaired[index] = incoming * scale;
      repaired[index + 1] = outgoing * scale;
      changed = true;
    }

    if (!changed) {
      break;
    }
  }

  return repaired;
}

function clampTurnAngle(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, Math.PI) : 0;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

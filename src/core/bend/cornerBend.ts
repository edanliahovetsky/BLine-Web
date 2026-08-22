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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

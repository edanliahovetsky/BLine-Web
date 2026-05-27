import { createTranslationTarget, type TranslationTarget } from "../model/path";

export interface ProfilePoint {
  x_meters: number;
  y_meters: number;
}

export interface CurveProfileOptions {
  toleranceMeters?: number;
  minSpacingMeters?: number;
  maxGeneratedTargets?: number;
}

export interface CurveTargetOptions extends CurveProfileOptions {
  previousAnchor?: ProfilePoint | null;
  nextAnchor?: ProfilePoint | null;
  endpointSnapToleranceMeters?: number;
  handoffRadiusMeters?: number;
}

export interface CurveProfileResult {
  points: ProfilePoint[];
  toleranceMeters: number;
}

const defaultToleranceMeters = 0.18;
const defaultMinSpacingMeters = 0.35;
const defaultMaxGeneratedTargets = 18;
const defaultEndpointSnapToleranceMeters = 0.18;
const defaultHandoffRadiusMeters = 0.45;
const minPointSeparationMeters = 0.015;
const maxSimplificationRounds = 12;

export function buildSparseCurveProfile(
  samples: readonly ProfilePoint[],
  options: CurveProfileOptions = {},
): CurveProfileResult {
  const cleaned = dedupeNearbyPoints(sanitizePoints(samples));
  if (cleaned.length <= 2) {
    return {
      points: cleaned,
      toleranceMeters: positiveNumber(
        options.toleranceMeters,
        defaultToleranceMeters,
      ),
    };
  }

  const minSpacing = positiveNumber(
    options.minSpacingMeters,
    defaultMinSpacingMeters,
  );
  const maxGeneratedTargets = Math.max(
    2,
    Math.trunc(
      positiveNumber(options.maxGeneratedTargets, defaultMaxGeneratedTargets),
    ),
  );
  let tolerance = positiveNumber(
    options.toleranceMeters,
    defaultToleranceMeters,
  );
  let best = cleaned;

  for (let round = 0; round <= maxSimplificationRounds; round += 1) {
    const simplified = enforceMinimumSpacing(
      simplifyPolylineRdp(cleaned, tolerance),
      minSpacing,
    );
    best = simplified;
    if (simplified.length <= maxGeneratedTargets) {
      break;
    }
    tolerance *= 1.3;
  }

  return { points: best, toleranceMeters: tolerance };
}

export function createCurveTranslationTargets(
  samples: readonly ProfilePoint[],
  options: CurveTargetOptions = {},
): TranslationTarget[] {
  const profile = buildSparseCurveProfile(samples, options);
  const points = trimAnchoredEndpoints(profile.points, options);
  const handoffRadius = positiveNumber(
    options.handoffRadiusMeters,
    defaultHandoffRadiusMeters,
  );

  return points.map((point) => {
    return createTranslationTarget({
      x_meters: roundMeters(point.x_meters),
      y_meters: roundMeters(point.y_meters),
      intermediate_handoff_radius_meters: roundMeters(handoffRadius),
    });
  });
}

export function simplifyPolylineRdp(
  points: readonly ProfilePoint[],
  toleranceMeters: number,
): ProfilePoint[] {
  if (points.length <= 2) {
    return [...points];
  }

  const tolerance = Math.max(0, toleranceMeters);
  const keep = new Set<number>([0, points.length - 1]);
  simplifyRange(points, 0, points.length - 1, tolerance, keep);

  return [...keep]
    .sort((left, right) => left - right)
    .map((index) => points[index]);
}

function simplifyRange(
  points: readonly ProfilePoint[],
  startIndex: number,
  endIndex: number,
  toleranceMeters: number,
  keep: Set<number>,
): void {
  if (endIndex <= startIndex + 1) {
    return;
  }

  const start = points[startIndex];
  const end = points[endIndex];
  let farthestIndex = -1;
  let farthestDistance = -1;

  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const distance = distanceToSegment(points[index], start, end);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }

  if (farthestIndex === -1 || farthestDistance <= toleranceMeters) {
    return;
  }

  keep.add(farthestIndex);
  simplifyRange(points, startIndex, farthestIndex, toleranceMeters, keep);
  simplifyRange(points, farthestIndex, endIndex, toleranceMeters, keep);
}

function enforceMinimumSpacing(
  points: readonly ProfilePoint[],
  minSpacingMeters: number,
): ProfilePoint[] {
  if (points.length <= 2 || minSpacingMeters <= 0) {
    return [...points];
  }

  const kept: ProfilePoint[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const lastKept = kept[kept.length - 1];
    const next = points[index + 1];
    if (
      distance(point, lastKept) >= minSpacingMeters &&
      distance(point, next) >= minPointSeparationMeters
    ) {
      kept.push(point);
    }
  }

  const end = points[points.length - 1];
  if (distance(kept[kept.length - 1], end) < minPointSeparationMeters) {
    kept[kept.length - 1] = end;
  } else {
    kept.push(end);
  }

  return kept;
}

function trimAnchoredEndpoints(
  points: readonly ProfilePoint[],
  options: CurveTargetOptions,
): ProfilePoint[] {
  const snapTolerance = positiveNumber(
    options.endpointSnapToleranceMeters,
    defaultEndpointSnapToleranceMeters,
  );
  let startIndex = 0;
  let endIndex = points.length - 1;

  if (
    options.previousAnchor &&
    points[startIndex] &&
    distance(points[startIndex], options.previousAnchor) <= snapTolerance
  ) {
    startIndex += 1;
  }

  if (
    options.nextAnchor &&
    endIndex >= startIndex &&
    points[endIndex] &&
    distance(points[endIndex], options.nextAnchor) <= snapTolerance
  ) {
    endIndex -= 1;
  }

  return startIndex <= endIndex ? points.slice(startIndex, endIndex + 1) : [];
}

function sanitizePoints(points: readonly ProfilePoint[]): ProfilePoint[] {
  return points.flatMap((point) => {
    if (Number.isFinite(point.x_meters) && Number.isFinite(point.y_meters)) {
      return [{ x_meters: point.x_meters, y_meters: point.y_meters }];
    }
    return [];
  });
}

function dedupeNearbyPoints(points: readonly ProfilePoint[]): ProfilePoint[] {
  const deduped: ProfilePoint[] = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || distance(previous, point) >= minPointSeparationMeters) {
      deduped.push(point);
    }
  }
  return deduped;
}

function distanceToSegment(
  point: ProfilePoint,
  start: ProfilePoint,
  end: ProfilePoint,
): number {
  const dx = end.x_meters - start.x_meters;
  const dy = end.y_meters - start.y_meters;
  const denominator = dx * dx + dy * dy;
  if (denominator <= 1e-12) {
    return distance(point, start);
  }

  const t = clamp(
    ((point.x_meters - start.x_meters) * dx +
      (point.y_meters - start.y_meters) * dy) /
      denominator,
    0,
    1,
  );
  return distance(point, {
    x_meters: start.x_meters + dx * t,
    y_meters: start.y_meters + dy * t,
  });
}

function distance(first: ProfilePoint, second: ProfilePoint): number {
  return Math.hypot(
    first.x_meters - second.x_meters,
    first.y_meters - second.y_meters,
  );
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function roundMeters(value: number): number {
  return Number(value.toFixed(5));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

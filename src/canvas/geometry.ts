import {
  clampPointToFieldCoordinates,
  defaultFieldGeometry,
  fieldCoordinateOffsetXMeters,
  fieldCoordinateOffsetYMeters,
  type FieldGeometry,
} from "../core/field/fieldConfig";
import {
  isAnchorElement,
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement,
} from "../core/model/path";

export interface CanvasSize {
  width: number;
  height: number;
}

export interface FieldViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  field: FieldGeometry;
}

export interface StagePoint {
  x: number;
  y: number;
}

export type StageRect = Pick<FieldViewport, "x" | "y" | "width" | "height">;

/** The calibrated Field image and model coordinates share this exact rectangle. */
export function fieldImageStageRect(viewport: FieldViewport): StageRect {
  return {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width,
    height: viewport.height,
  };
}

export function stagePointsDiffer(
  first: StagePoint,
  second: StagePoint,
): boolean {
  return first.x !== second.x || first.y !== second.y;
}

export function isStagePointWithinCanvas(
  point: StagePoint,
  size: CanvasSize,
  margin = 0,
): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= -margin &&
    point.x <= size.width + margin &&
    point.y >= -margin &&
    point.y <= size.height + margin
  );
}

/**
 * Projects an off-canvas point onto the canvas edge without pretending that
 * it lies on the Field boundary. The result is intended for a distinct
 * overflow marker, not as a replacement model position.
 */
export function overflowMarkerStagePoint(
  point: StagePoint,
  size: CanvasSize,
  inset = 22,
): StagePoint | null {
  if (isStagePointWithinCanvas(point, size)) {
    return null;
  }
  if (Number.isNaN(point.x) || Number.isNaN(point.y)) {
    return null;
  }

  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const center = { x: width / 2, y: height / 2 };
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const magnitude = Math.max(Math.abs(dx), Math.abs(dy));
  if (magnitude === 0 || Number.isNaN(magnitude)) {
    return null;
  }

  const unitX = Number.isFinite(magnitude)
    ? dx / magnitude
    : Number.isFinite(dx)
      ? 0
      : Math.sign(dx);
  const unitY = Number.isFinite(magnitude)
    ? dy / magnitude
    : Number.isFinite(dy)
      ? 0
      : Math.sign(dy);
  if (unitX === 0 && unitY === 0) {
    return null;
  }

  const minimumX = Math.min(inset, width / 2);
  const maximumX = Math.max(minimumX, width - minimumX);
  const minimumY = Math.min(inset, height / 2);
  const maximumY = Math.max(minimumY, height - minimumY);
  const xDistance =
    unitX > 0
      ? (maximumX - center.x) / unitX
      : unitX < 0
        ? (minimumX - center.x) / unitX
        : Number.POSITIVE_INFINITY;
  const yDistance =
    unitY > 0
      ? (maximumY - center.y) / unitY
      : unitY < 0
        ? (minimumY - center.y) / unitY
        : Number.POSITIVE_INFINITY;
  const distance = Math.min(xDistance, yDistance);

  return {
    x: clamp(center.x + unitX * distance, minimumX, maximumX),
    y: clamp(center.y + unitY * distance, minimumY, maximumY),
  };
}

/**
 * Clips a polyline to a small canvas overscan region before Pixi builds GPU
 * geometry. This preserves the visible portion of true model geometry while
 * keeping arbitrarily large imported coordinates away from the renderer.
 */
export function clipStagePolyline(
  points: readonly StagePoint[],
  size: CanvasSize,
  margin = 96,
): StagePoint[][] {
  if (points.length < 2) {
    return [];
  }

  const rect = {
    minX: -margin,
    maxX: Math.max(1, size.width) + margin,
    minY: -margin,
    maxY: Math.max(1, size.height) + margin,
  };
  const coordinateLimit =
    Math.max(1, size.width, size.height, Math.abs(margin)) * 64;
  const runs: StagePoint[][] = [];

  for (let index = 1; index < points.length; index += 1) {
    const segment = clipStageSegment(
      renderSafeStagePoint(points[index - 1], coordinateLimit),
      renderSafeStagePoint(points[index], coordinateLimit),
      rect,
    );
    if (!segment) {
      continue;
    }

    const previousRun = runs.at(-1);
    const previousEnd = previousRun?.at(-1);
    if (
      previousRun &&
      previousEnd &&
      stagePointsAlmostEqual(previousEnd, segment[0])
    ) {
      previousRun.push(segment[1]);
    } else {
      runs.push(segment);
    }
  }

  return runs;
}

export interface PointMeters {
  x_meters: number;
  y_meters: number;
}

export type PositionOverrides = ReadonlyMap<number, PointMeters>;
export type RotationOverrides = ReadonlyMap<number, number>;

export function createFieldViewport(
  size: CanvasSize,
  preferredPaddingPx = 24,
  field: FieldGeometry = defaultFieldGeometry,
): FieldViewport {
  const safeWidth = Math.max(1, size.width);
  const safeHeight = Math.max(1, size.height);
  const padding = Math.min(preferredPaddingPx, safeWidth / 12, safeHeight / 12);
  const availableWidth = Math.max(1, safeWidth - padding * 2);
  const availableHeight = Math.max(1, safeHeight - padding * 2);
  const scale = Math.max(
    1,
    Math.min(
      availableWidth / field.length_meters,
      availableHeight / field.width_meters,
    ),
  );
  const width = field.length_meters * scale;
  const height = field.width_meters * scale;

  return {
    x: (safeWidth - width) / 2,
    y: (safeHeight - height) / 2,
    width,
    height,
    scale,
    field,
  };
}

export function fieldSceneToStagePoint(
  scenePoint: PointMeters,
  viewport: FieldViewport,
): StagePoint {
  return {
    x: viewport.x + scenePoint.x_meters * viewport.scale,
    y: viewport.y + scenePoint.y_meters * viewport.scale,
  };
}

export function modelToStagePoint(
  point: PointMeters,
  viewport: FieldViewport,
): StagePoint {
  const offsetX = fieldCoordinateOffsetXMeters(viewport.field);
  const offsetY = fieldCoordinateOffsetYMeters(viewport.field);

  return fieldSceneToStagePoint(
    {
      x_meters: point.x_meters + offsetX,
      y_meters: viewport.field.width_meters - point.y_meters - offsetY,
    },
    viewport,
  );
}

export function stageToModelPoint(
  point: StagePoint,
  viewport: FieldViewport,
): PointMeters {
  const sceneX = (point.x - viewport.x) / viewport.scale;
  const sceneY = (point.y - viewport.y) / viewport.scale;
  const offsetX = fieldCoordinateOffsetXMeters(viewport.field);
  const offsetY = fieldCoordinateOffsetYMeters(viewport.field);

  return clampModelPoint(
    {
      x_meters: sceneX - offsetX,
      y_meters: viewport.field.width_meters - sceneY - offsetY,
    },
    viewport.field,
  );
}

export function clampModelPoint(
  point: PointMeters,
  field: FieldGeometry = defaultFieldGeometry,
): PointMeters {
  return clampPointToFieldCoordinates(point, field);
}

/**
 * Radius of the ring the anchor node claims for itself: matches the
 * translation node circle hit-test so overlay grabs and node grabs never
 * contest the same pixels.
 */
export function anchorNodeExclusionRadiusPx(viewport: FieldViewport): number {
  return Math.max(7, 0.1 * viewport.scale) + 14;
}

export function getElementPosition(
  elements: readonly PathElement[],
  index: number,
  overrides: PositionOverrides = emptyOverrides,
): PointMeters | null {
  const override = overrides.get(index);
  if (override) {
    return override;
  }

  const element = elements[index];
  if (!element) {
    return null;
  }

  if (isTranslationTarget(element)) {
    return {
      x_meters: element.x_meters,
      y_meters: element.y_meters,
    };
  }

  if (isWaypoint(element)) {
    return {
      x_meters: element.translation_target.x_meters,
      y_meters: element.translation_target.y_meters,
    };
  }

  if (isRotationTarget(element) || isEventTrigger(element)) {
    const previous = findNeighborAnchorPosition(elements, index, -1, overrides);
    const next = findNeighborAnchorPosition(elements, index, 1, overrides);

    if (!previous || !next) {
      return null;
    }

    const tRatio = clamp(element.t_ratio, 0, 1);

    return {
      x_meters:
        previous.x_meters + (next.x_meters - previous.x_meters) * tRatio,
      y_meters:
        previous.y_meters + (next.y_meters - previous.y_meters) * tRatio,
    };
  }

  return null;
}

export function getAnchorPositions(
  elements: readonly PathElement[],
  overrides: PositionOverrides = emptyOverrides,
): Array<{ index: number; position: PointMeters }> {
  return elements.flatMap((element, index) => {
    if (!isAnchorElement(element)) {
      return [];
    }

    const position = getElementPosition(elements, index, overrides);
    return position ? [{ index, position }] : [];
  });
}

export function getRenderableElementPositions(
  elements: readonly PathElement[],
  overrides: PositionOverrides = emptyOverrides,
): Array<{ index: number; position: PointMeters }> {
  return elements.flatMap((_element, index) => {
    const position = getElementPosition(elements, index, overrides);
    return position ? [{ index, position }] : [];
  });
}

export function getRotationRadians(element: PathElement): number | null {
  if (isRotationTarget(element)) {
    return element.rotation_radians;
  }

  if (isWaypoint(element)) {
    return element.rotation_target.rotation_radians;
  }

  return null;
}

export function getElementHeadingRadians(
  elements: readonly PathElement[],
  index: number,
  overrides: RotationOverrides = emptyRotationOverrides,
): number | null {
  const override = overrides.get(index);
  if (override !== undefined) {
    return override;
  }

  const element = elements[index];
  if (!element) {
    return null;
  }

  if (isRotationTarget(element) || isWaypoint(element)) {
    return getRotationRadians(element);
  }

  if (isEventTrigger(element)) {
    return getSegmentHeadingRadians(elements, index, Math.PI / 2);
  }

  if (isTranslationTarget(element)) {
    for (
      let previousIndex = index - 1;
      previousIndex >= 0;
      previousIndex -= 1
    ) {
      const previous = elements[previousIndex];
      if (isRotationTarget(previous) || isWaypoint(previous)) {
        return getRotationRadians(previous);
      }
    }
  }

  return 0;
}

export function getNeighborAnchorPositions(
  elements: readonly PathElement[],
  index: number,
  overrides: PositionOverrides = emptyOverrides,
): { previous: PointMeters; next: PointMeters } | null {
  const previous = findNeighborAnchorPosition(elements, index, -1, overrides);
  const next = findNeighborAnchorPosition(elements, index, 1, overrides);

  return previous && next ? { previous, next } : null;
}

export function projectPointToSegmentRatio(
  point: PointMeters,
  previous: PointMeters,
  next: PointMeters,
): number {
  const dx = next.x_meters - previous.x_meters;
  const dy = next.y_meters - previous.y_meters;
  const denominator = dx * dx + dy * dy;
  if (denominator <= 1e-9) {
    return 0;
  }

  return clamp(
    ((point.x_meters - previous.x_meters) * dx +
      (point.y_meters - previous.y_meters) * dy) /
      denominator,
    0,
    1,
  );
}

export function interpolateSegmentPosition(
  previous: PointMeters,
  next: PointMeters,
  tRatio: number,
): PointMeters {
  const t = clamp(tRatio, 0, 1);
  return {
    x_meters: previous.x_meters + (next.x_meters - previous.x_meters) * t,
    y_meters: previous.y_meters + (next.y_meters - previous.y_meters) * t,
  };
}

function findNeighborAnchorPosition(
  elements: readonly PathElement[],
  startIndex: number,
  direction: -1 | 1,
  overrides: PositionOverrides,
): PointMeters | null {
  for (
    let index = startIndex + direction;
    index >= 0 && index < elements.length;
    index += direction
  ) {
    if (isAnchorElement(elements[index])) {
      return getElementPosition(elements, index, overrides);
    }
  }

  return null;
}

function getSegmentHeadingRadians(
  elements: readonly PathElement[],
  index: number,
  offsetRadians = 0,
): number | null {
  const previous = findNeighborAnchorPosition(
    elements,
    index,
    -1,
    emptyOverrides,
  );
  const next = findNeighborAnchorPosition(elements, index, 1, emptyOverrides);

  if (!previous || !next) {
    return null;
  }

  return (
    Math.atan2(
      next.y_meters - previous.y_meters,
      next.x_meters - previous.x_meters,
    ) + offsetRadians
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

interface StageClipRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function renderSafeStagePoint(
  point: StagePoint,
  coordinateLimit: number,
): StagePoint {
  return {
    x: renderSafeCoordinate(point.x, coordinateLimit),
    y: renderSafeCoordinate(point.y, coordinateLimit),
  };
}

function renderSafeCoordinate(value: number, limit: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value === Number.POSITIVE_INFINITY) {
    return limit;
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return -limit;
  }
  return clamp(value, -limit, limit);
}

function clipStageSegment(
  start: StagePoint,
  end: StagePoint,
  rect: StageClipRect,
): [StagePoint, StagePoint] | null {
  let startPoint = start;
  let endPoint = end;
  let startCode = stageClipCode(startPoint, rect);
  let endCode = stageClipCode(endPoint, rect);

  for (let iteration = 0; iteration < 8; iteration += 1) {
    if ((startCode | endCode) === 0) {
      return [startPoint, endPoint];
    }
    if ((startCode & endCode) !== 0) {
      return null;
    }

    const code = startCode || endCode;
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    let next: StagePoint;

    if ((code & stageClipTop) !== 0) {
      next = {
        x: startPoint.x + (dx * (rect.minY - startPoint.y)) / dy,
        y: rect.minY,
      };
    } else if ((code & stageClipBottom) !== 0) {
      next = {
        x: startPoint.x + (dx * (rect.maxY - startPoint.y)) / dy,
        y: rect.maxY,
      };
    } else if ((code & stageClipRight) !== 0) {
      next = {
        x: rect.maxX,
        y: startPoint.y + (dy * (rect.maxX - startPoint.x)) / dx,
      };
    } else {
      next = {
        x: rect.minX,
        y: startPoint.y + (dy * (rect.minX - startPoint.x)) / dx,
      };
    }

    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) {
      return null;
    }
    if (code === startCode) {
      startPoint = next;
      startCode = stageClipCode(startPoint, rect);
    } else {
      endPoint = next;
      endCode = stageClipCode(endPoint, rect);
    }
  }

  return null;
}

function stageClipCode(point: StagePoint, rect: StageClipRect): number {
  let code = 0;
  if (point.x < rect.minX) {
    code |= stageClipLeft;
  } else if (point.x > rect.maxX) {
    code |= stageClipRight;
  }
  if (point.y < rect.minY) {
    code |= stageClipTop;
  } else if (point.y > rect.maxY) {
    code |= stageClipBottom;
  }
  return code;
}

function stagePointsAlmostEqual(first: StagePoint, second: StagePoint): boolean {
  return (
    Math.abs(first.x - second.x) <= 0.001 &&
    Math.abs(first.y - second.y) <= 0.001
  );
}

const stageClipLeft = 1;
const stageClipRight = 2;
const stageClipTop = 4;
const stageClipBottom = 8;

const emptyOverrides = new Map<number, PointMeters>();
const emptyRotationOverrides = new Map<number, number>();

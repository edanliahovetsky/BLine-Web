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

const emptyOverrides = new Map<number, PointMeters>();
const emptyRotationOverrides = new Map<number, number>();

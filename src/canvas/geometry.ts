import {
  fieldCoordinateOffsetMeters,
  fieldLengthMeters,
  fieldWidthMeters,
  robotLengthMeters,
  robotWidthMeters
} from "./constants";
import {
  isAnchorElement,
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement
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
}

export interface StagePoint {
  x: number;
  y: number;
}

export interface PointMeters {
  x_meters: number;
  y_meters: number;
}

export type PositionOverrides = ReadonlyMap<number, PointMeters>;

export function createFieldViewport(
  size: CanvasSize,
  preferredPaddingPx = 24
): FieldViewport {
  const safeWidth = Math.max(1, size.width);
  const safeHeight = Math.max(1, size.height);
  const padding = Math.min(preferredPaddingPx, safeWidth / 12, safeHeight / 12);
  const availableWidth = Math.max(1, safeWidth - padding * 2);
  const availableHeight = Math.max(1, safeHeight - padding * 2);
  const scale = Math.max(
    1,
    Math.min(availableWidth / fieldLengthMeters, availableHeight / fieldWidthMeters)
  );
  const width = fieldLengthMeters * scale;
  const height = fieldWidthMeters * scale;

  return {
    x: (safeWidth - width) / 2,
    y: (safeHeight - height) / 2,
    width,
    height,
    scale
  };
}

export function fieldSceneToStagePoint(
  scenePoint: PointMeters,
  viewport: FieldViewport
): StagePoint {
  return {
    x: viewport.x + scenePoint.x_meters * viewport.scale,
    y: viewport.y + scenePoint.y_meters * viewport.scale
  };
}

export function modelToStagePoint(
  point: PointMeters,
  viewport: FieldViewport
): StagePoint {
  return fieldSceneToStagePoint(
    {
      x_meters: point.x_meters + fieldCoordinateOffsetMeters,
      y_meters: fieldWidthMeters - point.y_meters - fieldCoordinateOffsetMeters
    },
    viewport
  );
}

export function stageToModelPoint(
  point: StagePoint,
  viewport: FieldViewport
): PointMeters {
  const sceneX = (point.x - viewport.x) / viewport.scale;
  const sceneY = (point.y - viewport.y) / viewport.scale;

  return clampModelPoint({
    x_meters: sceneX - fieldCoordinateOffsetMeters,
    y_meters: fieldWidthMeters - sceneY - fieldCoordinateOffsetMeters
  });
}

export function clampModelPoint(point: PointMeters): PointMeters {
  const halfRobotLength = robotLengthMeters / 2;
  const halfRobotWidth = robotWidthMeters / 2;
  const maxX = fieldLengthMeters - fieldCoordinateOffsetMeters * 2 - halfRobotLength;
  const maxY = fieldWidthMeters - fieldCoordinateOffsetMeters * 2 - halfRobotWidth;

  return {
    x_meters: clamp(point.x_meters, halfRobotLength, maxX),
    y_meters: clamp(point.y_meters, halfRobotWidth, maxY)
  };
}

export function getElementPosition(
  elements: readonly PathElement[],
  index: number,
  overrides: PositionOverrides = emptyOverrides
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
      y_meters: element.y_meters
    };
  }

  if (isWaypoint(element)) {
    return {
      x_meters: element.translation_target.x_meters,
      y_meters: element.translation_target.y_meters
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
      x_meters: previous.x_meters + (next.x_meters - previous.x_meters) * tRatio,
      y_meters: previous.y_meters + (next.y_meters - previous.y_meters) * tRatio
    };
  }

  return null;
}

export function getAnchorPositions(
  elements: readonly PathElement[],
  overrides: PositionOverrides = emptyOverrides
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
  overrides: PositionOverrides = emptyOverrides
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
  index: number
): number | null {
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
    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const previous = elements[previousIndex];
      if (isRotationTarget(previous) || isWaypoint(previous)) {
        return getRotationRadians(previous);
      }
    }
  }

  return 0;
}

export function getHandoffRadiusMeters(element: PathElement): number | null {
  if (isTranslationTarget(element)) {
    return positiveRadiusOrNull(element.intermediate_handoff_radius_meters);
  }

  if (isWaypoint(element)) {
    return positiveRadiusOrNull(
      element.translation_target.intermediate_handoff_radius_meters
    );
  }

  return null;
}

function findNeighborAnchorPosition(
  elements: readonly PathElement[],
  startIndex: number,
  direction: -1 | 1,
  overrides: PositionOverrides
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
  offsetRadians = 0
): number | null {
  const previous = findNeighborAnchorPosition(elements, index, -1, emptyOverrides);
  const next = findNeighborAnchorPosition(elements, index, 1, emptyOverrides);

  if (!previous || !next) {
    return null;
  }

  return (
    Math.atan2(next.y_meters - previous.y_meters, next.x_meters - previous.x_meters) +
    offsetRadians
  );
}

function positiveRadiusOrNull(radius: number | null): number | null {
  return radius !== null && radius > 0 ? radius : null;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

const emptyOverrides = new Map<number, PointMeters>();

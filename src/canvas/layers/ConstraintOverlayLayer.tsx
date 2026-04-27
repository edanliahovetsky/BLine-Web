import { Circle, Group, Line, Rect } from "react-konva";
import type { ProjectDocument } from "../../core/io/projectSchema";
import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement,
  type RangedConstraint
} from "../../core/model/path";
import type { SelectedRangedConstraint } from "../../state/selectionStore";
import {
  elementCircleRadiusMeters,
  eventMarkerHalfHeightPx,
  eventTriggerLengthMeters
} from "../constants";
import {
  firstDomainIndexForConstraintRange,
  pathIndexesForConstraintRange
} from "../constraintRange";
import {
  getElementHeadingRadians,
  getElementPosition,
  modelToStagePoint,
  type FieldViewport,
  type PositionOverrides,
  type StagePoint
} from "../geometry";
import {
  centeredRobotBounds,
  robotSizeFromConfig,
  strokedRectInsideBounds,
  type RobotSizeMeters
} from "../robotFootprint";

const constraintHighlightColor = "#15c915";
const constraintPathHighlightStrokeWidthPx = 4;

export function ConstraintRangeHighlightContent({
  project,
  selection,
  viewport,
  dragPreview
}: {
  project: ProjectDocument | null;
  selection: SelectedRangedConstraint | null;
  viewport: FieldViewport;
  dragPreview: PositionOverrides;
}) {
  if (!project || !selection) {
    return null;
  }

  const selectedConstraint = project.path.ranged_constraints[selection.index];
  if (!selectedConstraint || selectedConstraint.key !== selection.key) {
    return null;
  }

  const constraint: RangedConstraint = {
    ...selectedConstraint,
    start_ordinal: selection.startOrdinal,
    end_ordinal: selection.endOrdinal
  };
  const elements = project.path.path_elements;
  const robotSizeMeters = robotSizeFromConfig(project.config);
  const covered = pathIndexesForConstraintRange(elements, constraint).flatMap((index) => {
    const position = getElementPosition(elements, index, dragPreview);
    return position ? [{ index, point: modelToStagePoint(position, viewport) }] : [];
  });
  const firstDomainIndex = firstDomainIndexForConstraintRange(elements, constraint);
  const firstDomainPosition =
    firstDomainIndex === null
      ? null
      : getElementPosition(elements, firstDomainIndex, dragPreview);

  if (covered.length === 0 && firstDomainPosition === null) {
    return null;
  }

  const points = covered.flatMap(({ point }) => [point.x, point.y]);

  return (
    <>
      {points.length >= 4 ? (
        <Line
          points={points}
          stroke={constraintHighlightColor}
          strokeWidth={constraintPathHighlightStrokeWidthPx}
          lineCap="round"
          lineJoin="round"
          opacity={0.96}
          listening={false}
        />
      ) : null}
      {firstDomainIndex !== null && firstDomainPosition ? (
        <ConstraintStartElementHighlight
          element={elements[firstDomainIndex]}
          point={modelToStagePoint(firstDomainPosition, viewport)}
          headingRadians={getElementHeadingRadians(elements, firstDomainIndex)}
          robotSizeMeters={robotSizeMeters}
          metersToPixels={viewport.scale}
        />
      ) : null}
    </>
  );
}

function ConstraintStartElementHighlight({
  element,
  point,
  headingRadians,
  robotSizeMeters,
  metersToPixels
}: {
  element: PathElement;
  point: StagePoint;
  headingRadians: number | null;
  robotSizeMeters: RobotSizeMeters;
  metersToPixels: number;
}) {
  if (isTranslationTarget(element)) {
    return (
      <Circle
        x={point.x}
        y={point.y}
        radius={Math.max(7, elementCircleRadiusMeters * metersToPixels)}
        fill={constraintHighlightColor}
        stroke={constraintHighlightColor}
        strokeWidth={2}
        listening={false}
      />
    );
  }

  if (isWaypoint(element) || isRotationTarget(element)) {
    const width = robotSizeMeters.lengthMeters * metersToPixels;
    const height = robotSizeMeters.widthMeters * metersToPixels;
    const strokeWidth = Math.max(4, Math.min(width, height) * 0.11);
    const outline = strokedRectInsideBounds(
      centeredRobotBounds(width, height),
      strokeWidth
    );

    return (
      <Group
        x={point.x}
        y={point.y}
        rotation={toStageDegrees(headingRadians)}
        listening={false}
      >
        <Rect
          x={outline.rect.x}
          y={outline.rect.y}
          width={outline.rect.width}
          height={outline.rect.height}
          cornerRadius={Math.max(
            0,
            robotCornerRadius(width, height) - outline.strokeWidth / 2
          )}
          stroke={constraintHighlightColor}
          strokeWidth={outline.strokeWidth}
          fill="rgba(21, 201, 21, 0.22)"
          lineJoin="round"
        />
      </Group>
    );
  }

  if (isEventTrigger(element)) {
    return (
      <Line
        x={point.x}
        y={point.y}
        points={eventTriggerPoints(metersToPixels)}
        rotation={toStageDegrees(headingRadians)}
        stroke={constraintHighlightColor}
        strokeWidth={constraintPathHighlightStrokeWidthPx}
        lineCap="round"
        listening={false}
      />
    );
  }

  return null;
}

function eventTriggerPoints(metersToPixels: number): number[] {
  const halfLength =
    Math.max(eventMarkerHalfHeightPx * 2, eventTriggerLengthMeters * metersToPixels) / 2;
  return [-halfLength, 0, halfLength, 0];
}

function toStageDegrees(radians: number | null): number {
  return radians === null ? 0 : -radians * (180 / Math.PI);
}

function robotCornerRadius(width: number, height: number): number {
  return Math.max(3, Math.min(width, height) * 0.08);
}

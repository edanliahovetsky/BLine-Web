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
  eventTriggerLengthMeters,
  robotLengthMeters,
  robotWidthMeters
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

const constraintHighlightColor = "#15c915";

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
  const strokeWidth = Math.max(6, viewport.scale * 0.05);

  return (
    <>
      {points.length >= 4 ? (
        <Line
          points={points}
          stroke={constraintHighlightColor}
          strokeWidth={strokeWidth}
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
  metersToPixels
}: {
  element: PathElement;
  point: StagePoint;
  headingRadians: number | null;
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
    const width = robotLengthMeters * metersToPixels;
    const height = robotWidthMeters * metersToPixels;
    const strokeWidth = Math.max(4, Math.min(width, height) * 0.11);

    return (
      <Group
        x={point.x}
        y={point.y}
        rotation={toStageDegrees(headingRadians)}
        listening={false}
      >
        <Rect
          x={-width / 2}
          y={-height / 2}
          width={width}
          height={height}
          cornerRadius={robotCornerRadius(width, height)}
          stroke={constraintHighlightColor}
          strokeWidth={strokeWidth}
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
        strokeWidth={Math.max(6, metersToPixels * 0.05)}
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

import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Line, Rect } from "react-konva";
import {
  elementCircleRadiusMeters,
  elementOutlineMeters,
  eventTriggerLengthMeters,
  eventMarkerHalfHeightPx,
  robotLengthMeters,
  robotWidthMeters,
  triangleSizeRatio,
  waypointSizePx
} from "../constants";
import type { StagePoint } from "../geometry";
import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement
} from "../../core/model/path";

type CanvasPointerEvent = KonvaEventObject<MouseEvent | TouchEvent | PointerEvent>;
type CanvasDragEvent = KonvaEventObject<DragEvent>;

interface WaypointNodeProps {
  element: PathElement;
  index: number;
  point: StagePoint;
  selected: boolean;
  draggable: boolean;
  headingRadians: number | null;
  handoffRadiusMeters: number | null;
  metersToPixels: number;
  onPointerDown(index: number, event: CanvasPointerEvent): void;
  onDragStart(index: number, event: CanvasDragEvent): void;
  onDragMove(index: number, event: CanvasDragEvent): void;
  onDragEnd(index: number, event: CanvasDragEvent): void;
}

export function WaypointNode({
  element,
  index,
  point,
  selected,
  draggable,
  headingRadians,
  handoffRadiusMeters,
  metersToPixels,
  onPointerDown,
  onDragStart,
  onDragMove,
  onDragEnd
}: WaypointNodeProps) {
  const selectionStroke = selected ? "#fc6525" : undefined;
  const circleRadius = metersToVisiblePixels(elementCircleRadiusMeters, metersToPixels, 7);
  const rectWidth = metersToVisiblePixels(robotLengthMeters, metersToPixels, waypointSizePx);
  const rectHeight = metersToVisiblePixels(robotWidthMeters, metersToPixels, waypointSizePx);
  const outlineWidth = metersToVisiblePixels(elementOutlineMeters, metersToPixels, 3);
  const handoffRadius = handoffRadiusMeters
    ? Math.max(8, handoffRadiusMeters * metersToPixels)
    : null;

  return (
    <Group
      x={point.x}
      y={point.y}
      draggable={draggable}
      onMouseDown={(event) => onPointerDown(index, event)}
      onTouchStart={(event) => onPointerDown(index, event)}
      onDragStart={(event) => onDragStart(index, event)}
      onDragMove={(event) => onDragMove(index, event)}
      onDragEnd={(event) => onDragEnd(index, event)}
    >
      {handoffRadius ? (
        <Circle
          radius={handoffRadius}
          stroke="#ff00ff"
          strokeWidth={3}
          dash={[7, 6]}
          opacity={0.95}
          listening={false}
        />
      ) : null}

      {isTranslationTarget(element) ? (
        <>
          {selected ? (
            <Circle
              radius={circleRadius + 7}
              stroke={selectionStroke}
              strokeWidth={4}
              opacity={0.9}
            />
          ) : null}
          <Circle
            radius={circleRadius}
            fill="#3aa3ff"
            stroke="#1d6c9d"
            strokeWidth={2}
          />
        </>
      ) : null}

      {isWaypoint(element) ? (
        <>
          {selected ? (
            <SelectionFootprint
              width={rectWidth}
              height={rectHeight}
              headingRadians={headingRadians}
              stroke={selectionStroke}
            />
          ) : null}
          <RobotFootprint
            width={rectWidth}
            height={rectHeight}
            outline="#ff7f3a"
            outlineWidth={outlineWidth}
            headingRadians={headingRadians}
            dashed={false}
            triangleMode="outline"
          />
        </>
      ) : null}

      {isRotationTarget(element) ? (
        <>
          {selected ? (
            <SelectionFootprint
              width={rectWidth}
              height={rectHeight}
              headingRadians={headingRadians}
              stroke={selectionStroke}
            />
          ) : null}
          <RobotFootprint
            width={rectWidth}
            height={rectHeight}
            outline="#50c878"
            outlineWidth={outlineWidth}
            headingRadians={headingRadians}
            dashed={true}
            triangleMode="fill"
          />
        </>
      ) : null}

      {isEventTrigger(element) ? (
        <>
          {selected ? (
            <Line
              points={eventTriggerPoints(metersToPixels, 8)}
              rotation={toStageDegrees(headingRadians)}
              stroke={selectionStroke}
              strokeWidth={8}
              lineCap="round"
            />
          ) : null}
          <Line
            points={eventTriggerPoints(metersToPixels, 0)}
            rotation={toStageDegrees(headingRadians)}
            stroke="#ffd54d"
            strokeWidth={7}
            lineCap="butt"
          />
        </>
      ) : null}
    </Group>
  );
}

function SelectionFootprint({
  width,
  height,
  headingRadians,
  stroke
}: {
  width: number;
  height: number;
  headingRadians: number | null;
  stroke: string | undefined;
}) {
  return (
    <Group rotation={toStageDegrees(headingRadians)}>
      <Rect
        x={-width / 2 - 7}
        y={-height / 2 - 7}
        width={width + 14}
        height={height + 14}
        stroke={stroke}
        strokeWidth={4}
      />
    </Group>
  );
}

function RobotFootprint({
  width,
  height,
  outline,
  outlineWidth,
  headingRadians,
  dashed,
  triangleMode
}: {
  width: number;
  height: number;
  outline: string;
  outlineWidth: number;
  headingRadians: number | null;
  dashed: boolean;
  triangleMode: "fill" | "outline";
}) {
  const triangleLength = Math.min(width, height) * triangleSizeRatio;
  const halfTriangleHeight = triangleLength / 2;
  const trianglePoints = [
    triangleLength / 2,
    0,
    -triangleLength / 2,
    halfTriangleHeight,
    -triangleLength / 2,
    -halfTriangleHeight
  ];

  return (
    <Group rotation={toStageDegrees(headingRadians)}>
      <Rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        stroke={outline}
        strokeWidth={outlineWidth}
        dash={dashed ? [6, 4] : undefined}
        fill="rgba(0, 0, 0, 0.05)"
        lineJoin="miter"
      />
      <Line
        points={trianglePoints}
        closed={true}
        fill={triangleMode === "fill" ? outline : undefined}
        stroke={outline}
        strokeWidth={outlineWidth}
        lineJoin="miter"
      />
    </Group>
  );
}

function eventTriggerPoints(metersToPixels: number, paddingPx: number): number[] {
  const halfLength =
    metersToVisiblePixels(eventTriggerLengthMeters, metersToPixels, eventMarkerHalfHeightPx * 2) /
      2 +
    paddingPx;
  return [-halfLength, 0, halfLength, 0];
}

function metersToVisiblePixels(
  meters: number,
  metersToPixels: number,
  minimumPixels: number
): number {
  return Math.max(minimumPixels, meters * metersToPixels);
}

function toStageDegrees(radians: number | null): number {
  return radians === null ? 0 : -radians * (180 / Math.PI);
}

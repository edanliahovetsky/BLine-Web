import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Line, Rect } from "react-konva";
import {
  elementCircleRadiusMeters,
  elementOutlineMeters,
  eventTriggerLengthMeters,
  eventMarkerHalfHeightPx,
  robotLengthMeters,
  robotWidthMeters,
  triangleSizeRatio
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
  dimmed: boolean;
  selectedPulse: number;
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
  dimmed,
  selectedPulse,
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
  const selectionOpacity = 0.58 + selectedPulse * 0.34;
  const selectionWidth = 3 + selectedPulse * 2;
  const circleRadius = metersToVisiblePixels(elementCircleRadiusMeters, metersToPixels, 7);
  const rectWidth = robotLengthMeters * metersToPixels;
  const rectHeight = robotWidthMeters * metersToPixels;
  const outlineWidth = metersToVisiblePixels(elementOutlineMeters, metersToPixels, 2.25);
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
      opacity={dimmed ? 0.48 : 1}
    >
      {handoffRadius ? (
        <Circle
          radius={handoffRadius}
          stroke="#ff00ff"
          strokeWidth={2}
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
              strokeWidth={selectionWidth}
              opacity={selectionOpacity}
            />
          ) : null}
          <Circle
            radius={circleRadius}
            fill="#3aa3ff"
            stroke="#1d6c9d"
            strokeWidth={1.75}
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
              opacity={selectionOpacity}
              strokeWidth={selectionWidth}
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
              opacity={selectionOpacity}
              strokeWidth={selectionWidth}
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
              strokeWidth={selectionWidth + 4}
              opacity={selectionOpacity}
              lineCap="round"
            />
          ) : null}
          <Line
            points={eventTriggerPoints(metersToPixels, 0)}
            rotation={toStageDegrees(headingRadians)}
            stroke="#ffd54d"
            strokeWidth={5}
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
  stroke,
  opacity,
  strokeWidth
}: {
  width: number;
  height: number;
  headingRadians: number | null;
  stroke: string | undefined;
  opacity: number;
  strokeWidth: number;
}) {
  return (
    <Group rotation={toStageDegrees(headingRadians)}>
      <Rect
        x={-width / 2 - 7}
        y={-height / 2 - 7}
        width={width + 14}
        height={height + 14}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
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
  const dashLength = Math.max(3, outlineWidth * 1.2);
  const dashGap = Math.max(2, outlineWidth * 0.65);
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
        dash={dashed ? [dashLength, dashGap] : undefined}
        fill="rgba(0, 0, 0, 0.05)"
        lineJoin="miter"
        lineCap="butt"
      />
      {dashed ? (
        <CornerCaps
          width={width}
          height={height}
          color={outline}
          size={outlineWidth}
        />
      ) : null}
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

function CornerCaps({
  width,
  height,
  color,
  size
}: {
  width: number;
  height: number;
  color: string;
  size: number;
}) {
  const capSize = Math.max(2, size);
  const halfCap = capSize / 2;
  const points = [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [-width / 2, height / 2],
    [width / 2, height / 2]
  ];

  return (
    <>
      {points.map(([x, y]) => (
        <Rect
          key={`${x}-${y}`}
          x={x - halfCap}
          y={y - halfCap}
          width={capSize}
          height={capSize}
          fill={color}
          listening={false}
        />
      ))}
    </>
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

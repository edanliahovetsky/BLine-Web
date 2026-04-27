import { memo } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Line, Rect } from "react-konva";
import {
  elementCircleRadiusMeters,
  elementOutlineMeters,
  eventTriggerLengthMeters,
  eventMarkerHalfHeightPx,
  triangleSizeRatio
} from "../constants";
import type { StagePoint } from "../geometry";
import {
  centeredRobotBounds,
  strokedRectInsideBounds,
  type RobotSizeMeters
} from "../robotFootprint";
import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement
} from "../../core/model/path";
import { elementColors } from "../elementStyle";

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
  robotSizeMeters: RobotSizeMeters;
  metersToPixels: number;
  onPointerDown(index: number, event: CanvasPointerEvent): void;
  onDragStart(index: number, event: CanvasDragEvent): void;
  onDragMove(index: number, event: CanvasDragEvent): void;
  onDragEnd(index: number, event: CanvasDragEvent): void;
}

export const WaypointNode = memo(function WaypointNode({
  element,
  index,
  point,
  selected,
  dimmed,
  selectedPulse,
  draggable,
  headingRadians,
  handoffRadiusMeters,
  robotSizeMeters,
  metersToPixels,
  onPointerDown,
  onDragStart,
  onDragMove,
  onDragEnd
}: WaypointNodeProps) {
  const selectionStroke = selected ? elementColors.selected : undefined;
  const selectionOpacity = 0.46 + selectedPulse * 0.34;
  const selectionWidth = selectionStrokeWidthPx;
  const circleRadius = metersToVisiblePixels(elementCircleRadiusMeters, metersToPixels, 7);
  const rectWidth = robotSizeMeters.lengthMeters * metersToPixels;
  const rectHeight = robotSizeMeters.widthMeters * metersToPixels;
  const outlineWidth = metersToVisiblePixels(elementOutlineMeters, metersToPixels, 1.65);
  const selectionPadding = Math.max(6, outlineWidth / 2 + 5);
  const nodeHaloThickness = clampedElementHaloThickness(circleRadius);
  const handoffRadius = handoffRadiusMeters
    ? Math.max(8, handoffRadiusMeters * metersToPixels)
    : null;
  const elementOpacity = dimmed ? 0.58 : 1;

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
      opacity={elementOpacity}
    >
      <NodeHitTarget
        element={element}
        circleRadius={circleRadius}
        rectWidth={rectWidth}
        rectHeight={rectHeight}
        headingRadians={headingRadians}
        metersToPixels={metersToPixels}
      />

      {handoffRadius ? (
        <>
          <Circle
            radius={handoffRadius}
            stroke="rgba(5, 8, 11, 0.82)"
            strokeWidth={4}
            dash={[6, 6]}
            listening={false}
          />
          <Circle
            radius={handoffRadius}
            stroke={elementColors.handoff}
            strokeWidth={1.45}
            dash={[6, 6]}
            opacity={0.82}
            listening={false}
          />
        </>
      ) : null}

      {isTranslationTarget(element) ? (
        <>
          {selected ? (
            <Circle
              radius={circleRadius + 8}
              stroke={selectionStroke}
              strokeWidth={selectionWidth}
              opacity={selectionOpacity}
              listening={false}
            />
          ) : null}
          <Circle
            radius={circleRadius + nodeHaloThickness}
            fill="rgba(5, 8, 11, 0.72)"
            listening={false}
          />
          <Circle
            radius={circleRadius}
            fill={elementColors.translation}
            stroke="rgba(239, 248, 255, 0.9)"
            strokeWidth={1.35}
            shadowColor="rgba(45, 130, 255, 0.42)"
            shadowBlur={4}
            shadowOpacity={0.7}
            listening={false}
          />
          <Circle
            radius={Math.max(2, circleRadius * 0.24)}
            fill="#f7fbff"
            listening={false}
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
              padding={selectionPadding}
              outlineWidth={outlineWidth}
            />
          ) : null}
          <RobotFootprint
            width={rectWidth}
            height={rectHeight}
            accent={elementColors.waypoint}
            outlineWidth={outlineWidth}
            headingRadians={headingRadians}
            mode="waypoint"
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
              padding={selectionPadding}
              outlineWidth={outlineWidth}
            />
          ) : null}
          <RobotFootprint
            width={rectWidth}
            height={rectHeight}
            accent={elementColors.rotation}
            outlineWidth={outlineWidth}
            headingRadians={headingRadians}
            mode="rotation"
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
              listening={false}
            />
          ) : null}
          <Line
            points={eventTriggerPoints(metersToPixels, 2)}
            rotation={toStageDegrees(headingRadians)}
            stroke="rgba(5, 8, 11, 0.82)"
            strokeWidth={8}
            lineCap="round"
            listening={false}
          />
          <Line
            points={eventTriggerPoints(metersToPixels, 0)}
            rotation={toStageDegrees(headingRadians)}
            stroke={elementColors.event}
            strokeWidth={4}
            lineCap="round"
            listening={false}
          />
          <Circle
            radius={3.75}
            fill="#f8f4ff"
            stroke="rgba(5, 8, 11, 0.58)"
            strokeWidth={1}
            listening={false}
          />
        </>
      ) : null}
    </Group>
  );
}, areWaypointNodePropsEqual);

function NodeHitTarget({
  element,
  circleRadius,
  rectWidth,
  rectHeight,
  headingRadians,
  metersToPixels
}: {
  element: PathElement;
  circleRadius: number;
  rectWidth: number;
  rectHeight: number;
  headingRadians: number | null;
  metersToPixels: number;
}) {
  if (isTranslationTarget(element)) {
    return (
      <Circle
        radius={circleRadius + 12}
        fill="rgba(255, 255, 255, 0.001)"
      />
    );
  }

  if (isWaypoint(element) || isRotationTarget(element)) {
    const padding = Math.max(10, Math.min(rectWidth, rectHeight) * 0.18);

    return (
      <Group rotation={toStageDegrees(headingRadians)}>
        <Rect
          x={-rectWidth / 2 - padding}
          y={-rectHeight / 2 - padding}
          width={rectWidth + padding * 2}
          height={rectHeight + padding * 2}
          cornerRadius={robotCornerRadius(rectWidth, rectHeight) + padding}
          fill="rgba(255, 255, 255, 0.001)"
        />
      </Group>
    );
  }

  if (isEventTrigger(element)) {
    return (
      <Line
        points={eventTriggerPoints(metersToPixels, 10)}
        rotation={toStageDegrees(headingRadians)}
        stroke="rgba(255, 255, 255, 0.001)"
        strokeWidth={24}
        lineCap="round"
      />
    );
  }

  return null;
}

function SelectionFootprint({
  width,
  height,
  headingRadians,
  stroke,
  opacity,
  strokeWidth,
  padding,
  outlineWidth
}: {
  width: number;
  height: number;
  headingRadians: number | null;
  stroke: string | undefined;
  opacity: number;
  strokeWidth: number;
  padding: number;
  outlineWidth: number;
}) {
  const cornerRadius = robotCornerRadius(width, height) + padding + outlineWidth * 0.12;

  return (
    <Group rotation={toStageDegrees(headingRadians)} listening={false}>
      <Rect
        x={-width / 2 - padding}
        y={-height / 2 - padding}
        width={width + padding * 2}
        height={height + padding * 2}
        cornerRadius={cornerRadius}
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
        lineJoin="round"
        shadowColor={stroke}
        shadowBlur={8}
        shadowOpacity={0.28}
      />
    </Group>
  );
}

function RobotFootprint({
  width,
  height,
  accent,
  outlineWidth,
  headingRadians,
  mode
}: {
  width: number;
  height: number;
  accent: string;
  outlineWidth: number;
  headingRadians: number | null;
  mode: "waypoint" | "rotation";
}) {
  const triangleLength = Math.min(width, height) * triangleSizeRatio;
  const halfTriangleHeight = triangleLength / 2;
  const cornerRadius = robotCornerRadius(width, height);
  const halo = robotHaloMetrics(width, height);
  const footprintBounds = centeredRobotBounds(width, height);
  const haloOutline = strokedRectInsideBounds(footprintBounds, halo.strokeWidth);
  const robotOutline = strokedRectInsideBounds(footprintBounds, outlineWidth);
  const trianglePoints = [
    triangleLength / 2,
    0,
    -triangleLength / 2,
    halfTriangleHeight,
    -triangleLength / 2,
    -halfTriangleHeight
  ];

  return (
    <Group rotation={toStageDegrees(headingRadians)} listening={false}>
      <Rect
        x={haloOutline.rect.x}
        y={haloOutline.rect.y}
        width={haloOutline.rect.width}
        height={haloOutline.rect.height}
        cornerRadius={Math.max(0, cornerRadius - haloOutline.strokeWidth / 2)}
        stroke="rgba(5, 8, 11, 0.82)"
        strokeWidth={haloOutline.strokeWidth}
        fill="rgba(5, 8, 11, 0.28)"
        lineJoin="round"
      />
      <Rect
        x={robotOutline.rect.x}
        y={robotOutline.rect.y}
        width={robotOutline.rect.width}
        height={robotOutline.rect.height}
        cornerRadius={Math.max(0, cornerRadius - robotOutline.strokeWidth / 2)}
        stroke={accent}
        strokeWidth={robotOutline.strokeWidth}
        fill={mode === "waypoint" ? "rgba(255, 159, 67, 0.1)" : "rgba(107, 220, 139, 0.1)"}
        lineJoin="round"
      />
      {mode === "rotation" ? (
        <>
          <Circle
            radius={Math.max(4, Math.min(width, height) * 0.13)}
            stroke={accent}
            strokeWidth={Math.max(1.4, outlineWidth * 0.72)}
            fill="rgba(5, 8, 11, 0.26)"
          />
          <Line
            points={[0, 0, width * 0.28, 0]}
            stroke={accent}
            strokeWidth={Math.max(1.25, outlineWidth * 0.55)}
            lineCap="round"
          />
        </>
      ) : (
        <Line
          points={trianglePoints}
          closed={true}
          fill="rgba(5, 8, 11, 0.25)"
          stroke={accent}
          strokeWidth={Math.max(1.4, outlineWidth * 0.72)}
          lineJoin="round"
        />
      )}
      {mode === "rotation" ? (
        <Line
          points={trianglePoints}
          closed={true}
          fill={accent}
          opacity={0.52}
          lineJoin="round"
        />
      ) : null}
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

function robotCornerRadius(width: number, height: number): number {
  return Math.max(3, Math.min(width, height) * 0.08);
}

function robotHaloMetrics(width: number, height: number) {
  const footprintSize = Math.min(width, height);

  return {
    strokeWidth: clamp(footprintSize * 0.12, 2.2, 5)
  };
}

function clampedElementHaloThickness(radius: number): number {
  return clamp(radius * 0.35, 2.25, 4);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const selectionStrokeWidthPx = 2.6;

function areWaypointNodePropsEqual(
  previous: WaypointNodeProps,
  next: WaypointNodeProps
): boolean {
  return (
    previous.element === next.element &&
    previous.index === next.index &&
    previous.selected === next.selected &&
    previous.dimmed === next.dimmed &&
    previous.draggable === next.draggable &&
    previous.headingRadians === next.headingRadians &&
    previous.handoffRadiusMeters === next.handoffRadiusMeters &&
    previous.robotSizeMeters.lengthMeters === next.robotSizeMeters.lengthMeters &&
    previous.robotSizeMeters.widthMeters === next.robotSizeMeters.widthMeters &&
    previous.metersToPixels === next.metersToPixels &&
    previous.onPointerDown === next.onPointerDown &&
    previous.onDragStart === next.onDragStart &&
    previous.onDragMove === next.onDragMove &&
    previous.onDragEnd === next.onDragEnd &&
    pointsEqual(previous.point, next.point) &&
    (!next.selected || previous.selectedPulse === next.selectedPulse)
  );
}

function pointsEqual(
  previous: StagePoint,
  next: StagePoint
): boolean {
  return previous.x === next.x && previous.y === next.y;
}

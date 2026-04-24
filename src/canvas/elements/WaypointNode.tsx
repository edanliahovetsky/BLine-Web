import type { KonvaEventObject } from "konva/lib/Node";
import { Arrow, Circle, Group, Line, Rect, RegularPolygon } from "react-konva";
import {
  eventMarkerHalfHeightPx,
  nodeRadiusPx,
  rotationNodeRadiusPx,
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
  rotationRadians: number | null;
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
  rotationRadians,
  onPointerDown,
  onDragStart,
  onDragMove,
  onDragEnd
}: WaypointNodeProps) {
  const selectionStroke = selected ? "#fc6525" : undefined;

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
      {isTranslationTarget(element) ? (
        <>
          {selected ? (
            <Circle
              radius={nodeRadiusPx + 7}
              stroke={selectionStroke}
              strokeWidth={4}
              opacity={0.9}
            />
          ) : null}
          <Circle
            radius={nodeRadiusPx}
            fill="#f7fbff"
            stroke="#236f91"
            strokeWidth={4}
          />
        </>
      ) : null}

      {isWaypoint(element) ? (
        <>
          {selected ? (
            <Rect
              x={-waypointSizePx / 2 - 6}
              y={-waypointSizePx / 2 - 6}
              width={waypointSizePx + 12}
              height={waypointSizePx + 12}
              stroke={selectionStroke}
              strokeWidth={4}
              cornerRadius={4}
            />
          ) : null}
          <Rect
            x={-waypointSizePx / 2}
            y={-waypointSizePx / 2}
            width={waypointSizePx}
            height={waypointSizePx}
            fill="#fffaf7"
            stroke="#d9622b"
            strokeWidth={4}
            cornerRadius={3}
          />
          <RotationArrow rotationRadians={rotationRadians} stroke="#d9622b" />
        </>
      ) : null}

      {isRotationTarget(element) ? (
        <>
          {selected ? (
            <RegularPolygon
              sides={4}
              radius={rotationNodeRadiusPx + 8}
              stroke={selectionStroke}
              strokeWidth={4}
              rotation={45}
            />
          ) : null}
          <RegularPolygon
            sides={4}
            radius={rotationNodeRadiusPx}
            stroke="#2f8b57"
            strokeWidth={4}
            dash={[7, 4]}
            rotation={45}
          />
          <RotationArrow rotationRadians={rotationRadians} stroke="#2f8b57" />
        </>
      ) : null}

      {isEventTrigger(element) ? (
        <>
          {selected ? (
            <Line
              points={[0, -eventMarkerHalfHeightPx - 8, 0, eventMarkerHalfHeightPx + 8]}
              stroke={selectionStroke}
              strokeWidth={8}
              lineCap="round"
            />
          ) : null}
          <Line
            points={[0, -eventMarkerHalfHeightPx, 0, eventMarkerHalfHeightPx]}
            stroke="#c69d16"
            strokeWidth={7}
            lineCap="round"
          />
        </>
      ) : null}
    </Group>
  );
}

function RotationArrow({
  rotationRadians,
  stroke
}: {
  rotationRadians: number | null;
  stroke: string;
}) {
  if (rotationRadians === null) {
    return null;
  }

  return (
    <Arrow
      points={[0, 0, 28, 0]}
      rotation={-rotationRadians * (180 / Math.PI)}
      stroke={stroke}
      fill={stroke}
      strokeWidth={3}
      pointerLength={7}
      pointerWidth={7}
      lineCap="round"
    />
  );
}

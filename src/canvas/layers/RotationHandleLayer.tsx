import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Layer, Line } from "react-konva";
import type { ProjectDocument } from "../../core/io/projectSchema";
import { isRotationTarget, isWaypoint } from "../../core/model/path";
import { elementColors, rotatableElementAccent } from "../elementStyle";
import {
  getElementHeadingRadians,
  getElementPosition,
  modelToStagePoint,
  type FieldViewport,
  type PositionOverrides,
  type RotationOverrides
} from "../geometry";

type RotationDragEvent = KonvaEventObject<DragEvent>;

interface RotationHandleLayerProps {
  project: ProjectDocument | null;
  selectedElementIndex: number | null;
  viewport: FieldViewport;
  positionPreview: PositionOverrides;
  rotationPreview: RotationOverrides;
  onRotationDragStart(index: number, event: RotationDragEvent): void;
  onRotationDragMove(index: number, event: RotationDragEvent): void;
  onRotationDragEnd(index: number, event: RotationDragEvent): void;
}

export function RotationHandleLayer({
  project,
  selectedElementIndex,
  viewport,
  positionPreview,
  rotationPreview,
  onRotationDragStart,
  onRotationDragMove,
  onRotationDragEnd
}: RotationHandleLayerProps) {
  return (
    <Layer>
      <RotationHandleLayerContent
        project={project}
        selectedElementIndex={selectedElementIndex}
        viewport={viewport}
        positionPreview={positionPreview}
        rotationPreview={rotationPreview}
        onRotationDragStart={onRotationDragStart}
        onRotationDragMove={onRotationDragMove}
        onRotationDragEnd={onRotationDragEnd}
      />
    </Layer>
  );
}

export function RotationHandleLayerContent({
  project,
  selectedElementIndex,
  viewport,
  positionPreview,
  rotationPreview,
  onRotationDragStart,
  onRotationDragMove,
  onRotationDragEnd
}: RotationHandleLayerProps) {
  if (!project || selectedElementIndex === null) {
    return null;
  }

  const elements = project.path.path_elements;
  const element = elements[selectedElementIndex];
  if (!element || (!isWaypoint(element) && !isRotationTarget(element))) {
    return null;
  }

  const position = getElementPosition(elements, selectedElementIndex, positionPreview);
  const rotationRadians = getElementHeadingRadians(
    elements,
    selectedElementIndex,
    rotationPreview
  );
  if (!position || rotationRadians === null) {
    return null;
  }

  const accent = rotatableElementAccent(element);
  const center = modelToStagePoint(position, viewport);
  const radius = rotationHandleRadius(viewport);
  const handle = {
    x: center.x + Math.cos(rotationRadians) * radius,
    y: center.y - Math.sin(rotationRadians) * radius
  };

  return (
    <>
      <Group>
        <Line
          points={[center.x, center.y, handle.x, handle.y]}
          stroke={elementColors.shadow}
          strokeWidth={6}
          lineCap="round"
          opacity={0.78}
          listening={false}
        />
        <Line
          points={[center.x, center.y, handle.x, handle.y]}
          stroke={accent}
          strokeWidth={2.2}
          lineCap="round"
          opacity={0.86}
          listening={false}
        />
        <Circle
          x={handle.x}
          y={handle.y}
          radius={10}
          fill="rgba(15, 18, 21, 0.94)"
          stroke={accent}
          strokeWidth={2}
          hitStrokeWidth={24}
          shadowColor={accent}
          shadowBlur={7}
          shadowOpacity={0.54}
          draggable={true}
          data-testid="rotation-handle"
          onDragStart={(event) => onRotationDragStart(selectedElementIndex, event)}
          onDragMove={(event) => onRotationDragMove(selectedElementIndex, event)}
          onDragEnd={(event) => onRotationDragEnd(selectedElementIndex, event)}
        />
      </Group>
    </>
  );
}

function rotationHandleRadius(viewport: FieldViewport): number {
  return Math.max(42, Math.min(64, viewport.scale * 0.36));
}

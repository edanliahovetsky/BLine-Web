import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Layer, Line } from "react-konva";
import type { ProjectDocument } from "../../core/io/projectSchema";
import { isRotationTarget, isWaypoint } from "../../core/model/path";
import {
  getElementHeadingRadians,
  getElementPosition,
  modelToStagePoint,
  type FieldViewport,
  type RotationOverrides
} from "../geometry";

type RotationDragEvent = KonvaEventObject<DragEvent>;

interface RotationHandleLayerProps {
  project: ProjectDocument | null;
  selectedElementIndex: number | null;
  viewport: FieldViewport;
  rotationPreview: RotationOverrides;
  onRotationDragStart(index: number, event: RotationDragEvent): void;
  onRotationDragMove(index: number, event: RotationDragEvent): void;
  onRotationDragEnd(index: number, event: RotationDragEvent): void;
}

export function RotationHandleLayer({
  project,
  selectedElementIndex,
  viewport,
  rotationPreview,
  onRotationDragStart,
  onRotationDragMove,
  onRotationDragEnd
}: RotationHandleLayerProps) {
  if (!project || selectedElementIndex === null) {
    return <Layer />;
  }

  const elements = project.path.path_elements;
  const element = elements[selectedElementIndex];
  if (!element || (!isWaypoint(element) && !isRotationTarget(element))) {
    return <Layer />;
  }

  const position = getElementPosition(elements, selectedElementIndex);
  const rotationRadians = getElementHeadingRadians(
    elements,
    selectedElementIndex,
    rotationPreview
  );

  if (!position || rotationRadians === null) {
    return <Layer />;
  }

  const center = modelToStagePoint(position, viewport);
  const radius = Math.max(40, Math.min(78, viewport.scale * 0.72));
  const handle = {
    x: center.x + Math.cos(rotationRadians) * radius,
    y: center.y - Math.sin(rotationRadians) * radius
  };

  return (
    <Layer>
      <Group listening={false}>
        <Circle
          x={center.x}
          y={center.y}
          radius={radius}
          stroke="#2dd47a"
          strokeWidth={2}
          dash={[7, 7]}
          opacity={0.38}
        />
        <Line
          points={[center.x, center.y, handle.x, handle.y]}
          stroke="#2dd47a"
          strokeWidth={3}
          lineCap="round"
          opacity={0.76}
        />
      </Group>
      <Circle
        x={handle.x}
        y={handle.y}
        radius={10}
        fill="#2dd47a"
        stroke="#0c1813"
        strokeWidth={3}
        draggable={true}
        shadowColor="#2dd47a"
        shadowBlur={9}
        data-testid="rotation-handle"
        onDragStart={(event) => onRotationDragStart(selectedElementIndex, event)}
        onDragMove={(event) => onRotationDragMove(selectedElementIndex, event)}
        onDragEnd={(event) => onRotationDragEnd(selectedElementIndex, event)}
      />
    </Layer>
  );
}

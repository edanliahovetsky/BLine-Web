import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Layer } from "react-konva";
import type { ProjectDocument } from "../../core/io/projectSchema";
import { isRotationTarget, isWaypoint } from "../../core/model/path";
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
  if (!project || selectedElementIndex === null) {
    return <Layer />;
  }

  const elements = project.path.path_elements;
  const element = elements[selectedElementIndex];
  if (!element || (!isWaypoint(element) && !isRotationTarget(element))) {
    return <Layer />;
  }

  const position = getElementPosition(elements, selectedElementIndex, positionPreview);
  const rotationRadians = getElementHeadingRadians(
    elements,
    selectedElementIndex,
    rotationPreview
  );

  if (!position || rotationRadians === null) {
    return <Layer />;
  }

  const center = modelToStagePoint(position, viewport);
  const radius = Math.max(42, Math.min(64, viewport.scale * 0.36));
  const handle = {
    x: center.x + Math.cos(rotationRadians) * radius,
    y: center.y - Math.sin(rotationRadians) * radius
  };

  return (
    <Layer>
      <Circle
        x={handle.x}
        y={handle.y}
        radius={12}
        fill="rgba(45, 212, 122, 0.14)"
        stroke="rgba(45, 212, 122, 0.62)"
        strokeWidth={2}
        draggable={true}
        data-testid="rotation-handle"
        onDragStart={(event) => onRotationDragStart(selectedElementIndex, event)}
        onDragMove={(event) => onRotationDragMove(selectedElementIndex, event)}
        onDragEnd={(event) => onRotationDragEnd(selectedElementIndex, event)}
      />
    </Layer>
  );
}

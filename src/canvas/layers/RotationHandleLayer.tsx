import { forwardRef, useImperativeHandle, useRef } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Group as KonvaGroup } from "konva/lib/Group";
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
import type { LiveDragPreview } from "../hooks/useCanvasDrag";

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

export interface RotationHandleLayerHandle {
  syncElementPosition(preview: LiveDragPreview | null): void;
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

export const RotationHandleLayerContent = forwardRef<
  RotationHandleLayerHandle,
  RotationHandleLayerProps
>(function RotationHandleLayerContent({
  project,
  selectedElementIndex,
  viewport,
  positionPreview,
  rotationPreview,
  onRotationDragStart,
  onRotationDragMove,
  onRotationDragEnd
}: RotationHandleLayerProps, ref) {
  const rootRef = useRef<KonvaGroup | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      syncElementPosition(preview) {
        if (!preview || preview.index !== selectedElementIndex) {
          return;
        }

        const root = rootRef.current;
        if (!root) {
          return;
        }

        root.position(preview.stagePoint);
        root.getLayer()?.batchDraw();
      }
    }),
    [selectedElementIndex]
  );

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
  const handleOffset = {
    x: Math.cos(rotationRadians) * radius,
    y: -Math.sin(rotationRadians) * radius
  };

  return (
    <Group
      ref={rootRef}
      x={center.x}
      y={center.y}
      data-testid="rotation-handle-root"
    >
      <Line
        points={[0, 0, handleOffset.x, handleOffset.y]}
        stroke={elementColors.shadow}
        strokeWidth={6}
        lineCap="round"
        opacity={0.78}
        listening={false}
      />
      <Line
        points={[0, 0, handleOffset.x, handleOffset.y]}
        stroke={accent}
        strokeWidth={2.2}
        lineCap="round"
        opacity={0.86}
        listening={false}
      />
      <Circle
        x={handleOffset.x}
        y={handleOffset.y}
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
  );
});

function rotationHandleRadius(viewport: FieldViewport): number {
  return Math.max(42, Math.min(64, viewport.scale * 0.36));
}

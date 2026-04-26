import type { KonvaEventObject } from "konva/lib/Node";
import { useState } from "react";
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
  activeRotationElementIndex: number | null;
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
  activeRotationElementIndex,
  viewport,
  positionPreview,
  rotationPreview,
  onRotationDragStart,
  onRotationDragMove,
  onRotationDragEnd
}: RotationHandleLayerProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!project) {
    return <Layer />;
  }

  const elements = project.path.path_elements;
  const handles = elements.flatMap((element, index) => {
    if (!isWaypoint(element) && !isRotationTarget(element)) {
      return [];
    }

    const position = getElementPosition(elements, index, positionPreview);
    const rotationRadians = getElementHeadingRadians(elements, index, rotationPreview);
    if (!position || rotationRadians === null) {
      return [];
    }

    const center = modelToStagePoint(position, viewport);
    const radius = rotationHandleRadius(viewport);
    const handle = {
      x: center.x + Math.cos(rotationRadians) * radius,
      y: center.y - Math.sin(rotationRadians) * radius
    };

    return [
      {
        accent: rotatableElementAccent(element),
        center,
        handle,
        index,
        isPrimary:
          index === selectedElementIndex ||
          index === activeRotationElementIndex ||
          index === hoveredIndex
      }
    ];
  });

  return (
    <Layer>
      {handles.map(({ accent, center, handle, index, isPrimary }) => {
        const passiveOpacity = selectedElementIndex === null ? 0.66 : 0.48;
        const opacity = isPrimary ? 1 : passiveOpacity;
        const connectorWidth = isPrimary ? 2.2 : 1.35;
        const handleRadius = isPrimary ? 10 : 8.5;

        return (
          <Group key={index}>
            <Line
              points={[center.x, center.y, handle.x, handle.y]}
              stroke={elementColors.shadow}
              strokeWidth={isPrimary ? 6 : 4}
              lineCap="round"
              opacity={isPrimary ? 0.78 : 0.38}
              listening={false}
            />
            <Line
              points={[center.x, center.y, handle.x, handle.y]}
              stroke={accent}
              strokeWidth={connectorWidth}
              lineCap="round"
              opacity={isPrimary ? 0.86 : 0.42}
              listening={false}
            />
            <Circle
              x={handle.x}
              y={handle.y}
              radius={handleRadius}
              fill="rgba(15, 18, 21, 0.94)"
              stroke={accent}
              strokeWidth={2}
              hitStrokeWidth={24}
              shadowColor={accent}
              shadowBlur={isPrimary ? 7 : 4}
              shadowOpacity={isPrimary ? 0.54 : 0.28}
              draggable={true}
              opacity={opacity}
              data-testid={
                index === selectedElementIndex
                  ? "rotation-handle"
                  : `rotation-handle-${index}`
              }
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex((current) => (current === index ? null : current))}
              onDragStart={(event) => onRotationDragStart(index, event)}
              onDragMove={(event) => onRotationDragMove(index, event)}
              onDragEnd={(event) => onRotationDragEnd(index, event)}
            />
          </Group>
        );
      })}
    </Layer>
  );
}

function rotationHandleRadius(viewport: FieldViewport): number {
  return Math.max(42, Math.min(64, viewport.scale * 0.36));
}

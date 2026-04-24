import { Layer, Line } from "react-konva";
import type { ProjectDocument } from "../../core/io/projectSchema";
import {
  getAnchorPositions,
  getElementPosition,
  getRotationRadians,
  modelToStagePoint,
  type FieldViewport,
  type PositionOverrides
} from "../geometry";
import { WaypointNode } from "../elements/WaypointNode";
import type { useCanvasDrag } from "../hooks/useCanvasDrag";
import type { useCanvasSelection } from "../hooks/useCanvasSelection";

interface PathLayerProps {
  project: ProjectDocument | null;
  selectedElementIndex: number | null;
  viewport: FieldViewport;
  dragPreview: PositionOverrides;
  drag: ReturnType<typeof useCanvasDrag>;
  selection: ReturnType<typeof useCanvasSelection>;
}

export function PathLayer({
  project,
  selectedElementIndex,
  viewport,
  dragPreview,
  drag,
  selection
}: PathLayerProps) {
  if (!project) {
    return <Layer />;
  }

  const elements = project.path.path_elements;
  const anchorPoints = getAnchorPositions(elements, dragPreview).flatMap(({ position }) => {
    const point = modelToStagePoint(position, viewport);
    return [point.x, point.y];
  });

  return (
    <Layer>
      {anchorPoints.length >= 4 ? (
        <Line
          points={anchorPoints}
          stroke="#315f7b"
          strokeWidth={5}
          lineCap="round"
          lineJoin="round"
          opacity={0.95}
        />
      ) : null}

      {elements.map((element, index) => {
        const position = getElementPosition(elements, index, dragPreview);
        if (!position) {
          return null;
        }

        return (
          <WaypointNode
            key={`${element.type}-${index}`}
            element={element}
            index={index}
            point={modelToStagePoint(position, viewport)}
            selected={selectedElementIndex === index}
            draggable={drag.isDragEnabled(element)}
            rotationRadians={getRotationRadians(element)}
            onPointerDown={selection.handleElementPointerDown}
            onDragStart={drag.handleDragStart}
            onDragMove={drag.handleDragMove}
            onDragEnd={drag.handleDragEnd}
          />
        );
      })}
    </Layer>
  );
}

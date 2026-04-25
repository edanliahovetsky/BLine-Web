import { Layer, Line } from "react-konva";
import type { ProjectDocument } from "../../core/io/projectSchema";
import {
  getElementHeadingRadians,
  getHandoffRadiusMeters,
  getElementPosition,
  getRenderableElementPositions,
  modelToStagePoint,
  type FieldViewport,
  type PositionOverrides,
  type RotationOverrides
} from "../geometry";
import { WaypointNode } from "../elements/WaypointNode";
import type { useCanvasDrag } from "../hooks/useCanvasDrag";
import type { useCanvasSelection } from "../hooks/useCanvasSelection";

interface PathLayerProps {
  project: ProjectDocument | null;
  selectedElementIndex: number | null;
  viewport: FieldViewport;
  dragPreview: PositionOverrides;
  rotationPreview: RotationOverrides;
  selectedPulse: number;
  drag: ReturnType<typeof useCanvasDrag>;
  selection: ReturnType<typeof useCanvasSelection>;
}

export function PathLayer({
  project,
  selectedElementIndex,
  viewport,
  dragPreview,
  rotationPreview,
  selectedPulse,
  drag,
  selection
}: PathLayerProps) {
  if (!project) {
    return <Layer />;
  }

  const elements = project.path.path_elements;
  const elementPoints = getRenderableElementPositions(elements, dragPreview).flatMap(
    ({ position }) => {
      const point = modelToStagePoint(position, viewport);
      return [point.x, point.y];
    }
  );

  const hasSelection = selectedElementIndex !== null;

  return (
    <Layer>
      {elementPoints.length >= 4 ? (
        <Line
          points={elementPoints}
          stroke="#cfd6dc"
          strokeWidth={4}
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
            dimmed={hasSelection && selectedElementIndex !== index}
            selectedPulse={selectedPulse}
            draggable={drag.isDragEnabled(element)}
            headingRadians={getElementHeadingRadians(elements, index, rotationPreview)}
            handoffRadiusMeters={
              index === elements.length - 1 ? null : getHandoffRadiusMeters(element)
            }
            metersToPixels={viewport.scale}
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

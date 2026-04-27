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
import { robotSizeFromConfig } from "../robotFootprint";
import { WaypointNode } from "../elements/WaypointNode";
import { buildElementProtrusionVisibilityByIndex } from "../protrusionVisibility";
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
  return (
    <Layer>
      <PathLayerContent
        project={project}
        selectedElementIndex={selectedElementIndex}
        viewport={viewport}
        dragPreview={dragPreview}
        rotationPreview={rotationPreview}
        selectedPulse={selectedPulse}
        drag={drag}
        selection={selection}
      />
    </Layer>
  );
}

export function PathLayerContent({
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
    return null;
  }

  const elements = project.path.path_elements;
  const robotSizeMeters = robotSizeFromConfig(project.config);
  const protrusions = project.config.gui.protrusions;
  const protrusionVisibilityByIndex = buildElementProtrusionVisibilityByIndex(
    elements,
    project.config,
    dragPreview
  );
  const elementPoints = getRenderableElementPositions(elements, dragPreview).flatMap(
    ({ position }) => {
      const point = modelToStagePoint(position, viewport);
      return [point.x, point.y];
    }
  );

  const hasSelection = selectedElementIndex !== null;
  const renderedNodes = elements.flatMap((element, index) => {
    const position = getElementPosition(elements, index, dragPreview);
    if (!position) {
      return [];
    }

    return [
      {
        element,
        index,
        position
      }
    ];
  });
  const orderedNodes =
    selectedElementIndex === null
      ? renderedNodes
      : [
          ...renderedNodes.filter(({ index }) => index !== selectedElementIndex),
          ...renderedNodes.filter(({ index }) => index === selectedElementIndex)
        ];

  return (
    <>
      {elementPoints.length >= 4 ? (
        <>
          <Line
            points={elementPoints}
            stroke="rgba(5, 9, 12, 0.82)"
            strokeWidth={8}
            lineCap="round"
            lineJoin="round"
            opacity={0.92}
            listening={false}
          />
          <Line
            points={elementPoints}
            stroke="#d7dde3"
            strokeWidth={2.75}
            lineCap="round"
            lineJoin="round"
            opacity={0.94}
            listening={false}
          />
        </>
      ) : null}

      {orderedNodes.map(({ element, index, position }) => {
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
            dragBoundFunc={drag.getDragBoundFunc(index)}
            headingRadians={getElementHeadingRadians(elements, index, rotationPreview)}
            handoffRadiusMeters={
              index === elements.length - 1 ? null : getHandoffRadiusMeters(element)
            }
            robotSizeMeters={robotSizeMeters}
            metersToPixels={viewport.scale}
            protrusionVisible={
              Boolean(protrusions.enabled) &&
              Boolean(protrusionVisibilityByIndex.get(index)) &&
              protrusions.distance_meters > 0 &&
              protrusions.side !== "none"
            }
            protrusionDistanceMeters={protrusions.distance_meters}
            protrusionSide={protrusions.side}
            onPointerDown={selection.handleElementPointerDown}
            onDragStart={drag.handleDragStart}
            onDragMove={drag.handleDragMove}
            onDragEnd={drag.handleDragEnd}
          />
        );
      })}
    </>
  );
}

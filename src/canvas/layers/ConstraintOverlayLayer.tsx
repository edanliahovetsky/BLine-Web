import { Circle, Group, Layer, Line } from "react-konva";
import type { ProjectDocument } from "../../core/io/projectSchema";
import {
  isRotationConstraintKey,
  isTranslationConstraintKey,
  type PathElement,
  type RangedConstraint
} from "../../core/model/path";
import {
  getElementPosition,
  modelToStagePoint,
  type FieldViewport,
  type PositionOverrides
} from "../geometry";

interface ConstraintOverlayLayerProps {
  project: ProjectDocument | null;
  viewport: FieldViewport;
  dragPreview: PositionOverrides;
}

export function ConstraintOverlayLayer({
  project,
  viewport,
  dragPreview
}: ConstraintOverlayLayerProps) {
  return (
    <Layer listening={false}>
      <ConstraintOverlayLayerContent
        project={project}
        viewport={viewport}
        dragPreview={dragPreview}
      />
    </Layer>
  );
}

export function ConstraintOverlayLayerContent({
  project,
  viewport,
  dragPreview
}: ConstraintOverlayLayerProps) {
  if (!project || project.path.ranged_constraints.length === 0) {
    return null;
  }

  const elements = project.path.path_elements;

  return (
    <Group listening={false}>
      {project.path.ranged_constraints.map((constraint, index) => (
        <ConstraintOverlay
          key={`${constraint.key}-${index}`}
          constraint={constraint}
          elements={elements}
          viewport={viewport}
          dragPreview={dragPreview}
        />
      ))}
    </Group>
  );
}

function ConstraintOverlay({
  constraint,
  elements,
  viewport,
  dragPreview
}: {
  constraint: RangedConstraint;
  elements: readonly PathElement[];
  viewport: FieldViewport;
  dragPreview: PositionOverrides;
}) {
  const domain = domainIndexesForConstraint(elements, constraint);
  const start = Math.min(constraint.start_ordinal, constraint.end_ordinal);
  const end = Math.max(constraint.start_ordinal, constraint.end_ordinal);
  const covered = domain
    .slice(Math.max(0, start - 1), Math.min(domain.length, end))
    .flatMap((index) => {
      const position = getElementPosition(elements, index, dragPreview);
      return position ? [{ index, point: modelToStagePoint(position, viewport) }] : [];
    });

  if (covered.length === 0) {
    return null;
  }

  const points = covered.flatMap(({ point }) => [point.x, point.y]);
  const isRotation = isRotationConstraintKey(constraint.key);

  return (
    <>
      {points.length >= 4 ? (
        <Line
          points={points}
          stroke={isRotation ? "#22d47a" : "#2f81f7"}
          strokeWidth={isRotation ? 3 : 5}
          dash={isRotation ? [8, 6] : undefined}
          lineCap="round"
          lineJoin="round"
          opacity={0.62}
        />
      ) : null}
      {covered.map(({ index, point }) => (
        <Circle
          key={index}
          x={point.x}
          y={point.y}
          radius={isRotation ? 17 : 13}
          stroke={isRotation ? "#22d47a" : "#2f81f7"}
          strokeWidth={3}
          dash={isRotation ? [5, 5] : undefined}
          opacity={0.82}
        />
      ))}
    </>
  );
}

function domainIndexesForConstraint(
  elements: readonly PathElement[],
  constraint: RangedConstraint
): number[] {
  return elements.flatMap((element, index) => {
    if (
      isTranslationConstraintKey(constraint.key) &&
      (element.type === "translation" || element.type === "waypoint")
    ) {
      return [index];
    }

    if (
      isRotationConstraintKey(constraint.key) &&
      (element.type === "rotation" ||
        element.type === "waypoint" ||
        element.type === "event_trigger")
    ) {
      return [index];
    }

    return [];
  });
}

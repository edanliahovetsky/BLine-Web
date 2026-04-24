import { useCallback, useRef, useState } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import type { ProjectDocument } from "../../core/io/projectSchema";
import type { PathElement } from "../../core/model/path";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import {
  getElementPosition,
  modelToStagePoint,
  stageToModelPoint,
  type FieldViewport,
  type PointMeters,
  type PositionOverrides
} from "../geometry";
import { createMoveElementCommand, isTranslationBearingElement } from "../modelSync";

type CanvasDragEvent = KonvaEventObject<DragEvent>;

interface ActiveDrag {
  index: number;
  start: PointMeters;
  current: PointMeters;
}

interface UseCanvasDragInput {
  project: ProjectDocument | null;
  viewport: FieldViewport;
}

export function useCanvasDrag({ project, viewport }: UseCanvasDragInput) {
  const [activeDrag, setActiveDragState] = useState<ActiveDrag | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);

  const setActiveDrag = useCallback((nextDrag: ActiveDrag | null) => {
    activeDragRef.current = nextDrag;
    setActiveDragState(nextDrag);
  }, []);

  const dragPreview: PositionOverrides = activeDrag
    ? new Map([[activeDrag.index, activeDrag.current]])
    : emptyPreview;

  const isDragEnabled = useCallback(
    (element: PathElement) => isTranslationBearingElement(element),
    []
  );

  const handleDragStart = useCallback(
    (index: number, event: CanvasDragEvent) => {
      if (!project) {
        return;
      }

      const element = project.path.path_elements[index];
      if (!element || !isTranslationBearingElement(element)) {
        return;
      }

      event.cancelBubble = true;
      selectionStore.getState().selectElement(index, project);

      const start = getElementPosition(project.path.path_elements, index);
      if (!start) {
        return;
      }

      setActiveDrag({
        index,
        start,
        current: start
      });
    },
    [project, setActiveDrag]
  );

  const handleDragMove = useCallback(
    (index: number, event: CanvasDragEvent) => {
      const drag = activeDragRef.current;
      if (!drag || drag.index !== index) {
        return;
      }

      event.cancelBubble = true;
      const nextPosition = stageToModelPoint(
        {
          x: event.target.x(),
          y: event.target.y()
        },
        viewport
      );
      const nextStagePoint = modelToStagePoint(nextPosition, viewport);
      event.target.position(nextStagePoint);

      setActiveDrag({
        ...drag,
        current: nextPosition
      });
    },
    [setActiveDrag, viewport]
  );

  const handleDragEnd = useCallback(
    (index: number, event: CanvasDragEvent) => {
      const drag = activeDragRef.current;
      if (!drag || drag.index !== index || !project) {
        setActiveDrag(null);
        return;
      }

      event.cancelBubble = true;
      const nextPosition = stageToModelPoint(
        {
          x: event.target.x(),
          y: event.target.y()
        },
        viewport
      );
      const nextStagePoint = modelToStagePoint(nextPosition, viewport);
      event.target.position(nextStagePoint);
      setActiveDrag(null);

      if (!pointsAlmostEqual(drag.start, nextPosition)) {
        projectStore
          .getState()
          .applyCommand(createMoveElementCommand(index, drag.start, nextPosition));
        selectionStore.getState().selectElement(index, projectStore.getState().project);
      }
    },
    [project, setActiveDrag, viewport]
  );

  return {
    dragPreview,
    isDragEnabled,
    handleDragStart,
    handleDragMove,
    handleDragEnd
  };
}

function pointsAlmostEqual(a: PointMeters, b: PointMeters): boolean {
  return (
    Math.abs(a.x_meters - b.x_meters) < 0.001 &&
    Math.abs(a.y_meters - b.y_meters) < 0.001
  );
}

const emptyPreview = new Map<number, PointMeters>();

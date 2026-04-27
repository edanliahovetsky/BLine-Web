import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import type { ProjectDocument } from "../../core/io/projectSchema";
import type { PathElement } from "../../core/model/path";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import {
  getElementPosition,
  getNeighborAnchorPositions,
  interpolateSegmentPosition,
  modelToStagePoint,
  projectPointToSegmentRatio,
  stageToModelPoint,
  type FieldViewport,
  type PointMeters,
  type PositionOverrides,
  type StagePoint
} from "../geometry";
import { robotSizeFromConfig } from "../robotFootprint";
import {
  createMoveElementCommand,
  createSetElementRatioCommand,
  isTranslationBearingElement
} from "../modelSync";
import { isEventTrigger, isRotationTarget } from "../../core/model/path";

type CanvasDragEvent = KonvaEventObject<DragEvent>;
type DragBoundFunc = (position: StagePoint) => StagePoint;

interface ActiveDrag {
  index: number;
  start: PointMeters;
  current: PointMeters;
  startRatio: number | null;
  currentRatio: number | null;
}

export interface LiveDragPreview {
  index: number;
  position: PointMeters;
  stagePoint: StagePoint;
  ratio: number | null;
}

interface UseCanvasDragInput {
  project: ProjectDocument | null;
  viewport: FieldViewport;
  onLiveDragPreviewChange?: (preview: LiveDragPreview | null) => void;
}

export function useCanvasDrag({
  project,
  viewport,
  onLiveDragPreviewChange
}: UseCanvasDragInput) {
  const [activeDrag, setActiveDragState] = useState<ActiveDrag | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const previewFrameRef = useRef<number | null>(null);

  const flushDragPreview = useCallback(() => {
    previewFrameRef.current = null;
    setActiveDragState(activeDragRef.current);
  }, []);

  const setActiveDrag = useCallback(
    (
      nextDrag: ActiveDrag | null,
      sync: "immediate" | "frame" = "immediate"
    ) => {
      activeDragRef.current = nextDrag;

      if (sync === "frame") {
        if (previewFrameRef.current === null) {
          previewFrameRef.current = window.requestAnimationFrame(flushDragPreview);
        }
        return;
      }

      if (previewFrameRef.current !== null) {
        window.cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = null;
      }

      setActiveDragState(nextDrag);
    },
    [flushDragPreview]
  );

  useEffect(
    () => () => {
      if (previewFrameRef.current !== null) {
        window.cancelAnimationFrame(previewFrameRef.current);
      }
    },
    []
  );

  const dragPreview: PositionOverrides = useMemo(
    () => (activeDrag ? new Map([[activeDrag.index, activeDrag.current]]) : emptyPreview),
    [activeDrag]
  );

  const isDragEnabled = useCallback(
    (element: PathElement) =>
      isTranslationBearingElement(element) ||
      isRotationTarget(element) ||
      isEventTrigger(element),
    []
  );

  const dragBoundFuncs = useMemo(() => {
    if (!project) {
      return emptyDragBoundFuncs;
    }

    const funcs = new Map<number, DragBoundFunc>();
    const robotSizeMeters = robotSizeFromConfig(project.config);
    for (const [index, element] of project.path.path_elements.entries()) {
      if (!isDragEnabled(element)) {
        continue;
      }

      funcs.set(index, (stagePoint) =>
        projectDragStagePoint(project, viewport, robotSizeMeters, index, stagePoint)
          .stagePoint
      );
    }

    return funcs;
  }, [isDragEnabled, project, viewport]);

  const getDragBoundFunc = useCallback(
    (index: number) => dragBoundFuncs.get(index),
    [dragBoundFuncs]
  );

  const handleDragStart = useCallback(
    (index: number, event: CanvasDragEvent) => {
      if (!project) {
        return;
      }

      const element = project.path.path_elements[index];
      if (!element || !isDragEnabled(element)) {
        return;
      }

      event.cancelBubble = true;
      selectionStore.getState().selectElement(index, project);

      const start = getElementPosition(project.path.path_elements, index);
      if (!start) {
        return;
      }

      const startRatio =
        isRotationTarget(element) || isEventTrigger(element)
          ? element.t_ratio
          : null;

      setActiveDrag({
        index,
        start,
        current: start,
        startRatio,
        currentRatio: startRatio
      });
      onLiveDragPreviewChange?.({
        index,
        position: start,
        stagePoint: modelToStagePoint(start, viewport),
        ratio: startRatio
      });
    },
    [isDragEnabled, onLiveDragPreviewChange, project, setActiveDrag, viewport]
  );

  const handleDragMove = useCallback(
    (index: number, event: CanvasDragEvent) => {
      const drag = activeDragRef.current;
      if (!drag || drag.index !== index) {
        return;
      }

      event.cancelBubble = true;
      const dragTarget = event.currentTarget;
      const projected = project
        ? projectDragStagePoint(
            project,
            viewport,
            robotSizeFromConfig(project.config),
            index,
            {
              x: dragTarget.x(),
              y: dragTarget.y()
            }
          )
        : {
            position: stageToModelPoint(
              {
                x: dragTarget.x(),
                y: dragTarget.y()
              },
              viewport
            ),
            ratio: drag.currentRatio
          };
      const nextPosition = projected.position;
      const nextRatio = projected.ratio;

      onLiveDragPreviewChange?.({
        index,
        position: nextPosition,
        stagePoint: projected.stagePoint,
        ratio: nextRatio
      });
      setActiveDrag(
        {
          ...drag,
          current: nextPosition,
          currentRatio: nextRatio
        },
        "frame"
      );
    },
    [onLiveDragPreviewChange, project, setActiveDrag, viewport]
  );

  const handleDragEnd = useCallback(
    (index: number, event: CanvasDragEvent) => {
      const drag = activeDragRef.current;
      if (!drag || drag.index !== index || !project) {
        setActiveDrag(null);
        return;
      }

      event.cancelBubble = true;
      const dragTarget = event.currentTarget;
      let nextPosition = drag.current;
      let nextRatio = drag.currentRatio;
      const element = project.path.path_elements[index];

      if (element && (isRotationTarget(element) || isEventTrigger(element))) {
        const segment = getNeighborAnchorPositions(project.path.path_elements, index);
        if (segment) {
          nextRatio = projectPointToSegmentRatio(
            nextPosition,
            segment.previous,
            segment.next
          );
          nextPosition = interpolateSegmentPosition(
            segment.previous,
            segment.next,
            nextRatio
          );
        }
      }

      const nextStagePoint = modelToStagePoint(nextPosition, viewport);
      dragTarget.position(nextStagePoint);
      onLiveDragPreviewChange?.({
        index,
        position: nextPosition,
        stagePoint: nextStagePoint,
        ratio: nextRatio
      });
      setActiveDrag(null);

      if (drag.startRatio !== null && nextRatio !== null) {
        if (Math.abs(drag.startRatio - nextRatio) >= 0.001) {
          projectStore
            .getState()
            .applyCommand(
              createSetElementRatioCommand(index, drag.startRatio, nextRatio)
            );
          selectionStore.getState().selectElement(index, projectStore.getState().project);
        }
        return;
      }

      if (!pointsAlmostEqual(drag.start, nextPosition)) {
        projectStore
          .getState()
          .applyCommand(createMoveElementCommand(index, drag.start, nextPosition));
        selectionStore.getState().selectElement(index, projectStore.getState().project);
      }
    },
    [onLiveDragPreviewChange, project, setActiveDrag, viewport]
  );

  return {
    dragPreview,
    isDragging: activeDrag !== null,
    getDragBoundFunc,
    isDragEnabled,
    handleDragStart,
    handleDragMove,
    handleDragEnd
  };
}

function projectDragStagePoint(
  project: ProjectDocument,
  viewport: FieldViewport,
  robotSizeMeters: ReturnType<typeof robotSizeFromConfig>,
  index: number,
  stagePoint: StagePoint
): { position: PointMeters; ratio: number | null; stagePoint: StagePoint } {
  let position = stageToModelPoint(stagePoint, viewport, robotSizeMeters);
  let ratio: number | null = null;
  const element = project.path.path_elements[index];

  if (element && (isRotationTarget(element) || isEventTrigger(element))) {
    ratio = element.t_ratio;
    const segment = getNeighborAnchorPositions(project.path.path_elements, index);
    if (segment) {
      ratio = projectPointToSegmentRatio(position, segment.previous, segment.next);
      position = interpolateSegmentPosition(segment.previous, segment.next, ratio);
    }
  }

  return {
    position,
    ratio,
    stagePoint: modelToStagePoint(position, viewport)
  };
}

function pointsAlmostEqual(a: PointMeters, b: PointMeters): boolean {
  return (
    Math.abs(a.x_meters - b.x_meters) < 0.001 &&
    Math.abs(a.y_meters - b.y_meters) < 0.001
  );
}

const emptyPreview = new Map<number, PointMeters>();
const emptyDragBoundFuncs = new Map<number, DragBoundFunc>();

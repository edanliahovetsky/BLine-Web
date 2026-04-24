import { useCallback } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import type { ProjectDocument } from "../../core/io/projectSchema";
import { selectionStore } from "../../state/selectionStore";

type CanvasPointerEvent = KonvaEventObject<MouseEvent | TouchEvent | PointerEvent>;

export function useCanvasSelection(project: ProjectDocument | null) {
  const clearSelection = useCallback(() => {
    selectionStore.getState().clearSelection();
  }, []);

  const selectElement = useCallback(
    (index: number) => {
      selectionStore.getState().selectElement(index, project);
    },
    [project]
  );

  const handleStagePointerDown = useCallback(
    (event: CanvasPointerEvent) => {
      if (event.target === event.target.getStage()) {
        clearSelection();
      }
    },
    [clearSelection]
  );

  const handleElementPointerDown = useCallback(
    (index: number, event: CanvasPointerEvent) => {
      event.cancelBubble = true;
      selectElement(index);
    },
    [selectElement]
  );

  return {
    clearSelection,
    selectElement,
    handleStagePointerDown,
    handleElementPointerDown
  };
}

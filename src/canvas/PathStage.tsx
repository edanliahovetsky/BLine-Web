import { useEffect, useMemo, useRef, useState } from "react";
import { Stage } from "react-konva";
import { projectStore } from "../state/projectStore";
import { useStoreSelector } from "../state/react";
import { selectionStore } from "../state/selectionStore";
import { fieldAspectRatio } from "./constants";
import { createFieldViewport, type CanvasSize } from "./geometry";
import { useCanvasDrag } from "./hooks/useCanvasDrag";
import { useCanvasSelection } from "./hooks/useCanvasSelection";
import { FieldLayer } from "./layers/FieldLayer";
import { PathLayer } from "./layers/PathLayer";

const fallbackStageSize: CanvasSize = {
  width: 960,
  height: Math.round(960 / fieldAspectRatio)
};

export function PathStage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState<CanvasSize>(fallbackStageSize);
  const project = useStoreSelector(projectStore, (state) => state.project);
  const selectedElementIndex = useStoreSelector(
    selectionStore,
    (state) => state.selectedElementIndex
  );

  useEffect(() => {
    selectionStore.getState().reconcileProject(project);
  }, [project]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width));
      const height = Math.max(260, Math.round(width / fieldAspectRatio));
      setStageSize({ width, height });
    };

    updateSize();

    if (!("ResizeObserver" in window)) {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  const viewport = useMemo(() => createFieldViewport(stageSize), [stageSize]);
  const selection = useCanvasSelection(project);
  const drag = useCanvasDrag({ project, viewport });

  return (
    <div
      ref={containerRef}
      className="path-stage"
      data-testid="path-stage"
      aria-label="Path canvas"
    >
      <Stage
        width={stageSize.width}
        height={stageSize.height}
        onMouseDown={selection.handleStagePointerDown}
        onTouchStart={selection.handleStagePointerDown}
      >
        <FieldLayer viewport={viewport} />
        <PathLayer
          project={project}
          selectedElementIndex={selectedElementIndex}
          viewport={viewport}
          dragPreview={drag.dragPreview}
          drag={drag}
          selection={selection}
        />
      </Stage>
    </div>
  );
}

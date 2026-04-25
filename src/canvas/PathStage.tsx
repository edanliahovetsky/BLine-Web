import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Stage } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { simulatePath, type SimResult } from "../core/sim";
import { projectStore } from "../state/projectStore";
import { useStoreSelector } from "../state/react";
import { selectionStore } from "../state/selectionStore";
import { fieldAspectRatio } from "./constants";
import { createFieldViewport, type CanvasSize } from "./geometry";
import { useCanvasDrag } from "./hooks/useCanvasDrag";
import { useCanvasSelection } from "./hooks/useCanvasSelection";
import { ConstraintOverlayLayer } from "./layers/ConstraintOverlayLayer";
import { FieldLayer } from "./layers/FieldLayer";
import { PathLayer } from "./layers/PathLayer";
import { SimulationLayer } from "./layers/SimulationLayer";
import { createRemovePathElementCommand } from "../ui/sidebar/sidebarCommands";

const fallbackStageSize: CanvasSize = {
  width: 960,
  height: Math.round(960 / fieldAspectRatio)
};

export function PathStage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState<CanvasSize>(fallbackStageSize);
  const [viewScale, setViewScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [simulationTime, setSimulationTime] = useState(0);
  const [simulationPlaying, setSimulationPlaying] = useState(false);
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

  const baseViewport = useMemo(() => createFieldViewport(stageSize), [stageSize]);
  const viewport = useMemo(
    () => ({
      ...baseViewport,
      x: baseViewport.x + panOffset.x,
      y: baseViewport.y + panOffset.y,
      width: baseViewport.width * viewScale,
      height: baseViewport.height * viewScale,
      scale: baseViewport.scale * viewScale
    }),
    [baseViewport, panOffset, viewScale]
  );
  const simulationResult: SimResult | null = useMemo(() => {
    if (!project) {
      return null;
    }

    try {
      return simulatePath(project.path, project.config, { dt_s: 0.02 });
    } catch {
      return null;
    }
  }, [project]);
  const selection = useCanvasSelection(project);
  const drag = useCanvasDrag({ project, viewport });

  useEffect(() => {
    if (!simulationPlaying || !simulationResult) {
      return;
    }

    let frameId = 0;
    let lastTimestamp: number | null = null;
    const tick = (timestamp: number) => {
      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
      }
      const deltaS = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;
      setSimulationTime((current) => {
        const next = Math.min(simulationResult.total_time_s, current + deltaS);
        if (next >= simulationResult.total_time_s) {
          setSimulationPlaying(false);
        }
        return next;
      });
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [simulationPlaying, simulationResult]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === " " && simulationResult) {
      event.preventDefault();
      setSimulationPlaying((current) => !current);
      return;
    }

    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selectedElementIndex !== null &&
      project
    ) {
      event.preventDefault();
      const element = project.path.path_elements[selectedElementIndex];
      if (!element) {
        return;
      }
      projectStore
        .getState()
        .applyCommand(createRemovePathElementCommand(selectedElementIndex, element));
      selectionStore.getState().selectElement(
        Math.min(selectedElementIndex, project.path.path_elements.length - 2),
        projectStore.getState().project
      );
    }
  };

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const factor = direction > 0 ? 1.08 : 0.92;
    setViewScale((current) => clamp(current * factor, 0.6, 3));
  };

  const handleFitView = () => {
    setViewScale(1);
    setPanOffset({ x: 0, y: 0 });
  };

  return (
    <div
      ref={containerRef}
      className="path-stage"
      data-testid="path-stage"
      aria-label="Path canvas"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="path-stage__canvas" data-testid="path-stage-canvas">
        <div className="canvas-hud" aria-label="Canvas view controls">
          <button type="button" aria-label="Zoom in" onClick={() => setViewScale((v) => clamp(v * 1.15, 0.6, 3))}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => setViewScale((v) => clamp(v * 0.85, 0.6, 3))}>
            -
          </button>
          <button type="button" aria-label="Fit view" onClick={handleFitView}>
            Fit
          </button>
        </div>
        <Stage
          width={stageSize.width}
          height={stageSize.height}
          onMouseDown={selection.handleStagePointerDown}
          onTouchStart={selection.handleStagePointerDown}
          onWheel={handleWheel}
        >
          <FieldLayer viewport={viewport} />
          <ConstraintOverlayLayer
            project={project}
            viewport={viewport}
            dragPreview={drag.dragPreview}
          />
          <PathLayer
            project={project}
            selectedElementIndex={selectedElementIndex}
            viewport={viewport}
            dragPreview={drag.dragPreview}
            drag={drag}
            selection={selection}
          />
          <SimulationLayer
            result={simulationResult}
            currentTimeS={simulationTime}
            viewport={viewport}
            config={project?.config ?? null}
          />
        </Stage>
      </div>
      <SimulationTransport
        result={simulationResult}
        currentTimeS={simulationTime}
        playing={simulationPlaying}
        onTogglePlaying={() => {
          if (simulationResult && simulationTime >= simulationResult.total_time_s) {
            setSimulationTime(0);
          }
          setSimulationPlaying((current) => !current);
        }}
        onSeek={(time) => {
          setSimulationTime(time);
          setSimulationPlaying(false);
        }}
      />
    </div>
  );
}

function SimulationTransport({
  result,
  currentTimeS,
  playing,
  onTogglePlaying,
  onSeek
}: {
  result: SimResult | null;
  currentTimeS: number;
  playing: boolean;
  onTogglePlaying(): void;
  onSeek(timeS: number): void;
}) {
  const total = result?.total_time_s ?? 0;
  const safeCurrent = Math.min(currentTimeS, total);

  return (
    <div className="simulation-transport" data-testid="simulation-transport">
      <button
        type="button"
        className="transport-play-button"
        aria-label={playing ? "Pause simulation" : "Play simulation"}
        onClick={onTogglePlaying}
        disabled={!result || total <= 0}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <span className="transport-time" data-testid="simulation-time">
        {safeCurrent.toFixed(2)} / {total.toFixed(2)} s
      </span>
      <input
        aria-label="Simulation time"
        type="range"
        min={0}
        max={Math.max(total, 0)}
        step={0.02}
        value={safeCurrent}
        disabled={!result || total <= 0}
        onChange={(event) => onSeek(Number(event.currentTarget.value))}
      />
      <button type="button" aria-label="Reset simulation" onClick={() => onSeek(0)}>
        Reset
      </button>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

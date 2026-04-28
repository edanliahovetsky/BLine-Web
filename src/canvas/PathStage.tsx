import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent
} from "react";
import {
  isEventTrigger,
  isRotationTarget,
  isWaypoint,
  type PathElement
} from "../core/model/path";
import { simulatePath, type SimResult } from "../core/sim";
import { projectStore } from "../state/projectStore";
import { useStoreSelector } from "../state/react";
import { selectionStore } from "../state/selectionStore";
import { SkipBackIcon, SkipForwardIcon } from "../ui/icons";
import {
  isInteractiveShortcutTarget,
  removeSelectedPathElement,
  removeSelectedRangedConstraint
} from "../ui/keyboardShortcuts";
import { fieldAspectRatio } from "./constants";
import {
  createFieldViewport,
  getElementHeadingRadians,
  getElementPosition,
  getNeighborAnchorPositions,
  interpolateSegmentPosition,
  modelToStagePoint,
  projectPointToSegmentRatio,
  stageToModelPoint,
  type CanvasSize,
  type FieldViewport,
  type PointMeters,
  type PositionOverrides,
  type RotationOverrides,
  type StagePoint
} from "./geometry";
import {
  createMoveElementCommand,
  createSetElementRatioCommand,
  createSetElementRotationCommand,
  isTranslationBearingElement
} from "./modelSync";
import { PixiPathRenderer, type PixiDebugWindow, type PixiRenderInput } from "./pixi/PixiPathRenderer";
import { robotSizeFromConfig } from "./robotFootprint";
import { useCanvasInteractionActivity } from "./hooks/useCanvasInteractionActivity";

const fallbackStageSize: CanvasSize = {
  width: 960,
  height: Math.round(960 / fieldAspectRatio)
};

interface PathStageProps {
  onInteractionStateChange?: (active: boolean) => void;
}

interface ActiveDrag {
  index: number;
  start: PointMeters;
  current: PointMeters;
  startRatio: number | null;
  currentRatio: number | null;
}

interface ActiveRotationDrag {
  index: number;
  startRadians: number;
  currentRadians: number;
}

interface ActivePanDrag {
  pointerId: number;
  startPointer: StagePoint;
  startPanOffset: StagePoint;
}

export function PathStage({ onInteractionStateChange }: PathStageProps = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<PixiPathRenderer | null>(null);
  const latestRenderInputRef = useRef<PixiRenderInput | null>(null);
  const activePanDragRef = useRef<ActivePanDrag | null>(null);
  const panOffsetRef = useRef<StagePoint>({ x: 0, y: 0 });
  const pendingPanOffsetRef = useRef<StagePoint | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const activeRotationDragRef = useRef<ActiveRotationDrag | null>(null);
  const rotationFrameRef = useRef<number | null>(null);
  const [stageSize, setStageSize] = useState<CanvasSize>(fallbackStageSize);
  const [viewScale, setViewScale] = useState(1);
  const [panOffset, setPanOffsetState] = useState<StagePoint>({ x: 0, y: 0 });
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [simulationTime, setSimulationTime] = useState(0);
  const [simulationPlaying, setSimulationPlaying] = useState(false);
  const [activeDrag, setActiveDragState] = useState<ActiveDrag | null>(null);
  const [activeRotationDrag, setActiveRotationDragState] =
    useState<ActiveRotationDrag | null>(null);
  const [dragPreview, setDragPreview] = useState<PositionOverrides>(emptyPreview);
  const [selectedPulse, setSelectedPulse] = useState(0);
  const project = useStoreSelector(projectStore, (state) => state.project);
  const selectedElementIndex = useStoreSelector(
    selectionStore,
    (state) => state.selectedElementIndex
  );
  const selectedRangedConstraint = useStoreSelector(
    selectionStore,
    (state) => state.selectedRangedConstraint
  );

  useEffect(() => {
    selectionStore.getState().reconcileProject(project);
  }, [project]);

  const flushPanOffset = useCallback(() => {
    panFrameRef.current = null;
    const nextOffset = pendingPanOffsetRef.current;
    if (!nextOffset) {
      return;
    }
    pendingPanOffsetRef.current = null;
    setPanOffsetState(nextOffset);
  }, []);

  const setPanOffset = useCallback(
    (nextOffset: StagePoint, sync: "immediate" | "frame" = "immediate") => {
      panOffsetRef.current = nextOffset;

      if (sync === "frame") {
        pendingPanOffsetRef.current = nextOffset;
        if (panFrameRef.current === null) {
          panFrameRef.current = window.requestAnimationFrame(flushPanOffset);
        }
        return;
      }

      pendingPanOffsetRef.current = null;
      if (panFrameRef.current !== null) {
        window.cancelAnimationFrame(panFrameRef.current);
        panFrameRef.current = null;
      }
      setPanOffsetState(nextOffset);
    },
    [flushPanOffset]
  );

  const flushDragPreview = useCallback(() => {
    dragFrameRef.current = null;
    const drag = activeDragRef.current;
    setActiveDragState(drag);
    setDragPreview(drag ? new Map([[drag.index, drag.current]]) : emptyPreview);
  }, []);

  const setActiveDrag = useCallback(
    (nextDrag: ActiveDrag | null, sync: "immediate" | "frame" = "immediate") => {
      activeDragRef.current = nextDrag;

      if (sync === "frame") {
        if (dragFrameRef.current === null) {
          dragFrameRef.current = window.requestAnimationFrame(flushDragPreview);
        }
        return;
      }

      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      setActiveDragState(nextDrag);
      setDragPreview(nextDrag ? new Map([[nextDrag.index, nextDrag.current]]) : emptyPreview);
    },
    [flushDragPreview]
  );

  const flushRotationPreview = useCallback(() => {
    rotationFrameRef.current = null;
    setActiveRotationDragState(activeRotationDragRef.current);
  }, []);

  const setActiveRotationDrag = useCallback(
    (
      nextDrag: ActiveRotationDrag | null,
      sync: "immediate" | "frame" = "immediate"
    ) => {
      activeRotationDragRef.current = nextDrag;

      if (sync === "frame") {
        if (rotationFrameRef.current === null) {
          rotationFrameRef.current = window.requestAnimationFrame(flushRotationPreview);
        }
        return;
      }

      if (rotationFrameRef.current !== null) {
        window.cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
      }
      setActiveRotationDragState(nextDrag);
    },
    [flushRotationPreview]
  );

  useEffect(
    () => () => {
      for (const frame of [panFrameRef, dragFrameRef, rotationFrameRef]) {
        if (frame.current !== null) {
          window.cancelAnimationFrame(frame.current);
        }
      }
    },
    []
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width));
      const height = Math.max(
        260,
        Math.floor(rect.height) || Math.round(width / fieldAspectRatio)
      );
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

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    let renderer: PixiPathRenderer | null = null;
    let debugApi: ReturnType<PixiPathRenderer["getDebugApi"]> | null = null;

    void PixiPathRenderer.create(fallbackStageSize)
      .then((nextRenderer) => {
        if (disposed) {
          nextRenderer.destroy();
          return;
        }

        setRendererError(null);
        renderer = nextRenderer;
        rendererRef.current = nextRenderer;
        host.prepend(nextRenderer.canvas);
        debugApi = nextRenderer.getDebugApi();
        (window as PixiDebugWindow).__blinePixiDebug = debugApi;
        if (latestRenderInputRef.current) {
          nextRenderer.update(latestRenderInputRef.current);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setRendererError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      disposed = true;
      if ((window as PixiDebugWindow).__blinePixiDebug === debugApi) {
        delete (window as PixiDebugWindow).__blinePixiDebug;
      }
      rendererRef.current = null;
      renderer?.destroy();
    };
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

  const canvasInteractionActive =
    isPanning || activeDrag !== null || activeRotationDrag !== null;
  const rotationPreview: RotationOverrides = useMemo(
    () =>
      activeRotationDrag
        ? new Map([[activeRotationDrag.index, activeRotationDrag.currentRadians]])
        : emptyRotationPreview,
    [activeRotationDrag]
  );
  const selectedPulseValue =
    selectedElementIndex === null ? 0 : canvasInteractionActive ? 0.72 : selectedPulse;

  useCanvasInteractionActivity({
    containerRef,
    semanticActive: canvasInteractionActive,
    onChange: onInteractionStateChange
  });

  useEffect(() => {
    if (selectedElementIndex === null || canvasInteractionActive) {
      return;
    }

    const startedAt = window.performance.now();
    const timer = window.setInterval(() => {
      const elapsed = window.performance.now() - startedAt;
      setSelectedPulse((Math.sin((elapsed / selectionPulsePeriodMs) * Math.PI * 2) + 1) / 2);
    }, selectionPulseIntervalMs);

    return () => window.clearInterval(timer);
  }, [canvasInteractionActive, selectedElementIndex]);

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

  const toggleSimulationPlaying = useCallback(() => {
    if (!simulationResult || simulationResult.total_time_s <= 0) {
      return;
    }

    if (simulationTime >= simulationResult.total_time_s) {
      setSimulationTime(0);
    }
    setSimulationPlaying((current) => !current);
  }, [simulationResult, simulationTime]);

  const resetSimulation = useCallback(() => {
    if (!simulationResult || simulationResult.total_time_s <= 0) {
      return;
    }

    setSimulationPlaying(false);
    setSimulationTime(0);
  }, [simulationResult]);

  const finishSimulation = useCallback(() => {
    if (!simulationResult || simulationResult.total_time_s <= 0) {
      return;
    }

    setSimulationPlaying(false);
    setSimulationTime(simulationResult.total_time_s);
  }, [simulationResult]);

  useEffect(() => {
    const handleSimulationShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isInteractiveShortcutTarget(event.target)
      ) {
        return;
      }

      if (event.key === " " || event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleSimulationPlaying();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "Home") {
        event.preventDefault();
        resetSimulation();
        return;
      }

      if (event.key === "ArrowRight" || event.key === "End") {
        event.preventDefault();
        finishSimulation();
      }
    };

    window.addEventListener("keydown", handleSimulationShortcut);
    return () => window.removeEventListener("keydown", handleSimulationShortcut);
  }, [finishSimulation, resetSimulation, toggleSimulationPlaying]);

  const renderInput = useMemo<PixiRenderInput>(
    () => ({
      stageSize,
      viewport,
      project,
      selectedElementIndex,
      selectedRangedConstraint,
      positionPreview: dragPreview,
      rotationPreview,
      selectedPulse: selectedPulseValue,
      simulationResult,
      simulationTimeS: simulationTime,
      simulationPlaying,
      config: project?.config ?? null
    }),
    [
      dragPreview,
      project,
      rotationPreview,
      selectedElementIndex,
      selectedPulseValue,
      selectedRangedConstraint,
      simulationPlaying,
      simulationResult,
      simulationTime,
      stageSize,
      viewport
    ]
  );

  useEffect(() => {
    latestRenderInputRef.current = renderInput;
    rendererRef.current?.update(renderInput);
  }, [renderInput]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isInteractiveShortcutTarget(event.target)
    ) {
      return;
    }

    if (event.key === " " || event.key.toLowerCase() === "k") {
      event.preventDefault();
      toggleSimulationPlaying();
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "Home") {
      event.preventDefault();
      resetSimulation();
      return;
    }

    if (event.key === "ArrowRight" || event.key === "End") {
      event.preventDefault();
      finishSimulation();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (removeSelectedRangedConstraint() || removeSelectedPathElement()) {
        event.preventDefault();
      }
    }
  };

  const zoomAtStagePoint = useCallback(
    (stagePoint: StagePoint, factor: number) => {
      const nextScale = clamp(viewScale * factor, minViewScale, maxViewScale);
      if (Math.abs(nextScale - viewScale) < 0.0001) {
        return;
      }

      const scenePoint = {
        x: (stagePoint.x - viewport.x) / viewport.scale,
        y: (stagePoint.y - viewport.y) / viewport.scale
      };
      const nextViewportScale = baseViewport.scale * nextScale;
      const nextViewportX = stagePoint.x - scenePoint.x * nextViewportScale;
      const nextViewportY = stagePoint.y - scenePoint.y * nextViewportScale;

      setViewScale(nextScale);
      setPanOffset(
        clampPanOffset(
          {
            x: nextViewportX - baseViewport.x,
            y: nextViewportY - baseViewport.y
          },
          baseViewport,
          stageSize,
          nextScale
        )
      );
    },
    [baseViewport, setPanOffset, stageSize, viewScale, viewport]
  );

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (isTransportEventTarget(event.target)) {
      return;
    }

    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const factor = direction > 0 ? zoomStepFactor : 1 / zoomStepFactor;
    zoomAtStagePoint(stagePointFromEvent(event), factor);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isTransportEventTarget(event.target)) {
      return;
    }
    if (!project) {
      return;
    }

    containerRef.current?.focus();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = stagePointFromEvent(event);
    const rotationHit = hitTestRotationHandle(
      project,
      selectedElementIndex,
      viewport,
      dragPreview,
      rotationPreview,
      pointer
    );
    if (rotationHit !== null) {
      const startRadians =
        getElementHeadingRadians(project.path.path_elements, rotationHit) ?? 0;
      setActiveRotationDrag({
        index: rotationHit,
        startRadians,
        currentRadians: startRadians
      });
      return;
    }

    const nodeHit = hitTestPathElement(project, viewport, dragPreview, pointer, selectedElementIndex);
    if (nodeHit !== null) {
      selectionStore.getState().selectElement(nodeHit, project);
      const element = project.path.path_elements[nodeHit];
      const start = getElementPosition(project.path.path_elements, nodeHit);
      if (!element || !start || !isDragEnabled(element)) {
        return;
      }

      const startRatio =
        isRotationTarget(element) || isEventTrigger(element)
          ? element.t_ratio
          : null;
      setActiveDrag({
        index: nodeHit,
        start,
        current: start,
        startRatio,
        currentRatio: startRatio
      });
      return;
    }

    selectionStore.getState().clearSelection();
    activePanDragRef.current = {
      pointerId: event.pointerId,
      startPointer: pointer,
      startPanOffset: panOffsetRef.current
    };
    setIsPanning(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isTransportEventTarget(event.target)) {
      return;
    }

    const pointer = stagePointFromEvent(event);
    const drag = activeDragRef.current;
    if (drag && project) {
      event.preventDefault();
      const projected = projectDragStagePoint(
        project,
        viewport,
        robotSizeFromConfig(project.config),
        drag.index,
        pointer
      );
      setActiveDrag(
        {
          ...drag,
          current: projected.position,
          currentRatio: projected.ratio
        },
        "frame"
      );
      return;
    }

    const rotationDrag = activeRotationDragRef.current;
    if (rotationDrag && project) {
      event.preventDefault();
      const nextRadians = rotationFromStagePoint(
        project,
        rotationDrag.index,
        viewport,
        pointer
      );
      if (nextRadians === null) {
        return;
      }
      setActiveRotationDrag(
        {
          ...rotationDrag,
          currentRadians: nextRadians
        },
        "frame"
      );
      return;
    }

    const panDrag = activePanDragRef.current;
    if (!panDrag || panDrag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    setPanOffset(
      clampPanOffset(
        {
          x: panDrag.startPanOffset.x + pointer.x - panDrag.startPointer.x,
          y: panDrag.startPanOffset.y + pointer.y - panDrag.startPointer.y
        },
        baseViewport,
        stageSize,
        viewScale
      ),
      "frame"
    );
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const pointer = stagePointFromEvent(event);
    finishActiveDrag();
    finishActiveRotation(pointer);
    finishPanDrag();
  };

  const finishActiveDrag = () => {
    const drag = activeDragRef.current;
    if (!drag || !project) {
      setActiveDrag(null);
      return;
    }

    let nextPosition = drag.current;
    let nextRatio = drag.currentRatio;
    const element = project.path.path_elements[drag.index];

    if (element && (isRotationTarget(element) || isEventTrigger(element))) {
      const segment = getNeighborAnchorPositions(project.path.path_elements, drag.index);
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

    setActiveDrag(null);

    if (drag.startRatio !== null && nextRatio !== null) {
      if (Math.abs(drag.startRatio - nextRatio) >= 0.001) {
        projectStore
          .getState()
          .applyCommand(
            createSetElementRatioCommand(drag.index, drag.startRatio, nextRatio)
          );
        selectionStore.getState().selectElement(drag.index, projectStore.getState().project);
      }
      return;
    }

    if (!pointsAlmostEqual(drag.start, nextPosition)) {
      projectStore
        .getState()
        .applyCommand(createMoveElementCommand(drag.index, drag.start, nextPosition));
      selectionStore.getState().selectElement(drag.index, projectStore.getState().project);
    }
  };

  const finishActiveRotation = (pointer: StagePoint) => {
    const rotationDrag = activeRotationDragRef.current;
    if (!rotationDrag || !project) {
      setActiveRotationDrag(null);
      return;
    }

    const nextRadians =
      rotationFromStagePoint(project, rotationDrag.index, viewport, pointer) ??
      rotationDrag.currentRadians;
    setActiveRotationDrag(null);

    if (Math.abs(angularDelta(rotationDrag.startRadians, nextRadians)) >= 0.001) {
      projectStore
        .getState()
        .applyCommand(
          createSetElementRotationCommand(
            rotationDrag.index,
            rotationDrag.startRadians,
            nextRadians
          )
        );
      selectionStore
        .getState()
        .selectElement(rotationDrag.index, projectStore.getState().project);
      return;
    }

    selectionStore.getState().selectElement(rotationDrag.index, project);
  };

  const finishPanDrag = () => {
    if (pendingPanOffsetRef.current) {
      setPanOffset(pendingPanOffsetRef.current);
    }
    activePanDragRef.current = null;
    setIsPanning(false);
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
      <div
        ref={canvasHostRef}
        className={`path-stage__canvas${isPanning ? " is-panning" : ""}`}
        data-testid="path-stage-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        {rendererError ? (
          <div className="path-stage__renderer-error">
            Canvas renderer failed: {rendererError}
          </div>
        ) : null}
        <SimulationTransport
          result={simulationResult}
          currentTimeS={simulationTime}
          playing={simulationPlaying}
          onReset={resetSimulation}
          onTogglePlaying={toggleSimulationPlaying}
          onFinish={finishSimulation}
          onSeek={(time) => {
            setSimulationTime(time);
            setSimulationPlaying(false);
          }}
        />
      </div>
    </div>
  );
}

function SimulationTransport({
  result,
  currentTimeS,
  playing,
  onReset,
  onTogglePlaying,
  onFinish,
  onSeek
}: {
  result: SimResult | null;
  currentTimeS: number;
  playing: boolean;
  onReset(): void;
  onTogglePlaying(): void;
  onFinish(): void;
  onSeek(timeS: number): void;
}) {
  const total = result?.total_time_s ?? 0;
  const safeCurrent = Math.min(currentTimeS, total);
  const disabled = !result || total <= 0;
  const progress = total > 0 ? (safeCurrent / total) * 100 : 0;
  const timelineStyle = {
    "--transport-progress": `${progress}%`
  } as CSSProperties;

  return (
    <div className="simulation-transport" data-testid="simulation-transport">
      <div className="transport-primary-controls">
        <button
          type="button"
          className="transport-step-button"
          aria-label="Reset simulation"
          aria-keyshortcuts="ArrowLeft Home"
          title="Reset simulation (Left Arrow)"
          onClick={onReset}
          disabled={disabled || safeCurrent <= 0}
        >
          <SkipBackIcon size={16} />
        </button>
        <button
          type="button"
          className="transport-play-button"
          aria-label={playing ? "Pause simulation" : "Play simulation"}
          aria-keyshortcuts="Space K"
          title={playing ? "Pause simulation (Space)" : "Play simulation (Space)"}
          onClick={onTogglePlaying}
          disabled={disabled}
        >
          <span className={playing ? "transport-icon pause" : "transport-icon play"} />
        </button>
        <button
          type="button"
          className="transport-step-button"
          aria-label="Fast forward simulation"
          aria-keyshortcuts="ArrowRight End"
          title="Fast forward simulation (Right Arrow)"
          onClick={onFinish}
          disabled={disabled || safeCurrent >= total}
        >
          <SkipForwardIcon size={16} />
        </button>
      </div>
      <span className="transport-time" data-testid="simulation-time">
        {safeCurrent.toFixed(2)} / {total.toFixed(2)} s
      </span>
      <span className="transport-elapsed" aria-hidden="true">
        {safeCurrent.toFixed(2)}s
      </span>
      <div className="transport-timeline">
        <input
          aria-label="Simulation time"
          type="range"
          min={0}
          max={Math.max(total, 0)}
          step={0.02}
          value={safeCurrent}
          style={timelineStyle}
          disabled={disabled}
          onChange={(event) => onSeek(Number(event.currentTarget.value))}
        />
      </div>
    </div>
  );
}

function hitTestRotationHandle(
  project: NonNullable<ReturnType<typeof projectStore.getState>["project"]>,
  selectedElementIndex: number | null,
  viewport: FieldViewport,
  positionPreview: PositionOverrides,
  rotationPreview: RotationOverrides,
  pointer: StagePoint
): number | null {
  if (selectedElementIndex === null) {
    return null;
  }

  const elements = project.path.path_elements;
  const element = elements[selectedElementIndex];
  if (!element || (!isRotationTarget(element) && !isWaypoint(element))) {
    return null;
  }

  const position = getElementPosition(elements, selectedElementIndex, positionPreview);
  const rotationRadians = getElementHeadingRadians(
    elements,
    selectedElementIndex,
    rotationPreview
  );
  if (!position || rotationRadians === null) {
    return null;
  }

  const center = modelToStagePoint(position, viewport);
  const handle = rotationHandlePoint(center, viewport, rotationRadians);
  return pointDistance(pointer, handle) <= rotationHandleHitRadiusPx
    ? selectedElementIndex
    : null;
}

function hitTestPathElement(
  project: NonNullable<ReturnType<typeof projectStore.getState>["project"]>,
  viewport: FieldViewport,
  positionPreview: PositionOverrides,
  pointer: StagePoint,
  selectedElementIndex: number | null
): number | null {
  const elements = project.path.path_elements;
  const renderedNodes = elements.flatMap((element, index) => {
    const position = getElementPosition(elements, index, positionPreview);
    return position ? [{ element, index, point: modelToStagePoint(position, viewport) }] : [];
  });
  const orderedNodes =
    selectedElementIndex === null
      ? renderedNodes
      : [
          ...renderedNodes.filter(({ index }) => index !== selectedElementIndex),
          ...renderedNodes.filter(({ index }) => index === selectedElementIndex)
        ];
  const robotSizeMeters = robotSizeFromConfig(project.config);

  for (let nodeIndex = orderedNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    const { element, index, point } = orderedNodes[nodeIndex];
    if (
      hitTestElementShape(
        element,
        point,
        pointer,
        getElementHeadingRadians(elements, index),
        viewport,
        robotSizeMeters
      )
    ) {
      return index;
    }
  }

  return null;
}

function hitTestElementShape(
  element: PathElement,
  point: StagePoint,
  pointer: StagePoint,
  headingRadians: number | null,
  viewport: FieldViewport,
  robotSizeMeters: ReturnType<typeof robotSizeFromConfig>
): boolean {
  if (isTranslationBearingElement(element)) {
    const radius = Math.max(7, 0.1 * viewport.scale) + 14;
    if (pointDistance(point, pointer) <= radius) {
      return true;
    }
  }

  if (isRotationTarget(element) || isTranslationBearingElement(element)) {
    const local = toLocalRobotPoint(point, pointer, headingRadians);
    const width = robotSizeMeters.lengthMeters * viewport.scale;
    const height = robotSizeMeters.widthMeters * viewport.scale;
    const padding = Math.max(10, Math.min(width, height) * 0.18);
    if (
      local.x >= -width / 2 - padding &&
      local.x <= width / 2 + padding &&
      local.y >= -height / 2 - padding &&
      local.y <= height / 2 + padding
    ) {
      return true;
    }
  }

  if (isEventTrigger(element)) {
    const local = toLocalRobotPoint(point, pointer, headingRadians);
    const halfLength = Math.max(32, eventTriggerLengthMetersFallback * viewport.scale) / 2;
    return Math.abs(local.y) <= 18 && Math.abs(local.x) <= halfLength + 12;
  }

  return false;
}

function projectDragStagePoint(
  project: NonNullable<ReturnType<typeof projectStore.getState>["project"]>,
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

function isDragEnabled(element: PathElement): boolean {
  return (
    isTranslationBearingElement(element) ||
    isRotationTarget(element) ||
    isEventTrigger(element)
  );
}

function stagePointFromEvent(event: PointerEvent<HTMLDivElement> | WheelEvent<HTMLDivElement>): StagePoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function isTransportEventTarget(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest(".simulation-transport"));
}

function rotationFromStagePoint(
  project: NonNullable<ReturnType<typeof projectStore.getState>["project"]>,
  index: number,
  viewport: FieldViewport,
  point: StagePoint
): number | null {
  const position = getElementPosition(project.path.path_elements, index);
  if (!position) {
    return null;
  }

  const center = modelToStagePoint(position, viewport);
  return normalizeRadians(Math.atan2(center.y - point.y, point.x - center.x));
}

function rotationHandlePoint(
  center: StagePoint,
  viewport: FieldViewport,
  rotationRadians: number
): StagePoint {
  const radius = Math.max(42, Math.min(64, viewport.scale * 0.36));
  return {
    x: center.x + Math.cos(rotationRadians) * radius,
    y: center.y - Math.sin(rotationRadians) * radius
  };
}

function toLocalRobotPoint(
  center: StagePoint,
  point: StagePoint,
  headingRadians: number | null
): StagePoint {
  const stageRadians = headingRadians === null ? 0 : -headingRadians;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(-stageRadians);
  const sin = Math.sin(-stageRadians);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos
  };
}

function pointsAlmostEqual(a: PointMeters, b: PointMeters): boolean {
  return (
    Math.abs(a.x_meters - b.x_meters) < 0.001 &&
    Math.abs(a.y_meters - b.y_meters) < 0.001
  );
}

function pointDistance(first: StagePoint, second: StagePoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function angularDelta(a: number, b: number): number {
  return normalizeRadians(b - a);
}

function normalizeRadians(radians: number): number {
  if (!Number.isFinite(radians)) {
    return 0;
  }

  let normalized = radians;
  while (normalized <= -Math.PI) {
    normalized += Math.PI * 2;
  }
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  return normalized;
}

function clampPanOffset(
  offset: StagePoint,
  baseViewport: FieldViewport,
  stageSize: CanvasSize,
  scale: number
): StagePoint {
  const scaledWidth = baseViewport.width * scale;
  const scaledHeight = baseViewport.height * scale;

  return {
    x: clampAxisPan(offset.x, baseViewport.x, scaledWidth, stageSize.width),
    y: clampAxisPan(offset.y, baseViewport.y, scaledHeight, stageSize.height)
  };
}

function clampAxisPan(
  offset: number,
  basePosition: number,
  scaledSize: number,
  stageSize: number
): number {
  if (scaledSize <= stageSize) {
    return 0;
  }

  const minOffset = stageSize - scaledSize - basePosition;
  const maxOffset = -basePosition;

  return clamp(offset, minOffset, maxOffset);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const emptyPreview = new Map<number, PointMeters>();
const emptyRotationPreview = new Map<number, number>();
const eventTriggerLengthMetersFallback = 0.36;
const minViewScale = 1;
const maxViewScale = 8;
const zoomStepFactor = 1.03;
const selectionPulseIntervalMs = 40;
const selectionPulsePeriodMs = 1800;
const rotationHandleHitRadiusPx = 18;

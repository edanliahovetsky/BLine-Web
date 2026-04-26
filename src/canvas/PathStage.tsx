import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from "react";
import { Layer, Stage } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  getElementHeadingRadians,
  getElementPosition,
  modelToStagePoint,
  type RotationOverrides
} from "./geometry";
import { simulatePath, type SimResult } from "../core/sim";
import { projectStore } from "../state/projectStore";
import { useStoreSelector } from "../state/react";
import { selectionStore } from "../state/selectionStore";
import { fieldAspectRatio } from "./constants";
import { createFieldViewport, type CanvasSize } from "./geometry";
import { useCanvasDrag } from "./hooks/useCanvasDrag";
import { useCanvasSelection } from "./hooks/useCanvasSelection";
import { ConstraintRangeHighlightContent } from "./layers/ConstraintOverlayLayer";
import { FieldLayerContent } from "./layers/FieldLayer";
import { PathLayerContent } from "./layers/PathLayer";
import { RotationHandleLayerContent } from "./layers/RotationHandleLayer";
import { SimulationLayerContent } from "./layers/SimulationLayer";
import {
  createRemovePathElementCommand
} from "../ui/sidebar/sidebarCommands";
import { createSetElementRotationCommand } from "./modelSync";

const safariMaxKonvaPixelRatio = 1;

configureKonvaForCanvasPerformance();

const fallbackStageSize: CanvasSize = {
  width: 960,
  height: Math.round(960 / fieldAspectRatio)
};

interface ActiveRotationDrag {
  index: number;
  startRadians: number;
  currentRadians: number;
}

interface ActivePanDrag {
  startPointer: { x: number; y: number };
  startPanOffset: { x: number; y: number };
}

export function PathStage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activePanDragRef = useRef<ActivePanDrag | null>(null);
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const pendingPanOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const [stageSize, setStageSize] = useState<CanvasSize>(fallbackStageSize);
  const [viewScale, setViewScale] = useState(1);
  const [panOffset, setPanOffsetState] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [simulationTime, setSimulationTime] = useState(0);
  const [simulationPlaying, setSimulationPlaying] = useState(false);
  const [activeRotationDrag, setActiveRotationDragState] =
    useState<ActiveRotationDrag | null>(null);
  const activeRotationDragRef = useRef<ActiveRotationDrag | null>(null);
  const rotationFrameRef = useRef<number | null>(null);
  const project = useStoreSelector(projectStore, (state) => state.project);
  const selectedElementIndex = useStoreSelector(
    selectionStore,
    (state) => state.selectedElementIndex
  );
  const selectedRangedConstraint = useStoreSelector(
    selectionStore,
    (state) => state.selectedRangedConstraint
  );
  const [selectedPulse, setSelectedPulse] = useState(0);

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
    (nextOffset: { x: number; y: number }, sync: "immediate" | "frame" = "immediate") => {
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
      if (panFrameRef.current !== null) {
        window.cancelAnimationFrame(panFrameRef.current);
      }
      if (rotationFrameRef.current !== null) {
        window.cancelAnimationFrame(rotationFrameRef.current);
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
  const canvasInteractionActive =
    isPanning || drag.isDragging || activeRotationDrag !== null;
  const rotationPreview: RotationOverrides = activeRotationDrag
    ? new Map([[activeRotationDrag.index, activeRotationDrag.currentRadians]])
    : emptyRotationPreview;
  const selectedPulseValue =
    selectedElementIndex === null ? 0 : canvasInteractionActive ? 0.72 : selectedPulse;

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
    const factor = direction > 0 ? zoomStepFactor : 1 / zoomStepFactor;
    const pointer = event.target.getStage()?.getPointerPosition() ?? {
      x: stageSize.width / 2,
      y: stageSize.height / 2
    };
    zoomAtStagePoint(pointer, factor);
  };

  const zoomAtStagePoint = (
    stagePoint: { x: number; y: number },
    factor: number
  ) => {
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
  };

  const handleStagePointerDown = (
    event: KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    selection.handleStagePointerDown(event);
    if (event.target !== event.target.getStage()) {
      return;
    }

    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) {
      return;
    }

    activePanDragRef.current = {
      startPointer: pointer,
      startPanOffset: panOffsetRef.current
    };
    setIsPanning(true);
  };

  const handleStagePointerMove = (
    event: KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    const panDrag = activePanDragRef.current;
    if (!panDrag) {
      return;
    }

    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) {
      return;
    }

    event.evt.preventDefault();
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

  const handleStagePointerUp = () => {
    if (pendingPanOffsetRef.current) {
      setPanOffset(pendingPanOffsetRef.current);
    }
    activePanDragRef.current = null;
    setIsPanning(false);
  };

  const handleRotationDragStart = (
    index: number,
    event: KonvaEventObject<DragEvent>
  ) => {
    if (!project) {
      return;
    }

    event.cancelBubble = true;
    const startRadians =
      getElementHeadingRadians(project.path.path_elements, index) ?? 0;
    setActiveRotationDrag({
      index,
      startRadians,
      currentRadians: startRadians
    });
  };

  const handleRotationDragMove = (
    index: number,
    event: KonvaEventObject<DragEvent>
  ) => {
    const rotationDrag = activeRotationDragRef.current;
    if (!project || !rotationDrag || rotationDrag.index !== index) {
      return;
    }

    event.cancelBubble = true;
    const dragTarget = event.currentTarget;
    const pointer = dragTarget.getStage()?.getPointerPosition() ?? {
      x: dragTarget.x(),
      y: dragTarget.y()
    };
    const nextRadians = rotationFromStagePoint(
      project,
      index,
      viewport,
      pointer
    );
    if (nextRadians === null) {
      return;
    }

    const renderedRadians =
      activeRotationDrag?.currentRadians ?? rotationDrag.currentRadians;
    const handlePoint = rotationHandlePoint(
      project,
      index,
      viewport,
      renderedRadians
    );
    if (handlePoint) {
      dragTarget.position(handlePoint);
    }

    setActiveRotationDrag(
      {
        ...rotationDrag,
        currentRadians: nextRadians
      },
      "frame"
    );
  };

  const handleRotationDragEnd = (
    index: number,
    event: KonvaEventObject<DragEvent>
  ) => {
    const rotationDrag = activeRotationDragRef.current;
    if (!project || !rotationDrag || rotationDrag.index !== index) {
      setActiveRotationDrag(null);
      return;
    }

    event.cancelBubble = true;
    const dragTarget = event.currentTarget;
    const pointer = dragTarget.getStage()?.getPointerPosition() ?? {
      x: dragTarget.x(),
      y: dragTarget.y()
    };
    const nextRadians =
      rotationFromStagePoint(project, index, viewport, pointer) ??
      rotationDrag.currentRadians;
    const handlePoint = rotationHandlePoint(project, index, viewport, nextRadians);
    if (handlePoint) {
      dragTarget.position(handlePoint);
    }
    setActiveRotationDrag(null);

    if (Math.abs(angularDelta(rotationDrag.startRadians, nextRadians)) >= 0.001) {
      projectStore
        .getState()
        .applyCommand(
          createSetElementRotationCommand(
            index,
            rotationDrag.startRadians,
            nextRadians
          )
        );
      selectionStore.getState().selectElement(index, projectStore.getState().project);
      return;
    }

    selectionStore.getState().selectElement(index, project);
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
        className={`path-stage__canvas${isPanning ? " is-panning" : ""}`}
        data-testid="path-stage-canvas"
      >
        <Stage
          width={stageSize.width}
          height={stageSize.height}
          onMouseDown={handleStagePointerDown}
          onTouchStart={handleStagePointerDown}
          onMouseMove={handleStagePointerMove}
          onTouchMove={handleStagePointerMove}
          onMouseUp={handleStagePointerUp}
          onTouchEnd={handleStagePointerUp}
          onMouseLeave={handleStagePointerUp}
          onWheel={handleWheel}
        >
          <Layer listening={false}>
            <FieldLayerContent viewport={viewport} />
          </Layer>
          <Layer>
            <PathLayerContent
              project={project}
              selectedElementIndex={selectedElementIndex}
              viewport={viewport}
              dragPreview={drag.dragPreview}
              rotationPreview={rotationPreview}
              selectedPulse={selectedPulseValue}
              drag={drag}
              selection={selection}
            />
            <ConstraintRangeHighlightContent
              project={project}
              selection={selectedRangedConstraint}
              viewport={viewport}
              dragPreview={drag.dragPreview}
            />
            <RotationHandleLayerContent
              project={project}
              selectedElementIndex={selectedElementIndex}
              viewport={viewport}
              positionPreview={drag.dragPreview}
              rotationPreview={rotationPreview}
              onRotationDragStart={handleRotationDragStart}
              onRotationDragMove={handleRotationDragMove}
              onRotationDragEnd={handleRotationDragEnd}
            />
            <SimulationLayerContent
              result={simulationResult}
              currentTimeS={simulationTime}
              playing={simulationPlaying}
              viewport={viewport}
              config={project?.config ?? null}
            />
          </Layer>
        </Stage>
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
  const progress = total > 0 ? (safeCurrent / total) * 100 : 0;
  const timelineStyle = {
    "--transport-progress": `${progress}%`
  } as CSSProperties;

  return (
    <div className="simulation-transport" data-testid="simulation-transport">
      <div className="transport-primary-controls">
        <button
          type="button"
          className="transport-play-button"
          aria-label={playing ? "Pause simulation" : "Play simulation"}
          title={playing ? "Pause simulation" : "Play simulation"}
          onClick={onTogglePlaying}
          disabled={!result || total <= 0}
        >
          <span className={playing ? "transport-icon pause" : "transport-icon play"} />
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
          disabled={!result || total <= 0}
          onChange={(event) => onSeek(Number(event.currentTarget.value))}
        />
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rotationFromStagePoint(
  project: NonNullable<ReturnType<typeof projectStore.getState>["project"]>,
  index: number,
  viewport: ReturnType<typeof createFieldViewport>,
  point: { x: number; y: number }
): number | null {
  const position = getElementPosition(project.path.path_elements, index);
  if (!position) {
    return null;
  }

  const center = modelToStagePoint(position, viewport);
  return normalizeRadians(Math.atan2(center.y - point.y, point.x - center.x));
}

function rotationHandlePoint(
  project: NonNullable<ReturnType<typeof projectStore.getState>["project"]>,
  index: number,
  viewport: ReturnType<typeof createFieldViewport>,
  rotationRadians: number
): { x: number; y: number } | null {
  const position = getElementPosition(project.path.path_elements, index);
  if (!position) {
    return null;
  }

  const center = modelToStagePoint(position, viewport);
  const radius = Math.max(42, Math.min(64, viewport.scale * 0.36));
  return {
    x: center.x + Math.cos(rotationRadians) * radius,
    y: center.y - Math.sin(rotationRadians) * radius
  };
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
  offset: { x: number; y: number },
  baseViewport: ReturnType<typeof createFieldViewport>,
  stageSize: CanvasSize,
  scale: number
): { x: number; y: number } {
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

const emptyRotationPreview = new Map<number, number>();
const minViewScale = 1;
const maxViewScale = 8;
const zoomStepFactor = 1.03;
const selectionPulseIntervalMs = 40;
const selectionPulsePeriodMs = 1800;

function configureKonvaForCanvasPerformance() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return;
  }

  const konva = (window as Window & { Konva?: KonvaRuntimeSettings }).Konva;
  if (!konva) {
    return;
  }

  konva.hitOnDragEnabled = false;

  const userAgent = navigator.userAgent;
  const isSafari =
    /\bSafari\//.test(userAgent) &&
    !/\b(?:Chrome|Chromium|CriOS|FxiOS|Edg|OPR)\//.test(userAgent);

  if (isSafari && window.devicePixelRatio > safariMaxKonvaPixelRatio) {
    konva.pixelRatio = safariMaxKonvaPixelRatio;
  }
}

interface KonvaRuntimeSettings {
  hitOnDragEnabled: boolean;
  pixelRatio: number;
}

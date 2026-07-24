import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  Eye,
  EyeOff,
  Focus,
  MousePointer2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  isAnchorElement,
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement,
  type TranslationTarget,
} from "../core/model/path";
import type {
  LinkedTarget,
  LinkedTargetKind,
  ProjectDocument,
} from "../core/io/projectSchema";
import { getDefaultOptionalConfigValue } from "../core/config/projectConfig";
import { resolveFieldDefinition } from "../core/field/fieldConfig";
import { createCurveTranslationTargets } from "../core/pathProfile/curveProfile";
import { simulatePath, type SimResult } from "../core/sim";
import { projectStore } from "../state/projectStore";
import { useStoreSelector } from "../state/react";
import { selectionStore } from "../state/selectionStore";
import {
  getPathElementLinkedTargetId,
  isElementCompatibleWithLinkedTarget,
  linkedTargetControlsElementRotation,
  linkedTargetForPathElement,
  nextLinkedTargetName,
} from "../core/linkedTargets";
import {
  CurveIcon,
  ElementIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "../ui/icons";
import { IconButton } from "../ui/controls";
import type { EditorTool } from "../ui/app/editorCommands";
import {
  isInteractiveShortcutTarget,
  removeSelectedPathElement,
  removeSelectedRangedConstraint,
} from "../ui/keyboardShortcuts";
import { fieldAspectRatio } from "./constants";
import {
  createFieldViewport,
  clampModelPoint,
  getElementHeadingRadians,
  getElementPosition,
  getRenderableElementPositions,
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
  type StagePoint,
} from "./geometry";
import {
  createMoveElementCommand,
  createSetElementRatioCommand,
  createSetElementRotationCommand,
  isTranslationBearingElement,
} from "./modelSync";
import {
  PixiPathRenderer,
  type PixiDebugWindow,
  type PixiPathOverlay,
  type PixiRenderInput,
} from "./pixi/PixiPathRenderer";
import { robotSizeFromConfig } from "./robotFootprint";
import { useCanvasInteractionActivity } from "./hooks/useCanvasInteractionActivity";
import type { CurveAuthoringPreview, CurveToolSession } from "./curveAuthoring";

const fallbackStageSize: CanvasSize = {
  width: 960,
  height: Math.round(960 / fieldAspectRatio),
};

interface PathStageProps {
  activeTool?: EditorTool;
  curveTool?: CurveToolSession | null;
  onToolChange?(tool: EditorTool): void;
  onPlaceElement?(placement: CanvasElementPlacement): void;
  onInteractionStateChange?: (active: boolean) => void;
  onCurveToolCommit?(
    insertionIndex: number,
    targets: readonly TranslationTarget[],
  ): void;
  onCurveToolCancel?(): void;
}

export interface CanvasElementPlacement {
  type: "waypoint" | "translation" | "rotation" | "event_trigger";
  insertionIndex: number;
  position: PointMeters;
  ratio?: number;
}

interface ActiveDrag {
  index: number;
  start: PointMeters;
  current: PointMeters;
  startRatio: number | null;
  currentRatio: number | null;
  linkedTargetId: string | null;
}

interface ActiveRotationDrag {
  index: number;
  startRadians: number;
  currentRadians: number;
  linkedTargetId: string | null;
}

interface ActivePanDrag {
  pointerId: number;
  startPointer: StagePoint;
  startPanOffset: StagePoint;
}

interface ActiveCurveDraft {
  pointerId: number;
  insertionIndex: number;
  samples: PointMeters[];
  targetPoints: PointMeters[];
}

interface ActiveCanvasContextMenu {
  stagePoint: StagePoint;
  fieldPoint: PointMeters;
  elementIndex: number | null;
}

export function PathStage({
  activeTool = "select",
  curveTool = null,
  onToolChange,
  onPlaceElement,
  onInteractionStateChange,
  onCurveToolCommit,
  onCurveToolCancel,
}: PathStageProps = {}) {
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
  const activeCurveDraftRef = useRef<ActiveCurveDraft | null>(null);
  const rotationFrameRef = useRef<number | null>(null);
  const [stageSize, setStageSize] = useState<CanvasSize>(fallbackStageSize);
  const [viewScale, setViewScale] = useState(1);
  const [showGhostPaths, setShowGhostPaths] = useState(true);
  const [panOffset, setPanOffsetState] = useState<StagePoint>({ x: 0, y: 0 });
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [customFieldImage, setCustomFieldImage] = useState<{
    fieldId: string;
    url: string;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [simulationTime, setSimulationTime] = useState(0);
  const [simulationPlaying, setSimulationPlaying] = useState(false);
  const [hoveredOverlayPathId, setHoveredOverlayPathId] = useState<
    string | null
  >(null);
  const [hoveredOverlayPoint, setHoveredOverlayPoint] =
    useState<StagePoint | null>(null);
  const [placementPreview, setPlacementPreview] = useState<{
    point: StagePoint;
    placement: CanvasElementPlacement | null;
  } | null>(null);
  const [contextMenu, setContextMenu] =
    useState<ActiveCanvasContextMenu | null>(null);
  const [activeDrag, setActiveDragState] = useState<ActiveDrag | null>(null);
  const [activeRotationDrag, setActiveRotationDragState] =
    useState<ActiveRotationDrag | null>(null);
  const [activeCurveDraft, setActiveCurveDraftState] =
    useState<ActiveCurveDraft | null>(null);
  const [dragPreview, setDragPreview] =
    useState<PositionOverrides>(emptyPreview);
  const [selectedPulse, setSelectedPulse] = useState(0);
  const project = useStoreSelector(projectStore, (state) => state.project);
  const workspace = useStoreSelector(projectStore, (state) => state.workspace);
  const selectedElementIndex = useStoreSelector(
    selectionStore,
    (state) => state.selectedElementIndex,
  );
  const selectedRangedConstraint = useStoreSelector(
    selectionStore,
    (state) => state.selectedRangedConstraint,
  );
  const activeField = useMemo(
    () => resolveFieldDefinition(project?.config.gui.field),
    [project?.config.gui.field],
  );
  useEffect(() => {
    if (!activeField.custom) {
      return undefined;
    }

    let disposed = false;
    let objectUrl: string | null = null;
    const fieldId = activeField.id;

    void projectStore
      .getState()
      .readFieldImageAsset(activeField.custom)
      .then((blob) => {
        if (disposed || !blob) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setCustomFieldImage({ fieldId, url: objectUrl });
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setRendererError(
            error instanceof Error ? error.message : String(error),
          );
        }
      });

    return () => {
      disposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [activeField.custom, activeField.id]);
  const customFieldImageUrl =
    customFieldImage && customFieldImage.fieldId === activeField.id
      ? customFieldImage.url
      : null;
  const renderField = useMemo(
    () =>
      activeField.custom && customFieldImageUrl
        ? { ...activeField, image_src: customFieldImageUrl }
        : activeField,
    [activeField, customFieldImageUrl],
  );
  const activeFieldAspectRatio =
    activeField.geometry.length_meters / activeField.geometry.width_meters;

  const fieldRenderKey = `${renderField.id}:${renderField.image_src ?? renderField.kind}`;
  const rendererFieldRef = useRef(renderField);

  useEffect(() => {
    rendererFieldRef.current = renderField;
  }, [renderField]);

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
    [flushPanOffset],
  );

  const flushDragPreview = useCallback(() => {
    dragFrameRef.current = null;
    const drag = activeDragRef.current;
    setActiveDragState(drag);
    setDragPreview(drag ? new Map([[drag.index, drag.current]]) : emptyPreview);
  }, []);

  const setActiveDrag = useCallback(
    (
      nextDrag: ActiveDrag | null,
      sync: "immediate" | "frame" = "immediate",
    ) => {
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
      setDragPreview(
        nextDrag ? new Map([[nextDrag.index, nextDrag.current]]) : emptyPreview,
      );
    },
    [flushDragPreview],
  );

  const flushRotationPreview = useCallback(() => {
    rotationFrameRef.current = null;
    setActiveRotationDragState(activeRotationDragRef.current);
  }, []);

  const setActiveRotationDrag = useCallback(
    (
      nextDrag: ActiveRotationDrag | null,
      sync: "immediate" | "frame" = "immediate",
    ) => {
      activeRotationDragRef.current = nextDrag;

      if (sync === "frame") {
        if (rotationFrameRef.current === null) {
          rotationFrameRef.current =
            window.requestAnimationFrame(flushRotationPreview);
        }
        return;
      }

      if (rotationFrameRef.current !== null) {
        window.cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
      }
      setActiveRotationDragState(nextDrag);
    },
    [flushRotationPreview],
  );

  const setActiveCurveDraft = useCallback(
    (nextDraft: ActiveCurveDraft | null) => {
      activeCurveDraftRef.current = nextDraft;
      setActiveCurveDraftState(nextDraft);
    },
    [],
  );

  useEffect(
    () => () => {
      for (const frame of [panFrameRef, dragFrameRef, rotationFrameRef]) {
        if (frame.current !== null) {
          window.cancelAnimationFrame(frame.current);
        }
      }
    },
    [],
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
        Math.floor(rect.height) || Math.round(width / activeFieldAspectRatio),
      );
      setStageSize({ width, height });
    };

    updateSize();

    if (!("ResizeObserver" in window)) {
      (window as Window).addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, [activeFieldAspectRatio]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    let renderer: PixiPathRenderer | null = null;
    let debugApi: ReturnType<PixiPathRenderer["getDebugApi"]> | null = null;
    const rendererField = rendererFieldRef.current;

    void PixiPathRenderer.create(fallbackStageSize, rendererField)
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
          setRendererError(
            error instanceof Error ? error.message : String(error),
          );
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
  }, [fieldRenderKey]);

  const baseViewport = useMemo(
    () => createFieldViewport(stageSize, 24, activeField.geometry),
    [activeField.geometry, stageSize],
  );
  const viewport = useMemo(
    () => ({
      ...baseViewport,
      x: baseViewport.x + panOffset.x,
      y: baseViewport.y + panOffset.y,
      width: baseViewport.width * viewScale,
      height: baseViewport.height * viewScale,
      scale: baseViewport.scale * viewScale,
      field: baseViewport.field,
    }),
    [baseViewport, panOffset, viewScale],
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
    isPanning ||
    activeDrag !== null ||
    activeRotationDrag !== null ||
    activeCurveDraft !== null ||
    curveTool !== null;
  const rotationPreview: RotationOverrides = useMemo(
    () =>
      activeRotationDrag
        ? new Map([
            [activeRotationDrag.index, activeRotationDrag.currentRadians],
          ])
        : emptyRotationPreview,
    [activeRotationDrag],
  );
  const selectedPulseValue =
    selectedElementIndex === null
      ? 0
      : canvasInteractionActive
        ? 0.72
        : selectedPulse;
  const curvePreview: CurveAuthoringPreview | null = useMemo(
    () =>
      activeCurveDraft
        ? {
            rawPoints: activeCurveDraft.samples,
            targetPoints: activeCurveDraft.targetPoints,
            insertionIndex: activeCurveDraft.insertionIndex,
          }
        : null,
    [activeCurveDraft],
  );
  const overlayPaths = useMemo<PixiPathOverlay[]>(() => {
    if (!showGhostPaths || !workspace?.active_path_group_id) {
      return [];
    }

    const group = workspace.path_groups.find(
      (candidate) => candidate.group_id === workspace.active_path_group_id,
    );
    if (!group) {
      return [];
    }

    return group.path_ids.flatMap((pathId) => {
      if (pathId === workspace.active_path_id) {
        return [];
      }
      const path = workspace.paths.find(
        (candidate) => candidate.path_id === pathId,
      );
      return path
        ? [
            {
              pathId: path.path_id,
              displayName: path.display_name,
              path: path.path,
            },
          ]
        : [];
    });
  }, [showGhostPaths, workspace]);
  const hoveredOverlayPath =
    overlayPaths.find((overlay) => overlay.pathId === hoveredOverlayPathId) ??
    null;

  useCanvasInteractionActivity({
    containerRef,
    semanticActive: canvasInteractionActive,
    onChange: onInteractionStateChange,
  });

  useEffect(() => {
    if (selectedElementIndex === null || canvasInteractionActive) {
      return;
    }

    const startedAt = window.performance.now();
    const timer = window.setInterval(() => {
      const elapsed = window.performance.now() - startedAt;
      setSelectedPulse(
        (Math.sin((elapsed / selectionPulsePeriodMs) * Math.PI * 2) + 1) / 2,
      );
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

      const key = event.key.toLowerCase();
      if (event.key === " " || key === "k") {
        event.preventDefault();
        toggleSimulationPlaying();
        return;
      }

      if (event.key === "Home" || key === "j") {
        event.preventDefault();
        resetSimulation();
        return;
      }

      if (event.key === "End" || key === "l") {
        event.preventDefault();
        finishSimulation();
      }
    };

    window.addEventListener("keydown", handleSimulationShortcut);
    return () =>
      window.removeEventListener("keydown", handleSimulationShortcut);
  }, [finishSimulation, resetSimulation, toggleSimulationPlaying]);

  const renderInput = useMemo<PixiRenderInput>(
    () => ({
      stageSize,
      viewport,
      field: renderField,
      project,
      overlayPaths,
      hoveredOverlayPathId,
      selectedElementIndex,
      selectedRangedConstraint,
      positionPreview: dragPreview,
      rotationPreview,
      selectedPulse: selectedPulseValue,
      simulationResult,
      simulationTimeS: simulationTime,
      simulationPlaying,
      config: project?.config ?? null,
      curvePreview,
    }),
    [
      renderField,
      curvePreview,
      dragPreview,
      project,
      overlayPaths,
      hoveredOverlayPathId,
      rotationPreview,
      selectedElementIndex,
      selectedPulseValue,
      selectedRangedConstraint,
      simulationPlaying,
      simulationResult,
      simulationTime,
      stageSize,
      viewport,
    ],
  );

  useEffect(() => {
    latestRenderInputRef.current = renderInput;
    rendererRef.current?.update(renderInput);
  }, [renderInput]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isInteractiveShortcutTarget(event.target)) {
      return;
    }

    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && !event.altKey) {
      if (event.key === "0") {
        event.preventDefault();
        resetView();
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomFromCenter(1.25);
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        zoomFromCenter(1 / 1.25);
      }
      return;
    }

    if (event.altKey) {
      return;
    }

    // Playback transport (Space/K, J/Home, L/End) is handled by the global
    // window listener, so it does not need to be duplicated on the canvas.

    if (event.key === "Escape" && curveTool) {
      event.preventDefault();
      setActiveCurveDraft(null);
      onCurveToolCancel?.();
      return;
    }

    if (event.key === "Escape" && contextMenu) {
      event.preventDefault();
      setContextMenu(null);
      return;
    }

    if (event.key === "Escape" && activeTool !== "select") {
      event.preventDefault();
      setPlacementPreview(null);
      onToolChange?.("select");
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
        y: (stagePoint.y - viewport.y) / viewport.scale,
      };
      const nextViewportScale = baseViewport.scale * nextScale;
      const nextViewportX = stagePoint.x - scenePoint.x * nextViewportScale;
      const nextViewportY = stagePoint.y - scenePoint.y * nextViewportScale;

      setViewScale(nextScale);
      setPanOffset(
        clampPanOffset(
          {
            x: nextViewportX - baseViewport.x,
            y: nextViewportY - baseViewport.y,
          },
          baseViewport,
          stageSize,
          nextScale,
        ),
      );
    },
    [baseViewport, setPanOffset, stageSize, viewScale, viewport],
  );

  const zoomFromCenter = useCallback(
    (factor: number) =>
      zoomAtStagePoint(
        { x: stageSize.width / 2, y: stageSize.height / 2 },
        factor,
      ),
    [stageSize.height, stageSize.width, zoomAtStagePoint],
  );

  const resetView = useCallback(() => {
    setViewScale(1);
    setPanOffset({ x: 0, y: 0 });
  }, [setPanOffset]);

  useEffect(() => {
    const handleViewShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        isInteractiveShortcutTarget(event.target)
      ) {
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        resetView();
      } else if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomFromCenter(1.25);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomFromCenter(1 / 1.25);
      }
    };

    window.addEventListener("keydown", handleViewShortcut);
    return () => window.removeEventListener("keydown", handleViewShortcut);
  }, [resetView, zoomFromCenter]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (isCanvasChromeEventTarget(event.target)) {
      return;
    }

    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const factor = direction > 0 ? zoomStepFactor : 1 / zoomStepFactor;
    zoomAtStagePoint(stagePointFromEvent(event), factor);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isCanvasChromeEventTarget(event.target)) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (!project) {
      return;
    }

    setContextMenu(null);
    containerRef.current?.focus();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = stagePointFromEvent(event);

    if (curveTool) {
      const sample = stageToModelPoint(pointer, viewport);
      setActiveCurveDraft({
        pointerId: event.pointerId,
        insertionIndex: curveTool.insertionIndex,
        samples: [sample],
        targetPoints: curveTargetPointsForSamples(
          project,
          curveTool.insertionIndex,
          [sample],
        ),
      });
      return;
    }

    if (isPlacementTool(activeTool)) {
      const placement = placementForPointer(
        project,
        activeTool,
        pointer,
        viewport,
      );
      setPlacementPreview({ point: pointer, placement });
      if (placement) {
        onPlaceElement?.(placement);
      }
      return;
    }

    const rotationHit = hitTestRotationHandle(
      project,
      selectedElementIndex,
      viewport,
      dragPreview,
      rotationPreview,
      pointer,
    );
    if (rotationHit !== null) {
      const element = project.path.path_elements[rotationHit];
      const linkedTarget = workspace
        ? linkedTargetForPathElement(workspace, element)
        : null;
      const linkedTargetId =
        element &&
        linkedTarget &&
        linkedTargetControlsElementRotation(element, linkedTarget)
          ? linkedTarget.target_id
          : null;
      if (linkedTargetId && linkedTarget?.locked) {
        return;
      }
      const startRadians =
        getElementHeadingRadians(project.path.path_elements, rotationHit) ?? 0;
      setActiveRotationDrag({
        index: rotationHit,
        startRadians,
        currentRadians: startRadians,
        linkedTargetId,
      });
      return;
    }

    const nodeHit = hitTestPathElement(
      project,
      viewport,
      dragPreview,
      pointer,
      selectedElementIndex,
    );
    if (nodeHit !== null) {
      selectionStore.getState().selectElement(nodeHit, project);
      const element = project.path.path_elements[nodeHit];
      const start = getElementPosition(project.path.path_elements, nodeHit);
      if (!element || !start || !isDragEnabled(element)) {
        return;
      }
      const linkedTarget = workspace
        ? linkedTargetForPathElement(workspace, element)
        : null;
      if (linkedTarget?.locked) {
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
        currentRatio: startRatio,
        linkedTargetId: linkedTarget?.target_id ?? null,
      });
      return;
    }

    const overlayHit = hitTestOverlayPath(overlayPaths, viewport, pointer);
    if (overlayHit) {
      projectStore.getState().setActivePath(overlayHit.pathId);
      selectionStore.getState().clearSelection();
      setHoveredOverlayPathId(null);
      setHoveredOverlayPoint(null);
      return;
    }

    selectionStore.getState().clearSelection();
    activePanDragRef.current = {
      pointerId: event.pointerId,
      startPointer: pointer,
      startPanOffset: panOffsetRef.current,
    };
    setIsPanning(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isCanvasChromeEventTarget(event.target)) {
      return;
    }

    const pointer = stagePointFromEvent(event);
    if (
      project &&
      isPlacementTool(activeTool) &&
      !activeDragRef.current &&
      !activeRotationDragRef.current
    ) {
      setPlacementPreview({
        point: pointer,
        placement: placementForPointer(project, activeTool, pointer, viewport),
      });
      setHoveredOverlayPathId(null);
      setHoveredOverlayPoint(null);
      return;
    }

    const curveDraft = activeCurveDraftRef.current;
    if (curveDraft && project && curveDraft.pointerId === event.pointerId) {
      event.preventDefault();
      const sample = stageToModelPoint(pointer, viewport);
      const samples = appendCurveSample(curveDraft.samples, sample);
      setActiveCurveDraft({
        ...curveDraft,
        samples,
        targetPoints: curveTargetPointsForSamples(
          project,
          curveDraft.insertionIndex,
          samples,
        ),
      });
      return;
    }

    const drag = activeDragRef.current;
    if (drag && project) {
      event.preventDefault();
      const projected = projectDragStagePoint(
        project,
        viewport,
        drag.index,
        pointer,
      );
      setActiveDrag(
        {
          ...drag,
          current: projected.position,
          currentRatio: projected.ratio,
        },
        "frame",
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
        pointer,
      );
      if (nextRadians === null) {
        return;
      }
      setActiveRotationDrag(
        {
          ...rotationDrag,
          currentRadians: nextRadians,
        },
        "frame",
      );
      return;
    }

    const panDrag = activePanDragRef.current;
    if (!panDrag || panDrag.pointerId !== event.pointerId) {
      const overlayHit =
        project && !canvasInteractionActive
          ? hitTestOverlayPath(overlayPaths, viewport, pointer)
          : null;
      setHoveredOverlayPathId(overlayHit?.pathId ?? null);
      setHoveredOverlayPoint(overlayHit ? pointer : null);
      return;
    }

    event.preventDefault();
    setPanOffset(
      clampPanOffset(
        {
          x: panDrag.startPanOffset.x + pointer.x - panDrag.startPointer.x,
          y: panDrag.startPanOffset.y + pointer.y - panDrag.startPointer.y,
        },
        baseViewport,
        stageSize,
        viewScale,
      ),
      "frame",
    );
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const pointer = stagePointFromEvent(event);
    if (activeCurveDraftRef.current) {
      finishActiveCurve();
      return;
    }

    finishActiveDrag();
    finishActiveRotation(pointer);
    finishPanDrag();
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (activeCurveDraftRef.current) {
      setActiveCurveDraft(null);
      onCurveToolCancel?.();
      return;
    }

    finishActiveDrag();
    finishActiveRotation(stagePointFromEvent(event));
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
      const segment = getNeighborAnchorPositions(
        project.path.path_elements,
        drag.index,
      );
      if (segment) {
        nextRatio = projectPointToSegmentRatio(
          nextPosition,
          segment.previous,
          segment.next,
        );
        nextPosition = interpolateSegmentPosition(
          segment.previous,
          segment.next,
          nextRatio,
        );
      }
    }

    setActiveDrag(null);

    if (drag.startRatio !== null && nextRatio !== null) {
      if (Math.abs(drag.startRatio - nextRatio) >= 0.001) {
        projectStore
          .getState()
          .applyCommand(
            createSetElementRatioCommand(
              drag.index,
              drag.startRatio,
              nextRatio,
            ),
          );
        selectionStore
          .getState()
          .selectElement(drag.index, projectStore.getState().project);
      }
      return;
    }

    if (!pointsAlmostEqual(drag.start, nextPosition)) {
      if (drag.linkedTargetId) {
        const target = projectStore
          .getState()
          .workspace?.linked_targets.find(
            (candidate) => candidate.target_id === drag.linkedTargetId,
          );
        if (target && !target.locked) {
          projectStore.getState().updateLinkedTarget(drag.linkedTargetId, {
            x_meters: nextPosition.x_meters,
            y_meters: nextPosition.y_meters,
          });
          selectionStore
            .getState()
            .selectElement(drag.index, projectStore.getState().project);
        }
        return;
      }
      projectStore
        .getState()
        .applyCommand(
          createMoveElementCommand(drag.index, drag.start, nextPosition),
        );
      selectionStore
        .getState()
        .selectElement(drag.index, projectStore.getState().project);
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

    if (
      Math.abs(angularDelta(rotationDrag.startRadians, nextRadians)) >= 0.001
    ) {
      if (rotationDrag.linkedTargetId) {
        const target = projectStore
          .getState()
          .workspace?.linked_targets.find(
            (candidate) => candidate.target_id === rotationDrag.linkedTargetId,
          );
        if (target && !target.locked) {
          projectStore
            .getState()
            .updateLinkedTarget(rotationDrag.linkedTargetId, {
              rotation_radians: nextRadians,
            });
          selectionStore
            .getState()
            .selectElement(rotationDrag.index, projectStore.getState().project);
        }
        return;
      }
      projectStore
        .getState()
        .applyCommand(
          createSetElementRotationCommand(
            rotationDrag.index,
            rotationDrag.startRadians,
            nextRadians,
          ),
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

  const finishActiveCurve = () => {
    const draft = activeCurveDraftRef.current;
    if (!draft || !project) {
      setActiveCurveDraft(null);
      return;
    }

    const targets = curveTargetsForSamples(
      project,
      draft.insertionIndex,
      draft.samples,
    );
    setActiveCurveDraft(null);

    if (targets.length > 0) {
      onCurveToolCommit?.(draft.insertionIndex, targets);
    } else {
      onCurveToolCancel?.();
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (isCanvasChromeEventTarget(event.target)) {
      return;
    }
    event.preventDefault();
    if (!project) {
      return;
    }

    const pointer = stagePointFromEvent(event);
    const elementIndex = hitTestPathElement(
      project,
      viewport,
      dragPreview,
      pointer,
      selectedElementIndex,
    );
    setContextMenu({
      stagePoint: pointer,
      fieldPoint: stageToModelPoint(pointer, viewport),
      elementIndex,
    });
  };

  const createLinkedTranslationAtContext = () => {
    if (!workspace || !contextMenu) {
      return;
    }

    projectStore.getState().createLinkedTarget({
      display_name: nextLinkedTargetName(workspace, "translation"),
      kind: "translation",
      x_meters: contextMenu.fieldPoint.x_meters,
      y_meters: contextMenu.fieldPoint.y_meters,
      rotation_radians: null,
    });
    setContextMenu(null);
  };

  const createLinkedTargetFromContextElement = (kind: LinkedTargetKind) => {
    if (
      !workspace ||
      !project ||
      !contextMenu ||
      contextMenu.elementIndex === null
    ) {
      return;
    }

    const elementIndex = contextMenu.elementIndex;
    const position = getElementPosition(
      project.path.path_elements,
      elementIndex,
    );
    if (!position) {
      return;
    }

    projectStore.getState().createLinkedTarget({
      display_name: nextLinkedTargetName(workspace, kind),
      kind,
      x_meters: position.x_meters,
      y_meters: position.y_meters,
      rotation_radians:
        kind === "waypoint"
          ? (getElementHeadingRadians(
              project.path.path_elements,
              elementIndex,
            ) ?? 0)
          : null,
      link: {
        pathId: project.project_id,
        elementIndex,
      },
    });
    selectionStore
      .getState()
      .selectElement(elementIndex, projectStore.getState().project);
    setContextMenu(null);
  };

  const linkContextElementToTarget = (targetId: string) => {
    if (!project || !contextMenu || contextMenu.elementIndex === null) {
      return;
    }

    projectStore
      .getState()
      .linkPathElementToTarget(
        project.project_id,
        contextMenu.elementIndex,
        targetId,
      );
    selectionStore
      .getState()
      .selectElement(contextMenu.elementIndex, projectStore.getState().project);
    setContextMenu(null);
  };

  const unlinkContextElement = () => {
    if (!project || !contextMenu || contextMenu.elementIndex === null) {
      return;
    }

    projectStore
      .getState()
      .unlinkPathElement(project.project_id, contextMenu.elementIndex);
    selectionStore
      .getState()
      .selectElement(contextMenu.elementIndex, projectStore.getState().project);
    setContextMenu(null);
  };

  const contextElement =
    project && contextMenu?.elementIndex !== null && contextMenu
      ? (project.path.path_elements[contextMenu.elementIndex] ?? null)
      : null;
  const contextCompatibleTargets =
    workspace && contextElement
      ? workspace.linked_targets.filter((target) =>
          isElementCompatibleWithLinkedTarget(contextElement, target),
        )
      : [];

  return (
    <div
      ref={containerRef}
      className="path-stage"
      data-testid="path-stage"
      data-tour="path-canvas"
      aria-label="Path canvas"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={canvasHostRef}
        className={[
          "path-stage__canvas",
          isPanning ? "is-panning" : "",
          curveTool ? "is-curve-tool" : "",
          isPlacementTool(activeTool) ? "is-placement-tool" : "",
          hoveredOverlayPath ? "has-ghost-hover" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="path-stage-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => {
          if (!activeDragRef.current && !activeCurveDraftRef.current) {
            setPlacementPreview(null);
          }
        }}
        onContextMenu={handleContextMenu}
        onWheel={handleWheel}
      >
        <CanvasToolRail
          activeTool={activeTool}
          project={project}
          onToolChange={(tool) => {
            setPlacementPreview(null);
            onToolChange?.(tool);
          }}
        />
        <CanvasViewControls
          scale={viewScale}
          showGhostPaths={showGhostPaths}
          onFit={resetView}
          onToggleGhostPaths={() => setShowGhostPaths((current) => !current)}
          onZoomIn={() => zoomFromCenter(1.25)}
          onZoomOut={() => zoomFromCenter(1 / 1.25)}
        />
        {rendererError ? (
          <div className="path-stage__renderer-error">
            Canvas renderer failed: {rendererError}
          </div>
        ) : null}
        {placementPreview && isPlacementTool(activeTool) ? (
          <div
            className={[
              "path-stage__placement-preview",
              placementPreview.placement ? "is-valid" : "is-invalid",
            ].join(" ")}
            style={{
              left: placementPreview.point.x,
              top: placementPreview.point.y,
            }}
            aria-hidden="true"
          >
            <ElementIcon
              type={placementToolElementType(activeTool)}
              size={18}
            />
          </div>
        ) : null}
        {hoveredOverlayPath && hoveredOverlayPoint ? (
          <div
            className="path-stage__ghost-label"
            data-testid="path-stage-ghost-label"
            style={{
              left: hoveredOverlayPoint.x,
              top: hoveredOverlayPoint.y,
            }}
          >
            {hoveredOverlayPath.displayName}
          </div>
        ) : null}
        {contextMenu ? (
          <CanvasContextMenu
            point={contextMenu.stagePoint}
            element={contextElement}
            compatibleTargets={contextCompatibleTargets}
            linkedTargetId={getPathElementLinkedTargetId(
              contextElement ?? undefined,
            )}
            onCreateTranslationAtField={createLinkedTranslationAtContext}
            onCreateTranslationFromElement={() =>
              createLinkedTargetFromContextElement("translation")
            }
            onCreateWaypointFromElement={() =>
              createLinkedTargetFromContextElement("waypoint")
            }
            onLinkTarget={linkContextElementToTarget}
            onUnlink={unlinkContextElement}
          />
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

function CanvasToolRail({
  activeTool,
  project,
  onToolChange,
}: {
  activeTool: EditorTool;
  project: ProjectDocument | null;
  onToolChange(tool: EditorTool): void;
}) {
  const anchorCount =
    project?.path.path_elements.filter(isAnchorElement).length ?? 0;
  const tools: Array<{
    tool: EditorTool;
    label: string;
    shortcut: string;
    disabled?: boolean;
  }> = [
    { tool: "select", label: "Select", shortcut: "V" },
    { tool: "waypoint", label: "Waypoint", shortcut: "1" },
    { tool: "translation", label: "Translation", shortcut: "2" },
    {
      tool: "rotation",
      label: "Rotation",
      shortcut: "3",
      disabled: anchorCount < 2,
    },
    {
      tool: "event",
      label: "Event",
      shortcut: "4",
      disabled: anchorCount < 2,
    },
    { tool: "curve", label: "Curve", shortcut: "C" },
  ];

  return (
    <aside
      className="canvas-tool-rail"
      data-tour="tool-rail"
      aria-label="Canvas tools"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {tools.map(({ tool, label, shortcut, disabled }) => (
        <button
          key={tool}
          type="button"
          className={activeTool === tool ? "is-active" : ""}
          aria-label={`${label} tool`}
          aria-keyshortcuts={shortcut}
          aria-pressed={activeTool === tool}
          disabled={!project || disabled}
          title={
            disabled
              ? `${label} needs two anchors`
              : `${label} tool (${shortcut})`
          }
          onClick={() => onToolChange(tool)}
        >
          {tool === "select" ? (
            <MousePointer2 aria-hidden="true" size={18} />
          ) : tool === "curve" ? (
            <CurveIcon size={18} />
          ) : (
            <ElementIcon type={placementToolElementType(tool)} size={18} />
          )}
          <kbd>{shortcut}</kbd>
        </button>
      ))}
    </aside>
  );
}

function CanvasViewControls({
  scale,
  showGhostPaths,
  onFit,
  onToggleGhostPaths,
  onZoomIn,
  onZoomOut,
}: {
  scale: number;
  showGhostPaths: boolean;
  onFit(): void;
  onToggleGhostPaths(): void;
  onZoomIn(): void;
  onZoomOut(): void;
}) {
  return (
    <div
      className="canvas-view-controls"
      aria-label="Canvas view controls"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <IconButton
        className={showGhostPaths ? "is-active" : ""}
        aria-label={
          showGhostPaths ? "Hide collection paths" : "Show collection paths"
        }
        aria-pressed={showGhostPaths}
        title={
          showGhostPaths
            ? "Hide the collection's other paths (shown as faint overlays for reference)"
            : "Show the collection's other paths as faint overlays for reference"
        }
        onClick={onToggleGhostPaths}
      >
        {showGhostPaths ? (
          <Eye aria-hidden="true" size={16} />
        ) : (
          <EyeOff aria-hidden="true" size={16} />
        )}
      </IconButton>
      <IconButton aria-label="Zoom out" title="Zoom out" onClick={onZoomOut}>
        <ZoomOut aria-hidden="true" size={16} />
      </IconButton>
      <button
        type="button"
        className="canvas-view-controls__scale"
        aria-label="Fit view"
        title="Fit view (Ctrl/Command+0)"
        onClick={onFit}
      >
        <Focus aria-hidden="true" size={15} />
        <span>{Math.round(scale * 100)}%</span>
      </button>
      <IconButton aria-label="Zoom in" title="Zoom in" onClick={onZoomIn}>
        <ZoomIn aria-hidden="true" size={16} />
      </IconButton>
    </div>
  );
}

function isPlacementTool(
  tool: EditorTool,
): tool is "waypoint" | "translation" | "rotation" | "event" {
  return (
    tool === "waypoint" ||
    tool === "translation" ||
    tool === "rotation" ||
    tool === "event"
  );
}

function placementToolElementType(
  tool: EditorTool,
): "waypoint" | "translation" | "rotation" | "event_trigger" {
  if (tool === "event") {
    return "event_trigger";
  }
  if (tool === "rotation" || tool === "translation" || tool === "waypoint") {
    return tool;
  }
  return "waypoint";
}

function placementForPointer(
  project: ProjectDocument,
  tool: "waypoint" | "translation" | "rotation" | "event",
  pointer: StagePoint,
  viewport: FieldViewport,
): CanvasElementPlacement | null {
  const position = clampModelPoint(
    stageToModelPoint(pointer, viewport),
    viewport.field,
  );
  const elements = project.path.path_elements;

  if (tool === "waypoint" || tool === "translation") {
    const selectedIndex = selectionStore.getState().selectedElementIndex;
    return {
      type: tool,
      position,
      insertionIndex: Math.min(
        elements.length,
        Math.max(
          0,
          selectedIndex === null ? elements.length : selectedIndex + 1,
        ),
      ),
    };
  }

  const anchors = elements.flatMap((element, index) => {
    if (!isAnchorElement(element)) {
      return [];
    }
    const anchorPosition = getElementPosition(elements, index);
    return anchorPosition ? [{ index, position: anchorPosition }] : [];
  });
  if (anchors.length < 2) {
    return null;
  }

  let nearest:
    | {
        insertionIndex: number;
        position: PointMeters;
        ratio: number;
        distance: number;
      }
    | undefined;
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index];
    const end = anchors[index + 1];
    const ratio = projectPointToSegmentRatio(
      position,
      start.position,
      end.position,
    );
    const projected = interpolateSegmentPosition(
      start.position,
      end.position,
      ratio,
    );
    const distance = modelPointDistance(position, projected);
    if (!nearest || distance < nearest.distance) {
      nearest = {
        insertionIndex: end.index,
        position: projected,
        ratio,
        distance,
      };
    }
  }

  return nearest
    ? {
        type: placementToolElementType(tool),
        insertionIndex: nearest.insertionIndex,
        position: nearest.position,
        ratio: nearest.ratio,
      }
    : null;
}

function SimulationTransport({
  result,
  currentTimeS,
  playing,
  onReset,
  onTogglePlaying,
  onFinish,
  onSeek,
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
    "--transport-progress": `${progress}%`,
  } as CSSProperties;

  return (
    <div
      className="simulation-transport"
      data-testid="simulation-transport"
      data-tour="simulation-transport"
    >
      <div className="transport-primary-controls">
        <button
          type="button"
          className="transport-step-button"
          aria-label="Reset simulation"
          aria-keyshortcuts="J Home"
          title="Restart simulation (J or Home)"
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
          title={
            playing ? "Pause simulation (Space)" : "Play simulation (Space)"
          }
          onClick={onTogglePlaying}
          disabled={disabled}
        >
          <span
            className={playing ? "transport-icon pause" : "transport-icon play"}
          />
        </button>
        <button
          type="button"
          className="transport-step-button"
          aria-label="Fast forward simulation"
          aria-keyshortcuts="L End"
          title="Jump to end (L or End)"
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

function CanvasContextMenu({
  compatibleTargets,
  element,
  linkedTargetId,
  onCreateTranslationAtField,
  onCreateTranslationFromElement,
  onCreateWaypointFromElement,
  onLinkTarget,
  onUnlink,
  point,
}: {
  compatibleTargets: readonly LinkedTarget[];
  element: PathElement | null;
  linkedTargetId: string | null;
  onCreateTranslationAtField(): void;
  onCreateTranslationFromElement(): void;
  onCreateWaypointFromElement(): void;
  onLinkTarget(targetId: string): void;
  onUnlink(): void;
  point: StagePoint;
}) {
  const canCreateWaypoint = element && isWaypoint(element);
  const canCreateFromElement =
    element && (isWaypoint(element) || isTranslationTarget(element));

  return (
    <div
      className="path-stage__context-menu"
      role="menu"
      style={{ left: point.x, top: point.y }}
    >
      {canCreateFromElement ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={onCreateTranslationFromElement}
          >
            Create Linked Translation
          </button>
          {canCreateWaypoint ? (
            <button
              type="button"
              role="menuitem"
              onClick={onCreateWaypointFromElement}
            >
              Create Linked Waypoint
            </button>
          ) : null}
          {linkedTargetId ? (
            <button type="button" role="menuitem" onClick={onUnlink}>
              Unlink Element
            </button>
          ) : null}
          {compatibleTargets.length > 0 ? (
            <div className="path-stage__context-menu-group">
              <span>Link to</span>
              {compatibleTargets.map((target) => (
                <button
                  key={target.target_id}
                  type="button"
                  role="menuitem"
                  disabled={target.target_id === linkedTargetId}
                  onClick={() => onLinkTarget(target.target_id)}
                >
                  {target.display_name}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={onCreateTranslationAtField}
        >
          Create Linked Translation Here
        </button>
      )}
    </div>
  );
}

function curveTargetPointsForSamples(
  project: NonNullable<ReturnType<typeof projectStore.getState>["project"]>,
  insertionIndex: number,
  samples: readonly PointMeters[],
): PointMeters[] {
  return curveTargetsForSamples(project, insertionIndex, samples).map(
    (target) => ({
      x_meters: target.x_meters,
      y_meters: target.y_meters,
    }),
  );
}

function curveTargetsForSamples(
  project: NonNullable<ReturnType<typeof projectStore.getState>["project"]>,
  insertionIndex: number,
  samples: readonly PointMeters[],
): TranslationTarget[] {
  const { previousAnchor, nextAnchor } = curveEndpointContext(
    project.path.path_elements,
    insertionIndex,
  );

  return createCurveTranslationTargets(samples, {
    previousAnchor,
    nextAnchor,
    toleranceMeters: curveFitToleranceMeters,
    minSpacingMeters: curveMinTargetSpacingMeters,
    maxGeneratedTargets: curveMaxGeneratedTargets,
    endpointSnapToleranceMeters: curveEndpointSnapToleranceMeters,
    handoffRadiusMeters:
      getDefaultOptionalConfigValue(
        project.config,
        "intermediate_handoff_radius_meters",
      ) ?? curveDefaultHandoffRadiusMeters,
  });
}

function curveEndpointContext(
  elements: readonly PathElement[],
  insertionIndex: number,
): { previousAnchor: PointMeters | null; nextAnchor: PointMeters | null } {
  return {
    previousAnchor: findAnchorPosition(elements, insertionIndex - 1, -1),
    nextAnchor: findAnchorPosition(elements, insertionIndex, 1),
  };
}

function findAnchorPosition(
  elements: readonly PathElement[],
  startIndex: number,
  direction: -1 | 1,
): PointMeters | null {
  for (
    let index = startIndex;
    index >= 0 && index < elements.length;
    index += direction
  ) {
    if (isAnchorElement(elements[index])) {
      return getElementPosition(elements, index);
    }
  }

  return null;
}

function appendCurveSample(
  samples: readonly PointMeters[],
  sample: PointMeters,
): PointMeters[] {
  const previous = samples.at(-1);
  if (
    previous &&
    modelPointDistance(previous, sample) < curveSampleSpacingMeters
  ) {
    return [...samples.slice(0, -1), sample];
  }

  return [...samples, sample];
}

function modelPointDistance(first: PointMeters, second: PointMeters): number {
  return Math.hypot(
    first.x_meters - second.x_meters,
    first.y_meters - second.y_meters,
  );
}

function hitTestRotationHandle(
  project: NonNullable<ReturnType<typeof projectStore.getState>["project"]>,
  selectedElementIndex: number | null,
  viewport: FieldViewport,
  positionPreview: PositionOverrides,
  rotationPreview: RotationOverrides,
  pointer: StagePoint,
): number | null {
  if (selectedElementIndex === null) {
    return null;
  }

  const elements = project.path.path_elements;
  const element = elements[selectedElementIndex];
  if (!element || (!isRotationTarget(element) && !isWaypoint(element))) {
    return null;
  }

  const position = getElementPosition(
    elements,
    selectedElementIndex,
    positionPreview,
  );
  const rotationRadians = getElementHeadingRadians(
    elements,
    selectedElementIndex,
    rotationPreview,
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
  selectedElementIndex: number | null,
): number | null {
  const elements = project.path.path_elements;
  const renderedNodes = elements.flatMap((element, index) => {
    const position = getElementPosition(elements, index, positionPreview);
    return position
      ? [{ element, index, point: modelToStagePoint(position, viewport) }]
      : [];
  });
  const orderedNodes =
    selectedElementIndex === null
      ? renderedNodes
      : [
          ...renderedNodes.filter(
            ({ index }) => index !== selectedElementIndex,
          ),
          ...renderedNodes.filter(
            ({ index }) => index === selectedElementIndex,
          ),
        ];
  const robotSizeMeters = robotSizeFromConfig(project.config);

  for (
    let nodeIndex = orderedNodes.length - 1;
    nodeIndex >= 0;
    nodeIndex -= 1
  ) {
    const { element, index, point } = orderedNodes[nodeIndex];
    if (
      hitTestElementShape(
        element,
        point,
        pointer,
        getElementHeadingRadians(elements, index),
        viewport,
        robotSizeMeters,
      )
    ) {
      return index;
    }
  }

  return null;
}

function hitTestOverlayPath(
  overlays: readonly PixiPathOverlay[],
  viewport: FieldViewport,
  pointer: StagePoint,
): PixiPathOverlay | null {
  for (
    let overlayIndex = overlays.length - 1;
    overlayIndex >= 0;
    overlayIndex -= 1
  ) {
    const overlay = overlays[overlayIndex];
    const points = getRenderableElementPositions(
      overlay.path.path_elements,
    ).map(({ position }) => modelToStagePoint(position, viewport));

    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      const previous = points[pointIndex - 1];
      const next = points[pointIndex];
      if (
        previous &&
        next &&
        pointToSegmentDistance(pointer, previous, next) <= overlayHitRadiusPx
      ) {
        return overlay;
      }
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
  robotSizeMeters: ReturnType<typeof robotSizeFromConfig>,
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
    const halfLength =
      Math.max(32, eventTriggerLengthMetersFallback * viewport.scale) / 2;
    return Math.abs(local.y) <= 18 && Math.abs(local.x) <= halfLength + 12;
  }

  return false;
}

function projectDragStagePoint(
  project: NonNullable<ReturnType<typeof projectStore.getState>["project"]>,
  viewport: FieldViewport,
  index: number,
  stagePoint: StagePoint,
): { position: PointMeters; ratio: number | null; stagePoint: StagePoint } {
  let position = stageToModelPoint(stagePoint, viewport);
  let ratio: number | null = null;
  const element = project.path.path_elements[index];

  if (element && (isRotationTarget(element) || isEventTrigger(element))) {
    ratio = element.t_ratio;
    const segment = getNeighborAnchorPositions(
      project.path.path_elements,
      index,
    );
    if (segment) {
      ratio = projectPointToSegmentRatio(
        position,
        segment.previous,
        segment.next,
      );
      position = interpolateSegmentPosition(
        segment.previous,
        segment.next,
        ratio,
      );
    }
  }

  return {
    position,
    ratio,
    stagePoint: modelToStagePoint(position, viewport),
  };
}

function isDragEnabled(element: PathElement): boolean {
  return (
    isTranslationBearingElement(element) ||
    isRotationTarget(element) ||
    isEventTrigger(element)
  );
}

function stagePointFromEvent(
  event:
    | MouseEvent<HTMLDivElement>
    | PointerEvent<HTMLDivElement>
    | WheelEvent<HTMLDivElement>,
): StagePoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function isCanvasChromeEventTarget(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        ".simulation-transport, .canvas-tool-rail, .canvas-view-controls",
      ),
    )
  );
}

function rotationFromStagePoint(
  project: NonNullable<ReturnType<typeof projectStore.getState>["project"]>,
  index: number,
  viewport: FieldViewport,
  point: StagePoint,
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
  rotationRadians: number,
): StagePoint {
  const radius = Math.max(42, Math.min(64, viewport.scale * 0.36));
  return {
    x: center.x + Math.cos(rotationRadians) * radius,
    y: center.y - Math.sin(rotationRadians) * radius,
  };
}

function toLocalRobotPoint(
  center: StagePoint,
  point: StagePoint,
  headingRadians: number | null,
): StagePoint {
  const stageRadians = headingRadians === null ? 0 : -headingRadians;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(-stageRadians);
  const sin = Math.sin(-stageRadians);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
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

function pointToSegmentDistance(
  point: StagePoint,
  start: StagePoint,
  end: StagePoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-9) {
    return pointDistance(point, start);
  }

  const t = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq,
    0,
    1,
  );
  return pointDistance(point, {
    x: start.x + dx * t,
    y: start.y + dy * t,
  });
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
  scale: number,
): StagePoint {
  const scaledWidth = baseViewport.width * scale;
  const scaledHeight = baseViewport.height * scale;

  return {
    x: clampAxisPan(offset.x, baseViewport.x, scaledWidth, stageSize.width),
    y: clampAxisPan(offset.y, baseViewport.y, scaledHeight, stageSize.height),
  };
}

function clampAxisPan(
  offset: number,
  basePosition: number,
  scaledSize: number,
  stageSize: number,
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
const curveFitToleranceMeters = 0.18;
const curveMinTargetSpacingMeters = 0.35;
const curveEndpointSnapToleranceMeters = 0.22;
const curveSampleSpacingMeters = 0.035;
const curveDefaultHandoffRadiusMeters = 0.45;
const curveMaxGeneratedTargets = 18;
const overlayHitRadiusPx = 15;

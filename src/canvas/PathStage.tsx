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
  type PathModel,
  type TranslationTarget,
} from "../core/model/path";
import type { LinkedTarget, LinkedTargetKind } from "../core/io/projectSchema";
import type { Project, ProjectConfig } from "../core/model/project";
import { getDefaultOptionalConfigValue } from "../core/config/projectConfig";
import {
  resolveUserFieldDefinition,
  type ResolvedFieldDefinition,
} from "../core/field/fieldConfig";
import { createCurveTranslationTargets } from "../core/pathProfile/curveProfile";
import { simulatePathWithTrace, type SimResult } from "../core/sim";
import type { SimTraceResult } from "../core/sim/types";
import { activePathForProjectStore, projectStore } from "../state/projectStore";
import { useStoreSelector } from "../state/react";
import { selectionStore } from "../state/selectionStore";
import {
  getPathElementLinkedTargetId,
  isElementCompatibleWithLinkedTarget,
  linkedTargetControlsElementRotation,
} from "../core/linkedTargets";
import {
  CurveIcon,
  ElementIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "../ui/icons";
import { IconButton } from "../ui/controls";
import {
  readEditorUiPreferences,
  writeEditorUiPreferences,
  type EditorTool,
} from "../ui/app/editorCommands";
import {
  isInteractiveShortcutTarget,
  removeSelectedPathElement,
  removeSelectedRangedConstraint,
} from "../ui/keyboardShortcuts";
import { fieldAspectRatio } from "./constants";
import {
  anchorNodeExclusionRadiusPx,
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
  stagePointsDiffer,
  type CanvasSize,
  type FieldViewport,
  type PointMeters,
  type PositionOverrides,
  type RotationOverrides,
  type StagePoint,
} from "./geometry";
import { isTranslationBearingElement } from "./modelSync";
import {
  PixiPathRenderer,
  type PixiDebugWindow,
  type PixiPathOverlay,
  type PixiRenderInput,
} from "./pixi/PixiPathRenderer";
import { robotSizeFromConfig } from "./robotFootprint";
import { useCanvasInteractionActivity } from "./hooks/useCanvasInteractionActivity";
import type { CurveAuthoringPreview, CurveToolSession } from "./curveAuthoring";
import { readFieldBackgroundImage } from "../userData";

const fallbackStageSize: CanvasSize = {
  width: 960,
  height: Math.round(960 / fieldAspectRatio),
};

interface PathStageProps {
  field?: ResolvedFieldDefinition;
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
  pointerId: number;
  index: number;
  startPointer: StagePoint;
  moved: boolean;
  start: PointMeters;
  current: PointMeters;
  startRatio: number | null;
  currentRatio: number | null;
}

interface ActiveRotationDrag {
  pointerId: number;
  index: number;
  startPointer: StagePoint;
  moved: boolean;
  startRadians: number;
  currentRadians: number;
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
  field = resolveUserFieldDefinition(null, []),
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
  const [showGhostPaths, setShowGhostPaths] = useState(
    () => readEditorUiPreferences().showGhostPaths,
  );
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
  const durableProject = useStoreSelector(
    projectStore,
    (state) => state.project,
  );
  const activePathId = useStoreSelector(
    projectStore,
    (state) => state.activePathId,
  );
  const activePathGroupId = useStoreSelector(
    projectStore,
    (state) => state.activePathGroupId,
  );
  const activePath = useMemo(
    () =>
      durableProject?.paths.find((path) => path.path_id === activePathId) ??
      null,
    [activePathId, durableProject],
  );
  const selectedElementIndex = useStoreSelector(
    selectionStore,
    (state) => state.selectedElementIndex,
  );
  const selectedRangedConstraint = useStoreSelector(
    selectionStore,
    (state) => state.selectedRangedConstraint,
  );
  const activeField = field;
  useEffect(() => {
    if (!activeField.user_entry) {
      return undefined;
    }

    let disposed = false;
    let objectUrl: string | null = null;
    const fieldId = activeField.id;

    void readFieldBackgroundImage(activeField.user_entry.id)
      .then((bytes) => {
        if (disposed || !bytes) {
          return;
        }
        const blob = new Blob([bytes], {
          type: activeField.user_entry?.mime_type,
        });
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
  }, [activeField.id, activeField.user_entry]);
  const customFieldImageUrl =
    customFieldImage && customFieldImage.fieldId === activeField.id
      ? customFieldImage.url
      : null;
  const renderField = useMemo(
    () =>
      activeField.user_entry && customFieldImageUrl
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
    selectionStore.getState().reconcilePath(activePath?.path ?? null);
  }, [activePath]);

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
  const boundedPositionPreview = useMemo<PositionOverrides>(() => {
    const preview = new Map<number, PointMeters>();
    const elements = activePath?.path.path_elements ?? [];
    for (const { index, position } of getRenderableElementPositions(elements)) {
      if (!isTranslationBearingElement(elements[index])) {
        continue;
      }
      const bounded = clampModelPoint(position, activeField.geometry);
      if (!pointsAlmostEqual(position, bounded)) {
        preview.set(index, bounded);
      }
    }
    return preview;
  }, [activeField.geometry, activePath]);
  const positionPreview = useMemo<PositionOverrides>(() => {
    if (dragPreview.size === 0) {
      return boundedPositionPreview;
    }
    return new Map([...boundedPositionPreview, ...dragPreview]);
  }, [boundedPositionPreview, dragPreview]);

  const simulationResult: SimTraceResult | null = useMemo(() => {
    if (!activePath || !durableProject) {
      return null;
    }

    try {
      return simulatePathWithTrace(activePath.path, durableProject.config, {
        dt_s: 0.02,
      });
    } catch {
      return null;
    }
  }, [activePath, durableProject]);

  const trajectoryMaxSpeedMps = useMemo(() => {
    const fromPath = Number(
      activePath?.path.constraints.max_velocity_meters_per_sec,
    );
    if (Number.isFinite(fromPath) && fromPath > 0) {
      return fromPath;
    }
    const fromConfig = durableProject
      ? getDefaultOptionalConfigValue(
          durableProject.config,
          "max_velocity_meters_per_sec",
        )
      : null;
    return fromConfig !== null && fromConfig > 0 ? fromConfig : 3;
  }, [activePath, durableProject]);

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
    if (!showGhostPaths || !durableProject || !activePathGroupId) {
      return [];
    }

    const group = durableProject.path_groups.find(
      (candidate) => candidate.group_id === activePathGroupId,
    );
    if (!group) {
      return [];
    }

    return group.path_ids.flatMap((pathId) => {
      if (pathId === activePathId) {
        return [];
      }
      const path = durableProject.paths.find(
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
  }, [activePathGroupId, activePathId, durableProject, showGhostPaths]);
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
      path: activePath?.path ?? null,
      overlayPaths,
      hoveredOverlayPathId,
      selectedElementIndex,
      selectedRangedConstraint,
      positionPreview,
      rotationPreview,
      selectedPulse: selectedPulseValue,
      simulationResult,
      simulationTrace: simulationResult?.trace ?? null,
      trajectoryMaxSpeedMps,
      simulationTimeS: simulationTime,
      simulationPlaying,
      config: durableProject?.config ?? null,
      curvePreview,
    }),
    [
      renderField,
      activePath,
      curvePreview,
      positionPreview,
      durableProject,
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
      trajectoryMaxSpeedMps,
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

    // Command/Ctrl +, -, and 0 belong to the browser or desktop shell so they
    // can resize the complete interface. Canvas-only view shortcuts are
    // intentionally unmodified and work while the canvas has focus.
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

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
    if (!activePath || !durableProject) {
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
          activePath.path,
          durableProject.config,
          curveTool.insertionIndex,
          [sample],
        ),
      });
      return;
    }

    if (isPlacementTool(activeTool)) {
      const placement = placementForPointer(
        activePath.path,
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
      activePath.path,
      selectedElementIndex,
      viewport,
      positionPreview,
      rotationPreview,
      pointer,
    );
    if (rotationHit !== null) {
      const element = activePath.path.path_elements[rotationHit];
      const linkedTarget = linkedTargetForElement(durableProject, element);
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
        getElementHeadingRadians(activePath.path.path_elements, rotationHit) ??
        0;
      setActiveRotationDrag({
        pointerId: event.pointerId,
        index: rotationHit,
        startPointer: pointer,
        moved: false,
        startRadians,
        currentRadians: startRadians,
      });
      return;
    }

    const nodeHit = hitTestPathElement(
      activePath.path,
      durableProject.config,
      viewport,
      positionPreview,
      pointer,
      selectedElementIndex,
    );
    if (nodeHit !== null) {
      selectionStore.getState().selectElement(nodeHit, activePath.path);
      const element = activePath.path.path_elements[nodeHit];
      const start = getElementPosition(activePath.path.path_elements, nodeHit);
      if (!element || !start || !isDragEnabled(element)) {
        return;
      }
      const linkedTarget = linkedTargetForElement(durableProject, element);
      if (linkedTarget?.locked) {
        return;
      }

      const startRatio =
        isRotationTarget(element) || isEventTrigger(element)
          ? element.t_ratio
          : null;
      setActiveDrag({
        pointerId: event.pointerId,
        index: nodeHit,
        startPointer: pointer,
        moved: false,
        start,
        current: isTranslationBearingElement(element)
          ? clampModelPoint(start, activeField.geometry)
          : start,
        startRatio,
        currentRatio: startRatio,
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
      activePath &&
      isPlacementTool(activeTool) &&
      !activeDragRef.current &&
      !activeRotationDragRef.current
    ) {
      setPlacementPreview({
        point: pointer,
        placement: placementForPointer(
          activePath.path,
          activeTool,
          pointer,
          viewport,
        ),
      });
      setHoveredOverlayPathId(null);
      setHoveredOverlayPoint(null);
      return;
    }

    const curveDraft = activeCurveDraftRef.current;
    if (
      curveDraft &&
      activePath &&
      durableProject &&
      curveDraft.pointerId === event.pointerId
    ) {
      event.preventDefault();
      const sample = stageToModelPoint(pointer, viewport);
      const samples = appendCurveSample(curveDraft.samples, sample);
      setActiveCurveDraft({
        ...curveDraft,
        samples,
        targetPoints: curveTargetPointsForSamples(
          activePath.path,
          durableProject.config,
          curveDraft.insertionIndex,
          samples,
        ),
      });
      return;
    }

    const drag = activeDragRef.current;
    if (drag && activePath && drag.pointerId === event.pointerId) {
      event.preventDefault();
      const moved = drag.moved || stagePointsDiffer(drag.startPointer, pointer);
      if (!moved) {
        return;
      }
      const projected = projectDragStagePoint(
        activePath.path,
        viewport,
        drag.index,
        pointer,
      );
      setActiveDrag(
        {
          ...drag,
          moved,
          current: projected.position,
          currentRatio: projected.ratio,
        },
        "frame",
      );
      return;
    }

    const rotationDrag = activeRotationDragRef.current;
    if (
      rotationDrag &&
      activePath &&
      rotationDrag.pointerId === event.pointerId
    ) {
      event.preventDefault();
      const moved =
        rotationDrag.moved ||
        stagePointsDiffer(rotationDrag.startPointer, pointer);
      if (!moved) {
        return;
      }
      const nextRadians = rotationFromStagePoint(
        activePath.path,
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
          moved,
          currentRadians: nextRadians,
        },
        "frame",
      );
      return;
    }

    const panDrag = activePanDragRef.current;
    if (!panDrag || panDrag.pointerId !== event.pointerId) {
      const overlayHit =
        activePath && !canvasInteractionActive
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

    finishActiveDrag(pointer, event.pointerId);
    finishActiveRotation(pointer, event.pointerId);
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

    if (activeDragRef.current?.pointerId === event.pointerId) {
      setActiveDrag(null);
    }
    if (activeRotationDragRef.current?.pointerId === event.pointerId) {
      setActiveRotationDrag(null);
    }
    finishPanDrag();
  };

  const finishActiveDrag = (pointer: StagePoint, pointerId: number) => {
    const drag = activeDragRef.current;
    if (!drag || drag.pointerId !== pointerId || !activePath) {
      return;
    }

    const moved = drag.moved || stagePointsDiffer(drag.startPointer, pointer);
    if (!moved) {
      setActiveDrag(null);
      return;
    }

    const projected = projectDragStagePoint(
      activePath.path,
      viewport,
      drag.index,
      pointer,
    );
    let nextPosition = projected.position;
    let nextRatio = projected.ratio;
    const element = activePath.path.path_elements[drag.index];

    if (element && (isRotationTarget(element) || isEventTrigger(element))) {
      const segment = getNeighborAnchorPositions(
        activePath.path.path_elements,
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
        projectStore.getState().applyPathElementEdit({
          kind: "ratio",
          index: drag.index,
          ratio: nextRatio,
        });
        selectionStore
          .getState()
          .selectElement(
            drag.index,
            activePathForProjectStore(projectStore.getState())?.path,
          );
      }
      return;
    }

    if (!pointsAlmostEqual(drag.start, nextPosition)) {
      projectStore.getState().applyPathElementEdit({
        kind: "position",
        index: drag.index,
        position: nextPosition,
      });
      selectionStore
        .getState()
        .selectElement(
          drag.index,
          activePathForProjectStore(projectStore.getState())?.path,
        );
    }
  };

  const finishActiveRotation = (pointer: StagePoint, pointerId: number) => {
    const rotationDrag = activeRotationDragRef.current;
    if (!rotationDrag || rotationDrag.pointerId !== pointerId || !activePath) {
      return;
    }

    const moved =
      rotationDrag.moved ||
      stagePointsDiffer(rotationDrag.startPointer, pointer);
    if (!moved) {
      setActiveRotationDrag(null);
      return;
    }

    const nextRadians =
      rotationFromStagePoint(
        activePath.path,
        rotationDrag.index,
        viewport,
        pointer,
      ) ?? rotationDrag.currentRadians;
    setActiveRotationDrag(null);

    if (
      Math.abs(angularDelta(rotationDrag.startRadians, nextRadians)) >= 0.001
    ) {
      projectStore.getState().applyPathElementEdit({
        kind: "rotation",
        index: rotationDrag.index,
        rotationRadians: nextRadians,
      });
      selectionStore
        .getState()
        .selectElement(
          rotationDrag.index,
          activePathForProjectStore(projectStore.getState())?.path,
        );
      return;
    }

    selectionStore
      .getState()
      .selectElement(rotationDrag.index, activePath.path);
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
    if (!draft || !activePath || !durableProject) {
      setActiveCurveDraft(null);
      return;
    }

    const targets = curveTargetsForSamples(
      activePath.path,
      durableProject.config,
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
    if (!activePath || !durableProject) {
      return;
    }

    const pointer = stagePointFromEvent(event);
    const elementIndex = hitTestPathElement(
      activePath.path,
      durableProject.config,
      viewport,
      positionPreview,
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
    if (!durableProject || !contextMenu) {
      return;
    }

    projectStore.getState().createLinkedTarget({
      display_name: nextLinkedTargetName(durableProject, "translation"),
      kind: "translation",
      x_meters: contextMenu.fieldPoint.x_meters,
      y_meters: contextMenu.fieldPoint.y_meters,
      rotation_radians: null,
    });
    setContextMenu(null);
  };

  const createLinkedTargetFromContextElement = (kind: LinkedTargetKind) => {
    if (
      !durableProject ||
      !activePath ||
      !contextMenu ||
      contextMenu.elementIndex === null
    ) {
      return;
    }

    const elementIndex = contextMenu.elementIndex;
    const position = getElementPosition(
      activePath.path.path_elements,
      elementIndex,
    );
    if (!position) {
      return;
    }

    projectStore.getState().createLinkedTarget({
      display_name: nextLinkedTargetName(durableProject, kind),
      kind,
      x_meters: position.x_meters,
      y_meters: position.y_meters,
      rotation_radians:
        kind === "waypoint"
          ? (getElementHeadingRadians(
              activePath.path.path_elements,
              elementIndex,
            ) ?? 0)
          : null,
      link: {
        pathId: activePath.path_id,
        elementIndex,
      },
    });
    selectionStore
      .getState()
      .selectElement(
        elementIndex,
        activePathForProjectStore(projectStore.getState())?.path,
      );
    setContextMenu(null);
  };

  const linkContextElementToTarget = (targetId: string) => {
    if (!activePath || !contextMenu || contextMenu.elementIndex === null) {
      return;
    }

    projectStore
      .getState()
      .linkPathElementToTarget(
        activePath.path_id,
        contextMenu.elementIndex,
        targetId,
      );
    selectionStore
      .getState()
      .selectElement(
        contextMenu.elementIndex,
        activePathForProjectStore(projectStore.getState())?.path,
      );
    setContextMenu(null);
  };

  const unlinkContextElement = () => {
    if (!activePath || !contextMenu || contextMenu.elementIndex === null) {
      return;
    }

    projectStore
      .getState()
      .unlinkPathElement(activePath.path_id, contextMenu.elementIndex);
    selectionStore
      .getState()
      .selectElement(
        contextMenu.elementIndex,
        activePathForProjectStore(projectStore.getState())?.path,
      );
    setContextMenu(null);
  };

  const contextElement =
    activePath && contextMenu?.elementIndex !== null && contextMenu
      ? (activePath.path.path_elements[contextMenu.elementIndex] ?? null)
      : null;
  const contextCompatibleTargets =
    durableProject && contextElement
      ? durableProject.linked_targets.filter((target) =>
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
          path={activePath?.path ?? null}
          onToolChange={(tool) => {
            setPlacementPreview(null);
            onToolChange?.(tool);
          }}
        />
        <CanvasViewControls
          scale={viewScale}
          showGhostPaths={showGhostPaths}
          onFit={resetView}
          onToggleGhostPaths={() =>
            setShowGhostPaths((current) => {
              const next = !current;
              writeEditorUiPreferences({
                ...readEditorUiPreferences(),
                showGhostPaths: next,
              });
              return next;
            })
          }
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
  path,
  onToolChange,
}: {
  activeTool: EditorTool;
  path: PathModel | null;
  onToolChange(tool: EditorTool): void;
}) {
  const anchorCount = path?.path_elements.filter(isAnchorElement).length ?? 0;
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
          data-tour={
            tool === "waypoint"
              ? "tool-waypoint"
              : tool === "translation"
                ? "tool-translation"
                : undefined
          }
          disabled={!path || disabled}
          title={
            disabled
              ? `${label} needs two path elements`
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
        aria-keyshortcuts="0"
        title="Fit view (0)"
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
  path: PathModel,
  tool: "waypoint" | "translation" | "rotation" | "event",
  pointer: StagePoint,
  viewport: FieldViewport,
): CanvasElementPlacement | null {
  const position = clampModelPoint(
    stageToModelPoint(pointer, viewport),
    viewport.field,
  );
  const elements = path.path_elements;

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
          data-tour="transport-play"
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
  path: PathModel,
  config: ProjectConfig,
  insertionIndex: number,
  samples: readonly PointMeters[],
): PointMeters[] {
  return curveTargetsForSamples(path, config, insertionIndex, samples).map(
    (target) => ({
      x_meters: target.x_meters,
      y_meters: target.y_meters,
    }),
  );
}

function curveTargetsForSamples(
  path: PathModel,
  config: ProjectConfig,
  insertionIndex: number,
  samples: readonly PointMeters[],
): TranslationTarget[] {
  const { previousAnchor, nextAnchor } = curveEndpointContext(
    path.path_elements,
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
        config,
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
  path: PathModel,
  selectedElementIndex: number | null,
  viewport: FieldViewport,
  positionPreview: PositionOverrides,
  rotationPreview: RotationOverrides,
  pointer: StagePoint,
): number | null {
  if (selectedElementIndex === null) {
    return null;
  }

  const elements = path.path_elements;
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
  path: PathModel,
  config: ProjectConfig,
  viewport: FieldViewport,
  positionPreview: PositionOverrides,
  pointer: StagePoint,
  selectedElementIndex: number | null,
): number | null {
  const elements = path.path_elements;
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
  const robotSizeMeters = robotSizeFromConfig(config);

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
    if (
      pointDistance(point, pointer) <= anchorNodeExclusionRadiusPx(viewport)
    ) {
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
  path: PathModel,
  viewport: FieldViewport,
  index: number,
  stagePoint: StagePoint,
): { position: PointMeters; ratio: number | null; stagePoint: StagePoint } {
  let position = stageToModelPoint(stagePoint, viewport);
  let ratio: number | null = null;
  const element = path.path_elements[index];

  if (element && isTranslationBearingElement(element)) {
    position = clampModelPoint(position, viewport.field);
  } else if (
    element &&
    (isRotationTarget(element) || isEventTrigger(element))
  ) {
    ratio = element.t_ratio;
    const segment = getNeighborAnchorPositions(path.path_elements, index);
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

function linkedTargetForElement(
  project: Project,
  element: PathElement | undefined,
): LinkedTarget | null {
  const targetId = getPathElementLinkedTargetId(element);
  if (!element || !targetId) {
    return null;
  }

  const target =
    project.linked_targets.find(
      (candidate) => candidate.target_id === targetId,
    ) ?? null;
  return target && isElementCompatibleWithLinkedTarget(element, target)
    ? target
    : null;
}

function nextLinkedTargetName(
  project: Project,
  kind: LinkedTargetKind,
): string {
  const base = kind === "waypoint" ? "Linked Waypoint" : "Linked Translation";
  const existing = new Set(
    project.linked_targets.map((target) => target.display_name),
  );
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `${base} ${project.linked_targets.length + 1}`;
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
  path: PathModel,
  index: number,
  viewport: FieldViewport,
  point: StagePoint,
): number | null {
  const position = getElementPosition(path.path_elements, index);
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

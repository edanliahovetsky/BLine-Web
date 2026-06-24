import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";
import type { LinkedTarget, ProjectConfig } from "../core/io/projectSchema";
import type { ResolvedFieldDefinition } from "../core/field/fieldConfig";
import { elementCircleRadiusMeters, fieldAspectRatio } from "./constants";
import {
  createFieldViewport,
  modelToStagePoint,
  stageToModelPoint,
  type CanvasSize,
  type FieldViewport,
  type PointMeters,
  type StagePoint,
} from "./geometry";
import {
  PixiPathRenderer,
  type PixiDebugWindow,
  type PixiLinkedTargetOverlay,
  type PixiRenderInput,
} from "./pixi/PixiPathRenderer";
import { robotSizeFromConfig } from "./robotFootprint";
import { projectStore } from "../state/projectStore";

interface LinkedTargetsCanvasProps {
  compatibleTargetIds?: ReadonlySet<string> | null;
  config: ProjectConfig;
  field: ResolvedFieldDefinition;
  selectedTargetId: string | null;
  targets: readonly LinkedTarget[];
  onMoveTarget(targetId: string, position: PointMeters): void;
  onRotateTarget(targetId: string, rotationRadians: number): void;
  onSelectTarget(targetId: string | null): void;
}

interface ActivePanDrag {
  pointerId: number;
  startPointer: StagePoint;
  startPanOffset: StagePoint;
}

interface ActiveTargetDrag {
  pointerId: number;
  targetId: string;
  start: PointMeters;
  current: PointMeters;
}

interface ActiveRotationDrag {
  pointerId: number;
  targetId: string;
  startRadians: number;
  currentRadians: number;
}

interface TargetDragPreview {
  targetId: string;
  current: PointMeters;
}

interface RotationDragPreview {
  targetId: string;
  currentRadians: number;
}

const fallbackPreviewStageSize: CanvasSize = {
  width: 720,
  height: Math.round(720 / fieldAspectRatio),
};

export function LinkedTargetsCanvas({
  compatibleTargetIds = null,
  config,
  field,
  selectedTargetId,
  targets,
  onMoveTarget,
  onRotateTarget,
  onSelectTarget,
}: LinkedTargetsCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<PixiPathRenderer | null>(null);
  const latestRenderInputRef = useRef<PixiRenderInput | null>(null);
  const activePanDragRef = useRef<ActivePanDrag | null>(null);
  const activeTargetDragRef = useRef<ActiveTargetDrag | null>(null);
  const activeRotationDragRef = useRef<ActiveRotationDrag | null>(null);
  const panOffsetRef = useRef<StagePoint>({ x: 0, y: 0 });
  const pendingPanOffsetRef = useRef<StagePoint | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const targetDragFrameRef = useRef<number | null>(null);
  const rotationFrameRef = useRef<number | null>(null);
  const [stageSize, setStageSize] = useState<CanvasSize>(
    fallbackPreviewStageSize,
  );
  const [viewScale, setViewScale] = useState(1);
  const [panOffset, setPanOffsetState] = useState<StagePoint>({
    x: 0,
    y: 0,
  });
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [dragPreview, setDragPreviewState] = useState<TargetDragPreview | null>(
    null,
  );
  const [rotationPreview, setRotationPreviewState] =
    useState<RotationDragPreview | null>(null);
  const [customFieldImage, setCustomFieldImage] = useState<{
    fieldId: string;
    url: string;
  } | null>(null);

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

  const flushTargetDragPreview = useCallback(() => {
    targetDragFrameRef.current = null;
    const drag = activeTargetDragRef.current;
    setDragPreviewState(
      drag ? { targetId: drag.targetId, current: drag.current } : null,
    );
  }, []);

  const setActiveTargetDrag = useCallback(
    (
      nextDrag: ActiveTargetDrag | null,
      sync: "immediate" | "frame" = "immediate",
    ) => {
      activeTargetDragRef.current = nextDrag;

      if (sync === "frame") {
        if (targetDragFrameRef.current === null) {
          targetDragFrameRef.current = window.requestAnimationFrame(
            flushTargetDragPreview,
          );
        }
        return;
      }

      if (targetDragFrameRef.current !== null) {
        window.cancelAnimationFrame(targetDragFrameRef.current);
        targetDragFrameRef.current = null;
      }
      setDragPreviewState(
        nextDrag
          ? { targetId: nextDrag.targetId, current: nextDrag.current }
          : null,
      );
    },
    [flushTargetDragPreview],
  );

  const flushRotationPreview = useCallback(() => {
    rotationFrameRef.current = null;
    const drag = activeRotationDragRef.current;
    setRotationPreviewState(
      drag
        ? { targetId: drag.targetId, currentRadians: drag.currentRadians }
        : null,
    );
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
      setRotationPreviewState(
        nextDrag
          ? {
              targetId: nextDrag.targetId,
              currentRadians: nextDrag.currentRadians,
            }
          : null,
      );
    },
    [flushRotationPreview],
  );

  useEffect(
    () => () => {
      for (const frame of [panFrameRef, targetDragFrameRef, rotationFrameRef]) {
        if (frame.current !== null) {
          window.cancelAnimationFrame(frame.current);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!field.custom) {
      return undefined;
    }

    let disposed = false;
    let objectUrl: string | null = null;
    const fieldId = field.id;

    void projectStore
      .getState()
      .readFieldImageAsset(field.custom)
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
  }, [field.custom, field.id]);

  const customFieldImageUrl =
    customFieldImage && customFieldImage.fieldId === field.id
      ? customFieldImage.url
      : null;
  const renderField = useMemo(
    () =>
      field.custom && customFieldImageUrl
        ? { ...field, image_src: customFieldImageUrl }
        : field,
    [customFieldImageUrl, field],
  );
  const fieldRenderKey = `${renderField.id}:${renderField.image_src ?? renderField.kind}`;
  const activeFieldAspectRatio =
    field.geometry.length_meters / field.geometry.width_meters;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const updateSize = () => {
      const rect = host.getBoundingClientRect();
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
      return () => (window as Window).removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(host);

    return () => observer.disconnect();
  }, [activeFieldAspectRatio]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    let renderer: PixiPathRenderer | null = null;
    let debugApi: ReturnType<PixiPathRenderer["getDebugApi"]> | null = null;

    void PixiPathRenderer.create(fallbackPreviewStageSize, renderField)
      .then((nextRenderer) => {
        if (disposed) {
          nextRenderer.destroy();
          return;
        }

        setRendererError(null);
        renderer = nextRenderer;
        rendererRef.current = nextRenderer;
        nextRenderer.canvas.dataset.testid = "linked-targets-pixi-canvas";
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
  }, [fieldRenderKey, renderField]);

  const baseViewport = useMemo(
    () =>
      createFieldViewport(
        stageSize,
        linkedElementsPreviewFieldPaddingPx,
        field.geometry,
      ),
    [field.geometry, stageSize],
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
  const displayedTargets = useMemo(
    () =>
      targets.map((target) =>
        dragPreview?.targetId === target.target_id
          ? {
              ...target,
              x_meters: dragPreview.current.x_meters,
              y_meters: dragPreview.current.y_meters,
            }
          : rotationPreview?.targetId === target.target_id
            ? {
                ...target,
                rotation_radians: rotationPreview.currentRadians,
              }
            : target,
      ),
    [dragPreview, rotationPreview, targets],
  );
  const pixiTargets = useMemo<readonly PixiLinkedTargetOverlay[]>(
    () =>
      displayedTargets.map((target) => ({
        ...target,
        compatible: compatibleTargetIds
          ? compatibleTargetIds.has(target.target_id)
          : true,
      })),
    [compatibleTargetIds, displayedTargets],
  );
  const renderInput = useMemo<PixiRenderInput>(
    () => ({
      stageSize,
      viewport,
      field: renderField,
      project: null,
      overlayPaths: [],
      hoveredOverlayPathId: null,
      selectedElementIndex: null,
      selectedRangedConstraint: null,
      positionPreview: emptyPreview,
      rotationPreview: emptyRotationPreview,
      selectedPulse: 0.72,
      simulationResult: null,
      simulationTimeS: 0,
      simulationPlaying: false,
      config,
      curvePreview: null,
      linkedTargets: pixiTargets,
      selectedLinkedTargetId: selectedTargetId,
    }),
    [config, pixiTargets, renderField, selectedTargetId, stageSize, viewport],
  );

  useEffect(() => {
    latestRenderInputRef.current = renderInput;
    rendererRef.current?.update(renderInput);
  }, [renderInput]);

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

  const finishPanDrag = (commitBlankClick = false, pointer?: StagePoint) => {
    const drag = activePanDragRef.current;
    if (pendingPanOffsetRef.current) {
      setPanOffset(pendingPanOffsetRef.current);
    }
    activePanDragRef.current = null;
    setIsPanning(false);

    if (
      commitBlankClick &&
      drag &&
      pointer &&
      pointDistance(drag.startPointer, pointer) <= blankClickMaxDistancePx
    ) {
      onSelectTarget(null);
    }
  };

  const finishTargetDrag = (commit: boolean) => {
    const drag = activeTargetDragRef.current;
    if (!drag) {
      setActiveTargetDrag(null);
      return;
    }

    setActiveTargetDrag(null);
    if (commit && !pointsAlmostEqual(drag.start, drag.current)) {
      onMoveTarget(drag.targetId, drag.current);
    }
  };

  const finishRotationDrag = (commit: boolean) => {
    const drag = activeRotationDragRef.current;
    if (!drag) {
      setActiveRotationDrag(null);
      return;
    }

    setActiveRotationDrag(null);
    if (
      commit &&
      Math.abs(angularDelta(drag.startRadians, drag.currentRadians)) >= 0.001
    ) {
      onRotateTarget(drag.targetId, drag.currentRadians);
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const factor = direction > 0 ? zoomStepFactor : 1 / zoomStepFactor;
    zoomAtStagePoint(stagePointFromEvent(event), factor);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer = stagePointFromEvent(event);
    const rotationHandleHit = hitTestLinkedTargetRotationHandle(
      displayedTargets,
      selectedTargetId,
      viewport,
      pointer,
    );
    if (rotationHandleHit) {
      onSelectTarget(rotationHandleHit.target_id);
      if (rotationHandleHit.locked) {
        return;
      }

      const startRadians = rotationHandleHit.rotation_radians ?? 0;
      setActiveRotationDrag({
        pointerId: event.pointerId,
        targetId: rotationHandleHit.target_id,
        startRadians,
        currentRadians: startRadians,
      });
      return;
    }

    const targetHit = hitTestLinkedTarget(
      displayedTargets,
      selectedTargetId,
      viewport,
      pointer,
      config,
    );

    if (targetHit) {
      onSelectTarget(targetHit.target_id);
      if (targetHit.locked) {
        return;
      }
      const start = {
        x_meters: targetHit.x_meters,
        y_meters: targetHit.y_meters,
      };
      setActiveTargetDrag({
        pointerId: event.pointerId,
        targetId: targetHit.target_id,
        start,
        current: start,
      });
      return;
    }

    activePanDragRef.current = {
      pointerId: event.pointerId,
      startPointer: pointer,
      startPanOffset: panOffsetRef.current,
    };
    setIsPanning(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pointer = stagePointFromEvent(event);
    const rotationDrag = activeRotationDragRef.current;
    if (rotationDrag && rotationDrag.pointerId === event.pointerId) {
      event.preventDefault();
      const nextRadians = rotationFromStagePoint(
        displayedTargets,
        rotationDrag.targetId,
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

    const targetDrag = activeTargetDragRef.current;
    if (targetDrag && targetDrag.pointerId === event.pointerId) {
      event.preventDefault();
      setActiveTargetDrag(
        {
          ...targetDrag,
          current: stageToModelPoint(pointer, viewport),
        },
        "frame",
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
    finishRotationDrag(true);
    finishTargetDrag(true);
    finishPanDrag(true, pointer);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishRotationDrag(false);
    finishTargetDrag(false);
    finishPanDrag();
  };

  return (
    <div
      ref={hostRef}
      className={[
        "linked-targets-dialog__preview",
        isPanning ? "is-panning" : "",
        dragPreview ? "is-target-dragging" : "",
        rotationPreview ? "is-rotation-dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="linked-targets-canvas"
      role="application"
      aria-label="Linked element field preview"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onWheel={handleWheel}
    >
      {rendererError ? (
        <div className="path-stage__renderer-error">
          Canvas renderer failed: {rendererError}
        </div>
      ) : null}
    </div>
  );
}

function hitTestLinkedTarget(
  targets: readonly LinkedTarget[],
  selectedTargetId: string | null,
  viewport: FieldViewport,
  pointer: StagePoint,
  config: ProjectConfig,
): LinkedTarget | null {
  const renderedTargets = targets.map((target) => ({
    target,
    point: modelToStagePoint(
      { x_meters: target.x_meters, y_meters: target.y_meters },
      viewport,
    ),
  }));
  const orderedTargets =
    selectedTargetId === null
      ? renderedTargets
      : [
          ...renderedTargets.filter(
            ({ target }) => target.target_id !== selectedTargetId,
          ),
          ...renderedTargets.filter(
            ({ target }) => target.target_id === selectedTargetId,
          ),
        ];
  const robotSizeMeters = robotSizeFromConfig(config);

  for (
    let targetIndex = orderedTargets.length - 1;
    targetIndex >= 0;
    targetIndex -= 1
  ) {
    const { point, target } = orderedTargets[targetIndex];
    if (
      hitTestLinkedTargetShape(
        target,
        point,
        pointer,
        viewport,
        robotSizeMeters,
      )
    ) {
      return target;
    }
  }

  return null;
}

function hitTestLinkedTargetRotationHandle(
  targets: readonly LinkedTarget[],
  selectedTargetId: string | null,
  viewport: FieldViewport,
  pointer: StagePoint,
): LinkedTarget | null {
  if (!selectedTargetId) {
    return null;
  }

  const target = targets.find(
    (candidate) => candidate.target_id === selectedTargetId,
  );
  if (!target || target.kind !== "waypoint") {
    return null;
  }

  const center = modelToStagePoint(
    { x_meters: target.x_meters, y_meters: target.y_meters },
    viewport,
  );
  const handle = rotationHandlePoint(
    center,
    viewport,
    target.rotation_radians ?? 0,
  );
  return pointDistance(pointer, handle) <= rotationHandleHitRadiusPx
    ? target
    : null;
}

function hitTestLinkedTargetShape(
  target: LinkedTarget,
  point: StagePoint,
  pointer: StagePoint,
  viewport: FieldViewport,
  robotSizeMeters: ReturnType<typeof robotSizeFromConfig>,
): boolean {
  const radius = Math.max(7, elementCircleRadiusMeters * viewport.scale) + 14;
  if (target.kind === "translation") {
    return pointDistance(point, pointer) <= radius;
  }

  const local = toLocalRobotPoint(point, pointer, target.rotation_radians ?? 0);
  const width = robotSizeMeters.lengthMeters * viewport.scale;
  const height = robotSizeMeters.widthMeters * viewport.scale;
  const padding = Math.max(10, Math.min(width, height) * 0.18);
  return (
    local.x >= -width / 2 - padding &&
    local.x <= width / 2 + padding &&
    local.y >= -height / 2 - padding &&
    local.y <= height / 2 + padding
  );
}

function rotationFromStagePoint(
  targets: readonly LinkedTarget[],
  targetId: string,
  viewport: FieldViewport,
  point: StagePoint,
): number | null {
  const target = targets.find((candidate) => candidate.target_id === targetId);
  if (!target || target.kind !== "waypoint") {
    return null;
  }

  const center = modelToStagePoint(
    { x_meters: target.x_meters, y_meters: target.y_meters },
    viewport,
  );
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

function stagePointFromEvent(
  event: PointerEvent<HTMLDivElement> | WheelEvent<HTMLDivElement>,
): StagePoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
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
const minViewScale = 1;
const maxViewScale = 8;
const zoomStepFactor = 1.03;
const linkedElementsPreviewFieldPaddingPx = 6;
const rotationHandleHitRadiusPx = 18;
const blankClickMaxDistancePx = 4;

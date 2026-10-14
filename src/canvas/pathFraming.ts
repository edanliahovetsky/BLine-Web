import { isAnchorElement, type PathModel } from "../core/model/path";
import {
  getElementPosition,
  modelToStagePoint,
  type CanvasSize,
  type FieldViewport,
  type StagePoint,
} from "./geometry";
import type { RobotSizeMeters } from "./robotFootprint";

/** The user's zoom and pan, relative to the fitted field viewport. */
export interface CanvasView {
  scale: number;
  pan: StagePoint;
}

export interface ModelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Stage pixels covered by canvas chrome that framing should keep clear. */
export interface StageInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const fittedCanvasView: CanvasView = { scale: 1, pan: { x: 0, y: 0 } };
export const minCanvasViewScale = 1;
export const maxCanvasViewScale = 8;
/** Framing a short path should not zoom so far that the field loses context. */
export const maxPathFramingScale = 4;
const minFramedExtentMeters = { x: 2.5, y: 2 };

/**
 * Field bounds of everything that defines the path on the canvas: its anchors
 * and authored start, padded by the robot so footprints at either end stay in
 * view.
 */
export function pathFramingBounds(
  path: PathModel | null | undefined,
  robot: RobotSizeMeters,
): ModelBounds | null {
  if (!path) return null;
  const points = path.path_elements.flatMap((element, index) => {
    if (!isAnchorElement(element)) return [];
    const position = getElementPosition(path.path_elements, index);
    return position ? [position] : [];
  });
  const start = path.preview?.start_pose;
  if (start) points.unshift(start);
  if (points.length === 0) return null;

  const margin = Math.hypot(robot.lengthMeters, robot.widthMeters) / 2 + 0.15;
  const xs = points.map((point) => point.x_meters);
  const ys = points.map((point) => point.y_meters);
  return padToMinimumExtent({
    minX: Math.min(...xs) - margin,
    minY: Math.min(...ys) - margin,
    maxX: Math.max(...xs) + margin,
    maxY: Math.max(...ys) + margin,
  });
}

export function viewportForView(
  base: FieldViewport,
  view: CanvasView,
): FieldViewport {
  return {
    ...base,
    x: base.x + view.pan.x,
    y: base.y + view.pan.y,
    width: base.width * view.scale,
    height: base.height * view.scale,
    scale: base.scale * view.scale,
  };
}

/** Keeps a zoomed field covering the stage, and centers one that fits. */
export function clampViewPan(
  pan: StagePoint,
  base: FieldViewport,
  stage: CanvasSize,
  scale: number,
): StagePoint {
  return {
    x: clampAxisPan(pan.x, base.x, base.width * scale, stage.width),
    y: clampAxisPan(pan.y, base.y, base.height * scale, stage.height),
  };
}

/** The stage rectangle a model-space box occupies under a viewport. */
export function boundsStageRect(
  bounds: ModelBounds,
  viewport: FieldViewport,
): { x: number; y: number; width: number; height: number } {
  const a = modelToStagePoint(
    { x_meters: bounds.minX, y_meters: bounds.minY },
    viewport,
  );
  const b = modelToStagePoint(
    { x_meters: bounds.maxX, y_meters: bounds.maxY },
    viewport,
  );
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function boundsVisible(
  bounds: ModelBounds,
  viewport: FieldViewport,
  stage: CanvasSize,
  insets: StageInsets,
  tolerancePx = 1,
): boolean {
  const rect = boundsStageRect(bounds, viewport);
  return (
    rect.x >= insets.left - tolerancePx &&
    rect.y >= insets.top - tolerancePx &&
    rect.x + rect.width <= stage.width - insets.right + tolerancePx &&
    rect.y + rect.height <= stage.height - insets.bottom + tolerancePx
  );
}

/**
 * The view that centers the bounds in the unobstructed stage at the largest
 * zoom that keeps them whole, never past `maxScale` and never smaller than
 * the fitted field.
 */
export function framedView(
  bounds: ModelBounds,
  base: FieldViewport,
  stage: CanvasSize,
  insets: StageInsets,
  maxScale = maxPathFramingScale,
): CanvasView {
  const rect = boundsStageRect(bounds, base);
  const availableWidth = Math.max(1, stage.width - insets.left - insets.right);
  const availableHeight = Math.max(
    1,
    stage.height - insets.top - insets.bottom,
  );
  const scale = clamp(
    Math.min(
      availableWidth / Math.max(1, rect.width),
      availableHeight / Math.max(1, rect.height),
    ),
    minCanvasViewScale,
    Math.max(minCanvasViewScale, maxScale),
  );
  const centerX = insets.left + availableWidth / 2;
  const centerY = insets.top + availableHeight / 2;
  const rectCenterX = base.x + (rect.x + rect.width / 2 - base.x) * scale;
  const rectCenterY = base.y + (rect.y + rect.height / 2 - base.y) * scale;
  return {
    scale,
    pan: clampViewPan(
      { x: centerX - rectCenterX, y: centerY - rectCenterY },
      base,
      stage,
      scale,
    ),
  };
}

export interface StageFrame {
  base: FieldViewport;
  stage: CanvasSize;
  /** Page position of the stage, so a canvas that moves sideways can glide. */
  origin: StagePoint;
}

/**
 * Re-frames the canvas after the workspace resizes. `start` keeps the field
 * where it was on the page so the change can animate; `target` keeps the
 * fitted field fitted, otherwise holds the same zoom and center, and brings a
 * path that was in view back into view.
 */
export function reframeAfterResize({
  previous,
  next,
  view,
  bounds,
  insets,
}: {
  previous: StageFrame;
  next: StageFrame;
  view: CanvasView;
  bounds: ModelBounds | null;
  insets: StageInsets;
}): { start: CanvasView; target: CanvasView } {
  const before = viewportForView(previous.base, view);
  const start: CanvasView = {
    scale: before.scale / next.base.scale,
    pan: {
      x: before.x + previous.origin.x - next.origin.x - next.base.x,
      y: before.y + previous.origin.y - next.origin.y - next.base.y,
    },
  };

  if (isFittedView(view)) return { start, target: fittedCanvasView };

  // Hold the same field point at the stage center at the same pixel scale.
  const scale = clamp(
    before.scale / next.base.scale,
    minCanvasViewScale,
    maxCanvasViewScale,
  );
  const centerSceneX = (previous.stage.width / 2 - before.x) / before.scale;
  const centerSceneY = (previous.stage.height / 2 - before.y) / before.scale;
  const nextScale = next.base.scale * scale;
  let target: CanvasView = {
    scale,
    pan: clampViewPan(
      {
        x: next.stage.width / 2 - centerSceneX * nextScale - next.base.x,
        y: next.stage.height / 2 - centerSceneY * nextScale - next.base.y,
      },
      next.base,
      next.stage,
      scale,
    ),
  };

  if (
    bounds &&
    boundsVisible(bounds, before, previous.stage, insets) &&
    !boundsVisible(
      bounds,
      viewportForView(next.base, target),
      next.stage,
      insets,
    )
  ) {
    target = framedView(bounds, next.base, next.stage, insets, scale);
  }
  return { start, target };
}

export function isFittedView(view: CanvasView): boolean {
  return (
    Math.abs(view.scale - 1) < 0.0001 &&
    Math.abs(view.pan.x) < 0.5 &&
    Math.abs(view.pan.y) < 0.5
  );
}

export function interpolateView(
  from: CanvasView,
  to: CanvasView,
  t: number,
): CanvasView {
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    scale: mix(from.scale, to.scale),
    pan: { x: mix(from.pan.x, to.pan.x), y: mix(from.pan.y, to.pan.y) },
  };
}

export function viewsDiffer(a: CanvasView, b: CanvasView): boolean {
  return (
    Math.abs(a.scale - b.scale) > 0.0001 ||
    Math.abs(a.pan.x - b.pan.x) > 0.5 ||
    Math.abs(a.pan.y - b.pan.y) > 0.5
  );
}

function padToMinimumExtent(bounds: ModelBounds): ModelBounds {
  const padX = Math.max(
    0,
    (minFramedExtentMeters.x - (bounds.maxX - bounds.minX)) / 2,
  );
  const padY = Math.max(
    0,
    (minFramedExtentMeters.y - (bounds.maxY - bounds.minY)) / 2,
  );
  return {
    minX: bounds.minX - padX,
    minY: bounds.minY - padY,
    maxX: bounds.maxX + padX,
    maxY: bounds.maxY + padY,
  };
}

function clampAxisPan(
  offset: number,
  basePosition: number,
  scaledSize: number,
  stageSize: number,
): number {
  if (scaledSize <= stageSize) return 0;
  return clamp(offset, stageSize - scaledSize - basePosition, -basePosition);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

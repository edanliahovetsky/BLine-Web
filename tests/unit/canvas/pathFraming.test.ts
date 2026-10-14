import { describe, expect, it } from "vitest";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
} from "../../../src/core/model/path";
import { createFieldViewport } from "../../../src/canvas/geometry";
import {
  boundsVisible,
  clampViewPan,
  fittedCanvasView,
  framedView,
  maxPathFramingScale,
  pathFramingBounds,
  reframeAfterResize,
  viewportForView,
  type StageFrame,
} from "../../../src/canvas/pathFraming";

function waypoint(x_meters: number, y_meters: number) {
  return createWaypoint({
    translation_target: createTranslationTarget({ x_meters, y_meters }),
  });
}

const robot = { lengthMeters: 0.8, widthMeters: 0.8 };
const insets = { top: 56, right: 16, bottom: 64, left: 60 };

function frame(width: number, height = 800, originX = 0): StageFrame {
  const stage = { width, height };
  return {
    stage,
    base: createFieldViewport(stage),
    origin: { x: originX, y: 48 },
  };
}

const path = createPathModel({
  path_elements: [
    waypoint(3, 2),
    createRotationTarget({ rotation_radians: 0, t_ratio: 0.5 }),
    createTranslationTarget({ x_meters: 7, y_meters: 3 }),
    waypoint(12, 6),
  ],
});

describe("path framing", () => {
  it("bounds the anchors and authored start, padded by the robot", () => {
    const withStart = {
      ...path,
      preview: {
        start_pose: { x_meters: 1, y_meters: 1, rotation_radians: 0 },
      },
    };
    const bounds = pathFramingBounds(withStart, robot);
    const margin = Math.hypot(0.8, 0.8) / 2 + 0.15;
    expect(bounds?.minX).toBeCloseTo(1 - margin);
    expect(bounds?.minY).toBeCloseTo(1 - margin);
    expect(bounds?.maxX).toBeCloseTo(12 + margin);
    expect(bounds?.maxY).toBeCloseTo(6 + margin);
    expect(pathFramingBounds(createPathModel(), robot)).toBeNull();
    expect(pathFramingBounds(null, robot)).toBeNull();
  });

  it("frames a short path without zooming past the framing cap", () => {
    const short = createPathModel({
      path_elements: [waypoint(8, 4), waypoint(8.2, 4)],
    });
    const { base, stage } = frame(1440);
    const bounds = pathFramingBounds(short, robot)!;
    const view = framedView(bounds, base, stage, insets);
    expect(view.scale).toBe(maxPathFramingScale);
    expect(
      boundsVisible(bounds, viewportForView(base, view), stage, insets),
    ).toBe(true);
  });

  it("centers a framed path in the stage clear of the canvas chrome", () => {
    const { base, stage } = frame(1100);
    const bounds = pathFramingBounds(path, robot)!;
    const view = framedView(bounds, base, stage, insets);
    expect(view.scale).toBeGreaterThan(1);
    expect(
      boundsVisible(bounds, viewportForView(base, view), stage, insets),
    ).toBe(true);
  });

  it("keeps the fitted field fitted and glides from its old page position", () => {
    const previous = frame(1440);
    const next = frame(1100);
    const { start, target } = reframeAfterResize({
      previous,
      next,
      view: fittedCanvasView,
      bounds: pathFramingBounds(path, robot),
      insets,
    });
    expect(target).toEqual(fittedCanvasView);
    const startViewport = viewportForView(next.base, start);
    expect(startViewport.x).toBeCloseTo(previous.base.x);
    expect(startViewport.y).toBeCloseTo(previous.base.y);
    expect(startViewport.scale).toBeCloseTo(previous.base.scale);
  });

  it("accounts for a canvas that shifts right when the navigator opens", () => {
    const previous = frame(1440);
    const next = frame(880, 800, 560);
    const { start } = reframeAfterResize({
      previous,
      next,
      view: fittedCanvasView,
      bounds: null,
      insets,
    });
    const startViewport = viewportForView(next.base, start);
    expect(startViewport.x + next.origin.x).toBeCloseTo(
      previous.base.x + previous.origin.x,
    );
  });

  it("brings a zoomed path that was in view back into view after narrowing", () => {
    const previous = frame(1440);
    const next = frame(1100);
    const bounds = pathFramingBounds(path, robot)!;
    const view = framedView(bounds, previous.base, previous.stage, insets);
    expect(
      boundsVisible(
        bounds,
        viewportForView(previous.base, view),
        previous.stage,
        insets,
      ),
    ).toBe(true);

    const { target } = reframeAfterResize({
      previous,
      next,
      view,
      bounds,
      insets,
    });
    expect(
      boundsVisible(
        bounds,
        viewportForView(next.base, target),
        next.stage,
        insets,
      ),
    ).toBe(true);
  });

  it("holds the zoom and center of a view that did not show the path", () => {
    const previous = frame(1100);
    const next = frame(1440);
    const bounds = pathFramingBounds(path, robot)!;
    // Zoomed into an empty corner: the path is not in view to begin with.
    const view = {
      scale: 4,
      pan: clampViewPan({ x: 0, y: 0 }, previous.base, previous.stage, 4),
    };
    const before = viewportForView(previous.base, view);
    const { target } = reframeAfterResize({
      previous,
      next,
      view,
      bounds,
      insets,
    });
    const after = viewportForView(next.base, target);
    expect(after.scale).toBeCloseTo(before.scale);
  });
});

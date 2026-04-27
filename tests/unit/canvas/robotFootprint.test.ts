import { describe, expect, it } from "vitest";
import { createProjectConfig } from "../../../src/core/config/projectConfig";
import { fieldCoordinateOffsetMeters, fieldLengthMeters, fieldWidthMeters } from "../../../src/canvas/constants";
import { clampModelPoint } from "../../../src/canvas/geometry";
import {
  centeredRobotBounds,
  robotBoundsWithProtrusion,
  robotSizeFromConfig,
  strokedRectInsideBounds
} from "../../../src/canvas/robotFootprint";

describe("robot footprint geometry", () => {
  it("reads robot dimensions from project config", () => {
    const config = createProjectConfig({
      robot_length_meters: 0.82,
      robot_width_meters: 0.98
    });

    expect(robotSizeFromConfig(config)).toEqual({
      lengthMeters: 0.82,
      widthMeters: 0.98
    });
  });

  it("keeps stroked rectangle outside edges on the requested bounds", () => {
    const bounds = centeredRobotBounds(82, 98);
    const outline = strokedRectInsideBounds(bounds, 6);

    expect(outline.rect.x - outline.strokeWidth / 2).toBeCloseTo(bounds.x);
    expect(outline.rect.y - outline.strokeWidth / 2).toBeCloseTo(bounds.y);
    expect(outline.rect.x + outline.rect.width + outline.strokeWidth / 2).toBeCloseTo(
      bounds.x + bounds.width
    );
    expect(outline.rect.y + outline.rect.height + outline.strokeWidth / 2).toBeCloseTo(
      bounds.y + bounds.height
    );
  });

  it("caps stroke width for tiny configured robot sizes", () => {
    const bounds = centeredRobotBounds(1, 0.75);
    const outline = strokedRectInsideBounds(bounds, 6);

    expect(outline.strokeWidth).toBe(0.75);
    expect(outline.rect.x - outline.strokeWidth / 2).toBeCloseTo(bounds.x);
    expect(outline.rect.y - outline.strokeWidth / 2).toBeCloseTo(bounds.y);
    expect(outline.rect.x + outline.rect.width + outline.strokeWidth / 2).toBeCloseTo(
      bounds.x + bounds.width
    );
    expect(outline.rect.y + outline.rect.height + outline.strokeWidth / 2).toBeCloseTo(
      bounds.y + bounds.height
    );
  });

  it("extends protrusion bounds from the configured robot edge", () => {
    expect(
      robotBoundsWithProtrusion({
        lengthPx: 50,
        widthPx: 40,
        protrusionVisible: true,
        protrusionDistancePx: 12,
        protrusionSide: "front"
      })
    ).toEqual({
      x: -25,
      y: -20,
      width: 62,
      height: 40
    });
  });

  it("clamps model points by configured robot half extents", () => {
    const clamped = clampModelPoint(
      { x_meters: -1, y_meters: -1 },
      { lengthMeters: 0.82, widthMeters: 0.98 }
    );

    expect(clamped).toEqual({
      x_meters: 0.41,
      y_meters: 0.49
    });

    const maxClamped = clampModelPoint(
      { x_meters: 100, y_meters: 100 },
      { lengthMeters: 0.82, widthMeters: 0.98 }
    );

    expect(maxClamped).toEqual({
      x_meters: fieldLengthMeters - fieldCoordinateOffsetMeters * 2 - 0.41,
      y_meters: fieldWidthMeters - fieldCoordinateOffsetMeters * 2 - 0.49
    });
  });
});

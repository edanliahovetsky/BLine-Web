import { describe, expect, it } from "vitest";
import { createProjectConfig } from "../../../src/core/config/projectConfig";
import {
  centeredRobotBounds,
  robotBoundsWithProtrusion,
  robotProtrusionOutlineGeometry,
  robotSizeFromConfig,
  strokedRectInsideBounds,
} from "../../../src/canvas/robotFootprint";

describe("robot footprint geometry", () => {
  it("reads robot dimensions from project config", () => {
    const config = createProjectConfig({
      robot_length_meters: 0.82,
      robot_width_meters: 0.98,
    });

    expect(robotSizeFromConfig(config)).toEqual({
      lengthMeters: 0.82,
      widthMeters: 0.98,
    });
  });

  it("keeps stroked rectangle outside edges on the requested bounds", () => {
    const bounds = centeredRobotBounds(82, 98);
    const outline = strokedRectInsideBounds(bounds, 6);

    expect(outline.rect.x - outline.strokeWidth / 2).toBeCloseTo(bounds.x);
    expect(outline.rect.y - outline.strokeWidth / 2).toBeCloseTo(bounds.y);
    expect(
      outline.rect.x + outline.rect.width + outline.strokeWidth / 2,
    ).toBeCloseTo(bounds.x + bounds.width);
    expect(
      outline.rect.y + outline.rect.height + outline.strokeWidth / 2,
    ).toBeCloseTo(bounds.y + bounds.height);
  });

  it("caps stroke width for tiny configured robot sizes", () => {
    const bounds = centeredRobotBounds(1, 0.75);
    const outline = strokedRectInsideBounds(bounds, 6);

    expect(outline.strokeWidth).toBe(0.75);
    expect(outline.rect.x - outline.strokeWidth / 2).toBeCloseTo(bounds.x);
    expect(outline.rect.y - outline.strokeWidth / 2).toBeCloseTo(bounds.y);
    expect(
      outline.rect.x + outline.rect.width + outline.strokeWidth / 2,
    ).toBeCloseTo(bounds.x + bounds.width);
    expect(
      outline.rect.y + outline.rect.height + outline.strokeWidth / 2,
    ).toBeCloseTo(bounds.y + bounds.height);
  });

  it("extends protrusion bounds from the configured robot edge", () => {
    expect(
      robotBoundsWithProtrusion({
        lengthPx: 50,
        widthPx: 40,
        protrusionVisible: true,
        protrusionDistancePx: 12,
        protrusionSide: "front",
      }),
    ).toEqual({
      x: -25,
      y: -20,
      width: 62,
      height: 40,
    });
  });

  it("keeps the total outer footprint at robot size plus protrusion size", () => {
    const cases = [
      {
        protrusionSide: "front",
        expected: { x: -25, y: -20, width: 62, height: 40 },
      },
      {
        protrusionSide: "back",
        expected: { x: -37, y: -20, width: 62, height: 40 },
      },
      {
        protrusionSide: "left",
        expected: { x: -25, y: -32, width: 50, height: 52 },
      },
      {
        protrusionSide: "right",
        expected: { x: -25, y: -20, width: 50, height: 52 },
      },
    ] as const;

    for (const { protrusionSide, expected } of cases) {
      expect(
        robotBoundsWithProtrusion({
          lengthPx: 50,
          widthPx: 40,
          protrusionVisible: true,
          protrusionDistancePx: 12,
          protrusionSide,
        }),
      ).toEqual(expected);
    }
  });

  it("keeps protrusion outline outer edge at the configured distance", () => {
    const frontOutline = robotProtrusionOutlineGeometry({
      lengthPx: 50,
      widthPx: 40,
      protrusionVisible: true,
      protrusionDistancePx: 12,
      protrusionSide: "front",
      strokeWidth: 4,
    });

    expect(frontOutline).not.toBeNull();
    expect(frontOutline?.bounds).toEqual({
      x: 25,
      y: -20,
      width: 12,
      height: 40,
    });

    expect(frontOutline?.pathPoints).toEqual([
      25, -18, 35, -18, 35, 18, 25, 18,
    ]);
    expect(frontOutline?.pathData).toContain("Q");
    expect((frontOutline?.pathPoints[2] ?? 0) + 2).toBeCloseTo(37);
    expect((frontOutline?.pathPoints[3] ?? 0) - 2).toBeCloseTo(-20);
    expect((frontOutline?.pathPoints[5] ?? 0) + 2).toBeCloseTo(20);

    const rightOutline = robotProtrusionOutlineGeometry({
      lengthPx: 50,
      widthPx: 40,
      protrusionVisible: true,
      protrusionDistancePx: 8,
      protrusionSide: "right",
      strokeWidth: 4,
    });

    expect(rightOutline).not.toBeNull();
    expect(rightOutline?.bounds).toEqual({
      x: -25,
      y: 20,
      width: 50,
      height: 8,
    });

    expect(rightOutline?.pathPoints).toEqual([
      -23, 20, -23, 26, 23, 26, 23, 20,
    ]);
    expect(rightOutline?.pathData).toContain("Q");
    expect((rightOutline?.pathPoints[3] ?? 0) + 2).toBeCloseTo(28);
    expect((rightOutline?.pathPoints[0] ?? 0) - 2).toBeCloseTo(-25);
    expect((rightOutline?.pathPoints[4] ?? 0) + 2).toBeCloseTo(25);
  });

  it("keeps every protrusion stroke rooted on the robot outer edge", () => {
    const cases = [
      {
        protrusionSide: "front",
        expectedBounds: { x: 25, y: -20, width: 12, height: 40 },
        expectedPathPoints: [25, -18, 35, -18, 35, 18, 25, 18],
        rootIndexes: [0, 6],
        rootValue: 25,
        farIndexes: [2, 4],
        farValue: 35,
        minCrossIndexes: [1, 3],
        minCrossValue: -18,
        maxCrossIndexes: [5, 7],
        maxCrossValue: 18,
      },
      {
        protrusionSide: "back",
        expectedBounds: { x: -37, y: -20, width: 12, height: 40 },
        expectedPathPoints: [-25, -18, -35, -18, -35, 18, -25, 18],
        rootIndexes: [0, 6],
        rootValue: -25,
        farIndexes: [2, 4],
        farValue: -35,
        minCrossIndexes: [1, 3],
        minCrossValue: -18,
        maxCrossIndexes: [5, 7],
        maxCrossValue: 18,
      },
      {
        protrusionSide: "left",
        expectedBounds: { x: -25, y: -32, width: 50, height: 12 },
        expectedPathPoints: [-23, -20, -23, -30, 23, -30, 23, -20],
        rootIndexes: [1, 7],
        rootValue: -20,
        farIndexes: [3, 5],
        farValue: -30,
        minCrossIndexes: [0, 2],
        minCrossValue: -23,
        maxCrossIndexes: [4, 6],
        maxCrossValue: 23,
      },
      {
        protrusionSide: "right",
        expectedBounds: { x: -25, y: 20, width: 50, height: 12 },
        expectedPathPoints: [-23, 20, -23, 30, 23, 30, 23, 20],
        rootIndexes: [1, 7],
        rootValue: 20,
        farIndexes: [3, 5],
        farValue: 30,
        minCrossIndexes: [0, 2],
        minCrossValue: -23,
        maxCrossIndexes: [4, 6],
        maxCrossValue: 23,
      },
    ] as const;

    for (const testCase of cases) {
      const outline = robotProtrusionOutlineGeometry({
        lengthPx: 50,
        widthPx: 40,
        protrusionVisible: true,
        protrusionDistancePx: 12,
        protrusionSide: testCase.protrusionSide,
        strokeWidth: 4,
        rootInsetPx: 0,
      });

      expect(outline).not.toBeNull();
      expect(outline?.bounds).toEqual(testCase.expectedBounds);
      expect(outline?.pathPoints).toEqual(testCase.expectedPathPoints);

      for (const index of testCase.rootIndexes) {
        expect(outline?.pathPoints[index]).toBeCloseTo(testCase.rootValue);
      }
      for (const index of testCase.farIndexes) {
        expect(outline?.pathPoints[index]).toBeCloseTo(testCase.farValue);
      }
      for (const index of testCase.minCrossIndexes) {
        expect(outline?.pathPoints[index]).toBeCloseTo(testCase.minCrossValue);
      }
      for (const index of testCase.maxCrossIndexes) {
        expect(outline?.pathPoints[index]).toBeCloseTo(testCase.maxCrossValue);
      }
    }
  });

  it("returns one continuous protrusion path", () => {
    const outline = robotProtrusionOutlineGeometry({
      lengthPx: 50,
      widthPx: 40,
      protrusionVisible: true,
      protrusionDistancePx: 12,
      protrusionSide: "front",
      strokeWidth: 4,
      cornerRadiusPx: 4,
      rootInsetPx: 2,
    });

    expect(outline?.pathPoints).toHaveLength(8);
    expect(outline?.pathPoints.slice(0, 2)).toEqual([25, -18]);
    expect(outline?.pathPoints.slice(-2)).toEqual([25, 18]);
    expect(outline?.pathData).toContain("M 23 -16 Q 23 -18 25 -18");
    expect(outline?.pathData).toContain("L 25 18 Q 23 18 23 16");
  });

});

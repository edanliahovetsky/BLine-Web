import { describe, expect, it } from "vitest";
import {
  buildSparseCurveProfile,
  createCurveTranslationTargets,
  simplifyPolylineRdp,
  type ProfilePoint,
} from "../../../src/core/pathProfile/curveProfile";

describe("curve profile fitting", () => {
  it("reduces a dense straight stroke to its endpoints", () => {
    const points = Array.from({ length: 24 }, (_, index) => ({
      x_meters: index * 0.1,
      y_meters: 1,
    }));

    expect(simplifyPolylineRdp(points, 0.02)).toEqual([
      points[0],
      points[points.length - 1],
    ]);
  });

  it("keeps sparse points for curved strokes without over-clustering", () => {
    const arc = Array.from({ length: 60 }, (_, index) => {
      const theta = (index / 59) * (Math.PI / 2);
      return {
        x_meters: Math.cos(theta) * 2,
        y_meters: Math.sin(theta) * 2,
      };
    });

    const profile = buildSparseCurveProfile(arc, {
      toleranceMeters: 0.08,
      minSpacingMeters: 0.35,
      maxGeneratedTargets: 10,
    });

    expect(profile.points.length).toBeGreaterThan(2);
    expect(profile.points.length).toBeLessThanOrEqual(10);
    expect(minConsecutiveDistance(profile.points)).toBeGreaterThanOrEqual(0.35);
  });

  it("drops drawn endpoints that are already represented by neighboring anchors", () => {
    const targets = createCurveTranslationTargets(
      [
        { x_meters: 0, y_meters: 0 },
        { x_meters: 1, y_meters: 0.5 },
        { x_meters: 2, y_meters: 0 },
      ],
      {
        previousAnchor: { x_meters: 0.05, y_meters: 0.02 },
        nextAnchor: { x_meters: 2.03, y_meters: -0.01 },
        endpointSnapToleranceMeters: 0.12,
        toleranceMeters: 0.01,
      },
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]?.x_meters).toBeCloseTo(1, 5);
    expect(targets[0]?.y_meters).toBeCloseTo(0.5, 5);
  });

  it("uses the configured handoff radius for generated curve targets", () => {
    const targets = createCurveTranslationTargets(
      [
        { x_meters: 0, y_meters: 0 },
        { x_meters: 1, y_meters: 0 },
        { x_meters: 1, y_meters: 1 },
      ],
      {
        toleranceMeters: 0.001,
        minSpacingMeters: 0.1,
        maxGeneratedTargets: 10,
        handoffRadiusMeters: 0.45,
      },
    );

    expect(targets).toHaveLength(3);
    expect(
      targets.map((target) => target.intermediate_handoff_radius_meters),
    ).toEqual([0.45, 0.45, 0.45]);
    expect(targets.map((target) => target.handoff_radius_source)).toEqual([
      "auto",
      "auto",
      "auto",
    ]);
  });

  it("defaults generated curve target handoff radii to 0.45 meters", () => {
    const targets = createCurveTranslationTargets([
      { x_meters: 0, y_meters: 0 },
      { x_meters: 1, y_meters: 1 },
    ]);

    expect(targets).toHaveLength(2);
    expect(
      targets.map((target) => target.intermediate_handoff_radius_meters),
    ).toEqual([0.45, 0.45]);
  });
});

function minConsecutiveDistance(points: readonly ProfilePoint[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    min = Math.min(
      min,
      Math.hypot(
        point.x_meters - previous.x_meters,
        point.y_meters - previous.y_meters,
      ),
    );
  }
  return min;
}

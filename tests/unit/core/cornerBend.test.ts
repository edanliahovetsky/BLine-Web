import { describe, expect, it } from "vitest";
import {
  cornerGeometry,
  feasibleRadiusRange,
  seedRadius,
  type BendPoint,
} from "../../../src/core/bend/cornerBend";

describe("corner geometry", () => {
  it("frames a right-angle corner from its adjacent legs", () => {
    const geometry = cornerGeometry(corner(1, 1, 90), 1);

    expect(geometry).not.toBeNull();
    expect(geometry?.turnAngleRadians).toBeCloseTo(Math.PI / 2, 12);
    expect(geometry?.legInMeters).toBeCloseTo(1, 12);
    expect(geometry?.legOutMeters).toBeCloseTo(1, 12);
    expect(geometry?.inUnitX).toBeCloseTo(1, 12);
    expect(geometry?.inUnitY).toBeCloseTo(0, 12);
    expect(geometry?.outUnitX).toBeCloseTo(0, 12);
    expect(geometry?.outUnitY).toBeCloseTo(1, 12);
    expect(geometry?.bisectorX).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(geometry?.bisectorY).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it("keeps shallow turns and reports their turn angle", () => {
    const geometry = cornerGeometry(corner(2, 3, 5), 1);

    expect(geometry?.turnAngleRadians).toBeCloseTo((5 * Math.PI) / 180, 12);
    expect(geometry?.legInMeters).toBeCloseTo(2, 12);
    expect(geometry?.legOutMeters).toBeCloseTo(3, 12);
  });

  it("points the bisector back down the incoming leg at a reversal", () => {
    const geometry = cornerGeometry(
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 0 },
      ],
      1,
    );

    expect(geometry?.turnAngleRadians).toBeCloseTo(Math.PI, 12);
    expect(geometry?.bisectorX).toBeCloseTo(-1, 12);
    expect(geometry?.bisectorY).toBeCloseTo(0, 12);
  });

  it("returns null for endpoints and out-of-range indices", () => {
    const points = corner(1, 1, 90);

    expect(cornerGeometry(points, 0)).toBeNull();
    expect(cornerGeometry(points, 2)).toBeNull();
    expect(cornerGeometry(points, -1)).toBeNull();
    expect(cornerGeometry(points, 1.5)).toBeNull();
  });

  it("returns null for collinear corners", () => {
    expect(cornerGeometry(corner(1, 1, 0), 1)).toBeNull();
    expect(cornerGeometry(corner(1, 1, 0.5), 1)).toBeNull();
  });

  it("returns null when an adjacent leg is degenerate", () => {
    expect(
      cornerGeometry(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        1,
      ),
    ).toBeNull();
    expect(cornerGeometry(corner(1, 1e-9, 90), 1)).toBeNull();
  });
});

describe("feasible radius range", () => {
  it("bounds the range by progress available on the incoming leg", () => {
    const range = feasibleRadiusRange(cornerGeometry(corner(2, 1, 90), 1));

    expect(range).toEqual({ minMeters: 0.05, maxMeters: 1.8 });
  });

  it("is empty when the legs cannot fit the smallest radius", () => {
    expect(feasibleRadiusRange(cornerGeometry(corner(0.05, 1, 90), 1))).toBe(
      null,
    );
    expect(feasibleRadiusRange(null)).toBeNull();
  });

  it.each([0.299, 0.3, 0.301])(
    "allows %s meter legs when the incoming leg fits the minimum radius",
    (length) => {
      const range = feasibleRadiusRange(
        cornerGeometry(corner(length, length, 90), 1),
      );

      expect(range?.minMeters).toBe(0.05);
      expect(range?.maxMeters).toBeCloseTo(0.9 * length, 12);
    },
  );

  it("does not restrict a radius to the outgoing leg length", () => {
    expect(feasibleRadiusRange(cornerGeometry(corner(1, 0.01, 90), 1))).toEqual(
      {
        minMeters: 0.05,
        maxMeters: 0.9,
      },
    );
  });

  it("keeps the minimum when the incoming leg can only just fit it", () => {
    expect(
      feasibleRadiusRange(cornerGeometry(corner(0.0555, 1, 90), 1)),
    ).toBeNull();
    expect(
      feasibleRadiusRange(cornerGeometry(corner(0.0556, 1, 90), 1)),
    ).toEqual({
      minMeters: 0.05,
      maxMeters: 0.05004,
    });
  });
});

describe("seed radius", () => {
  it("starts every corner at a stable incoming-leg fraction", () => {
    expect(seedRadius(cornerGeometry(corner(4, 4, 90), 1))).toBeCloseTo(
      1.96,
      12,
    );
  });

  it("does not tighten sharp corners before measured validation", () => {
    const shallow = seedRadius(cornerGeometry(corner(4, 4, 30), 1));
    const sharp = seedRadius(cornerGeometry(corner(4, 4, 150), 1));
    const reversal = seedRadius(cornerGeometry(corner(4, 4, 180), 1));

    expect(shallow).toBeCloseTo(1.96, 12);
    expect(sharp).toBeCloseTo(shallow ?? 0, 12);
    expect(reversal).toBeCloseTo(shallow ?? 0, 12);
  });

  it("does not let a short outgoing leg cap the trigger radius", () => {
    expect(seedRadius(cornerGeometry(corner(2, 0.01, 90), 1))).toBeCloseTo(
      0.98,
      12,
    );
  });

  it("scales short incoming legs without using the outgoing length", () => {
    expect(seedRadius(cornerGeometry(corner(0.3, 2, 90), 1))).toBeCloseTo(
      0.147,
      12,
    );
  });

  it("returns null where no radius is feasible", () => {
    expect(seedRadius(cornerGeometry(corner(0.05, 1, 90), 1))).toBeNull();
    expect(seedRadius(null)).toBeNull();
  });

  it.each([0.0556, 0.06, 0.1])(
    "clamps the seed to the 0.05 meter floor on a %s meter incoming leg",
    (length) => {
      expect(seedRadius(cornerGeometry(corner(length, 1, 90), 1))).toBe(0.05);
    },
  );
});

function corner(
  legInMeters: number,
  legOutMeters: number,
  turnDegrees: number,
): BendPoint[] {
  const turnAngle = (turnDegrees * Math.PI) / 180;

  return [
    { x: -legInMeters, y: 0 },
    { x: 0, y: 0 },
    {
      x: Math.cos(turnAngle) * legOutMeters,
      y: Math.sin(turnAngle) * legOutMeters,
    },
  ];
}

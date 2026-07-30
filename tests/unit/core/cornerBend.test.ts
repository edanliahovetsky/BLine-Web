import { describe, expect, it } from "vitest";
import {
  cornerGeometry,
  corridorDeviationForRadius,
  deviationForRadius,
  feasibleRadiusRange,
  radiusForCorridorDeviation,
  radiusForDeviation,
  repairChaining,
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
});

describe("fillet radius and deviation mapping", () => {
  it("matches the fillet sagitta for the turn angle", () => {
    for (const turnDegrees of [30, 90, 150]) {
      const turnAngle = (turnDegrees * Math.PI) / 180;
      const filletRadius = 0.4 / Math.tan(turnAngle / 2);

      expect(deviationForRadius(0.4, turnAngle)).toBeCloseTo(
        filletRadius * (1 / Math.cos(turnAngle / 2) - 1),
        12,
      );
    }
  });

  it("round-trips a deviation back to its radius", () => {
    for (const turnDegrees of [1.5, 15, 90, 179]) {
      const turnAngle = (turnDegrees * Math.PI) / 180;
      for (const radiusMeters of [0.05, 0.3, 1.2]) {
        expect(
          radiusForDeviation(
            deviationForRadius(radiusMeters, turnAngle),
            turnAngle,
          ),
        ).toBeCloseTo(radiusMeters, 12);
      }
    }
  });

  it("stays finite as the turn angle approaches its limits", () => {
    expect(deviationForRadius(0.4, Math.PI)).toBeCloseTo(0.4, 12);
    expect(radiusForDeviation(0.4, Math.PI)).toBeCloseTo(0.4, 12);
    expect(deviationForRadius(0.4, 0.019)).toBe(0);
    expect(radiusForDeviation(0.4, 0.019)).toBe(0);
  });

  it("clamps degenerate inputs to zero", () => {
    expect(deviationForRadius(-1, Math.PI / 2)).toBe(0);
    expect(radiusForDeviation(-1, Math.PI / 2)).toBe(0);
    expect(deviationForRadius(Number.NaN, Math.PI / 2)).toBe(0);
    expect(radiusForDeviation(0.4, Number.NaN)).toBe(0);
    expect(deviationForRadius(0.4, 4 * Math.PI)).toBeCloseTo(0.4, 12);
  });

  it("projects vertex deviation onto the local polyline corridor", () => {
    const radiusMeters = 1.2;
    const turnAngle = (149.2 * Math.PI) / 180;

    expect(corridorDeviationForRadius(radiusMeters, turnAngle)).toBeCloseTo(
      radiusMeters * Math.tan(turnAngle / 4) * Math.cos(turnAngle / 2),
      12,
    );
    expect(
      radiusForCorridorDeviation(
        corridorDeviationForRadius(radiusMeters, turnAngle),
        turnAngle,
      ),
    ).toBeCloseTo(radiusMeters, 12);
  });

  it("charges no corridor deviation for a true reversal", () => {
    expect(corridorDeviationForRadius(1.5, Math.PI)).toBeCloseTo(0, 12);
    expect(radiusForCorridorDeviation(0.26, Math.PI)).toBe(
      Number.POSITIVE_INFINITY,
    );
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
    expect(seedRadius(cornerGeometry(corner(2, 0.3, 90), 1))).toBeCloseTo(
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
});

describe("chaining repair", () => {
  it("leaves radii that fit their shared leg", () => {
    const points: BendPoint[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ];

    expect(repairChaining([null, 0.3, 0.4, null], points)).toEqual([
      null,
      0.3,
      0.4,
      null,
    ]);
  });

  it("scales overlapping neighbors down proportionally", () => {
    const points: BendPoint[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ];

    const repaired = repairChaining([null, 0.6, 0.9, null], points);

    expect(repaired[1]).toBeCloseTo(0.36, 12);
    expect(repaired[2]).toBeCloseTo(0.54, 12);
    expect((repaired[1] ?? 0) + (repaired[2] ?? 0)).toBeCloseTo(0.9, 12);
    expect((repaired[1] ?? 0) / (repaired[2] ?? 1)).toBeCloseTo(0.6 / 0.9, 12);
  });

  it("settles a run of corners that each overrun their shared leg", () => {
    const points: BendPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ];

    const repaired = repairChaining([null, 0.8, 0.8, 0.8, null], points);

    for (let index = 1; index < 3; index += 1) {
      expect((repaired[index] ?? 0) + (repaired[index + 1] ?? 0)).toBeLessThan(
        0.9 + 1e-9,
      );
    }
  });

  it("keeps untuned corners untouched and sanitizes bad values", () => {
    const points: BendPoint[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
    ];

    expect(repairChaining([null, Number.NaN, -0.2], points)).toEqual([
      null,
      null,
      0,
    ]);
  });
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

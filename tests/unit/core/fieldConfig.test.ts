import { describe, expect, it } from "vitest";
import {
  clampPointToFieldCoordinates,
  coordinateEditBounds,
  fieldCoordinateBounds,
  fieldCoordinateOffsetMaximumMeters,
  isPointWithinFieldCoordinates,
  movePointWithinFieldCoordinates,
  normalizeFieldCoordinateGeometry,
  type FieldGeometry,
} from "../../../src/core/field/fieldConfig";

const asymmetricField: FieldGeometry = {
  length_meters: 10,
  width_meters: 6,
  coordinate_offset_meters: 0,
  coordinate_offset_x_meters: 1,
  coordinate_offset_y_meters: 0.5,
};

describe("field coordinate bounds", () => {
  it("derives the effective coordinate domain from per-axis offsets", () => {
    expect(fieldCoordinateBounds(asymmetricField)).toEqual({
      minX: 0,
      maxX: 8,
      minY: 0,
      maxY: 5,
    });
    expect(
      isPointWithinFieldCoordinates(
        { x_meters: 8, y_meters: 5 },
        asymmetricField,
      ),
    ).toBe(true);
    expect(
      isPointWithinFieldCoordinates(
        { x_meters: 8.01, y_meters: 5 },
        asymmetricField,
      ),
    ).toBe(false);
    expect(
      isPointWithinFieldCoordinates(
        { x_meters: Number.NaN, y_meters: 5 },
        asymmetricField,
      ),
    ).toBe(false);
  });

  it("clamps points without discarding their other properties", () => {
    expect(
      clampPointToFieldCoordinates(
        { x_meters: 9, y_meters: -1, label: "retained" },
        asymmetricField,
      ),
    ).toEqual({ x_meters: 8, y_meters: 0, label: "retained" });
  });

  it("lets an existing overflow recover without increasing or crossing it", () => {
    expect(coordinateEditBounds(9, 8)).toEqual({ min: 0, max: 9 });

    expect(coordinateEditBounds(-1, 8)).toEqual({ min: -1, max: 8 });

    expect(coordinateEditBounds(4, 8)).toEqual({ min: 0, max: 8 });
  });

  it("nudges overflow inward without jumping or allowing outward movement", () => {
    const outside = { x_meters: 9, y_meters: 3 };
    expect(
      movePointWithinFieldCoordinates(outside, 0.05, 0, asymmetricField),
    ).toEqual(outside);
    expect(
      movePointWithinFieldCoordinates(outside, -0.05, 0, asymmetricField),
    ).toEqual({ x_meters: 8.95, y_meters: 3 });
    expect(
      movePointWithinFieldCoordinates(
        { x_meters: 8, y_meters: 0 },
        0.05,
        -0.05,
        asymmetricField,
      ),
    ).toEqual({ x_meters: 8, y_meters: 0 });
  });

  it("keeps image padding below half of each Field dimension", () => {
    const normalized = normalizeFieldCoordinateGeometry({
      length_meters: 0.5,
      width_meters: 1,
      coordinate_offset_meters: 5,
      coordinate_offset_x_meters: 5,
      coordinate_offset_y_meters: -1,
    });

    expect(normalized.coordinate_offset_x_meters).toBe(
      fieldCoordinateOffsetMaximumMeters(0.5),
    );
    expect(normalized.coordinate_offset_y_meters).toBe(0);
    expect(normalized.coordinate_offset_meters).toBe(
      fieldCoordinateOffsetMaximumMeters(0.5),
    );
    const bounds = fieldCoordinateBounds(normalized);
    expect(bounds.minX).toBe(0);
    expect(bounds.maxX).toBeCloseTo(0.01);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxY).toBe(1);
  });
});

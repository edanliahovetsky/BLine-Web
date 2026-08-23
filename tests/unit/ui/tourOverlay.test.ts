import { describe, expect, it } from "vitest";
import { paddedViewportRect } from "../../../src/ui/tours/tourGeometry";

describe("tour spotlight geometry", () => {
  it("keeps padded targets inside the viewport", () => {
    expect(
      paddedViewportRect(
        { top: 48, left: 1260, right: 1600, bottom: 870 },
        1600,
        900,
      ),
    ).toEqual({ top: 42, left: 1254, width: 346, height: 834 });

    expect(
      paddedViewportRect(
        { top: 48, left: 0, right: 1260, bottom: 870 },
        1600,
        900,
      ),
    ).toEqual({ top: 42, left: 0, width: 1266, height: 834 });

    expect(
      paddedViewportRect(
        { top: 2, left: 20, right: 180, bottom: 40 },
        1600,
        900,
      ),
    ).toEqual({ top: 0, left: 14, width: 172, height: 46 });
  });

  it("drops targets that are completely outside the viewport", () => {
    expect(
      paddedViewportRect(
        { top: 100, left: 1700, right: 1800, bottom: 200 },
        1600,
        900,
      ),
    ).toBeNull();
  });
});

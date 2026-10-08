import { describe, expect, it } from "vitest";
import { wheelZoomFactor } from "../../../src/canvas/wheelZoom";

describe("wheel zoom", () => {
  it("keeps the established step for small trackpad deltas", () => {
    expect(wheelZoomFactor({ deltaY: -4 })).toBeCloseTo(1.03);
    expect(wheelZoomFactor({ deltaY: 4 })).toBeCloseTo(1 / 1.03);
  });

  it("scales between the trackpad step and a ten percent mouse notch", () => {
    expect(wheelZoomFactor({ deltaY: -100 })).toBeCloseTo(1.1);
    expect(wheelZoomFactor({ deltaY: 100 })).toBeCloseTo(1 / 1.1);
    expect(wheelZoomFactor({ deltaY: -60 })).toBeCloseTo(
      Math.exp((60 * Math.log(1.1)) / 100),
    );
  });

  it("treats line-mode deltas as pixels and caps a single event", () => {
    expect(wheelZoomFactor({ deltaY: -3, deltaMode: 1 })).toBeCloseTo(
      Math.exp((48 * Math.log(1.1)) / 100),
    );
    expect(wheelZoomFactor({ deltaY: -400 })).toBe(1.1);
    expect(wheelZoomFactor({ deltaY: -5000 })).toBe(1.1);
    expect(wheelZoomFactor({ deltaY: 1, deltaMode: 2 })).toBe(1 / 1.1);
  });

  it("ignores empty or invalid deltas", () => {
    expect(wheelZoomFactor({ deltaY: 0 })).toBe(1);
    expect(wheelZoomFactor({ deltaY: Number.NaN })).toBe(1);
  });
});

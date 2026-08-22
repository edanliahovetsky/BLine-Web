import { describe, expect, it } from "vitest";
import { handoffRingRadiusPx } from "../../../src/canvas/handoffRadiusInteraction";

describe("handoff radius canvas rendering", () => {
  it("keeps small radii visible at low zoom", () => {
    expect(handoffRingRadiusPx(0.05, 20)).toBe(8);
  });
});

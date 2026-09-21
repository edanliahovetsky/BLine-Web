import { describe, expect, it } from "vitest";
import { handoffRingRadiusPx } from "../../../src/canvas/handoffRadiusInteraction";

describe("handoff radius canvas rendering", () => {
  it("keeps small radii visible at low zoom", () => {
    expect(handoffRingRadiusPx(0.05, 20)).toBe(8);
  });
});

import { progressHandoffGate } from "../../../src/canvas/progressHandoffGate";
import { handoffReached } from "../../../src/core/model/handoffModes";

it("keeps a symmetric six-dash progress gate perpendicular at every zoom, independent of handoff distance", () => {
  for (const scale of [5, 25, 80, 500]) {
    // A 3-4-5 diagonal incoming segment, expressed in stage pixels.
    const start = { x: 2 * scale, y: 3 * scale };
    const end = { x: 5 * scale, y: 7 * scale };
    for (const distance of [0, 0.4, 2, 7]) {
      const gate = progressHandoffGate(start, end, distance, scale)!;
      const length = Math.max(30, 1.2 * scale);
      expect(gate.dashes).toHaveLength(6);
      const remaining = Math.min(distance, 5) * scale;
      expect(gate.center.x).toBeCloseTo(end.x - 0.6 * remaining);
      expect(gate.center.y).toBeCloseTo(end.y - 0.8 * remaining);
      const spans = gate.dashes.map(({ start: a, end: b }) =>
        Math.hypot(b.x - a.x, b.y - a.y),
      );
      expect(spans[0]).toBeCloseTo(length / 20);
      expect(spans.at(-1)).toBeCloseTo(length / 20);
      for (const span of spans.slice(1, -1))
        expect(span).toBeCloseTo(length / 10);
      for (const [index, dash] of gate.dashes.entries()) {
        const opposite = gate.dashes[5 - index];
        expect((dash.start.x + opposite.end.x) / 2).toBeCloseTo(gate.center.x);
        expect((dash.start.y + opposite.end.y) / 2).toBeCloseTo(gate.center.y);
        // The gate is orthogonal to the incoming segment, rather than the outgoing turn.
        expect(
          (dash.end.x - dash.start.x) * 0.6 + (dash.end.y - dash.start.y) * 0.8,
        ).toBeCloseTo(0);
        if (index > 0) {
          const previous = gate.dashes[index - 1].end;
          expect(
            Math.hypot(dash.start.x - previous.x, dash.start.y - previous.y),
          ).toBeCloseTo(length / 10);
        }
      }
    }
  }
  expect(
    progressHandoffGate({ x: 2, y: 3 }, { x: 2, y: 3 }, 0.4, 80),
  ).toBeNull();
  // Being far beyond the drawn endpoints does not impose a lateral constraint.
  expect(handoffReached("progress", 100, 4.6, 5, 0.4)).toBe(true);
  expect(handoffReached("radius", 100, 4.6, 5, 0.4)).toBe(false);
});

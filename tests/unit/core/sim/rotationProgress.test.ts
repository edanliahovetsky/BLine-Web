import { describe, expect, it } from "vitest";
import { RotationProgress } from "../../../../src/core/sim/rotationProgress";
import type { RotationKeyframe } from "../../../../src/core/sim/types";

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const frames = (...values: [number, number][]): RotationKeyframe[] =>
  values.map(([s_m, degrees], index) => ({
    s_m,
    theta_target: rad(degrees),
    event_ordinal_1b: index + 1,
    profiled_rotation: true,
  }));

describe("rotation progress", () => {
  it("keeps heading continuous across early handoff and joins a cut corner at the old request", () => {
    const schedule = new RotationProgress(
      [
        { ax: 0, ay: 0, bx: 2, by: 0 },
        { ax: 2, ay: 0, bx: 2, by: 2 },
      ],
      frames([0, 0], [2, 90], [4, 180]),
      0,
    );
    expect(schedule.update(1.6, 0.39, 0).headingRadians).toBeCloseTo(rad(72));
    // Translation has handed off, but its next segment is still farther away.
    expect(schedule.update(1.6, 0.39, 1).headingRadians).toBeCloseTo(rad(72));
    const join = schedule.update(1.61, 0.4, 1);
    expect(join.progressMeters).toBeCloseTo(2.4);
    expect(join.headingRadians).toBeCloseTo(rad(72.45));
    expect(schedule.update(2, 1.2, 1).headingRadians).toBeCloseTo(rad(126.225));
    // A backward disturbance must not replay the rotation schedule.
    expect(schedule.update(2, 0.8, 1).headingRadians).toBeCloseTo(rad(126.225));
    expect(schedule.update(2, 2, 1).headingRadians).toBeCloseTo(rad(180));
  });

  it("unwraps headings across pi and never jumps to a nearby nonadjacent segment", () => {
    const schedule = new RotationProgress(
      [
        { ax: 0, ay: 0, bx: 2, by: 0 },
        { ax: 2, ay: 0, bx: 2, by: 2 },
        { ax: 2, ay: 2, bx: 0, by: 0 },
      ],
      frames([0, 170], [2, -170], [4, -150], [4 + Math.sqrt(8), 0]),
      rad(170),
    );
    const sample = schedule.update(1, 0, 2);
    expect(sample.progressMeters).toBeCloseTo(1);
    expect(sample.headingRadians).toBeCloseTo(Math.PI);
  });

  it("can traverse coincident and retraced legs without reversing accepted progress", () => {
    const schedule = new RotationProgress(
      [
        { ax: 0, ay: 0, bx: 0, by: 0 },
        { ax: 0, ay: 0, bx: 2, by: 0 },
        { ax: 2, ay: 0, bx: 0, by: 0 },
      ],
      frames([0, 0], [2, 90], [4, 180]),
      0,
    );
    expect(schedule.update(1.5, 0, 1).headingRadians).toBeCloseTo(rad(67.5));
    const turned = schedule.update(1.4, 0, 2);
    expect(turned.progressMeters).toBeCloseTo(2.6);
    expect(turned.headingRadians).toBeCloseTo(rad(67.5));
    expect(schedule.update(0, 0, 2).headingRadians).toBeCloseTo(Math.PI);
  });
});

import { describe, expect, it } from "vitest";
import { simulatePathWithTrace } from "../../../src/core/sim";
import {
  canvasLessonTiming,
  firstHandoff,
  handoffPulseAtTime,
} from "../../../src/ui/tours/handoffTrace";
import {
  createHandoffPath,
  practiceConfig,
} from "../../../src/ui/tours/tourScenario";

describe("canvas handoff lesson", () => {
  const result = simulatePathWithTrace(createHandoffPath(), practiceConfig(), {
    dt_s: 0.02,
  });
  it("pulses only when the simulator switches the active target", () => {
    const handoff = firstHandoff(result.trace)!;
    expect(handoff).not.toBeNull();
    expect(handoffPulseAtTime(result.trace, handoff.time - 0.01)).toBe(0);
    expect(handoffPulseAtTime(result.trace, handoff.time)).toBe(1);
    expect(handoffPulseAtTime(result.trace, handoff.time + 0.12)).toBeCloseTo(
      0.5,
    );
    expect(handoffPulseAtTime(result.trace, handoff.time + 0.3)).toBe(0);
  });
  it("joins three playback phases continuously and slows the actual crossing", () => {
    const phases = (
      ["handoff-approach", "handoff-crossing", "handoff-departure"] as const
    ).map((phase) =>
      canvasLessonTiming(phase, result.trace, result.total_time_s),
    );
    expect(phases[0].start).toBe(0);
    expect(phases[0].end).toBe(phases[1].start);
    expect(phases[1].end).toBe(phases[2].start);
    expect(phases[2].end).toBe(result.total_time_s);
    expect(phases[1].rate).toBeLessThan(phases[0].rate);
    expect(phases[1].zoom).toBeGreaterThan(phases[2].zoom);
    const handoff = firstHandoff(result.trace)!;
    expect(phases[1].start).toBeLessThan(handoff.time);
    expect(phases[1].end).toBeGreaterThan(handoff.time);
  });
});

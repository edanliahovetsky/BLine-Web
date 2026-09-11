import type { SimulationTraceSample } from "../../core/sim";
import type { TourStep } from "./tourStore";

/** The simulator changes targets before integrating the next trace sample. */
export function firstHandoff(trace: readonly SimulationTraceSample[]) {
  const index = trace.findIndex(
    (sample, i) =>
      i > 0 &&
      sample.target_anchor_ordinal_1b > trace[i - 1].target_anchor_ordinal_1b,
  );
  if (index < 1) return null;
  return {
    x: trace[index - 1].x_m,
    y: trace[index - 1].y_m,
    time: trace[index].time_s,
  };
}

/** Only the actual active-target transition flashes the robot. */
export function handoffPulseAtTime(
  trace: readonly SimulationTraceSample[],
  time: number,
) {
  const handoff = firstHandoff(trace);
  if (!handoff || time < handoff.time || time > handoff.time + 0.24) return 0;
  return 1 - (time - handoff.time) / 0.24;
}

export function canvasLessonTiming(
  phase: NonNullable<TourStep["canvasLesson"]>,
  trace: readonly SimulationTraceSample[],
  duration: number,
) {
  const handoff = firstHandoff(trace);
  const time = handoff?.time ?? duration / 2;
  const before = Math.max(0, time - 0.3);
  const after = Math.min(duration, time + 0.4);
  switch (phase) {
    case "handoff-approach":
      return { start: 0, end: before, rate: 0.8, zoom: 1.3 };
    case "handoff-crossing":
      return { start: before, end: after, rate: 0.16, zoom: 2.8 };
    case "handoff-departure":
      return { start: after, end: duration, rate: 0.8, zoom: 1.15 };
    case "low-acceleration":
      return { start: 0, end: duration, rate: 1, zoom: 1 };
  }
}

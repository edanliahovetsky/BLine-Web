import type { SimulationTraceSample } from "../../core/sim";

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

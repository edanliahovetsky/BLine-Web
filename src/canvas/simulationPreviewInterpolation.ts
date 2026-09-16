import type { SimTraceResult, SimulationTraceSample } from "../core/sim/types";

export const previewBlendDurationMs = 80;
export const maximumBlendSamples = 512;

const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;
const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

function blendSample(
  from: SimulationTraceSample,
  to: SimulationTraceSample,
  amount: number,
): SimulationTraceSample {
  return {
    ...to,
    time_s: lerp(from.time_s, to.time_s, amount),
    x_m: lerp(from.x_m, to.x_m, amount),
    y_m: lerp(from.y_m, to.y_m, amount),
    theta_rad:
      from.theta_rad + angleDelta(from.theta_rad, to.theta_rad) * amount,
    speed_mps: lerp(from.speed_mps, to.speed_mps, amount),
    global_s_m: lerp(from.global_s_m, to.global_s_m, amount),
  };
}

/** Pair actual simulation samples at equivalent playback progress, once per result. */
function resample(
  result: SimTraceResult,
  count: number,
): SimulationTraceSample[] {
  const trace = result.trace;
  let cursor = 0;
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return trace[0];
    if (index === count - 1) return trace[trace.length - 1];
    const time = lerp(
      trace[0].time_s,
      trace[trace.length - 1].time_s,
      index / (count - 1),
    );
    while (cursor < trace.length - 2 && trace[cursor + 1].time_s <= time)
      cursor++;
    const from = trace[cursor],
      to = trace[cursor + 1] ?? from;
    const duration = to.time_s - from.time_s;
    return blendSample(
      from,
      to,
      duration > 0
        ? Math.max(0, Math.min(1, (time - from.time_s) / duration))
        : 1,
    );
  });
}

/** Display-only lerp between completed simulations. Never reads or reshapes authored geometry. */
export class SimulationPreviewInterpolation {
  private from: SimTraceResult | null;
  private target: SimTraceResult | null;
  private pairs: Array<{
    from: SimulationTraceSample;
    to: SimulationTraceSample;
  }> = [];
  private startedAt = -Infinity;

  constructor(initial: SimTraceResult | null) {
    this.from = this.target = initial;
  }

  retarget(result: SimTraceResult, now: number): void {
    // A new solve arriving mid-blend starts at the currently displayed curve.
    this.from = this.sample(now);
    this.target = result;
    this.startedAt = now;
    this.pairs = [];
    if (!this.from?.trace.length || !result.trace.length) return;
    const count = Math.min(
      maximumBlendSamples,
      Math.max(this.from.trace.length, result.trace.length),
    );
    const from = resample(this.from, count),
      to = resample(result, count);
    this.pairs = to.map((sample, index) => ({ from: from[index], to: sample }));
  }

  isAnimating(now: number): boolean {
    return (
      this.pairs.length > 0 && now - this.startedAt < previewBlendDurationMs
    );
  }

  sample(now: number): SimTraceResult | null {
    if (!this.from || !this.target || !this.isAnimating(now))
      return this.target;
    const amount = Math.max(
      0,
      Math.min(1, (now - this.startedAt) / previewBlendDurationMs),
    );
    if (amount === 0) return this.from;
    const trace = this.pairs.map(({ from, to }) =>
      blendSample(from, to, amount),
    );
    const poses = new Map(
      trace.map((sample) => [
        sample.time_s,
        [sample.x_m, sample.y_m, sample.theta_rad] as const,
      ]),
    );
    return {
      ...this.target,
      total_time_s: lerp(
        this.from.total_time_s,
        this.target.total_time_s,
        amount,
      ),
      trace,
      poses_by_time: poses,
      times_sorted: [...poses.keys()],
      global_s_by_time: new Map(
        trace.map((sample) => [sample.time_s, sample.global_s_m]),
      ),
      trail_points: trace.map((sample) => [sample.x_m, sample.y_m] as const),
    };
  }
}

import {
  isTranslationTarget,
  isWaypoint,
  type PathModel,
} from "../core/model/path";
import type { SimTraceResult, SimulationTraceSample } from "../core/sim/types";

// Bound both per-frame geometry work and the amount of ink rebuilt by Pixi.
export const maximumPreviewSamples = 512;

function anchors(path: PathModel) {
  return path.path_elements.flatMap((element) => {
    const target = isWaypoint(element)
      ? element.translation_target
      : isTranslationTarget(element)
        ? element
        : null;
    return target ? [{ x: target.x_meters, y: target.y_meters }] : [];
  });
}

export function prepareSimulationPreview(
  path: PathModel,
  result: SimTraceResult,
) {
  const points = anchors(path);
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(
      cumulative[i - 1] +
        Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y,
        ),
    );
  }
  const count = Math.min(maximumPreviewSamples, result.trace.length);
  const samples = Array.from({ length: count }, (_, index) => {
    const sample =
      result.trace[
        Math.round((index * (result.trace.length - 1)) / Math.max(1, count - 1))
      ];
    const from = Math.max(0, Math.min(points.length - 2, sample.segment_index));
    const to = Math.min(from + 1, points.length - 1);
    const length = cumulative[to] - cumulative[from];
    const progress =
      length > 1e-9
        ? Math.max(
            0,
            Math.min(1, (sample.global_s_m - cumulative[from]) / length),
          )
        : 1;
    // Zero slope at each anchor avoids a kink in the deformation at handoffs.
    const weight = progress * progress * (3 - 2 * progress);
    return { sample, from, to, weight };
  });
  return { points, samples, result };
}

/** A visual estimate only: move the existing trace with the edited anchors.
 * It never solves dynamics, changes timing/constraints, or touches the project.
 */
export function deformSimulationPreview(
  prepared: ReturnType<typeof prepareSimulationPreview>,
  preview: PathModel,
): SimTraceResult {
  const next = anchors(preview);
  if (next.length < 2 || next.length !== prepared.points.length)
    return prepared.result;
  const deltas = next.map((point, index) => ({
    x: point.x - prepared.points[index].x,
    y: point.y - prepared.points[index].y,
  }));
  const trace: SimulationTraceSample[] = prepared.samples.map(
    ({ sample, from, to, weight }) => ({
      ...sample,
      x_m: sample.x_m + deltas[from].x * (1 - weight) + deltas[to].x * weight,
      y_m: sample.y_m + deltas[from].y * (1 - weight) + deltas[to].y * weight,
    }),
  );
  const poses = new Map(
    trace.map((sample) => [
      sample.time_s,
      [sample.x_m, sample.y_m, sample.theta_rad] as const,
    ]),
  );
  return {
    ...prepared.result,
    trace,
    times_sorted: [...poses.keys()],
    poses_by_time: poses,
    trail_points: trace.map((sample) => [sample.x_m, sample.y_m] as const),
  };
}

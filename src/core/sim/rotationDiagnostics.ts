import { shortestAngularDistance, wrapAngleRadians } from "./simGeometry";
import type {
  AuthoredRotationTarget,
  RotationTargetDiagnostic,
  SimulationTraceSample,
} from "./types";

export const rotationTargetToleranceRadians = (0.5 * Math.PI) / 180;

/**
 * Evaluates heading at the first trace crossing of each fixed path distance.
 * Both inputs are monotone in path distance, so the sweep is O(samples +
 * targets). A terminal target is intentionally judged on arrival, before any
 * later in-place rotation at the same final path distance.
 */
export function evaluateRotationTargets(
  targets: readonly AuthoredRotationTarget[],
  trace: readonly SimulationTraceSample[],
): RotationTargetDiagnostic[] {
  if (targets.length === 0) {
    return [];
  }

  let traceIndex = 0;
  return targets.map((target) => {
    while (
      traceIndex < trace.length &&
      (trace[traceIndex]?.global_s_m ?? Number.NEGATIVE_INFINITY) <
        target.s_m - 1e-9
    ) {
      traceIndex += 1;
    }

    const actualTheta = headingAtFirstCrossing(trace, traceIndex, target.s_m);
    const error =
      actualTheta === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(shortestAngularDistance(target.theta_target, actualTheta));

    return {
      event_ordinal_1b: target.event_ordinal_1b,
      path_element_index: target.path_element_index,
      s_m: target.s_m,
      target_theta_rad: target.theta_target,
      actual_theta_rad: actualTheta,
      error_rad: error,
      tolerance_rad: rotationTargetToleranceRadians,
      passed: error <= rotationTargetToleranceRadians,
    };
  });
}

function headingAtFirstCrossing(
  trace: readonly SimulationTraceSample[],
  index: number,
  targetSMeters: number,
): number | null {
  const current = trace[index];
  if (!current) {
    return null;
  }
  const previous = trace[index - 1];
  if (!previous || targetSMeters <= previous.global_s_m + 1e-9) {
    return current.theta_rad;
  }

  const distanceDelta = current.global_s_m - previous.global_s_m;
  if (distanceDelta <= 1e-9) {
    return current.theta_rad;
  }
  const alpha = Math.max(
    0,
    Math.min(1, (targetSMeters - previous.global_s_m) / distanceDelta),
  );
  return wrapAngleRadians(
    previous.theta_rad +
      shortestAngularDistance(current.theta_rad, previous.theta_rad) * alpha,
  );
}

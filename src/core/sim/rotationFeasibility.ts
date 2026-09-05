import { getDefaultOptionalConfigValue } from "../config/projectConfig";
import type { PathModel, RangedConstraintKey } from "../model/path";
import { buildGlobalRotationTargets, buildSegments } from "./simulatePath";
import { shortestAngularDistance } from "./simGeometry";
import { profiledRotationReachability } from "./profiledRotationReachability";
import { rotationTargetToleranceRadians } from "./rotationDiagnostics";
import type { SimulationConfig, SimulationTraceSample } from "./types";

export interface RotationFeasibilityDiagnostic {
  elementIndex: number;
  eventOrdinal: number;
  deadlineS: number | null;
  availableTimeS: number;
  requiredTimeS: number;
  passed: boolean;
  reason:
    | "reachable"
    | "insufficient-time"
    | "unreached"
    | "conflicting-targets"
    | "angular-transition"
    | "profile-limits"
    | "profile-handoff";
  profileViolation?: number;
}

type VelocityRange = readonly [number, number];
const numericalEpsilon = 1e-9;

/**
 * Kinematic reachability, independent of the preview's angular controller.
 * A profiled interval may carry angular velocity into the next same-direction
 * interval. Unprofiled targets complete a turn and hold; reversals and the last
 * target also require zero angular velocity. No interval can take a longer
 * angular route or overshoot and reverse merely to consume spare time.
 */
export function evaluateRotationFeasibility(
  path: PathModel,
  config: SimulationConfig,
  trace: readonly SimulationTraceSample[],
): RotationFeasibilityDiagnostic[] {
  const { anchors, segments, cumulativeLengths } = buildSegments(path);
  const targets = buildGlobalRotationTargets(path, anchors, cumulativeLengths);
  if (targets.length === 0 || anchors.length < 2) return [];

  let previousHeading = trace[0]?.theta_rad ?? 0;
  let previousTime = 0;
  let velocities: VelocityRange = [0, 0];
  let sampleIndex = 0;
  let previousDistance = 0;

  return targets.map((target, index) => {
    // The last rotation on an incoming leg retires when that leg hands off,
    // even if the nominal target point itself was cut by the corner radius.
    const segmentIndex = Math.max(
      0,
      cumulativeLengths.findIndex(
        (s, i) => i > 0 && s >= target.s_m - numericalEpsilon,
      ) - 1,
    );
    while (
      sampleIndex < trace.length &&
      trace[sampleIndex]!.global_s_m < target.s_m - numericalEpsilon &&
      trace[sampleIndex]!.segment_index <= segmentIndex
    )
      sampleIndex += 1;

    const sample = trace[sampleIndex];
    const previous = trace[sampleIndex - 1];
    let deadline: number | null = sample?.time_s ?? null;
    if (sample && previous) {
      if (sample.segment_index > segmentIndex) {
        deadline = previous.time_s;
      } else if (sample.global_s_m > previous.global_s_m + numericalEpsilon) {
        const fraction = Math.max(
          0,
          Math.min(
            1,
            (target.s_m - previous.global_s_m) /
              (sample.global_s_m - previous.global_s_m),
          ),
        );
        deadline =
          previous.time_s + fraction * (sample.time_s - previous.time_s);
      }
    }

    const available = Math.max(0, (deadline ?? previousTime) - previousTime);
    const angle = shortestAngularDistance(target.theta_target, previousHeading);
    const direction = Math.sign(angle);
    const next = targets[index + 1];
    const nextDirection = next
      ? Math.sign(
          shortestAngularDistance(next.theta_target, target.theta_target),
        )
      : 0;
    const mustStop =
      !target.profiled_rotation || nextDirection !== direction || !next;
    const omega = angularLimit(
      path,
      config,
      "max_velocity_deg_per_sec",
      target.event_ordinal_1b,
      180,
    );
    const alpha = angularLimit(
      path,
      config,
      "max_acceleration_deg_per_sec2",
      target.event_ordinal_1b,
      360,
    );
    const start: VelocityRange =
      direction < 0 ? [-velocities[1], -velocities[0]] : velocities;
    const distance = Math.abs(angle);
    const coLocated = available <= numericalEpsilon;
    const withinTolerance = distance <= rotationTargetToleranceRadians;
    let end =
      coLocated && withinTolerance
        ? mustStop
          ? start[0] <= numericalEpsilon && start[1] >= -numericalEpsilon
            ? ([0, 0] as const)
            : null
          : start
        : reachableAngularVelocities(
            distance,
            available,
            start,
            omega,
            alpha,
            mustStop,
          );
    let profileViolation = 0;
    let profileHandoff = false;
    if (
      target.profiled_rotation &&
      !coLocated &&
      distance > numericalEpsilon &&
      deadline !== null
    ) {
      const positionAt = (s: number) => {
        const i = Math.max(
          0,
          cumulativeLengths.findIndex(
            (value, j) => j > 0 && value >= s - numericalEpsilon,
          ) - 1,
        );
        const segment = segments[i]!;
        const along = Math.max(0, s - (cumulativeLengths[i] ?? 0));
        return [
          segment.ax + segment.ux * along,
          segment.ay + segment.uy * along,
        ] as const;
      };
      const from = positionAt(previousDistance),
        to = positionAt(target.s_m);
      const dx = to[0] - from[0],
        dy = to[1] - from[1];
      const length = Math.hypot(dx, dy);
      const translationTolerance =
        path.constraints.end_translation_tolerance_meters ??
        getDefaultOptionalConfigValue(
          config,
          "end_translation_tolerance_meters",
        ) ??
        0.03;
      // Match the library's profiled setpoint: projection between rotation
      // target positions, including its final translation-tolerance snap.
      const progression = (x: number, y: number) => {
        let fraction =
          length <= numericalEpsilon
            ? 1
            : Math.max(
                0,
                Math.min(
                  1,
                  ((x - from[0]) * dx + (y - from[1]) * dy) / (length * length),
                ),
              );
        if (
          length > numericalEpsilon &&
          fraction >= 1 - Math.min(translationTolerance, length) / length
        )
          fraction = 1;
        return fraction * distance;
      };
      let lastX = sample?.x_m ?? to[0],
        lastY = sample?.y_m ?? to[1];
      if (sample && previous && sample.time_s > previous.time_s) {
        const fraction =
          (deadline - previous.time_s) / (sample.time_s - previous.time_s);
        lastX = previous.x_m + fraction * (sample.x_m - previous.x_m);
        lastY = previous.y_m + fraction * (sample.y_m - previous.y_m);
      }
      if (
        distance - progression(lastX, lastY) >
        rotationTargetToleranceRadians
      ) {
        // A target retired before its authored profile gets there is a
        // geometric conflict. More time cannot fix this by itself.
        profileHandoff = true;
        end = null;
      } else if (end) {
        const nodes = trace
          .filter(
            (point) =>
              point.time_s > previousTime + numericalEpsilon &&
              point.time_s < deadline - numericalEpsilon,
          )
          .map((point) => ({
            timeS: point.time_s - previousTime,
            angle: progression(point.x_m, point.y_m),
          }));
        nodes.push({ timeS: available, angle: progression(lastX, lastY) });
        const profile = profiledRotationReachability(
          nodes,
          distance,
          start,
          omega,
          alpha,
          rotationTargetToleranceRadians,
          mustStop,
        );
        end = profile.velocities;
        profileViolation = profile.violation;
      }
    }
    const passed = deadline !== null && end !== null;
    const required =
      coLocated && withinTolerance
        ? 0
        : minimumAngularTime(distance, start, omega, alpha, mustStop);
    const diagnostic: RotationFeasibilityDiagnostic = {
      elementIndex: target.path_element_index,
      eventOrdinal: target.event_ordinal_1b,
      deadlineS: deadline,
      availableTimeS: available,
      requiredTimeS: required,
      passed,
      ...(profileViolation > 0 ? { profileViolation } : {}),
      reason:
        deadline === null
          ? "unreached"
          : coLocated && !withinTolerance
            ? "conflicting-targets"
            : profileHandoff
              ? "profile-handoff"
              : passed
                ? "reachable"
                : required > available + numericalEpsilon
                  ? "insufficient-time"
                  : profileViolation > 0
                    ? "profile-limits"
                    : "angular-transition",
    };
    if (!(coLocated && withinTolerance)) previousHeading = target.theta_target;
    previousTime = deadline ?? previousTime;
    previousDistance = target.s_m;
    velocities = !end ? [0, 0] : direction < 0 ? [-end[1], -end[0]] : end;
    return diagnostic;
  });
}

/** Exact endpoint-velocity interval for a monotone bounded-acceleration turn. */
export function reachableAngularVelocities(
  distance: number,
  time: number,
  initial: VelocityRange,
  maxVelocity: number,
  maxAcceleration: number,
  stopAtTarget: boolean,
): VelocityRange | null {
  const lowStart = Math.max(0, initial[0]);
  const highStart = Math.min(maxVelocity, initial[1]);
  if (lowStart > highStart + numericalEpsilon || time < 0) return null;
  if (distance <= numericalEpsilon)
    return lowStart <= numericalEpsilon ? [0, 0] : null;
  if (time <= numericalEpsilon || maxVelocity <= 0 || maxAcceleration <= 0)
    return null;
  let lowEnd = Math.max(0, lowStart - maxAcceleration * time);
  let highEnd = Math.min(maxVelocity, highStart + maxAcceleration * time);
  if (stopAtTarget) {
    if (lowEnd > numericalEpsilon) return null;
    lowEnd = highEnd = 0;
  }
  const minDistance = (end: number) =>
    envelopeDistance(
      Math.max(lowStart, end - maxAcceleration * time),
      end,
      time,
      maxVelocity,
      maxAcceleration,
      false,
    );
  const maxDistance = (end: number) =>
    envelopeDistance(
      Math.min(highStart, end + maxAcceleration * time),
      end,
      time,
      maxVelocity,
      maxAcceleration,
      true,
    );
  if (
    minDistance(lowEnd) > distance + numericalEpsilon ||
    maxDistance(highEnd) < distance - numericalEpsilon
  )
    return null;
  if (maxDistance(lowEnd) < distance) {
    let a = lowEnd,
      b = highEnd;
    for (let i = 0; i < 36; i += 1) {
      const mid = (a + b) / 2;
      if (maxDistance(mid) < distance) a = mid;
      else b = mid;
    }
    lowEnd = b;
  }
  if (minDistance(highEnd) > distance) {
    let a = lowEnd,
      b = highEnd;
    for (let i = 0; i < 36; i += 1) {
      const mid = (a + b) / 2;
      if (minDistance(mid) > distance) b = mid;
      else a = mid;
    }
    highEnd = a;
  }
  return lowEnd <= highEnd + numericalEpsilon ? [lowEnd, highEnd] : null;
}

/** Integral of the upper/lower reachable velocity envelope. */
function envelopeDistance(
  start: number,
  end: number,
  time: number,
  velocity: number,
  acceleration: number,
  upper: boolean,
): number {
  const a = upper ? acceleration : -acceleration;
  const cruise = upper ? velocity : 0;
  const crossing = (end - start + a * time) / (2 * a);
  const times = [
    0,
    time,
    crossing,
    (cruise - start) / a,
    time - (cruise - end) / a,
  ]
    .filter((t) => t >= 0 && t <= time)
    .sort((x, y) => x - y);
  const at = (t: number) =>
    upper
      ? Math.min(cruise, start + a * t, end + a * (time - t))
      : Math.max(cruise, start + a * t, end + a * (time - t));
  let area = 0;
  for (let i = 1; i < times.length; i += 1) {
    area +=
      ((times[i]! - times[i - 1]!) * (at(times[i]!) + at(times[i - 1]!))) / 2;
  }
  return area;
}

function minimumAngularTime(
  distance: number,
  start: VelocityRange,
  velocity: number,
  acceleration: number,
  stop: boolean,
): number {
  const minimumStart = Math.max(0, start[0]);
  const maximumStart = Math.min(velocity, start[1]);
  if (
    minimumStart > maximumStart ||
    velocity <= 0 ||
    acceleration <= 0 ||
    (stop &&
      distance + numericalEpsilon < minimumStart ** 2 / (2 * acceleration))
  ) {
    return Number.POSITIVE_INFINITY;
  }
  if (distance <= numericalEpsilon)
    return minimumStart <= numericalEpsilon ? 0 : Number.POSITIVE_INFINITY;
  let low = 0;
  let high = Math.max(
    1,
    (2 * distance) / velocity + (2 * velocity) / acceleration,
  );
  // Earliest arrival depends on the maximum displacement envelope. Testing a
  // much longer fixed duration is not equivalent: a moving initial state can
  // reach a nearby target quickly, but cannot linger there without overshoot.
  for (let i = 0; i < 36; i += 1) {
    const time = (low + high) / 2;
    const initial = stop
      ? Math.min(maximumStart, acceleration * time)
      : maximumStart;
    const final = stop ? 0 : Math.min(velocity, initial + acceleration * time);
    if (
      initial >= minimumStart - numericalEpsilon &&
      envelopeDistance(initial, final, time, velocity, acceleration, true) >=
        distance - numericalEpsilon
    )
      high = time;
    else low = time;
  }
  return high;
}

function angularLimit(
  path: PathModel,
  config: SimulationConfig,
  key: RangedConstraintKey &
    ("max_velocity_deg_per_sec" | "max_acceleration_deg_per_sec2"),
  ordinal: number,
  fallback: number,
): number {
  const global =
    path.constraints[key] ??
    getDefaultOptionalConfigValue(config, key) ??
    fallback;
  let ranged: number | null = null;
  for (const constraint of path.ranged_constraints) {
    if (
      constraint.key === key &&
      Math.min(constraint.start_ordinal, constraint.end_ordinal) <= ordinal &&
      ordinal <= Math.max(constraint.start_ordinal, constraint.end_ordinal) &&
      constraint.value > 0
    ) {
      ranged =
        ranged === null ? constraint.value : Math.min(ranged, constraint.value);
    }
  }
  return ((ranged ?? global) * Math.PI) / 180;
}

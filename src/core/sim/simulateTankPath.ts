import type { PathModel } from "../model/path";
import { previewStartPose } from "../model/pathPreview";
import { handoffReached, resolveHandoffMode } from "../model/handoffModes";
import { limitTankVelocity, type TankVelocity } from "./tankRateLimiter";
import {
  degreesToRadians,
  shortestAngularDistance,
  wrapAngleRadians,
} from "./simGeometry";
import {
  activeRotationLimit,
  activeTranslationLimit,
  buildProtrusionVisibilityByTime,
  buildRotationDomainEvents,
  buildSegments,
  handoffRadiusForSegment,
  normalizeSimulationConfig,
  remainingDistanceFrom,
  resolveVelocityBaseline,
} from "./simulatePath";
import type {
  PoseTuple,
  SimTraceResult,
  SimulationConfig,
  SimulationOptions,
  SimulationTraceSample,
} from "./types";

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
type Phase = "follow" | "brake" | "align" | "alignBrake" | "done";

/**
 * Ideal, constraint-based differential-drive preview. Requests come from
 * target geometry and stopping distance, with no PID gains or error history.
 * The library uses tuned feedback controllers; this preview does not model them.
 * This is a kinematic preview, not a wheel/motor/traction physics simulation.
 */
export function simulateTankPath(
  path: PathModel,
  config: SimulationConfig,
  options: SimulationOptions,
  collectTrace: boolean,
): SimTraceResult {
  const dt = options.dt_s ?? 0.02;
  if (!Number.isFinite(dt) || dt <= 0)
    throw new Error("Simulation dt_s must be a positive finite number");
  const cfg = normalizeSimulationConfig(config);
  const { anchors, segments, cumulativeLengths } = buildSegments(path);
  const poses = new Map<number, PoseTuple>();
  const progress = new Map<number, number>();
  const trace: SimulationTraceSample[] = [];
  if (!segments.length)
    return {
      poses_by_time: poses,
      global_s_by_time: progress,
      protrusion_visible_by_time: new Map(),
      times_sorted: [],
      total_time_s: 0,
      trail_points: [],
      trace,
      completed: false,
    };
  const ghost = anchors[0].pathIndex < 0;
  const direction = path.tank_drive_direction ?? "forward";
  const first = path.path_elements[0];
  let theta = ghost
    ? previewStartPose(path).rotation_radians
    : first?.type === "waypoint"
      ? first.rotation_target.rotation_radians
      : Math.atan2(
          segments[0].by - segments[0].ay,
          segments[0].bx - segments[0].ax,
        ) + (direction === "backward" ? Math.PI : 0);
  const last = path.path_elements.at(-1);
  const finalHeading =
    last?.type === "waypoint" ? last.rotation_target.rotation_radians : null;
  const end = anchors.at(-1)!;
  const finalOrdinal = anchors.length - (ghost ? 1 : 0);
  const baseV =
    path.constraints.max_velocity_meters_per_sec ??
    cfg.default_max_velocity_meters_per_sec ??
    2;
  const baseA =
    path.constraints.max_acceleration_meters_per_sec2 ??
    cfg.default_max_acceleration_meters_per_sec2 ??
    2.5;
  const baseW =
    path.constraints.max_velocity_deg_per_sec ??
    cfg.default_max_velocity_deg_per_sec ??
    180;
  const baseAlpha =
    path.constraints.max_acceleration_deg_per_sec2 ??
    cfg.default_max_acceleration_deg_per_sec2 ??
    360;
  const baseMinV = path.constraints.min_velocity_meters_per_sec ?? 0;
  const baseMinW = path.constraints.min_velocity_deg_per_sec ?? 0;
  const endMinimum = resolveVelocityBaseline(
    activeTranslationLimit(path, "max_velocity_meters_per_sec", finalOrdinal) ??
      baseV,
    activeTranslationLimit(path, "min_velocity_meters_per_sec", finalOrdinal) ??
      baseMinV,
    baseV,
  ).min;
  const rolling = endMinimum > 0;
  const positionTolerance =
    path.constraints.end_translation_tolerance_meters ??
    cfg.default_end_translation_tolerance_meters ??
    0.03;
  const headingTolerance = degreesToRadians(
    path.constraints.end_rotation_tolerance_deg ??
      cfg.default_end_rotation_tolerance_deg ??
      2,
  );
  const defaultRadius = cfg.default_intermediate_handoff_radius_meters ?? 0.05;
  const rotationEvents = buildRotationDomainEvents(
    path,
    anchors,
    cumulativeLengths,
  );
  const totalLength = cumulativeLengths.at(-1) ?? 0;
  let x = anchors[0].x,
    y = anchors[0].y,
    s = 0,
    time = 0,
    segmentIndex = 0;
  let velocity: TankVelocity = { forward: 0, omega: 0 };
  let phase: Phase = "follow";
  let completed = false;
  const slowest = Math.min(
    baseV,
    ...anchors.map(
      (_, i) =>
        activeTranslationLimit(path, "max_velocity_meters_per_sec", i + 1) ??
        baseV,
    ),
  );
  const guard = Math.max(30, (2 * totalLength) / Math.max(0.05, slowest) + 20);
  const save = (oldVx: number, oldVy: number, elapsed: number) => {
    poses.set(time, [x, y, theta]);
    progress.set(time, s);
    if (!collectTrace) return;
    const vx = velocity.forward * Math.cos(theta),
      vy = velocity.forward * Math.sin(theta);
    const ax = elapsed ? (vx - oldVx) / elapsed : 0,
      ay = elapsed ? (vy - oldVy) / elapsed : 0;
    trace.push({
      time_s: time,
      x_m: x,
      y_m: y,
      theta_rad: theta,
      segment_index: segmentIndex,
      target_anchor_ordinal_1b: segmentIndex + 2 - (ghost ? 1 : 0),
      global_s_m: s,
      segment_s_m: project(segments[segmentIndex], x, y),
      vx_mps: vx,
      vy_mps: vy,
      omega_radps: velocity.omega,
      speed_mps: Math.abs(velocity.forward),
      ax_mps2: ax,
      ay_mps2: ay,
      acceleration_mps2: Math.hypot(ax, ay),
      snapped_position: false,
      snapped_rotation: false,
    });
  };
  save(0, 0, 0);
  for (let step = 1; step * dt <= guard; step++) {
    let segment = segments[segmentIndex];
    let distance = Math.hypot(segment.bx - x, segment.by - y);
    while (
      segmentIndex < segments.length - 1 &&
      handoffReached(
        resolveHandoffMode(
          path,
          path.path_elements[anchors[segmentIndex + 1].pathIndex],
          cfg.default_handoff_mode ?? "radius",
        ),
        distance,
        project(segment, x, y),
        segment.length_m,
        handoffRadiusForSegment(path, segmentIndex, anchors, defaultRadius),
      )
    ) {
      segment = segments[++segmentIndex];
      distance = Math.hypot(segment.bx - x, segment.by - y);
    }
    s = Math.max(s, cumulativeLengths[segmentIndex] + project(segment, x, y));
    const atPosition =
      segmentIndex === segments.length - 1 &&
      Math.hypot(end.x - x, end.y - y) <= positionTolerance;
    if (rolling && atPosition) {
      completed = true;
      break;
    }
    const stopped =
      Math.abs(velocity.forward) < 1e-8 && Math.abs(velocity.omega) < 1e-8;
    const endHeadingError =
      finalHeading === null ? 0 : shortestAngularDistance(finalHeading, theta);
    if (phase === "follow" && atPosition && !rolling) phase = "brake";
    if (phase === "brake" && stopped) phase = atPosition ? "align" : "follow";
    if (phase === "align") {
      if (!atPosition) phase = "brake";
      else if (Math.abs(endHeadingError) <= headingTolerance)
        phase = "alignBrake";
    }
    if (phase === "alignBrake" && stopped)
      phase = !atPosition
        ? "follow"
        : Math.abs(endHeadingError) > headingTolerance
          ? "align"
          : "done";
    if (phase === "done") {
      completed = true;
      break;
    }
    const ordinal = segmentIndex + 2 - (ghost ? 1 : 0);
    const { max: maxV, min: minV } = resolveVelocityBaseline(
      activeTranslationLimit(path, "max_velocity_meters_per_sec", ordinal) ??
        baseV,
      activeTranslationLimit(path, "min_velocity_meters_per_sec", ordinal) ??
        baseMinV,
      baseV,
    );
    const maxA =
      activeTranslationLimit(
        path,
        "max_acceleration_meters_per_sec2",
        ordinal,
      ) ?? baseA;
    const angular = resolveVelocityBaseline(
      activeRotationLimit(
        path,
        rotationEvents,
        "max_velocity_deg_per_sec",
        s,
      ) ?? baseW,
      activeRotationLimit(
        path,
        rotationEvents,
        "min_velocity_deg_per_sec",
        s,
      ) ?? baseMinW,
      baseW,
    );
    const maxW = degreesToRadians(angular.max);
    const minW = degreesToRadians(angular.min);
    const maxAlpha = degreesToRadians(
      activeRotationLimit(
        path,
        rotationEvents,
        "max_acceleration_deg_per_sec2",
        s,
      ) ?? baseAlpha,
    );
    if (
      ![maxV, maxA, maxW, maxAlpha, positionTolerance, headingTolerance].every(
        (value) => Number.isFinite(value) && value > 0,
      )
    )
      break;
    const remaining = remainingDistanceFrom(segments, segmentIndex, x, y);
    const bearing = Math.atan2(segment.by - y, segment.bx - x);
    const follow = phase === "follow";
    const desiredHeading = follow
      ? bearing + (direction === "backward" ? Math.PI : 0)
      : (finalHeading ?? theta);
    const headingError = shortestAngularDistance(desiredHeading, theta);
    const steer = phase === "align" || (follow && distance > 1e-9);
    const magnitude = Math.min(
      maxV,
      Math.max(
        Math.min(minV, maxV),
        stoppingSpeed(
          remaining,
          Math.abs(velocity.forward),
          maxA,
          dt,
          rolling ? endMinimum : 0,
        ),
      ),
    );
    let omega = 0;
    if (steer) {
      const sign = Math.sign(headingError);
      const speed = stoppingSpeed(
        Math.abs(headingError),
        sign * velocity.omega,
        maxAlpha,
        dt,
      );
      omega = sign * Math.min(maxW, speed);
      if (Math.abs(headingError) > headingTolerance)
        omega = sign * Math.max(Math.abs(omega), Math.min(minW, maxW));
    }
    const previous = velocity;
    velocity = limitTankVelocity(
      previous,
      {
        forward: follow ? magnitude * (direction === "backward" ? -1 : 1) : 0,
        omega,
      },
      {
        acceleration: maxA,
        angularAcceleration: maxAlpha,
        speed: maxV,
        omega: maxW,
      },
      dt,
      direction,
    );
    const oldVx = previous.forward * Math.cos(theta),
      oldVy = previous.forward * Math.sin(theta);
    const yaw = ((previous.omega + velocity.omega) * dt) / 2;
    const travel = ((previous.forward + velocity.forward) * dt) / 2;
    const sinc =
      Math.abs(yaw) < 1e-9 ? 1 - (yaw * yaw) / 6 : Math.sin(yaw) / yaw;
    const cosc = Math.abs(yaw) < 1e-9 ? yaw / 2 : (1 - Math.cos(yaw)) / yaw;
    x += travel * (sinc * Math.cos(theta) - cosc * Math.sin(theta));
    y += travel * (sinc * Math.sin(theta) + cosc * Math.cos(theta));
    theta = wrapAngleRadians(theta + yaw);
    time = Number((step * dt).toFixed(9));
    s = Math.min(
      totalLength,
      Math.max(s, cumulativeLengths[segmentIndex] + project(segment, x, y)),
    );
    save(oldVx, oldVy, dt);
  }
  if (completed) {
    // Successful tolerance-based completion consumes the final segment's events,
    // like an intermediate handoff. Advance accepted progress, not the robot pose
    // or velocity; aborted previews must leave unreached events pending.
    progress.set(time, totalLength);
    const lastSample = trace.at(-1);
    if (lastSample) lastSample.global_s_m = totalLength;
  }
  const times = [...poses.keys()];
  return {
    poses_by_time: poses,
    global_s_by_time: progress,
    protrusion_visible_by_time: buildProtrusionVisibilityByTime(
      path,
      config,
      anchors,
      cumulativeLengths,
      progress,
      times,
    ),
    times_sorted: times,
    total_time_s: time,
    trail_points: [...poses.values()].map(([px, py]) => [px, py]),
    trace,
    completed,
  };
}

function project(
  segment: { ax: number; ay: number; ux: number; uy: number; length_m: number },
  x: number,
  y: number,
) {
  return clamp(
    (x - segment.ax) * segment.ux + (y - segment.ay) * segment.uy,
    0,
    segment.length_m,
  );
}

/**
 * Largest next speed that leaves enough distance to brake at the configured
 * acceleration. The current/next average accounts for this integration step;
 * v_next² = v_end² + 2 a (distance - (v_current + v_next) dt / 2).
 * This is an ideal stopping-distance bound, not a proportional controller.
 */
function stoppingSpeed(
  distance: number,
  current: number,
  acceleration: number,
  dt: number,
  end = 0,
) {
  const halfStep = (acceleration * dt) / 2;
  return Math.max(
    0,
    Math.sqrt(
      Math.max(
        0,
        halfStep * halfStep +
          end * end +
          2 * acceleration * (distance - (current * dt) / 2),
      ),
    ) - halfStep,
  );
}

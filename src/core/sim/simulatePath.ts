import {
  isEventTrigger,
  isRotationTarget,
  isWaypoint,
  type PathElement,
  type PathModel,
  type RangedConstraintKey,
} from "../model/path";
import { createProjectConfig } from "../config/projectConfig";
import type {
  ChassisSpeeds,
  PointTuple,
  PoseTuple,
  RotationDomainEvent,
  RotationKeyframe,
  Segment,
  SimResult,
  SimTraceResult,
  SimulationConfig,
  SimulationOptions,
  SimulationTraceSample,
} from "./types";
import {
  clamp01,
  degreesToRadians,
  dot,
  hypot2,
  limitAcceleration,
  radiansToDegrees,
  shortestAngularDistance,
  wrapAngleRadians,
} from "./simGeometry";

interface Anchor {
  x: number;
  y: number;
  pathIndex: number;
}

interface SegmentBuildResult {
  anchors: Anchor[];
  segments: Segment[];
  cumulativeLengths: number[];
}

interface ProtrusionTrigger {
  s_m: number;
  path_index: number;
  visible: boolean;
}

const emptySpeeds: ChassisSpeeds = {
  vx_mps: 0,
  vy_mps: 0,
  omega_radps: 0,
};

export function simulatePath(
  path: PathModel,
  config: SimulationConfig = {},
  options: SimulationOptions = {},
): SimResult {
  return runPathSimulation(path, config, options, false);
}

export function simulatePathWithTrace(
  path: PathModel,
  config: SimulationConfig = {},
  options: SimulationOptions = {},
): SimTraceResult {
  return runPathSimulation(path, config, options, true) as SimTraceResult;
}

function runPathSimulation(
  path: PathModel,
  config: SimulationConfig,
  options: SimulationOptions,
  collectTrace: boolean,
): SimTraceResult {
  const dt = options.dt_s ?? 0.02;
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new Error("Simulation dt_s must be a positive finite number");
  }

  const cfg = normalizeSimulationConfig(config);
  const { anchors, segments, cumulativeLengths } = buildSegments(path);
  const posesByTime = new Map<number, PoseTuple>();
  const globalSByTime = new Map<number, number>();
  const timesSorted: number[] = [];
  const trailPoints: PointTuple[] = [];
  const trace: SimulationTraceSample[] = [];

  if (anchors.length < 2 || segments.length === 0) {
    const first = anchors[0];
    if (first) {
      posesByTime.set(0, [first.x, first.y, 0]);
      globalSByTime.set(0, 0);
      timesSorted.push(0);
      trailPoints.push([first.x, first.y]);
    }
    const uniqueTimes = dedupeTimes(timesSorted);
    return {
      poses_by_time: posesByTime,
      global_s_by_time: globalSByTime,
      protrusion_visible_by_time: buildProtrusionVisibilityByTime(
        path,
        config,
        anchors,
        cumulativeLengths,
        globalSByTime,
        uniqueTimes,
      ),
      times_sorted: uniqueTimes,
      total_time_s: 0,
      trail_points: trailPoints,
      trace,
    };
  }

  const constraints = path.constraints;
  const baseMaxV = resolveConstraint(
    constraints.max_velocity?.meters_per_sec,
    cfg.default_max_velocity_meters_per_sec,
    3,
  );
  const baseMaxA = resolveConstraint(
    constraints.max_acceleration?.meters_per_sec2,
    cfg.default_max_acceleration_meters_per_sec2,
    2.5,
  );
  const baseMaxOmega = degreesToRadians(
    resolveConstraint(
      constraints.max_angular_velocity?.radians_per_sec,
      cfg.default_max_velocity_deg_per_sec,
      180,
    ),
  );
  const baseMaxAlpha = degreesToRadians(
    resolveConstraint(
      constraints.max_angular_acceleration?.radians_per_sec2,
      cfg.default_max_acceleration_deg_per_sec2,
      360,
    ),
  );
  const defaultHandoffRadius = resolveConstraint(
    null,
    cfg.default_intermediate_handoff_radius_meters,
    0.05,
  );

  const totalPathLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0;
  const firstSegment = segments[0];
  const startHeadingBase = defaultHeading(firstSegment);
  const globalKeyframes = buildGlobalRotationKeyframes(
    path,
    anchors,
    cumulativeLengths,
  );
  const rotationDomainEvents = buildRotationDomainEvents(
    path,
    anchors,
    cumulativeLengths,
  );
  const initialHeading = desiredHeadingForGlobalS(
    globalKeyframes,
    0,
    startHeadingBase,
  ).desiredTheta;
  const endHeadingTarget = desiredHeadingForGlobalS(
    globalKeyframes,
    totalPathLength,
    startHeadingBase,
  ).desiredTheta;

  if (collectTrace) {
    trace.push({
      time_s: 0,
      x_m: firstSegment.ax,
      y_m: firstSegment.ay,
      theta_rad: initialHeading,
      segment_index: 0,
      target_anchor_ordinal_1b: 2,
      global_s_m: 0,
      segment_s_m: 0,
      vx_mps: 0,
      vy_mps: 0,
      omega_radps: 0,
      speed_mps: 0,
      ax_mps2: 0,
      ay_mps2: 0,
      acceleration_mps2: 0,
      snapped_position: false,
      snapped_rotation: false,
    });
  }

  let x = firstSegment.ax;
  let y = firstSegment.ay;
  let theta = initialHeading;
  let speeds: ChassisSpeeds = { ...emptySpeeds };
  let tS = 0;
  let segmentIndex = 0;
  const endX = anchors[anchors.length - 1].x;
  const endY = anchors[anchors.length - 1].y;

  const minTransV = minimumPositiveConstraint(path, "max_velocity", baseMaxV);
  const minRotOmegaDeg = minimumPositiveConstraint(
    path,
    "max_angular_velocity",
    radiansToDegrees(baseMaxOmega),
  );
  const minRotOmega = degreesToRadians(Math.max(0.001, minRotOmegaDeg));
  const estTransTime = totalPathLength / Math.max(0.1, minTransV);
  const estRotTime = Math.PI / minRotOmega;
  const guardTime = Math.max(3, 2 * estTransTime + 1.5 * estRotTime);
  const epsPos = 1e-3;
  const epsAng = degreesToRadians(0.5);
  let lastGlobalS = 0;

  while (tS <= guardTime) {
    if (segmentIndex >= segments.length) {
      break;
    }

    let segment = segments[segmentIndex];
    let dx = segment.bx - x;
    let dy = segment.by - y;
    let distToTarget = hypot2(dx, dy);
    let projectedS = projectedDistanceOnSegment(segment, x, y);
    let handoffRadius = handoffRadiusForSegment(
      path,
      segmentIndex,
      anchors,
      defaultHandoffRadius,
    );

    while (
      segmentIndex < segments.length - 1 &&
      distToTarget <= handoffRadius
    ) {
      segmentIndex += 1;
      segment = segments[segmentIndex];
      dx = segment.bx - x;
      dy = segment.by - y;
      distToTarget = hypot2(dx, dy);
      projectedS = projectedDistanceOnSegment(segment, x, y);
      handoffRadius = handoffRadiusForSegment(
        path,
        segmentIndex,
        anchors,
        defaultHandoffRadius,
      );
    }

    if (segmentIndex >= segments.length) {
      break;
    }

    const ux = distToTarget > 1e-9 ? dx / distToTarget : 1;
    const uy = distToTarget > 1e-9 ? dy / distToTarget : 0;
    const globalS = cumulativeLengths[segmentIndex] + projectedS;
    const desiredTheta = desiredHeadingForGlobalS(
      globalKeyframes,
      globalS,
      startHeadingBase,
    ).desiredTheta;
    const remaining = remainingDistanceFrom(segments, segmentIndex, x, y);
    const nextAnchorOrdinal1b = segmentIndex + 2;
    const maxVEff = activeTranslationLimit(
      path,
      "max_velocity",
      nextAnchorOrdinal1b,
    );
    const maxAEff = activeTranslationLimit(
      path,
      "max_acceleration",
      nextAnchorOrdinal1b,
    );
    const maxV = maxVEff ?? baseMaxV;
    const maxA = maxAEff ?? baseMaxA;
    const maxOmegaEff = activeRotationLimit(
      path,
      rotationDomainEvents,
      "max_angular_velocity",
      globalS,
    );
    const maxAlphaEff = activeRotationLimit(
      path,
      rotationDomainEvents,
      "max_angular_acceleration",
      globalS,
    );
    const maxOmega =
      maxOmegaEff === null ? baseMaxOmega : degreesToRadians(maxOmegaEff);
    const maxAlpha =
      maxAlphaEff === null ? baseMaxAlpha : degreesToRadians(maxAlphaEff);

    const vPControl = Math.sqrt(2 * baseMaxA * remaining);
    let vDesScalar = Math.max(0, Math.min(maxV, vPControl));
    const angularError = shortestAngularDistance(desiredTheta, theta);
    if (
      segmentIndex === segments.length - 1 &&
      vDesScalar <= 1e-9 &&
      distToTarget > epsPos
    ) {
      vDesScalar = Math.min(maxV, distToTarget / Math.max(dt, 1e-9));
    }

    const omegaControl = Math.sqrt(2 * maxAlpha * Math.abs(angularError));
    const omegaDes =
      angularError < 0
        ? -Math.min(omegaControl, maxOmega)
        : Math.min(omegaControl, maxOmega);
    const previousSpeeds = speeds;
    let limited = limitAcceleration(
      {
        vx_mps: vDesScalar * ux,
        vy_mps: vDesScalar * uy,
        omega_radps: omegaDes,
      },
      speeds,
      dt,
      maxA,
      maxAlpha,
    );

    if (Math.abs(limited.omega_radps) > maxOmega && maxOmega > 0) {
      limited = {
        ...limited,
        omega_radps: Math.sign(limited.omega_radps) * maxOmega,
      };
    }
    const dynamicsLimited = limited;
    const axMps2 = (dynamicsLimited.vx_mps - previousSpeeds.vx_mps) / dt;
    const ayMps2 = (dynamicsLimited.vy_mps - previousSpeeds.vy_mps) / dt;
    const accelerationMps2 = hypot2(axMps2, ayMps2);

    const stepDx = limited.vx_mps * dt;
    const stepDy = limited.vy_mps * dt;
    let snappedPosition = false;
    let snappedRotation = false;
    if (segmentIndex === segments.length - 1) {
      if (hypot2(stepDx, stepDy) >= Math.max(0, distToTarget - epsPos)) {
        x = endX;
        y = endY;
        limited = { vx_mps: 0, vy_mps: 0, omega_radps: limited.omega_radps };
        snappedPosition = true;
      } else {
        x += stepDx;
        y += stepDy;
      }
    } else {
      x += stepDx;
      y += stepDy;
    }
    theta = wrapAngleRadians(theta + limited.omega_radps * dt);

    const tKey = round3(tS);
    const poseGlobalS = Math.min(
      totalPathLength,
      Math.max(
        lastGlobalS,
        projectPointToGlobalS(x, y, segments, cumulativeLengths, lastGlobalS),
      ),
    );
    lastGlobalS = poseGlobalS;
    posesByTime.set(tKey, [x, y, theta]);
    globalSByTime.set(tKey, poseGlobalS);
    timesSorted.push(tKey);
    trailPoints.push([x, y]);

    if (segmentIndex === segments.length - 1) {
      const distToFinal = hypot2(endX - x, endY - y);
      let rotErr = Math.abs(shortestAngularDistance(endHeadingTarget, theta));
      let snappedPos = false;
      let snappedRot = false;

      if (distToFinal <= epsPos) {
        x = endX;
        y = endY;
        snappedPos = true;
      }

      if (distToFinal < 0.1 && rotErr <= epsAng) {
        theta = endHeadingTarget;
        rotErr = 0;
        snappedRot = true;
        snappedRotation = true;
      }

      if (snappedPos || snappedRot) {
        posesByTime.set(tKey, [x, y, theta]);
        trailPoints[trailPoints.length - 1] = [x, y];
        if (snappedPos) {
          snappedPosition = true;
          lastGlobalS = totalPathLength;
          globalSByTime.set(tKey, totalPathLength);
        }

        if (snappedPos) {
          limited = { vx_mps: 0, vy_mps: 0, omega_radps: limited.omega_radps };
          speeds = { vx_mps: 0, vy_mps: 0, omega_radps: speeds.omega_radps };
        }
        if (snappedRot || rotErr === 0) {
          limited = { ...limited, omega_radps: 0 };
          speeds = { ...speeds, omega_radps: 0 };
        }
        if (snappedPos && snappedRot) {
          speeds = { ...emptySpeeds };
        }
      }
    }

    if (collectTrace) {
      const pose = posesByTime.get(tKey) ?? [x, y, theta];
      const traceSegment =
        segments[Math.min(segmentIndex, segments.length - 1)];
      trace.push({
        time_s: tKey,
        x_m: pose[0],
        y_m: pose[1],
        theta_rad: pose[2],
        segment_index: segmentIndex,
        target_anchor_ordinal_1b: segmentIndex + 2,
        global_s_m: globalSByTime.get(tKey) ?? poseGlobalS,
        segment_s_m: traceSegment
          ? projectedDistanceOnSegment(traceSegment, pose[0], pose[1])
          : 0,
        vx_mps: dynamicsLimited.vx_mps,
        vy_mps: dynamicsLimited.vy_mps,
        omega_radps: dynamicsLimited.omega_radps,
        speed_mps: hypot2(dynamicsLimited.vx_mps, dynamicsLimited.vy_mps),
        ax_mps2: axMps2,
        ay_mps2: ayMps2,
        acceleration_mps2: accelerationMps2,
        snapped_position: snappedPosition,
        snapped_rotation: snappedRotation,
      });
    }

    if (snappedPosition && snappedRotation) {
      break;
    }

    tS += dt;
    speeds = limited;
  }

  const lastTime = round3(tS);
  if (!posesByTime.has(lastTime) && timesSorted.length > 0) {
    posesByTime.set(
      lastTime,
      posesByTime.get(timesSorted[timesSorted.length - 1])!,
    );
    globalSByTime.set(
      lastTime,
      globalSByTime.get(timesSorted[timesSorted.length - 1]) ?? lastGlobalS,
    );
    timesSorted.push(lastTime);
  }

  const uniqueTimes = dedupeTimes(timesSorted);

  return {
    poses_by_time: posesByTime,
    global_s_by_time: globalSByTime,
    protrusion_visible_by_time: buildProtrusionVisibilityByTime(
      path,
      config,
      anchors,
      cumulativeLengths,
      globalSByTime,
      uniqueTimes,
    ),
    times_sorted: uniqueTimes,
    total_time_s: uniqueTimes[uniqueTimes.length - 1] ?? 0,
    trail_points: trailPoints,
    trace,
  };
}

export function buildSegments(path: PathModel): SegmentBuildResult {
  const anchors: Anchor[] = [];
  for (const [pathIndex, element] of path.path_elements.entries()) {
    const anchor = anchorPoint(element);
    if (anchor) {
      anchors.push({ ...anchor, pathIndex });
    }
  }

  const segments: Segment[] = [];
  const cumulativeLengths = [0];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index];
    const end = anchors[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = hypot2(dx, dy);
    const segment =
      length <= 1e-9
        ? {
            ax: start.x,
            ay: start.y,
            bx: end.x,
            by: end.y,
            length_m: 0,
            ux: 1,
            uy: 0,
          }
        : {
            ax: start.x,
            ay: start.y,
            bx: end.x,
            by: end.y,
            length_m: length,
            ux: dx / length,
            uy: dy / length,
          };
    segments.push(segment);
    cumulativeLengths.push(
      cumulativeLengths[cumulativeLengths.length - 1] + length,
    );
  }

  return { anchors, segments, cumulativeLengths };
}

export function buildGlobalRotationKeyframes(
  path: PathModel,
  anchors: readonly Anchor[],
  cumulativeLengths: readonly number[],
): RotationKeyframe[] {
  const keyframes: RotationKeyframe[] = [];
  let rotationOrdinal = 0;

  for (const [pathIndex, element] of path.path_elements.entries()) {
    if (isRotationTarget(element)) {
      const bracket = surroundingAnchorOrdinals(
        path.path_elements,
        anchors,
        pathIndex,
      );
      if (!bracket) {
        continue;
      }
      const s0 = cumulativeLengths[bracket.previous] ?? 0;
      const s1 = cumulativeLengths[bracket.next] ?? s0;
      rotationOrdinal += 1;
      keyframes.push({
        s_m: s0 + clamp01(element.t_ratio) * Math.max(s1 - s0, 1e-9),
        theta_target: element.rotation.radians,
        event_ordinal_1b: rotationOrdinal,
        profiled_rotation: element.profiled_rotation,
      });
      continue;
    }

    if (isWaypoint(element)) {
      const anchorOrdinal = anchors.findIndex(
        (anchor) => anchor.pathIndex === pathIndex,
      );
      if (anchorOrdinal === -1) {
        continue;
      }
      rotationOrdinal += 1;
      keyframes.push({
        s_m: cumulativeLengths[anchorOrdinal] ?? 0,
        theta_target: element.rotation_target.rotation.radians,
        event_ordinal_1b: rotationOrdinal,
        profiled_rotation: element.rotation_target.profiled_rotation,
      });
    }
  }

  return dedupeRotationKeyframes(keyframes);
}

export function buildRotationDomainEvents(
  path: PathModel,
  anchors: readonly Anchor[],
  cumulativeLengths: readonly number[],
): RotationDomainEvent[] {
  const events: RotationDomainEvent[] = [];
  let ordinal = 0;

  for (const [pathIndex, element] of path.path_elements.entries()) {
    if (isWaypoint(element)) {
      const anchorOrdinal = anchors.findIndex(
        (anchor) => anchor.pathIndex === pathIndex,
      );
      if (anchorOrdinal === -1) {
        continue;
      }
      ordinal += 1;
      events.push({
        event_ordinal_1b: ordinal,
        s_m: cumulativeLengths[anchorOrdinal] ?? 0,
      });
      continue;
    }

    if (isRotationTarget(element)) {
      const bracket = surroundingAnchorOrdinals(
        path.path_elements,
        anchors,
        pathIndex,
      );
      if (!bracket) {
        continue;
      }
      const s0 = cumulativeLengths[bracket.previous] ?? 0;
      const s1 = cumulativeLengths[bracket.next] ?? s0;
      ordinal += 1;
      events.push({
        event_ordinal_1b: ordinal,
        s_m: s0 + clamp01(element.t_ratio) * Math.max(s1 - s0, 1e-9),
      });
    }
  }

  return events.sort((a, b) => a.s_m - b.s_m);
}

export function desiredHeadingForGlobalS(
  globalFrames: readonly RotationKeyframe[],
  sM: number,
  startHeading: number,
): {
  desiredTheta: number;
  dthetaDs: number;
  profiledRotation: boolean;
} {
  if (globalFrames.length === 0) {
    return {
      desiredTheta: startHeading,
      dthetaDs: 0,
      profiledRotation: true,
    };
  }

  const frames: Array<{
    s: number;
    theta: number;
    profiledRotation: boolean;
  }> = [];
  if (globalFrames[0].s_m > 1e-9) {
    frames.push({ s: 0, theta: startHeading, profiledRotation: true });
  }
  for (const keyframe of globalFrames) {
    frames.push({
      s: keyframe.s_m,
      theta: keyframe.theta_target,
      profiledRotation: keyframe.profiled_rotation,
    });
  }

  for (let index = 0; index < frames.length - 1; index += 1) {
    const current = frames[index];
    const next = frames[index + 1];
    const delta = shortestAngularDistance(next.theta, current.theta);
    const dthetaDs = delta / Math.max(next.s - current.s, 1e-9);

    if (sM <= current.s + 1e-12) {
      return {
        desiredTheta: current.theta,
        dthetaDs,
        profiledRotation: next.profiledRotation,
      };
    }

    if (current.s < sM && sM <= next.s + 1e-12) {
      if (!next.profiledRotation) {
        return {
          desiredTheta: next.theta,
          dthetaDs: 0,
          profiledRotation: next.profiledRotation,
        };
      }

      const alpha = (sM - current.s) / Math.max(next.s - current.s, 1e-9);
      return {
        desiredTheta: wrapAngleRadians(current.theta + delta * alpha),
        dthetaDs,
        profiledRotation: next.profiledRotation,
      };
    }
  }

  const last = frames[frames.length - 1];
  return {
    desiredTheta: last.theta,
    dthetaDs: 0,
    profiledRotation: last.profiledRotation,
  };
}

function normalizeSimulationConfig(input: unknown): SimulationConfig {
  if (!isRecord(input)) {
    return {};
  }

  const nested = isRecord(input.kinematic_constraints)
    ? input.kinematic_constraints
    : {};
  return {
    default_max_velocity_meters_per_sec: numericOption(
      input.default_max_velocity_meters_per_sec ??
        nested.default_max_velocity_meters_per_sec,
    ),
    default_max_acceleration_meters_per_sec2: numericOption(
      input.default_max_acceleration_meters_per_sec2 ??
        nested.default_max_acceleration_meters_per_sec2,
    ),
    default_intermediate_handoff_radius_meters: numericOption(
      input.default_intermediate_handoff_radius_meters ??
        nested.default_intermediate_handoff_radius_meters,
    ),
    default_max_velocity_deg_per_sec: numericOption(
      input.default_max_velocity_deg_per_sec ??
        nested.default_max_velocity_deg_per_sec,
    ),
    default_max_acceleration_deg_per_sec2: numericOption(
      input.default_max_acceleration_deg_per_sec2 ??
        nested.default_max_acceleration_deg_per_sec2,
    ),
  };
}

function resolveConstraint(
  value: unknown,
  fallback: unknown,
  defaultValue: number,
): number {
  const primary = numericOption(value);
  if (primary !== null && primary > 0) {
    return primary;
  }

  const secondary = numericOption(fallback);
  if (secondary !== null && secondary > 0) {
    return secondary;
  }

  return defaultValue;
}

function activeTranslationLimit(
  path: PathModel,
  key: RangedConstraintKey,
  nextAnchorOrdinal: number,
): number | null {
  let best: number | null = null;
  for (const constraint of path.ranged_constraints) {
    if (constraint.key !== key) {
      continue;
    }
    const start = Math.trunc(constraint.start_ordinal);
    const end = Math.trunc(constraint.end_ordinal);
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    if (lower <= nextAnchorOrdinal && nextAnchorOrdinal <= upper) {
      const value = numericOption(constraint.value);
      if (value !== null && value > 0) {
        best = best === null ? value : Math.min(best, value);
      }
    }
  }
  return best;
}

function activeRotationLimit(
  path: PathModel,
  rotationDomainEvents: readonly RotationDomainEvent[],
  key: RangedConstraintKey,
  globalSNow: number,
): number | null {
  const eventOrdinal = rotationTargetEventOrdinal(
    rotationDomainEvents,
    globalSNow,
  );
  if (eventOrdinal === null || eventOrdinal <= 0) {
    return null;
  }

  let best: number | null = null;
  for (const constraint of path.ranged_constraints) {
    if (constraint.key !== key) {
      continue;
    }
    const start = Math.trunc(constraint.start_ordinal);
    const end = Math.trunc(constraint.end_ordinal);
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    if (lower <= eventOrdinal && eventOrdinal <= upper) {
      const value = numericOption(constraint.value);
      if (value !== null && value > 0) {
        best = best === null ? value : Math.min(best, value);
      }
    }
  }
  return best;
}

function rotationTargetEventOrdinal(
  events: readonly RotationDomainEvent[],
  globalSNow: number,
): number | null {
  if (events.length === 0) {
    return null;
  }

  const tolerance = 1e-6;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (globalSNow < event.s_m - tolerance) {
      return event.event_ordinal_1b;
    }
    if (Math.abs(globalSNow - event.s_m) <= tolerance) {
      return events[index + 1]?.event_ordinal_1b ?? event.event_ordinal_1b;
    }
  }

  return events[events.length - 1].event_ordinal_1b;
}

function minimumPositiveConstraint(
  path: PathModel,
  key: RangedConstraintKey,
  fallback: number,
): number {
  let best = fallback;
  for (const constraint of path.ranged_constraints) {
    if (constraint.key !== key) {
      continue;
    }
    const value = numericOption(constraint.value);
    if (value !== null && value > 0) {
      best = Math.min(best, value);
    }
  }
  return best;
}

function handoffRadiusForSegment(
  path: PathModel,
  segmentIndex: number,
  anchors: readonly Anchor[],
  defaultRadius: number,
): number {
  const targetAnchor = anchors[segmentIndex + 1];
  if (!targetAnchor) {
    return defaultRadius;
  }

  const target = path.path_elements[targetAnchor.pathIndex];
  const radius =
    target?.type === "translation"
      ? target.intermediate_handoff_radius?.meters
      : target?.type === "waypoint"
        ? target.translation_target.intermediate_handoff_radius?.meters
        : null;
  const parsed = numericOption(radius);
  return parsed !== null && parsed > 0 ? parsed : defaultRadius;
}

function remainingDistanceFrom(
  segments: readonly Segment[],
  segmentIndex: number,
  currentX: number,
  currentY: number,
): number {
  let remaining = 0;
  let previousX = currentX;
  let previousY = currentY;

  for (let index = segmentIndex; index < segments.length; index += 1) {
    const segment = segments[index];
    remaining += hypot2(segment.bx - previousX, segment.by - previousY);
    previousX = segment.bx;
    previousY = segment.by;
  }

  return remaining;
}

function projectedDistanceOnSegment(
  segment: Segment,
  x: number,
  y: number,
): number {
  const projected = dot(x - segment.ax, y - segment.ay, segment.ux, segment.uy);
  return Math.max(0, Math.min(projected, segment.length_m));
}

function projectPointToGlobalS(
  x: number,
  y: number,
  segments: readonly Segment[],
  cumulativeLengths: readonly number[],
  fallbackS: number,
): number {
  let bestS = fallbackS;
  let bestDist2: number | null = null;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const projected = projectedDistanceOnSegment(segment, x, y);
    const projX = segment.ax + segment.ux * projected;
    const projY = segment.ay + segment.uy * projected;
    const dist2 = (x - projX) ** 2 + (y - projY) ** 2;
    if (bestDist2 === null || dist2 < bestDist2) {
      bestDist2 = dist2;
      bestS = (cumulativeLengths[index] ?? 0) + projected;
    }
  }

  return bestS;
}

function buildProtrusionVisibilityByTime(
  path: PathModel,
  rawConfig: unknown,
  anchors: readonly Anchor[],
  cumulativeLengths: readonly number[],
  globalSByTime: ReadonlyMap<number, number>,
  timesSorted: readonly number[],
): Map<number, boolean> {
  const visibilityByTime = new Map<number, boolean>();
  const protrusions = createProjectConfig(rawConfig).gui.protrusions;

  if (!protrusions.enabled) {
    for (const time of timesSorted) {
      visibilityByTime.set(time, false);
    }
    return visibilityByTime;
  }

  const schedule = buildProtrusionTriggerSchedule(
    path,
    anchors,
    cumulativeLengths,
    protrusions.show_on_event_keys,
    protrusions.hide_on_event_keys,
  );
  let visible = protrusions.default_state === "shown";
  let scheduleIndex = 0;

  for (const time of timesSorted) {
    const sNow = globalSByTime.get(time) ?? 0;
    while (
      scheduleIndex < schedule.length &&
      sNow + 1e-6 >= schedule[scheduleIndex].s_m
    ) {
      visible = schedule[scheduleIndex].visible;
      scheduleIndex += 1;
    }
    visibilityByTime.set(time, visible);
  }

  return visibilityByTime;
}

function buildProtrusionTriggerSchedule(
  path: PathModel,
  anchors: readonly Anchor[],
  cumulativeLengths: readonly number[],
  showOnEventKeys: readonly string[],
  hideOnEventKeys: readonly string[],
): ProtrusionTrigger[] {
  const showKeys = new Set(showOnEventKeys);
  const hideKeys = new Set(hideOnEventKeys);
  if (showKeys.size === 0 && hideKeys.size === 0) {
    return [];
  }

  const triggerSchedule: ProtrusionTrigger[] = [];
  for (const [pathIndex, element] of path.path_elements.entries()) {
    if (!isEventTrigger(element)) {
      continue;
    }

    const key = element.lib_key.trim();
    if (!key) {
      continue;
    }

    const visible = showKeys.has(key) ? true : hideKeys.has(key) ? false : null;
    if (visible === null) {
      continue;
    }

    const bracket = surroundingAnchorOrdinals(
      path.path_elements,
      anchors,
      pathIndex,
    );
    if (!bracket) {
      continue;
    }

    const s0 = cumulativeLengths[bracket.previous] ?? 0;
    const s1 = cumulativeLengths[bracket.next] ?? s0;
    triggerSchedule.push({
      s_m: s0 + clamp01(element.t_ratio) * Math.max(s1 - s0, 0),
      path_index: pathIndex,
      visible,
    });
  }

  return triggerSchedule.sort(
    (a, b) => a.s_m - b.s_m || a.path_index - b.path_index,
  );
}

function defaultHeading(segment: Segment): number {
  return Math.atan2(segment.by - segment.ay, segment.bx - segment.ax);
}

function anchorPoint(element: PathElement): { x: number; y: number } | null {
  if (element.type === "translation") {
    return { x: element.x.meters, y: element.y.meters };
  }
  if (element.type === "waypoint") {
    return {
      x: element.translation_target.x.meters,
      y: element.translation_target.y.meters,
    };
  }
  return null;
}

function surroundingAnchorOrdinals(
  elements: readonly PathElement[],
  anchors: readonly Anchor[],
  pathIndex: number,
): { previous: number; next: number } | null {
  let previous: number | null = null;
  let next: number | null = null;

  for (let index = pathIndex - 1; index >= 0; index -= 1) {
    if (anchorPoint(elements[index]) !== null) {
      const anchorIndex = anchors.findIndex(
        (anchor) => anchor.pathIndex === index,
      );
      if (anchorIndex !== -1) {
        previous = anchorIndex;
        break;
      }
    }
  }

  for (let index = pathIndex + 1; index < elements.length; index += 1) {
    if (anchorPoint(elements[index]) !== null) {
      const anchorIndex = anchors.findIndex(
        (anchor) => anchor.pathIndex === index,
      );
      if (anchorIndex !== -1) {
        next = anchorIndex;
        break;
      }
    }
  }

  return previous === null || next === null ? null : { previous, next };
}

function dedupeRotationKeyframes(
  keyframes: RotationKeyframe[],
): RotationKeyframe[] {
  const sorted = [...keyframes].sort((a, b) => a.s_m - b.s_m);
  const deduped: RotationKeyframe[] = [];
  let lastS: number | null = null;

  for (const keyframe of sorted) {
    if (lastS !== null && Math.abs(keyframe.s_m - lastS) < 1e-9) {
      deduped[deduped.length - 1] = keyframe;
    } else {
      deduped.push(keyframe);
      lastS = keyframe.s_m;
    }
  }

  return deduped;
}

function numericOption(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function dedupeTimes(timesSorted: readonly number[]): number[] {
  const uniqueTimes: number[] = [];
  const seen = new Set<number>();
  for (const time of timesSorted) {
    if (seen.has(time)) {
      continue;
    }
    seen.add(time);
    uniqueTimes.push(time);
  }
  return uniqueTimes;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

import type { PathModel } from "../core/model/path";
import type { SimulationTraceSample } from "../core/sim/types";
import { simulationEventMoments } from "./simulationEventPulse";

/** One plotted moment of the idealized preview, in display units. */
export interface MotionProfilePoint {
  time_s: number;
  speed_mps: number;
  omega_deg_per_s: number;
}

export interface MotionProfileEvent {
  key: string;
  time_s: number;
}

export interface MotionProfile {
  total_time_s: number;
  points: MotionProfilePoint[];
  peak_speed_mps: number;
  peak_omega_deg_per_s: number;
  /** Shared vertical extent so the configured limit stays visible as headroom. */
  speed_scale_max_mps: number;
  omega_scale_max_deg_per_s: number;
  speed_limit_mps: number | null;
  events: MotionProfileEvent[];
  /** Moments the controller hands off to the next translation target. */
  handoff_times_s: number[];
}

export interface MotionProfileReadout extends MotionProfilePoint {
  /** Magnitude of the trace acceleration, which includes turning. */
  acceleration_mps2: number;
  events: string[];
}

const maximumPlottedPoints = 600;
const scaleHeadroom = 1.08;
const eventReadoutWindowS = 0.12;

/**
 * Derive a plot-ready speed and angular-rate profile from a preview trace.
 * Display-only: it never feeds back into simulation or authored geometry.
 */
export function buildMotionProfile(
  path: PathModel | null,
  trace: readonly SimulationTraceSample[] | null | undefined,
  totalTimeS: number,
  speedLimitMps: number | null,
): MotionProfile | null {
  if (!trace || trace.length < 2 || !(totalTimeS > 0)) {
    return null;
  }

  const stride = Math.max(1, Math.ceil(trace.length / maximumPlottedPoints));
  const points: MotionProfilePoint[] = [];
  let peakSpeed = 0;
  let peakOmega = 0;
  for (let index = 0; index < trace.length; index += 1) {
    const sample = trace[index];
    const speed = Math.abs(sample.speed_mps);
    const omega = Math.abs(radiansToDegrees(sample.omega_radps));
    peakSpeed = Math.max(peakSpeed, speed);
    peakOmega = Math.max(peakOmega, omega);
    if (index % stride === 0 || index === trace.length - 1) {
      points.push({
        time_s: sample.time_s,
        speed_mps: speed,
        omega_deg_per_s: omega,
      });
    }
  }

  const limit =
    speedLimitMps !== null &&
    Number.isFinite(speedLimitMps) &&
    speedLimitMps > 0
      ? speedLimitMps
      : null;
  const handoffTimes: number[] = [];
  for (let index = 1; index < trace.length; index += 1) {
    if (
      trace[index].target_anchor_ordinal_1b !==
      trace[index - 1].target_anchor_ordinal_1b
    ) {
      handoffTimes.push(trace[index].time_s);
    }
  }

  return {
    total_time_s: totalTimeS,
    points,
    peak_speed_mps: peakSpeed,
    peak_omega_deg_per_s: peakOmega,
    speed_scale_max_mps: Math.max(0.5, peakSpeed, limit ?? 0) * scaleHeadroom,
    omega_scale_max_deg_per_s: Math.max(30, peakOmega) * scaleHeadroom,
    speed_limit_mps: limit,
    events: path
      ? simulationEventMoments(path, trace).map((event) => ({
          key: event.key || "Unnamed event",
          time_s: event.time,
        }))
      : [],
    handoff_times_s: handoffTimes,
  };
}

/** Interpolated values under the playhead or pointer. */
export function motionProfileReadoutAt(
  profile: MotionProfile,
  trace: readonly SimulationTraceSample[],
  timeS: number,
): MotionProfileReadout | null {
  if (trace.length === 0) {
    return null;
  }
  const time = Math.min(Math.max(timeS, 0), profile.total_time_s);
  let low = 0;
  let high = trace.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (trace[middle].time_s < time) low = middle + 1;
    else high = middle;
  }
  const to = trace[low];
  const from = trace[Math.max(0, low - 1)];
  const span = to.time_s - from.time_s;
  const amount =
    span > 0 ? Math.min(1, Math.max(0, (time - from.time_s) / span)) : 1;
  const lerp = (a: number, b: number) => a + (b - a) * amount;
  return {
    time_s: time,
    speed_mps: Math.abs(lerp(from.speed_mps, to.speed_mps)),
    omega_deg_per_s: Math.abs(
      radiansToDegrees(lerp(from.omega_radps, to.omega_radps)),
    ),
    acceleration_mps2: Math.abs(
      lerp(from.acceleration_mps2, to.acceleration_mps2),
    ),
    events: profile.events
      .filter((event) => Math.abs(event.time_s - time) <= eventReadoutWindowS)
      .map((event) => event.key),
  };
}

/** SVG polyline/area coordinates in a 0..width × 0..height box. */
export function motionProfilePolyline(
  profile: MotionProfile,
  series: "speed" | "omega",
  width: number,
  height: number,
): string {
  const scale =
    series === "speed"
      ? profile.speed_scale_max_mps
      : profile.omega_scale_max_deg_per_s;
  return profile.points
    .map((point) => {
      const value =
        series === "speed" ? point.speed_mps : point.omega_deg_per_s;
      const x = (point.time_s / profile.total_time_s) * width;
      const y = height - (Math.min(value, scale) / scale) * height;
      return `${round(x)},${round(y)}`;
    })
    .join(" ");
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

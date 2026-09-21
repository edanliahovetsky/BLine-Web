import { isEventTrigger, type PathModel } from "../core/model/path";
import type { SimulationTraceSample } from "../core/sim/types";
import { buildSegments } from "../core/sim/simulatePath";

const eventPulseLeadSeconds = 0.06;
const eventPulseFadeSeconds = 0.42;

export function simulationEventPulseAtTime(
  path: PathModel | null,
  trace: readonly SimulationTraceSample[] | null,
  timeS: number,
): number {
  if (!path || !trace || trace.length === 0 || timeS < 0) {
    return 0;
  }

  let pulse = 0;
  for (const event of eventTriggerPathDistances(path)) {
    const eventTime = timeAtPathDistance(trace, event.distance);
    if (eventTime === null) {
      continue;
    }

    const delta = timeS - eventTime;
    if (delta < -eventPulseLeadSeconds || delta > eventPulseFadeSeconds) {
      continue;
    }

    const nextPulse =
      delta <= 0
        ? 1 - Math.abs(delta) / eventPulseLeadSeconds
        : 1 - delta / eventPulseFadeSeconds;
    pulse = Math.max(pulse, smoothstep(nextPulse));
  }

  return clamp01(pulse);
}

export function simulationEventKeysAtTime(
  path: PathModel,
  trace: readonly SimulationTraceSample[],
  timeS: number,
): string[] {
  if (!trace.length || timeS < 0) return [];
  return eventTriggerPathDistances(path).flatMap((event) => {
    const eventTime = timeAtPathDistance(trace, event.distance);
    if (
      eventTime === null ||
      timeS < eventTime - eventPulseLeadSeconds ||
      timeS > eventTime + eventPulseFadeSeconds
    )
      return [];
    return [event.key || "Unnamed event"];
  });
}

/** Exact preview trigger moments, using the same geometric-progress mapping as the pulse. */
export function simulationEventMoments(
  path: PathModel,
  trace: readonly SimulationTraceSample[],
): { key: string; distance: number; time: number }[] {
  return eventTriggerPathDistances(path).flatMap((event) => {
    const time = timeAtPathDistance(trace, event.distance);
    return time === null ? [] : [{ ...event, time }];
  });
}

function eventTriggerPathDistances(
  path: PathModel,
): { distance: number; key: string }[] {
  const { anchors, cumulativeLengths: cumulativeDistances } =
    buildSegments(path);
  if (anchors.length < 2) return [];

  return path.path_elements.flatMap((element, pathIndex) => {
    if (!isEventTrigger(element)) {
      return [];
    }
    let previousAnchor = -1;
    for (let index = 0; index < anchors.length; index += 1) {
      if (anchors[index].pathIndex >= pathIndex) {
        break;
      }
      previousAnchor = index;
    }
    const nextAnchor = anchors.findIndex(
      (anchor) => anchor.pathIndex > pathIndex,
    );
    if (previousAnchor === -1 || nextAnchor === -1) {
      return [];
    }

    const startS = cumulativeDistances[previousAnchor] ?? 0;
    const endS = cumulativeDistances[nextAnchor] ?? startS;
    return [
      {
        distance:
          startS + clamp01(element.t_ratio) * Math.max(0, endS - startS),
        key: element.lib_key,
      },
    ];
  });
}

function timeAtPathDistance(
  trace: readonly SimulationTraceSample[],
  distanceM: number,
): number | null {
  const first = trace[0];
  if (!first) {
    return null;
  }
  if (distanceM <= first.global_s_m) {
    return first.time_s;
  }

  for (let index = 1; index < trace.length; index += 1) {
    const previous = trace[index - 1];
    const current = trace[index];
    if (current.global_s_m < distanceM) {
      continue;
    }

    const span = current.global_s_m - previous.global_s_m;
    if (span <= 1e-9) {
      return current.time_s;
    }
    const ratio = clamp01((distanceM - previous.global_s_m) / span);
    return previous.time_s + (current.time_s - previous.time_s) * ratio;
  }

  return null;
}

function smoothstep(value: number): number {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

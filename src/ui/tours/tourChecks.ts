import { isEventTrigger, type PathModel } from "../../core/model/path";
import type { ProjectConfig } from "../../core/model/project";
import { autoVelocityStatusForPath } from "../../core/constraints/autoVelocityApply";
import { tourStore, type TourFeedback } from "./tourStore";

export function feedback(
  complete: boolean,
  waiting: string,
  success: string,
): TourFeedback {
  return { complete, message: complete ? success : waiting };
}
/**
 * Lesson keys must match exactly, as they do in robot code. When the only
 * problem is capitalization, say so instead of repeating the instruction.
 */
export function eventKeyCaseHint(
  typed: Iterable<string>,
  expected: readonly string[],
): string | null {
  for (const raw of typed) {
    const key = raw.trim();
    const intended = expected.find(
      (candidate) =>
        candidate !== key &&
        candidate.toLocaleLowerCase() === key.toLocaleLowerCase(),
    );
    if (intended)
      return `Keys are case-sensitive — you typed "${key}"; use "${intended}".`;
  }
  return null;
}
export function withEventKeyCaseHint(
  result: TourFeedback,
  typed: Iterable<string>,
  expected: readonly string[],
): TourFeedback {
  if (result.complete) return result;
  const hint = eventKeyCaseHint(typed, expected);
  return hint ? { complete: false, message: hint } : result;
}
export function pathEventKeys(path: PathModel | null | undefined): string[] {
  return (path?.path_elements ?? []).flatMap((element) =>
    isEventTrigger(element) ? [element.lib_key] : [],
  );
}
export function checkPlan(
  path: PathModel,
  config: ProjectConfig,
): TourFeedback {
  return feedback(
    !autoVelocityStatusForPath(path, config).stale,
    "Generate the constraints for this route.",
    "Constraints are up to date.",
  );
}

/**
 * Hint for an event's position: quiet until the learner changes it from
 * where they placed it, then specific about what is still off.
 */
export function eventPosHint() {
  let token = "";
  const placed = new Map<number, number>();
  return (
    index: number | undefined,
    ratio: number | undefined,
    want: number,
  ) => {
    const state = tourStore.getState();
    const current = `${state.activeTourId}:${state.attemptId}:${state.stepIndex}`;
    if (current !== token) {
      token = current;
      placed.clear();
    }
    if (index === undefined || ratio === undefined) return "";
    if (!placed.has(index)) placed.set(index, ratio);
    if (Math.abs(ratio - placed.get(index)!) < 1e-6) return "";
    if (ratio <= 0 || ratio >= 1)
      return `Event Pos runs from 0 to 1. Type ${want}.`;
    return Math.abs(ratio - want) < 0.15
      ? `Close: it’s ${ratio.toFixed(2)}. Type exactly ${want}.`
      : "";
  };
}
/**
 * The value something had when this step first saw it, so a hint can tell a
 * learner’s change from the starting state.
 */
export function firstSeen<T>() {
  let token = "";
  const seen = new Map<string, T>();
  return (key: string, value: T): T => {
    const state = tourStore.getState();
    const current = `${state.activeTourId}:${state.attemptId}:${state.stepIndex}`;
    if (current !== token) {
      token = current;
      seen.clear();
    }
    if (!seen.has(key)) seen.set(key, value);
    return seen.get(key)!;
  };
}
/** Placing an event focuses its Lib Key, where ⌘Z undoes typing instead. */
export const wrongStretchHint = (between: string) =>
  `That one isn’t between ${between}. Remove it with its row’s red − button, then click the highlighted stretch.`;

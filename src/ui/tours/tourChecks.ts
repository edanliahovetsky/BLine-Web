import { isEventTrigger, type PathModel } from "../../core/model/path";
import type { ProjectConfig } from "../../core/model/project";
import { autoVelocityStatusForPath } from "../../core/constraints/autoVelocityApply";
import { tourStore, type TourFeedback, type TourShowMe } from "./tourStore";

export function feedback(
  complete: boolean,
  waiting: string,
  success: string,
): TourFeedback {
  return { complete, message: complete ? success : waiting };
}
/** A near miss: what went wrong, and where Show me points to fix it. */
export interface NearMiss {
  message: string;
  showMe: TourShowMe;
}
/** Like `feedback`, but a near miss also redirects Show me to its fix. */
export function feedbackOr(
  complete: boolean,
  miss: NearMiss | null,
  success: string,
): TourFeedback {
  return complete
    ? { complete, message: success }
    : miss
      ? { complete, message: miss.message, showMe: miss.showMe }
      : { complete, message: "" };
}
/** Show me's stop for Undo, when a hint says to press ⌘Z. */
export const undoStop = "label:Undo";
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
/**
 * An event placed on the wrong stretch. Placing one opens the sidebar and
 * focuses its Lib Key, where ⌘Z and Delete edit the text, so the hint and
 * Show me point at the row's remove button. With the sidebar closed (after
 * Back, say), selecting the event on the canvas works instead.
 */
export const wrongStretch = (
  between: string,
  eventIndex: number | null,
): NearMiss => {
  const sidebarOpen =
    typeof document !== "undefined" &&
    !!document.querySelector(
      '[data-tour="inspector-toggle"][aria-expanded="true"]',
    );
  return sidebarOpen
    ? {
        message: `That one isn’t between ${between}. Remove it with its row’s red − button, then click the highlighted stretch.`,
        showMe:
          eventIndex === null
            ? []
            : [`label:Remove Event Trigger ${eventIndex + 1}`],
      }
    : {
        message: `That one isn’t between ${between}. Click it and press Delete, then click the highlighted stretch.`,
        showMe:
          eventIndex === null
            ? []
            : [
                { target: "tool-select", done: selectToolChosen },
                `lesson-element-${eventIndex}`,
              ],
      };
};
const selectToolChosen = () =>
  typeof document !== "undefined" &&
  !!document.querySelector('[data-tour="tool-select"][aria-pressed="true"]');
/**
 * The newest event outside a stretch, ignoring `startIntake` from an earlier
 * step, which belongs on the first stretch.
 */
export function strayEventIndex(
  path: PathModel,
  bounds: readonly [number, number] | null,
): number | null {
  let stray: number | null = null;
  path.path_elements.forEach((element, index) => {
    if (!isEventTrigger(element)) return;
    const inside = !!bounds && index > bounds[0] && index < bounds[1];
    if (!inside && element.lib_key.trim() !== "startIntake") stray = index;
  });
  return stray;
}

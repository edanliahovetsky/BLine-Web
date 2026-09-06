import type { PathElement, PathModel } from "../../core/model/path";
import type { TourFeedback, TourStep } from "./tourStore";

/** The same assessment is used for feedback, placement locks, and Next. */
export function assessTourStep(
  step: TourStep,
  path: PathModel | null,
): TourFeedback {
  if (step.elements && !path)
    return {
      complete: false,
      message:
        "The practice path is missing. Restart the lesson to restore it.",
    };
  if (step.elements && path) {
    const types: PathElement["type"][] = [
      "waypoint",
      "translation",
      "rotation",
      "event_trigger",
    ];
    for (const type of types) {
      const actual = path.path_elements.filter(
        (element) => element.type === type,
      ).length;
      const expected = step.elements[type] ?? 0;
      if (actual !== expected) {
        const label =
          type === "event_trigger"
            ? "event trigger"
            : type === "translation"
              ? "translation target"
              : type === "rotation"
                ? "rotation target"
                : "waypoint";
        return {
          complete: false,
          message: `${actual > expected ? "Extra" : "Missing"} ${label}: this exercise needs ${expected}, and has ${actual}. Use Undo or Restart exercise to repair the route.`,
        };
      }
    }
  }
  const invariant = step.validate?.();
  if (invariant && !invariant.complete) return invariant;
  return (
    step.check?.() ?? { complete: step.completeWhen?.() ?? true, message: "" }
  );
}

export function tourInteractionTargets(step: TourStep): readonly string[] {
  const targets = [...(step.interact ?? [])];
  if (targets.includes("max-velocity-card")) targets.push("constraint-popout");
  return targets;
}

/** Tool buttons live inside the canvas rectangle; they need their own permission. */
export function tourAllowsTarget(step: TourStep, target: Element): boolean {
  const targets = tourInteractionTargets(step);
  const tool = target.closest('[data-tour^="tool-"]');
  if (tool) return targets.includes(tool.getAttribute("data-tour") ?? "");
  return (
    targets.some((id) => !!target.closest(`[data-tour="${id}"]`)) ||
    (targets.includes("lesson-health-dialog") &&
      !!target.closest('[role="dialog"][aria-label="Path health"]'))
  );
}

export function tourAllowsShortcut(
  step: TourStep,
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
  complete: boolean,
): boolean {
  const key = event.key.toLowerCase();
  const targets = tourInteractionTargets(step);
  if (event.metaKey || event.ctrlKey) {
    // History is always available as a repair route, including after placement.
    if (key === "z" || key === "y") return true;
    if (key === "d")
      return (
        !step.lockInteractionOnComplete && targets.includes("inspector-panel")
      );
    return false;
  }
  if (complete && step.lockInteractionOnComplete) return false;
  const tool = (
    {
      "1": "waypoint",
      "2": "translation",
      "3": "rotation",
      "4": "event",
      c: "curve",
    } as Record<string, string>
  )[key];
  if (tool) return targets.includes(`tool-${tool}`);
  if ([" ", "k", "j", "l", "home", "end"].includes(key))
    return (
      targets.includes("simulation-transport") ||
      targets.includes("transport-timeline")
    );
  if (key === "v") return targets.includes("path-canvas");
  if (key.startsWith("arrow"))
    return event.altKey
      ? targets.includes("inspector-panel")
      : targets.includes("path-canvas");
  if (["[", "]", "delete", "backspace"].includes(key))
    return (
      targets.includes("inspector-panel") || targets.includes("path-canvas")
    );
  return false;
}

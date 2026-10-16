import type { TourFeedback, TourPointer, TourStep } from "./tourStore";

/**
 * A step whose Show me follows the learner's progress: its requirements carry
 * their own stops, or its stops say when they are done. Older steps list
 * plain ids that Show me pulses in turn.
 */
export function followsProgress(step: TourStep): boolean {
  return (
    !!step.checks?.some((check) => check.showMe) ||
    !!step.showMe?.some((stop) => typeof stop !== "string")
  );
}

/**
 * The next thing to do: the first stop not yet done, for the first unmet
 * requirement. Nothing once the step is complete.
 */
export function nextShowMeStop(
  step: TourStep,
  assessment: TourFeedback,
): TourPointer | null {
  if (assessment.complete) return null;
  const unmet = assessment.items?.findIndex((item) => !item.complete) ?? -1;
  const route =
    (unmet >= 0 ? step.checks?.[unmet]?.showMe : undefined) ??
    step.showMe ??
    [];
  for (const stop of route) {
    const pointer = typeof stop === "string" ? { target: stop } : stop;
    if (!pointer.done?.()) return pointer;
  }
  return null;
}

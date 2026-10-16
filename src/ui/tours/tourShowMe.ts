import { selectionStore } from "../../state/selectionStore";
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
): (TourPointer & { target: string }) | null {
  if (assessment.complete) return null;
  const unmet = assessment.items?.findIndex((item) => !item.complete) ?? -1;
  const route =
    (unmet >= 0 ? step.checks?.[unmet]?.showMe : undefined) ??
    step.showMe ??
    [];
  for (const stop of route) {
    const pointer = typeof stop === "string" ? { target: stop } : stop;
    if (!pointer.done?.())
      return {
        ...pointer,
        target:
          typeof pointer.target === "function"
            ? pointer.target()
            : pointer.target,
      };
  }
  return null;
}

const pressable =
  'button, [role="tab"], [role="option"], [role="menuitem"], [role="switch"], a';

/** On screen and part of the editor, not the lesson card itself. */
function visible(element: Element) {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && !element.closest(".tour-layer");
}

/**
 * The element a lesson target names. Most are `data-tour` ids; the rest let a
 * step point at the exact control without new markup:
 * - `label:Event Pos (0-1)`: the control with that accessible name or that
 *   Settings row label, or its whole row;
 * - `text:Generate`: a button, tab, option, or menu item with that text;
 * - `testid:handoff-radius-chip-1`: a `data-testid`;
 * - `lesson-speed-3`: the speed limit cell covering the drive to point 3.
 */
export function findTourTarget(
  id: string,
  root: ParentNode = document,
): HTMLElement | null {
  const speedOrdinal =
    id === "lesson-corner-speed"
      ? 3
      : id === "lesson-pickup-speed"
        ? 2
        : id === "lesson-delivery-speed"
          ? 4
          : Number(/^lesson-speed-(\d+)$/.exec(id)?.[1]) || null;
  if (speedOrdinal)
    return (
      Array.from(
        root.querySelectorAll<HTMLElement>(
          '[data-ranged-constraint-key="max_velocity_meters_per_sec"][data-range-start]',
        ),
      ).find(
        (candidate) =>
          Number(candidate.dataset.rangeStart) <= speedOrdinal &&
          Number(candidate.dataset.rangeEnd) >= speedOrdinal,
      ) ??
      root.querySelector<HTMLElement>(
        `[data-testid="constraint-cell-max_velocity_meters_per_sec-${speedOrdinal}"]`,
      )
    );
  if (id === "lesson-health-dialog")
    return root.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Path health"]',
    );
  if (id === "lesson-lib-key") return findTourTarget("label:Lib Key", root);
  if (id === "lesson-event-pos")
    return findTourTarget("label:Event Pos (0-1)", root);
  if (id.startsWith("label:")) {
    // `*` stands for a number the editor puts in the name, as in
    // `label:Constraint * value`.
    const pattern = new RegExp(
      `^${id
        .slice("label:".length)
        .replace(/[.*+?^${}()|[\]\\]/g, (match) =>
          match === "*" ? "\\d+" : `\\${match}`,
        )}$`,
    );
    const control = Array.from(
      root.querySelectorAll<HTMLElement>("[aria-label]"),
    ).find(
      (element) =>
        visible(element) && pattern.test(element.getAttribute("aria-label")!),
    );
    if (control)
      return control.closest<HTMLElement>(".property-row") ?? control;
    // Settings rows name their control with visible text instead, and some
    // buttons are named only by their text.
    const text = id.slice("label:".length);
    return (
      Array.from(root.querySelectorAll<HTMLElement>(".config-row__label"))
        .find((label) => visible(label) && label.textContent?.trim() === text)
        ?.closest<HTMLElement>(".config-row") ??
      findTourTarget(`text:${text}`, root)
    );
  }
  if (id.startsWith("text:")) {
    const text = id.slice("text:".length).trim();
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>(pressable),
    ).filter(visible);
    return (
      candidates.find((candidate) => candidate.textContent?.trim() === text) ??
      candidates.find((candidate) =>
        candidate.textContent?.trim().startsWith(text),
      ) ??
      null
    );
  }
  if (id.startsWith("testid:"))
    return root.querySelector<HTMLElement>(
      `[data-testid="${CSS.escape(id.slice("testid:".length))}"]`,
    );
  return root.querySelector<HTMLElement>(`[data-tour="${id}"]`);
}

/** Show me's stop at a point's handoff radius cell, skipped once selected. */
export function radiusCell(elementIndex: number, echo?: string): TourPointer {
  const id = `handoff-radius-chip-${elementIndex}`;
  return {
    target: `testid:${id}`,
    echo,
    done: () =>
      !!document.querySelector(`[data-testid="${id}"][aria-pressed="true"]`),
  };
}

/** Show me's stop at a constraint's cell for `ordinal`, skipped once selected. */
export function constraintCell(
  key: string,
  ordinal: number,
  target: string,
): TourPointer {
  return {
    target,
    done: () => {
      const selected = selectionStore.getState().selectedRangedConstraint;
      return (
        selected?.key === key &&
        selected.startOrdinal <= ordinal &&
        selected.endOrdinal >= ordinal
      );
    },
  };
}

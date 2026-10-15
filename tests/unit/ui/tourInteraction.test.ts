import { describe, expect, it } from "vitest";
import {
  assessTourStep,
  tourAllowsShortcut,
  tourInteractionTargets,
} from "../../../src/ui/tours/tourInteraction";
import type { TourStep } from "../../../src/ui/tours/tourStore";

const placement: TourStep = {
  title: "Endpoints",
  body: "Place endpoints",
  interact: ["tool-waypoint", "path-canvas"],
  lockInteractionOnComplete: true,
};
const key = (key: string, modifier = false) => ({
  key,
  metaKey: modifier,
  ctrlKey: false,
  altKey: false,
});

describe("lesson interaction contract", () => {
  it("reports each named sub-check and completes only when all pass", () => {
    const state = { placed: false, keyed: false };
    const step: TourStep = {
      title: "Add",
      body: "Add an event",
      task: "Add it",
      checks: [
        {
          label: "Placed",
          check: () => ({ complete: state.placed, message: "Place it." }),
        },
        {
          label: "Keyed",
          check: () => ({ complete: state.keyed, message: "Type the key." }),
        },
      ],
    };
    expect(assessTourStep(step)).toEqual({
      complete: false,
      message: "Place it.",
      items: [
        { label: "Placed", complete: false, hint: "Place it." },
        { label: "Keyed", complete: false, hint: "Type the key." },
      ],
    });
    state.placed = true;
    expect(assessTourStep(step)).toMatchObject({
      complete: false,
      message: "Type the key.",
    });
    state.keyed = true;
    expect(assessTourStep(step).complete).toBe(true);
    expect(
      assessTourStep({
        ...step,
        check: () => ({ complete: false, message: "Overall" }),
      }),
    ).toMatchObject({ complete: false, message: "Overall" });
  });

  it("limits keyboard tools and duplication while keeping history available", () => {
    expect(tourAllowsShortcut(placement, key("1"), false)).toBe(true);
    expect(tourAllowsShortcut(placement, key("2"), false)).toBe(false);
    expect(tourAllowsShortcut(placement, key("d", true), false)).toBe(false);
    expect(tourAllowsShortcut(placement, key("1"), true)).toBe(false);
    expect(tourAllowsShortcut(placement, key("z", true), true)).toBe(true);
    expect(tourAllowsShortcut(placement, key("k", true), false)).toBe(false);
  });

  it("keeps constraints popouts accessible and gates keyboard playback", () => {
    const constraints = {
      title: "Speed",
      body: "Tune",
      interact: ["max-velocity-card"],
    };
    expect(tourInteractionTargets(constraints)).toContain("constraint-popout");
    expect(tourAllowsShortcut(constraints, key(" "), false)).toBe(false);
    expect(
      tourAllowsShortcut(
        { ...constraints, interact: ["simulation-transport"] },
        key(" "),
        false,
      ),
    ).toBe(true);
  });

  it("rechecks completion against current state instead of a previously earned tick", () => {
    let complete = true;
    const step = {
      title: "Observe",
      body: "Check",
      check: () => ({ complete, message: "Current result" }),
    };
    expect(assessTourStep(step).complete).toBe(true);
    complete = false;
    expect(assessTourStep(step).complete).toBe(false);
  });
});

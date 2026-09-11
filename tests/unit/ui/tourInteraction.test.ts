import { describe, expect, it } from "vitest";
import {
  createPathModel,
  createTranslationTarget,
  createWaypoint,
} from "../../../src/core/model/path";
import {
  assessTourStep,
  tourAllowsShortcut,
  tourInteractionTargets,
} from "../../../src/ui/tours/tourInteraction";
import type { TourStep } from "../../../src/ui/tours/tourStore";

const placement: TourStep = {
  title: "Endpoints",
  body: "Place endpoints",
  elements: { waypoint: 2 },
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
  it("does not accept mixed types, extra elements, or missing endpoints", () => {
    const path = createPathModel({
      path_elements: [createWaypoint(), createTranslationTarget()],
    });
    expect(assessTourStep(placement, path)).toMatchObject({
      complete: false,
      message: expect.stringContaining("Missing waypoint"),
    });
    path.path_elements = [
      createWaypoint(),
      createWaypoint(),
      createTranslationTarget(),
    ];
    expect(assessTourStep(placement, path)).toMatchObject({
      complete: false,
      message: expect.stringContaining("Extra translation"),
    });
    path.path_elements.pop();
    expect(assessTourStep(placement, path).complete).toBe(true);
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
    expect(assessTourStep(step, null).complete).toBe(true);
    complete = false;
    expect(assessTourStep(step, null).complete).toBe(false);
  });
});

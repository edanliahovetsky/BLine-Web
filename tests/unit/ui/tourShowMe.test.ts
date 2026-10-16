import { describe, expect, it } from "vitest";
import {
  followsProgress,
  nextShowMeStop,
} from "../../../src/ui/tours/tourShowMe";
import type { TourFeedback, TourStep } from "../../../src/ui/tours/tourStore";

const pending = (...complete: boolean[]): TourFeedback => ({
  complete: false,
  message: "",
  items: complete.map((done, index) => ({
    label: `item ${index}`,
    complete: done,
    hint: "",
  })),
});

describe("Show me", () => {
  let toolChosen = false;
  const step: TourStep = {
    title: "Add an event",
    checks: [
      {
        label: "Place it",
        check: () => ({ complete: false, message: "" }),
        showMe: [
          { target: "tool-event", done: () => toolChosen },
          "lesson-segment",
        ],
      },
      {
        label: "Name it",
        check: () => ({ complete: false, message: "" }),
        showMe: [{ target: "lesson-lib-key", echo: "lesson-element" }],
      },
    ],
  };

  it("points at the next action for the first unmet requirement", () => {
    toolChosen = false;
    expect(nextShowMeStop(step, pending(false, false))?.target).toBe(
      "tool-event",
    );
    toolChosen = true;
    expect(nextShowMeStop(step, pending(false, false))?.target).toBe(
      "lesson-segment",
    );
    expect(nextShowMeStop(step, pending(true, false))).toMatchObject({
      target: "lesson-lib-key",
      echo: "lesson-element",
    });
  });

  it("stops pointing once the step is complete", () => {
    expect(
      nextShowMeStop(step, { ...pending(true, true), complete: true }),
    ).toBeNull();
  });

  it("uses the step's own stops for a single-check step", () => {
    const single: TourStep = {
      title: "Find a speed limit",
      showMe: [{ target: "lesson-speed-3", echo: "lesson-segment" }],
      check: () => ({ complete: false, message: "" }),
    };
    expect(followsProgress(single)).toBe(true);
    expect(
      nextShowMeStop(single, { complete: false, message: "" })?.target,
    ).toBe("lesson-speed-3");
  });

  it("leaves plain id lists to the older pulse tour", () => {
    expect(followsProgress(step)).toBe(true);
    expect(followsProgress({ title: "Sidebar", showMe: ["a", "b", "c"] })).toBe(
      false,
    );
  });
});

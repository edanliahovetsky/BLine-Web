import { describe, expect, it } from "vitest";
import { tours } from "../../../src/ui/tours/tours";

describe("guided lesson content", () => {
  it("keeps every lesson focused, interactive, and free of dash punctuation", () => {
    expect(tours).toHaveLength(5);

    for (const tour of tours) {
      expect(tour.steps.length).toBeGreaterThanOrEqual(11);
      expect(tour.steps.length).toBeLessThanOrEqual(13);
      expect(tour.durationMinutes).toBeGreaterThan(0);
      expect(tour.summary).not.toMatch(/[—–]/);
      expect(tour.completionMessage).not.toMatch(/[—–]/);
      for (const step of tour.steps) {
        expect(step.title).not.toMatch(/[—–]/);
        expect(step.body).not.toMatch(/[—–]/);
        expect(step.task ?? "").not.toMatch(/[—–]/);
        if (step.completeWhen) {
          expect(step.task).toBeTruthy();
        }
      }
    }

    const scrubSteps = tours.flatMap((tour) =>
      tour.steps.filter((step) => step.target === "transport-timeline"),
    );
    expect(scrubSteps).toHaveLength(1);
    expect(scrubSteps[0]?.title).toBe("Scrub the timeline");
  });

  it("starts with realistic routes and leaves room for learner edits", () => {
    const seededElementCounts = tours.map(
      (tour) => tour.practicePath().path_elements.length,
    );

    expect(seededElementCounts).toEqual([0, 2, 3, 2, 4]);
  });

  it("uses visible field goals for the scenario lessons", () => {
    expect(tours.map((tour) => tour.markers?.length ?? 0)).toEqual([
      2, 1, 1, 1, 0,
    ]);
  });
});

describe("guided lesson dialogue choreography", () => {
  it("reserves a canvas corner for every field interaction", () => {
    const fieldSteps = tours.flatMap((tour) =>
      tour.steps
        .filter(
          (step) =>
            step.interact?.includes("path-canvas") ||
            step.interact?.includes("simulation-transport"),
        )
        .map((step) => `${tour.id}: ${step.title}`),
    );
    const positionedFieldSteps = tours.flatMap((tour) =>
      tour.steps
        .filter(
          (step) =>
            (step.interact?.includes("path-canvas") ||
              step.interact?.includes("simulation-transport")) &&
            step.cardPosition?.startsWith("canvas-"),
        )
        .map((step) => `${tour.id}: ${step.title}`),
    );

    expect(positionedFieldSteps).toEqual(fieldSteps);
  });

  it("keeps field-story callouts away from their markers", () => {
    for (const tour of tours) {
      for (const step of tour.steps.filter((candidate) =>
        candidate.target?.startsWith("lesson-"),
      )) {
        expect(step.cardPosition, `${tour.id}: ${step.title}`).toBe(
          "canvas-top-right",
        );
      }
    }
  });

  it("keeps the capstone repair dialogue opposite the right-side defects", () => {
    const capstone = tours.find((tour) => tour.id === "verify-export");
    const repairSteps = capstone?.steps.filter((step) =>
      step.title.startsWith("Fix the"),
    );

    expect(repairSteps?.map((step) => step.cardPosition)).toEqual([
      "canvas-top-left",
      "canvas-top-left",
    ]);
  });
});

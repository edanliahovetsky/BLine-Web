import { describe, expect, it } from "vitest";
import { tours } from "../../../src/ui/tours/tours";

describe("guided lesson content", () => {
  it("keeps every lesson focused, interactive, and free of dash punctuation", () => {
    for (const tour of tours) {
      expect(tour.steps.length).toBeGreaterThanOrEqual(7);
      expect(tour.steps.length).toBeLessThanOrEqual(9);
      expect(tour.durationMinutes).toBeGreaterThan(0);
      expect(tour.summary).not.toMatch(/[—–]/);
      expect(tour.completionMessage).not.toMatch(/[—–]/);
      expect(
        tour.steps.some(
          (step) =>
            step.target === "simulation-transport" &&
            step.completeWhen &&
            step.advance === "manual",
        ),
      ).toBe(true);

      for (const step of tour.steps) {
        expect(step.title).not.toMatch(/[—–]/);
        expect(step.body).not.toMatch(/[—–]/);
        expect(step.task ?? "").not.toMatch(/[—–]/);
        if (step.completeWhen) {
          expect(step.task).toBeTruthy();
        }
      }
    }
  });

  it("starts with realistic routes and leaves room for learner edits", () => {
    const seededElementCounts = tours.map(
      (tour) => tour.practicePath().path_elements.length,
    );

    expect(seededElementCounts).toEqual([3, 2, 5, 9]);
  });
});

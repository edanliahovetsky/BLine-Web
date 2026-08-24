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

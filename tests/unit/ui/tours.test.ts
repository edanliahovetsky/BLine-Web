import { describe, expect, it } from "vitest";
import { tours } from "../../../src/ui/tours/tours";

describe("guided lesson content", () => {
  it("keeps every lesson short, actionable, and free of dash punctuation", () => {
    for (const tour of tours) {
      expect(tour.steps).toHaveLength(6);
      expect(tour.durationMinutes).toBeGreaterThan(0);
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
  });
});

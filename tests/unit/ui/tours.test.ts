import { describe, expect, it } from "vitest";
import { tours } from "../../../src/ui/tours/tours";
import { speedCap } from "../../../src/ui/tours/tourChecks";

describe("guided lesson content", () => {
  it("teaches seven focused lessons with speed before radius tuning", () => {
    expect(tours.map((tour) => tour.id)).toEqual([
      "build-first-path",
      "shape-route",
      "plan-speed",
      "understand-handoffs",
      "control-heading",
      "trigger-actions",
      "verify-export",
    ]);
    for (const tour of tours) {
      expect(tour.steps.some((step) => step.phase === "Challenge")).toBe(true);
      expect(tour.steps.length).toBeLessThanOrEqual(9);
      expect(tour.durationMinutes).toBeGreaterThan(0);
      for (const step of tour.steps) {
        expect(
          [step.title, step.body, step.task, ...(step.hints ?? [])].join(" "),
        ).not.toMatch(/[—–]/);
        if (step.check) expect(step.task).toBeTruthy();
      }
    }
  });
  it("gets two waypoints moving before teaching other editor mechanics", () => {
    const build = tours[0];
    expect(build.steps[1].title).toBe("Place the endpoints");
    expect(build.steps[2].target).toBe("transport-play");
    expect(build.steps[2].elements).toEqual({ waypoint: 2 });
    expect(build.steps.some((step) => step.title.includes("order"))).toBe(
      false,
    );
    expect(
      tours[1].steps.some((step) => step.title === "Put it in drive order"),
    ).toBe(true);
  });
  it("starts the local-speed edit with a separate generated turn cap", () => {
    const speed = tours[2];
    const cap = speedCap(speed.practicePath(), 3);
    expect(cap).toMatchObject({
      source: "auto_velocity",
      start_ordinal: 3,
      end_ordinal: 3,
    });
    expect(cap!.value).toBeGreaterThan(1.2);
    expect(speed.steps.findIndex((step) => step.captureReference)).toBeLessThan(
      speed.steps.findIndex((step) => step.title.includes("shared")),
    );
  });
  it("prepares properties by element role and gives guided steps a structural contract", () => {
    for (const tour of tours.slice(0, -1)) {
      for (const step of tour.steps) {
        if (step.target === "element-properties")
          expect(step.prepare?.selectElement).toBeTypeOf("function");
        if (!step.lockInteractionOnComplete)
          expect(step.elements).toBeDefined();
      }
    }
    const capstone = tours.at(-1)!;
    expect(
      capstone.steps.find((step) => step.title === "Repair the whole mission")
        ?.elements,
    ).toBeUndefined();
    expect(capstone.steps.slice(3).every((step) => step.validate)).toBe(true);
  });
  it("keeps heading and event teaching separate and requires actual observation", () => {
    expect(
      tours[4]
        .practicePath()
        .path_elements.some((element) => element.type === "event_trigger"),
    ).toBe(false);
    expect(tours[4].steps.some((step) => step.experiment === "heading")).toBe(
      true,
    );
    expect(tours[5].steps.some((step) => step.experiment === "events")).toBe(
      true,
    );
    expect(
      tours[5].steps.some((step) => step.target === "transport-timeline"),
    ).toBe(true);
    for (const tour of tours) {
      for (const step of tour.steps.filter(
        (step) => step.phase === "Observe" && step.check,
      )) {
        expect(step.task).toBeTruthy();
      }
    }
  });
});

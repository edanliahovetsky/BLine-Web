import { describe, expect, it } from "vitest";
import { tours } from "../../../src/ui/tours/tours";

describe("guided lesson content", () => {
  it("keeps every lesson focused, interactive, and free of dash punctuation", () => {
    expect(tours).toHaveLength(5);

    for (const tour of tours) {
      expect(tour.steps.some((step) => step.phase === "Challenge")).toBe(true);
      expect(
        tour.steps.filter((step) => step.check).length,
      ).toBeGreaterThanOrEqual(5);
      expect(tour.durationMinutes).toBeGreaterThan(0);
      expect(tour.summary).not.toMatch(/[—–]/);
      expect(tour.completionMessage).not.toMatch(/[—–]/);
      for (const step of tour.steps) {
        expect(step.title).not.toMatch(/[—–]/);
        expect(step.body).not.toMatch(/[—–]/);
        expect(`${step.title} ${step.body}`).not.toMatch(
          /\b[WT]\d+\b|ordinals?|range bar/i,
        );
        expect(step.task ?? "").not.toMatch(/[—–]/);
        if (step.check) {
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

    expect(seededElementCounts).toEqual([0, 2, 4, 2, 7]);
  });

  it("uses visible field goals for the scenario lessons", () => {
    expect(tours.map((tour) => tour.markers?.length ?? 0)).toEqual([
      2, 4, 6, 3, 6,
    ]);
  });

  it("stages left-toolbar lesson work in the center-right field area", () => {
    const [build, shape, , behavior] = tours;

    expect(build?.markers?.map((marker) => marker.xMeters)).toEqual([5, 15]);
    expect(
      shape?.markers?.find((marker) => marker.kind === "structure")?.xMeters,
    ).toBeGreaterThan(10);
    expect(
      behavior?.markers?.find((marker) => marker.kind === "game-piece")
        ?.xMeters,
    ).toBe(8);
  });

  it("teaches drive order with a misplaced middle waypoint", () => {
    const firstPath = tours.find((tour) => tour.id === "build-first-path");
    const endpointsIndex = firstPath?.steps.findIndex(
      (step) => step.title === "Place the endpoints",
    );
    const middleIndex = firstPath?.steps.findIndex(
      (step) => step.title === "Add a middle waypoint",
    );
    const reorderStep = firstPath?.steps.find(
      (step) => step.title === "Put it in drive order",
    );

    expect(endpointsIndex).toBeGreaterThan(-1);
    expect(middleIndex).toBeGreaterThan(-1);
    expect(middleIndex).toBeGreaterThan(endpointsIndex ?? -1);
    expect(
      firstPath?.steps
        .filter((step) => step.target === "tool-waypoint")
        .every((step) => step.lockInteractionOnComplete),
    ).toBe(true);
    expect(reorderStep?.interact).toContain("inspector-panel");
    expect(reorderStep?.check).toBeTypeOf("function");
  });

  it("teaches handoff radii through the Constraints ledger", () => {
    const shape = tours.find((tour) => tour.id === "shape-route");
    const radiusStep = shape?.steps.find(
      (step) => step.title === "Tune the handoff",
    );

    expect(radiusStep?.target).toBe("max-velocity-card");
    expect(radiusStep?.prepare?.inspectorTab).toBe("constraints");
    expect(radiusStep?.interact).toContain("max-velocity-card");

    const regenerateStep = shape?.steps.find(
      (step) => step.title === "Regenerate the constraints",
    );
    expect(regenerateStep?.target).toBe("max-velocity-card");
    expect(regenerateStep?.check).toBeTypeOf("function");
  });
});

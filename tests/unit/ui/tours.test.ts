import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureTourStepState,
  foundationalTours,
  tourPathIntent,
} from "../../../src/ui/tours/tours";
import {
  createEventLessonPath,
  createFastRotationPath,
  createFundamentalsDemoPath,
  createHandoffLessonPath,
  createLowAccelerationPath,
  createRotationLessonPath,
  createTuningRectanglePath,
  tuningMarkers,
  tuningObstacle,
} from "../../../src/ui/tours/courseScenarios";
import {
  createEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathModel,
} from "../../../src/core/model/path";
import { createProject } from "../../../src/core/model/project";
import {
  autoVelocityStatusForPath,
  refreshAutoVelocityConstraints,
} from "../../../src/core/constraints/autoVelocityApply";
import { evaluateRotationFeasibility } from "../../../src/core/sim/rotationFeasibility";
import { simulatePathWithTrace } from "../../../src/core/sim";
import { practiceConfig } from "../../../src/ui/tours/tourScenario";
import { projectStore } from "../../../src/state/projectStore";
import { tourStore } from "../../../src/ui/tours/tourStore";

function loadPractice(path: PathModel) {
  projectStore.setState({
    project: createProject({
      project_id: "lesson-test",
      display_name: "Lesson test",
      config: practiceConfig(),
      paths: [
        {
          path_id: "practice",
          display_name: "Practice",
          file_name: "practice.json",
          path,
        },
      ],
    }),
    activePathId: "practice",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  tourStore.getState().exit();
  projectStore.setState({ project: null, activePathId: null });
});

describe("foundational lesson content", () => {
  it("uses the requested five foundational lessons in order", () => {
    expect(foundationalTours.map((tour) => tour.title)).toEqual([
      "Getting Started",
      "BLine Fundamentals",
      "Path Tuning",
      "Rotation targets",
      "Event triggers",
    ]);
    for (const tour of foundationalTours) {
      expect(tour.durationMinutes).toBeGreaterThan(0);
      for (const step of tour.steps) {
        if (step.check) expect(step.task).toBeTruthy();
        expect(step.experiment).toBeUndefined();
        expect(step.demo).toBeUndefined();
        expect(step.handoff).toBeUndefined();
        expect(step.captureReference).toBeUndefined();
      }
    }
  });

  it("briefly opens the overview panels and menus without editing their contents", () => {
    const overview = foundationalTours[0];
    expect(overview.practicePaths?.()).toHaveLength(9);
    expect(
      overview.practiceGroups?.().map((group) => group.display_name),
    ).toEqual(["Testing", "Top Side Auto", "Bottom Side Auto"]);
    expect(overview.practiceLinkedTargets?.()).toHaveLength(7);
    expect(overview.steps.map((step) => step.title)).toEqual([
      "Canvas",
      "Toolbar",
      "Sidebar",
      "Elements",
      "Constraints",
      "Play bar",
      "File menu",
      "Edit actions",
      "Edit menu",
      "Path dropdown",
      "Path Groups",
    ]);
    for (const step of overview.steps.filter((candidate) => candidate.check)) {
      expect(step.interact).toHaveLength(1);
    }
  });

  it("introduces all element types in the demo and then starts from an empty build", () => {
    const demo = createFundamentalsDemoPath();
    expect(demo.path_elements.filter(isWaypoint)).toHaveLength(2);
    expect(demo.path_elements.filter(isTranslationTarget)).toHaveLength(2);
    expect(demo.path_elements.filter(isRotationTarget)).toHaveLength(1);
    expect(
      demo.path_elements.filter((element) => element.type === "event_trigger"),
    ).toHaveLength(1);
    const fundamentals = foundationalTours[1];
    const placement = fundamentals.steps.find(
      (step) => step.title === "Place Start and End",
    )!;
    expect(placement.prepare?.practicePath?.().path_elements).toHaveLength(0);
    const explore = fundamentals.steps.find(
      (step) => step.title === "Try more route points",
    )!;
    expect(explore.elements).toBeUndefined();
    expect(explore.check).toBeUndefined();
    expect(explore.lockInteractionOnComplete).toBeUndefined();
    expect(explore.interact).toEqual(
      expect.arrayContaining([
        "tool-waypoint",
        "tool-translation",
        "simulation-transport",
        "path-canvas",
      ]),
    );
  });

  it("keeps the handoff sequence on the existing canvas and changes only acceleration for the wider turn", () => {
    const steps = foundationalTours[2].steps;
    expect(steps.slice(0, 4).map((step) => step.canvasLesson)).toEqual([
      "handoff-approach",
      "handoff-crossing",
      "handoff-departure",
      "low-acceleration",
    ]);
    expect(
      steps
        .slice(0, 4)
        .every(
          (step) => step.target === "path-canvas" && step.prepare?.autoPlay,
        ),
    ).toBe(true);
    const regular = createHandoffLessonPath();
    const low = createLowAccelerationPath();
    expect(low.path_elements).toEqual(regular.path_elements);
    expect(low.ranged_constraints).toEqual(regular.ranged_constraints);
    expect(low.constraints.max_acceleration_meters_per_sec2).toBeLessThan(
      regular.constraints.max_acceleration_meters_per_sec2!,
    );
  });

  it("begins rectangle tuning ungenerated, with fixed geometry and selectable Auto slots", () => {
    const path = createTuningRectanglePath();
    const points = path.path_elements.map((element) =>
      isWaypoint(element) ? element.translation_target : element,
    );
    expect(points).toMatchObject([
      { x_meters: 6, y_meters: 7.6 },
      { x_meters: 12.3, y_meters: 7.6 },
      { x_meters: 12.3, y_meters: 4.5 },
      { x_meters: 12.3, y_meters: 1.4 },
      { x_meters: 6, y_meters: 1.4 },
    ]);
    expect(tuningObstacle.maxY - tuningObstacle.minY).toBeGreaterThan(
      tuningObstacle.maxX - tuningObstacle.minX,
    );
    expect(
      tuningMarkers.find((marker) => marker.label === "Intermediate"),
    ).toMatchObject({ xMeters: 12.3, yMeters: 4.5 });
    expect(path.ranged_constraints).toHaveLength(5);
    expect(
      path.ranged_constraints.every(
        (constraint) =>
          constraint.source === "auto_velocity" &&
          !constraint.auto_velocity?.input_signature,
      ),
    ).toBe(true);
    expect(
      path.path_elements
        .filter(isTranslationTarget)
        .every(
          (target) =>
            target.handoff_radius_source === "auto" &&
            target.intermediate_handoff_radius_meters === null,
        ),
    ).toBe(true);
    expect(autoVelocityStatusForPath(path, practiceConfig()).stale).toBe(true);
    const steps = foundationalTours[2].steps;
    const rectangleIndex = steps.findIndex(
      (step) => step.title === "A new route to tune",
    );
    expect(
      steps
        .slice(rectangleIndex)
        .every((step) => step.lockGeometry && step.autoGenerate === false),
    ).toBe(true);
    expect(steps.at(-1)?.check).toBeUndefined();
    expect(steps.at(-1)?.interact).toContain("simulation-transport");
  });

  it("preserves a learner's manual velocity when regenerating the rectangle", () => {
    const config = practiceConfig();
    const path = createTuningRectanglePath();
    const manual = path.ranged_constraints[3];
    manual.source = "manual";
    manual.value = 1.1;
    const generated = refreshAutoVelocityConstraints(path, config, {
      whenPresentOnly: false,
    });
    expect(generated.ranged_constraints).toContainEqual(
      expect.objectContaining({
        key: manual.key,
        start_ordinal: 4,
        end_ordinal: 4,
        value: 1.1,
      }),
    );
    expect(
      generated.ranged_constraints.find(
        (constraint) => constraint.start_ordinal === 4,
      )?.source,
    ).not.toBe("auto_velocity");
    expect(
      generated.ranged_constraints.some(
        (constraint) =>
          constraint.source === "auto_velocity" &&
          constraint.auto_velocity?.input_signature,
      ),
    ).toBe(true);
  });

  it("uses manual 2 m/s for rotation exploration and a truly infeasible fast middle rotation", () => {
    const regular = createRotationLessonPath();
    expect(regular.constraints.max_velocity_meters_per_sec).toBe(2);
    expect(regular.ranged_constraints).toMatchObject([
      { source: "manual", value: 2 },
    ]);
    const fast = createFastRotationPath();
    expect(
      fast.path_elements.map((element) =>
        isWaypoint(element)
          ? element.rotation_target.rotation_radians
          : isRotationTarget(element)
            ? element.rotation_radians
            : null,
      ),
    ).toEqual([0, Math.PI, 0]);
    const trace = simulatePathWithTrace(fast, practiceConfig()).trace;
    expect(
      evaluateRotationFeasibility(fast, practiceConfig(), trace),
    ).toContainEqual(
      expect.objectContaining({
        elementIndex: 1,
        passed: false,
        reason: "insufficient-time",
      }),
    );
    const profile = foundationalTours[3].steps.find(
      (step) => step.title === "Try Profiled Rotation",
    )!;
    expect(profile.body).toContain("target heading changes gradually");
    expect(profile.body).toContain("Turn it off");
  });

  it("requires the new event key and ratio on the second segment", () => {
    const path = createEventLessonPath();
    const step = foundationalTours[4].steps.find(
      (candidate) => candidate.title === "Add an event on the next segment",
    )!;
    loadPractice(path);
    expect(step.check?.().complete).toBe(false);
    path.path_elements.splice(
      1,
      0,
      createEventTrigger({ lib_key: "stopIntake", t_ratio: 0.6 }),
    );
    loadPractice(path);
    expect(step.check?.().complete).toBe(false);
    path.path_elements.splice(1, 1);
    path.path_elements.splice(
      3,
      0,
      createEventTrigger({ lib_key: "stopIntake", t_ratio: 0.6 }),
    );
    // Project creation copies the path so write the changed exercise into the store.
    loadPractice(path);
    expect(step.check?.().complete).toBe(true);
    const original = path.path_elements[1];
    path.path_elements.splice(1, 1);
    loadPractice(path);
    expect(step.check?.().complete).toBe(false);
    path.path_elements.splice(1, 0, original);
    const added = path.path_elements[3];
    if (added.type === "event_trigger") added.t_ratio = 0.3;
    loadPractice(path);
    expect(step.check?.().complete).toBe(false);
  });

  it("unlocks demo Continue after Play without requiring the learner to finish the run", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    const tour = foundationalTours[1];
    tourStore.getState().start(tour.id);
    loadPractice(tour.practicePath());
    captureTourStepState();
    expect(tour.steps[0].check?.().complete).toBe(false);
    tourStore.getState().recordAction("play");
    expect(tour.steps[0].check?.().complete).toBe(true);
    expect(tourStore.getState().actions.finishRun).toBeUndefined();
    expect(tour.steps[0].lockInteractionOnComplete).toBeUndefined();
  });

  it("ignores generated values when comparing authored intent", () => {
    const before = createRotationLessonPath();
    const generated = structuredClone(before);
    generated.ranged_constraints.push({
      key: "max_velocity_meters_per_sec",
      value: 1.2,
      start_ordinal: 1,
      end_ordinal: 2,
      source: "auto_velocity",
    });
    expect(tourPathIntent(generated)).toBe(tourPathIntent(before));
    generated.ranged_constraints.at(-1)!.source = "manual";
    expect(tourPathIntent(generated)).not.toBe(tourPathIntent(before));
  });
});

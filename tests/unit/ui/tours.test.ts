import { afterEach, describe, expect, it, vi } from "vitest";
import { followsProgress } from "../../../src/ui/tours/tourShowMe";
import {
  captureTourStepState,
  findTour,
  tourPathIntent,
  tourSections,
  tours,
} from "../../../src/ui/tours/tours";
import { assessTourStep } from "../../../src/ui/tours/tourInteraction";
import { plainLessonText } from "../../../src/ui/tours/lessonKeyChips";
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
  createPathModel,
  isEventTrigger,
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
import {
  eventTriggerSettingsTour,
  robotSettingsTour,
} from "../../../src/ui/tours/robotSettingsLesson";

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
  it("groups lessons into Core, Settings, and Advanced in recommended order", () => {
    expect(
      tourSections.map((section) => [
        section.title,
        section.lessons.map((tour) => tour.title),
      ]),
    ).toEqual([
      [
        "Core",
        [
          "Getting Started",
          "BLine Fundamentals",
          "Event triggers",
          "Importing and Exporting",
        ],
      ],
      [
        "Settings",
        ["Robot", "Path Defaults", "Field", "Generator", "Lib Keys"],
      ],
      [
        "Advanced",
        [
          "Path Tuning",
          "Rotation targets",
          "Path Management",
          "How to use BLine offline",
          "Current-pose Starts",
          "Handoff Modes",
          "Linked Elements",
          "Path Linking",
        ],
      ],
    ]);
    expect(new Set(tours.map((tour) => tour.id)).size).toBe(tours.length);
  });

  it("keeps lesson copy short, task-led, and recapped", () => {
    for (const tour of tours) {
      expect(tour.durationMinutes).toBeGreaterThan(0);
      expect(tour.recap.length, tour.id).toBeGreaterThanOrEqual(2);
      expect(tour.recap.length, tour.id).toBeLessThanOrEqual(3);
      for (const step of tour.steps) {
        const words = plainLessonText(step.body ?? "").split(/\s+/).length;
        expect(words, `${tour.id}: ${step.title}`).toBeLessThanOrEqual(35);
        if (step.check || step.checks)
          expect(step.task, `${tour.id}: ${step.title}`).toBeTruthy();
        expect(step.body ?? "").not.toMatch(/Open File → Settings/);
        // A card reads at a glance: a task card stays under about 25 words,
        // a read-only card under 30, and its body never repeats the task.
        const visible = [
          step.task ?? "",
          step.body ?? "",
          ...(step.checks ?? []).map((check) => check.label),
        ]
          .map(plainLessonText)
          .join(" ")
          .trim();
        expect(
          visible.split(/\s+/).length,
          `${tour.id}: ${step.title}`,
        ).toBeLessThanOrEqual(step.task ? 25 : 30);
        if (step.task && step.body)
          expect(
            plainLessonText(step.body),
            `${tour.id}: ${step.title}`,
          ).not.toContain(plainLessonText(step.task));
        // Every task's Show me points at the next action, not a whole area.
        if (step.task)
          expect(followsProgress(step), `${tour.id}: ${step.title}`).toBe(true);
      }
    }
  });

  it("uses the editor’s own words, never bare jargon", () => {
    // The UI says Rotation, so lessons never say heading. Segment, chip, and
    // cell-beside phrasing named things a new learner can’t find.
    const banned = /\b(headings?|segments?|chips?|cell beside)\b/i;
    for (const tour of tours) {
      for (const text of [tour.title, tour.summary, ...tour.recap])
        expect(plainLessonText(text), tour.id).not.toMatch(banned);
      for (const step of tour.steps) {
        const copy = [
          step.title,
          step.task ?? "",
          step.body ?? "",
          step.why ?? "",
          ...(step.checks ?? []).map((check) => check.label),
        ].map(plainLessonText);
        for (const text of copy)
          expect(text, `${tour.id}: ${step.title}`).not.toMatch(banned);
      }
    }
  });

  it("briefly opens the overview panels and menus without editing their contents", () => {
    const overview = findTour("getting-started")!;
    expect(overview.practicePaths?.()).toHaveLength(9);
    expect(
      overview.practiceGroups?.().map((group) => group.display_name),
    ).toEqual(["Testing", "Top Side Auto", "Bottom Side Auto"]);
    expect(overview.practiceLinkedTargets?.()).toHaveLength(7);
    expect(overview.steps.map((step) => step.title)).toEqual([
      "The editor at a glance",
      "Sidebar",
      "Menus",
      "Path dropdown",
      "Path Groups",
    ]);
    expect(
      overview.steps.find((step) => step.title === "Sidebar")?.checks,
    ).toHaveLength(3);
  });

  it("introduces all element types in the demo and then starts from an empty build", () => {
    const demo = createFundamentalsDemoPath();
    expect(demo.path_elements.filter(isWaypoint)).toHaveLength(2);
    expect(demo.path_elements.filter(isTranslationTarget)).toHaveLength(2);
    expect(demo.path_elements.filter(isRotationTarget)).toHaveLength(1);
    expect(
      demo.path_elements.filter((element) => element.type === "event_trigger"),
    ).toHaveLength(1);
    const fundamentals = findTour("bline-fundamentals")!;
    const placement = fundamentals.steps.find(
      (step) => step.title === "Place Start and End",
    )!;
    expect(placement.prepare?.practicePath?.().path_elements).toHaveLength(0);
    loadPractice(createPathModel());
    // Nothing placed yet is not a mistake, so there is no hint.
    expect(assessTourStep(placement).items?.[0]).toMatchObject({
      complete: false,
      hint: "",
    });
    const explore = fundamentals.steps.find(
      (step) => step.title === "Try more route points",
    )!;
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
    const steps = findTour("path-tuning")!.steps;
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
    const steps = findTour("path-tuning")!.steps;
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
    const profile = findTour("rotation-targets")!.steps.find(
      (step) => step.title === "Try Profiled Rotation",
    )!;
    expect(profile.body).toContain("the turn spreads along the path");
    expect(profile.checks?.map((check) => check.label)).toEqual([
      "Profiled Rotation off",
      "Played the path",
    ]);
  });

  it("requires the new event key and ratio on the second segment", () => {
    const path = createEventLessonPath();
    const step = findTour("event-triggers")!.steps.find(
      (candidate) => candidate.title === "Add an event on the next stretch",
    )!;
    loadPractice(path);
    expect(assessTourStep(step).items?.map((item) => item.complete)).toEqual([
      false,
      false,
      false,
    ]);
    // stopIntake on the first segment does not count.
    path.path_elements.splice(
      1,
      0,
      createEventTrigger({ lib_key: "stopIntake", t_ratio: 0.6 }),
    );
    loadPractice(path);
    expect(assessTourStep(step).complete).toBe(false);
    path.path_elements.splice(1, 1);
    path.path_elements.splice(
      3,
      0,
      createEventTrigger({ lib_key: "", t_ratio: 0.42 }),
    );
    // Project creation copies the path so write the changed exercise into the store.
    loadPractice(path);
    // Unmet requirements stay quiet until something is close but wrong.
    expect(assessTourStep(step).items).toEqual([
      { label: "Place an event there", complete: true, hint: "" },
      { label: "Lib Key `stopIntake`", complete: false, hint: "" },
      { label: "Event Pos 0.6", complete: false, hint: "" },
    ]);
    const placed = path.path_elements[3];
    if (placed.type === "event_trigger") {
      placed.t_ratio = 0.55;
      placed.lib_key = "startIntake";
    }
    loadPractice(path);
    expect(assessTourStep(step).items?.map((item) => item.hint)).toEqual([
      "",
      "This one says “startIntake”. Click `stopIntake` to fix it.",
      "Close: it’s 0.55. Type exactly 0.6.",
    ]);
    const added = path.path_elements[3];
    if (added.type === "event_trigger") {
      added.t_ratio = 0.6;
      added.lib_key = "stopIntake";
    }
    loadPractice(path);
    expect(assessTourStep(step).complete).toBe(true);
  });

  it("registers the keys its lessons ask for", () => {
    expect(findTour("event-triggers")?.eventKeys).toEqual([
      "startIntake",
      "stopIntake",
    ]);
    expect(robotSettingsTour.eventKeys).toEqual(["startIntake", "stopIntake"]);
  });

  it("keeps lesson keys exact but explains a capitalization miss", () => {
    const path = createEventLessonPath();
    const step = findTour("event-triggers")!.steps.find(
      (candidate) => candidate.title === "Add an event on the next stretch",
    )!;
    path.path_elements.splice(
      3,
      0,
      createEventTrigger({ lib_key: "stopintake", t_ratio: 0.6 }),
    );
    loadPractice(path);
    expect(assessTourStep(step)).toMatchObject({
      complete: false,
      message:
        'Keys are case-sensitive — you typed "stopintake"; use "stopIntake".',
    });
    const typed = path.path_elements[3];
    if (typed.type === "event_trigger") typed.lib_key = "stopIntake";
    loadPractice(path);
    expect(assessTourStep(step).complete).toBe(true);
  });

  it("explains capitalization misses in the Robot lesson's key checks", () => {
    const steps = robotSettingsTour.steps;
    const connect = steps.find(
      (step) => step.title === "Connect the event keys",
    )!;
    const setExtend = steps.find(
      (step) => step.title === "Add the extend event",
    )!;
    const path = createEventLessonPath();
    const event = path.path_elements.find(isEventTrigger)!;
    event.lib_key = "StartIntake";
    loadPractice(path);
    const project = projectStore.getState().project!;
    project.config.gui.protrusions.show_on_event_keys = ["startintake"];
    project.config.gui.protrusions.hide_on_event_keys = ["stopIntake"];
    expect(assessTourStep(connect).message).toBe(
      'Keys are case-sensitive — you typed "startintake"; use "startIntake".',
    );
    project.config.gui.protrusions.show_on_event_keys = ["startIntake"];
    expect(assessTourStep(connect).complete).toBe(true);
    expect(assessTourStep(setExtend).message).toBe(
      'Keys are case-sensitive — you typed "StartIntake"; use "startIntake".',
    );
  });

  it("points a miscapitalized registration at Rename All", () => {
    const register = eventTriggerSettingsTour.steps.find(
      (step) => step.title === "Register a Lib Key",
    )!;
    loadPractice(createEventLessonPath());
    const config = projectStore.getState().project!.config;
    config.gui.event_trigger_keys = ["startIntake", "stopintake"];
    expect(assessTourStep(register)).toMatchObject({
      complete: false,
      message:
        'Keys are case-sensitive — you registered "stopintake". Open its ⋯ menu, choose Rename All, and change it to "stopIntake".',
    });
    config.gui.event_trigger_keys = ["startIntake", "stopIntake"];
    expect(assessTourStep(register).complete).toBe(true);
  });

  it("unlocks demo Continue after Play without requiring the learner to finish the run", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    const tour = findTour("bline-fundamentals")!;
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

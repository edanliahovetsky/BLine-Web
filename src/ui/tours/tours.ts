import {
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  type PathModel,
} from "../../core/model/path";
import {
  activePathForProjectStore,
  projectStore,
} from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import type { TourDefinition } from "./tourStore";

export const editorBasicsTourId = "editor-basics";

/** Scratch path a tour switches to so nothing it teaches touches real autos. */
export const tourPracticePathName = "Tour practice";

function waypoint(
  xMeters: number,
  yMeters: number,
  rotationRadians = 0,
): ReturnType<typeof createWaypoint> {
  return createWaypoint({
    translation_target: createTranslationTarget({
      x_meters: xMeters,
      y_meters: yMeters,
    }),
    rotation_target: createRotationTarget({
      rotation_radians: rotationRadians,
      t_ratio: 0,
    }),
  });
}

/** Lesson 1: the first half of a scoring run the learner finishes. */
export function createTourPracticePath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(2, 2, 0),
      createTranslationTarget({ x_meters: 4.8, y_meters: 2.6 }),
      waypoint(7.2, 4.7, Math.PI / 3),
    ],
  });
}

/** Lesson 2: a long lane the learner turns into a two-bend route. */
function createShapePracticePath(): PathModel {
  return createPathModel({
    path_elements: [waypoint(2, 1.8), waypoint(13.5, 6.1, Math.PI)],
  });
}

/**
 * Lesson 3: a two-corner scoring run, so generated caps have more than one
 * decision to explain.
 */
function createConstraintsPracticePath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(1.8, 2),
      createTranslationTarget({ x_meters: 5.4, y_meters: 2.1 }),
      waypoint(7, 4.6, Math.PI / 2),
      createTranslationTarget({ x_meters: 9.6, y_meters: 6.5 }),
      waypoint(13.4, 5.2, Math.PI),
    ],
  });
}

/**
 * Lesson 4: a complete three-stop auto with two turns, two headings, and two
 * mechanism events, so the timeline has a real sequence to inspect.
 */
function createSimulatePracticePath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(1.8, 1.7),
      createTranslationTarget({ x_meters: 4.2, y_meters: 2.2 }),
      createRotationTarget({
        rotation_radians: Math.PI / 3,
        t_ratio: 0.45,
      }),
      createEventTrigger({ t_ratio: 0.62, lib_key: "startIntake" }),
      waypoint(7, 4.8, Math.PI / 2),
      createTranslationTarget({ x_meters: 10.2, y_meters: 6.2 }),
      createRotationTarget({ rotation_radians: Math.PI, t_ratio: 0.45 }),
      createEventTrigger({ t_ratio: 0.7, lib_key: "scorePiece" }),
      waypoint(13.4, 4.4, Math.PI),
    ],
  });
}

/**
 * Element counts are captured when a step starts so placement steps can tell
 * that the user actually added something.
 */
let elementCountAtStepStart = 0;
let pathAtStepStart = "";
let simulationSeekCountAtStepStart = 0;
let lastPlacedElementIndex: number | null = null;

export function captureTourStepState(): void {
  const path = activePathForProjectStore(projectStore.getState())?.path ?? null;
  elementCountAtStepStart = path?.path_elements.length ?? 0;
  pathAtStepStart = path ? JSON.stringify(path.path_elements) : "";
  simulationSeekCountAtStepStart = readSimulationSeekCount();
}

function elementWasAdded(): boolean {
  const path = activePathForProjectStore(projectStore.getState())?.path;
  if (!path || path.path_elements.length <= elementCountAtStepStart) {
    return false;
  }
  lastPlacedElementIndex = selectionStore.getState().selectedElementIndex;
  return true;
}

function pathGeometryChanged(): boolean {
  const path = activePathForProjectStore(projectStore.getState())?.path ?? null;
  return (
    path !== null && JSON.stringify(path.path_elements) !== pathAtStepStart
  );
}

function simulationIsPlaying(): boolean {
  return document.querySelector('[aria-label="Pause simulation"]') !== null;
}

function readSimulationSeekCount(): number {
  const value = document
    .querySelector('[data-tour="simulation-transport"]')
    ?.getAttribute("data-tour-seek-count");
  return Number(value ?? 0);
}

function simulationWasScrubbed(): boolean {
  return readSimulationSeekCount() > simulationSeekCountAtStepStart;
}

function constraintsTabIsOpen(): boolean {
  return (
    document.querySelector(
      '[data-tour="inspector-constraints"][aria-selected="true"]',
    ) !== null
  );
}

function pathHealthIsOpen(): boolean {
  return (
    document.querySelector('[role="dialog"][aria-label="Path health"]') !== null
  );
}

function velocityPlanGenerated(): boolean {
  return (
    document.querySelector(
      '[data-tour="max-velocity-card"] .auto-velocity-status--current',
    ) !== null
  );
}

function lastPlacedTranslationSelected(): boolean {
  const path = activePathForProjectStore(projectStore.getState())?.path;
  const index = selectionStore.getState().selectedElementIndex;
  return (
    path !== undefined &&
    index !== null &&
    index === lastPlacedElementIndex &&
    path.path_elements[index]?.type === "translation"
  );
}

function eventElementSelected(): boolean {
  const path = activePathForProjectStore(projectStore.getState())?.path;
  const index = selectionStore.getState().selectedElementIndex;
  return (
    path !== undefined &&
    index !== null &&
    path.path_elements[index]?.type === "event_trigger"
  );
}

function velocitySegmentSelected(): boolean {
  return (
    selectionStore.getState().selectedRangedConstraint?.key ===
    "max_velocity_meters_per_sec"
  );
}

function selectedVelocityCapIsManual(): boolean {
  const path = activePathForProjectStore(projectStore.getState())?.path;
  const selection = selectionStore.getState().selectedRangedConstraint;
  if (!path || selection?.key !== "max_velocity_meters_per_sec") {
    return false;
  }

  return path.ranged_constraints[selection.index]?.source !== "auto_velocity";
}

export const editorBasicsTour: TourDefinition = {
  id: editorBasicsTourId,
  title: "Quick Start",
  summary: "Build, refine, and replay a scoring route",
  durationMinutes: 4,
  completionMessage:
    "You built a scoring route, checked its timing, and prepared it for motion.",
  practicePath: createTourPracticePath,
  steps: [
    {
      target: "path-breadcrumb",
      title: "Your training field",
      body: `This is “${tourPracticePathName},” a safe copy for learning. Your real project returns when you finish or exit.`,
      placement: "below",
    },
    {
      target: "tool-waypoint",
      title: "Finish the scoring run",
      body: "The robot already leaves its start and crosses one lane. Select Waypoint, then place the final scoring pose in open space.",
      task: "Place the final waypoint",
      keys: ["1"],
      placement: "right",
      interact: ["tool-waypoint", "path-canvas"],
      completeWhen: elementWasAdded,
    },
    {
      target: "path-canvas",
      title: "Tune the final pose",
      body: "Drag the selected waypoint until the approach looks clean. Arrow keys make small adjustments. Keep refining after the task is done.",
      task: "Move the final waypoint",
      keys: ["←", "↑", "↓", "→", "Shift"],
      placement: "right",
      interact: ["path-canvas"],
      prepare: { tool: "select" },
      completeWhen: pathGeometryChanged,
      advance: "manual",
    },
    {
      target: "simulation-transport",
      title: "Replay your edit",
      body: "The robot is parked at the new endpoint. Drag the timeline back through the turn, then scrub anywhere you want to inspect.",
      task: "Drag the simulation timeline",
      keys: ["J", "K", "L"],
      placement: "above",
      interact: ["simulation-transport"],
      prepare: { simulation: "end" },
      completeWhen: simulationWasScrubbed,
      advance: "manual",
    },
    {
      target: "inspector-constraints",
      title: "Open Constraints",
      body: "The route now has a shape. Constraints decide how hard the robot may drive through it.",
      task: "Select the Constraints tab",
      placement: "left",
      interact: ["inspector-constraints"],
      prepare: { inspector: "open", inspectorTab: "elements" },
      completeWhen: constraintsTabIsOpen,
    },
    {
      target: "max-velocity-card",
      title: "Generate velocity caps",
      body: "Select Generate. BLine will propose lower speed caps where this route asks the robot to turn harder.",
      task: "Generate velocity caps",
      placement: "left",
      interact: ["max-velocity-card"],
      prepare: { inspector: "open", inspectorTab: "constraints" },
      completeWhen: velocityPlanGenerated,
    },
    {
      target: "transport-play",
      title: "Run the simulation",
      body: "Select Play. Watch the full run once before you trust the timing.",
      task: "Play the simulation",
      keys: ["Space", "J", "K", "L"],
      placement: "above",
      interact: ["simulation-transport"],
      completeWhen: simulationIsPlaying,
    },
  ],
};

export const shapePathsTour: TourDefinition = {
  id: "shape-paths",
  title: "Shape a Path",
  summary: "Build and tune a two-bend pickup lane",
  durationMinutes: 7,
  completionMessage:
    "You built a two-bend route and used the robot trace to refine it.",
  practicePath: createShapePracticePath,
  steps: [
    {
      title: "Build a pickup lane",
      body: "The start and finish are set. Your job is to shape a two-bend lane around traffic, then replay it like a robot programmer reviewing an auto.",
    },
    {
      target: "tool-translation",
      title: "Place the first bend",
      body: "Translation targets shape the route without adding another stop. Select Translation and place one away from the straight line.",
      task: "Add the first translation target",
      keys: ["2"],
      placement: "right",
      interact: ["tool-translation", "path-canvas"],
      prepare: { selectElement: 0 },
      completeWhen: elementWasAdded,
    },
    {
      target: "path-canvas",
      title: "Shape the first bend",
      body: "Drag the selected target. Try a broad bend, then a tighter one, and watch how much route each move changes.",
      task: "Move the first bend",
      keys: ["←", "↑", "↓", "→", "Shift"],
      placement: "right",
      interact: ["path-canvas", "inspector-panel"],
      prepare: { tool: "select" },
      completeWhen: pathGeometryChanged,
      advance: "manual",
    },
    {
      target: "simulation-transport",
      title: "Drive through the bend",
      body: "The robot is at the endpoint. Drag the timeline back and forth to see where it commits to your new line.",
      task: "Scrub through the first bend",
      placement: "above",
      interact: ["simulation-transport"],
      prepare: { simulation: "end" },
      completeWhen: simulationWasScrubbed,
      advance: "manual",
    },
    {
      target: "tool-translation",
      title: "Add a second bend",
      body: "Real autos rarely get one clean lane. Add another Translation target in the second half to make an S route.",
      task: "Add a second translation target",
      keys: ["2"],
      placement: "right",
      interact: ["tool-translation", "path-canvas"],
      prepare: { selectElement: 1 },
      completeWhen: elementWasAdded,
    },
    {
      target: "inspector-panel",
      title: "Find the new bend",
      body: "The Elements tab is the route in order. Select the Translation row you just added before you tune it.",
      task: "Select the newest translation target",
      placement: "left",
      interact: ["inspector-panel"],
      prepare: {
        inspector: "open",
        inspectorTab: "elements",
        tool: "select",
        clearSelection: true,
      },
      completeWhen: lastPlacedTranslationSelected,
    },
    {
      target: "path-canvas",
      title: "Balance the S route",
      body: "Drag the selected bend until both turns feel deliberate. You can keep moving it after Done appears.",
      task: "Move the second bend",
      placement: "right",
      interact: ["path-canvas", "inspector-panel"],
      prepare: { tool: "select" },
      completeWhen: pathGeometryChanged,
      advance: "manual",
    },
    {
      target: "simulation-transport",
      title: "Compare the whole route",
      body: "BLine moved the robot to the new endpoint after your edit. Scrub across both bends and compare where each handoff begins.",
      task: "Scrub across both bends",
      placement: "above",
      interact: ["simulation-transport"],
      prepare: { simulation: "end" },
      completeWhen: simulationWasScrubbed,
      advance: "manual",
    },
    {
      target: "path-canvas",
      title: "Leave room for the robot",
      body: "Dashed circles show when BLine begins steering toward the next element. Favor a few clear targets and leave real clearance for bumpers, defenders, and error.",
      placement: "right",
    },
  ],
};

export const constraintsTour: TourDefinition = {
  id: "constrain-optimize",
  title: "Set Speed",
  summary: "Protect a fast two-corner auto",
  durationMinutes: 6,
  completionMessage:
    "You protected a generated cap and checked where the robot needs it.",
  practicePath: createConstraintsPracticePath,
  steps: [
    {
      title: "Fast is not one number",
      body: "This scoring run has two different corners. A useful speed plan stays quick on open ground and gives the robot room where direction changes.",
    },
    {
      target: "inspector-constraints",
      title: "Open Constraints",
      body: "Select Constraints to view the motion limits for this path.",
      task: "Select the Constraints tab",
      placement: "left",
      interact: ["inspector-constraints"],
      prepare: { inspector: "open", inspectorTab: "elements" },
      completeWhen: constraintsTabIsOpen,
    },
    {
      target: "max-velocity-card",
      title: "Read the segment bar",
      body: "Each section maps to part of the route. Open sections use the global maximum. Capped sections carry their own limit.",
      placement: "left",
      prepare: { inspector: "open", inspectorTab: "constraints" },
    },
    {
      target: "max-velocity-card",
      title: "Generate velocity caps",
      body: "Select Generate. Compare the caps BLine proposes for the two corners instead of treating the whole auto the same.",
      task: "Generate velocity caps",
      placement: "left",
      interact: ["max-velocity-card"],
      completeWhen: velocityPlanGenerated,
    },
    {
      target: "max-velocity-card",
      title: "Select a velocity cap",
      body: "Select a generated section in the bar to open its controls.",
      task: "Select one generated cap",
      placement: "left",
      interact: ["max-velocity-card"],
      completeWhen: velocitySegmentSelected,
    },
    {
      target: "max-velocity-card",
      title: "Set the cap to Manual",
      body: "Select Manual to protect this decision from the next generation pass. You can also try a lower value before continuing.",
      task: "Protect the selected cap as Manual",
      placement: "left",
      interact: ["max-velocity-card"],
      completeWhen: selectedVelocityCapIsManual,
      advance: "manual",
    },
    {
      target: "simulation-transport",
      title: "Find the slow corner",
      body: "The robot is at the endpoint. Scrub backward and connect the lower speed section to the turn it protects.",
      task: "Scrub through a constrained corner",
      placement: "above",
      interact: ["simulation-transport"],
      prepare: { simulation: "end" },
      completeWhen: simulationWasScrubbed,
      advance: "manual",
    },
  ],
};

export const simulateTour: TourDefinition = {
  id: "simulate-verify",
  title: "Check a Run",
  summary: "Review a full auto before robot testing",
  durationMinutes: 6,
  completionMessage:
    "You traced a full auto, checked its events, and prepared a safer robot test.",
  practicePath: createSimulatePracticePath,
  steps: [
    {
      title: "Read the whole auto",
      body: "This route has three stops, two heading changes, and mechanism events for intake and scoring. Treat the timeline like a quick preflight review.",
    },
    {
      target: "transport-play",
      title: "Run the simulation",
      body: "Select Play and watch the robot's position and heading through the full sequence.",
      task: "Play the simulation",
      keys: ["Space", "J", "K", "L"],
      placement: "above",
      interact: ["simulation-transport"],
      completeWhen: simulationIsPlaying,
    },
    {
      target: "simulation-transport",
      title: "Scrub with intent",
      body: "The robot is now at the finish. Drag back through the run and pause near a heading change or event marker.",
      task: "Drag the simulation timeline",
      placement: "above",
      interact: ["simulation-transport"],
      prepare: { simulation: "end" },
      completeWhen: simulationWasScrubbed,
      advance: "manual",
    },
    {
      target: "inspector-panel",
      title: "Inspect an event",
      body: "Open the Elements list and select either Event Trigger. Confirm that mechanism actions live at a specific point in the route.",
      task: "Select an event trigger",
      placement: "left",
      interact: ["inspector-panel"],
      prepare: {
        inspector: "open",
        inspectorTab: "elements",
        clearSelection: true,
      },
      completeWhen: eventElementSelected,
    },
    {
      title: "Know the limits",
      body: "This preview does not model wheel slip, battery sag, controller tuning, contact, or a defender. It checks route structure, timing, and intent.",
    },
    {
      title: "Plan the first robot run",
      body: "Start with clear space and an easy stop. Watch one risky corner, change one thing, then run again. Good autos are tuned from evidence.",
    },
    {
      target: "path-health",
      title: "Run the preflight check",
      body: "Path Health catches structural problems such as missing elements, off-field positions, and empty event keys before the robot sees the file.",
      task: "Open Path Health",
      placement: "below",
      interact: ["path-health"],
      completeWhen: pathHealthIsOpen,
    },
  ],
};

export const tours: readonly TourDefinition[] = [
  editorBasicsTour,
  shapePathsTour,
  constraintsTour,
  simulateTour,
];

export function findTour(tourId: string | null): TourDefinition | null {
  return tours.find((tour) => tour.id === tourId) ?? null;
}

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

/** Lesson 1: a plain two-waypoint run the learner extends and simulates. */
export function createTourPracticePath(): PathModel {
  return createPathModel({
    path_elements: [waypoint(3, 3), waypoint(6.5, 4.5)],
  });
}

/** Lesson 2: a straight line begging to be bent through the middle. */
function createShapePracticePath(): PathModel {
  return createPathModel({
    path_elements: [waypoint(2.5, 4), waypoint(9, 4)],
  });
}

/**
 * Lesson 3: a sharp right-angle corner, so the optimizer visibly proposes a
 * lower cap where the route turns.
 */
function createConstraintsPracticePath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(2.5, 2.5),
      createTranslationTarget({ x_meters: 8, y_meters: 2.5 }),
      waypoint(8, 6),
    ],
  });
}

/**
 * Lesson 4: a complete little auto with a corner, mid-segment rotation, and
 * an event, so the simulation has something worth watching.
 */
function createSimulatePracticePath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(2.5, 2.5),
      createTranslationTarget({ x_meters: 8, y_meters: 2.5 }),
      createRotationTarget({ rotation_radians: Math.PI / 2, t_ratio: 0.5 }),
      createEventTrigger({ t_ratio: 0.7, lib_key: "demoEvent" }),
      waypoint(8, 6, Math.PI / 2),
    ],
  });
}

/**
 * Element counts are captured when a step starts so placement steps can tell
 * that the user actually added something.
 */
let elementCountAtStepStart = 0;
let pathAtStepStart = "";

export function captureTourStepState(): void {
  const path = activePathForProjectStore(projectStore.getState())?.path ?? null;
  elementCountAtStepStart = path?.path_elements.length ?? 0;
  pathAtStepStart = path ? JSON.stringify(path.path_elements) : "";
}

function elementWasAdded(): boolean {
  const current =
    activePathForProjectStore(projectStore.getState())?.path.path_elements
      .length ?? 0;
  return current > elementCountAtStepStart;
}

function pathGeometryChanged(): boolean {
  const path = activePathForProjectStore(projectStore.getState())?.path ?? null;
  return path !== null && JSON.stringify(path.path_elements) !== pathAtStepStart;
}

function simulationIsPlaying(): boolean {
  return document.querySelector('[aria-label="Pause simulation"]') !== null;
}

function constraintsTabIsOpen(): boolean {
  return (
    document.querySelector(
      '[data-tour="inspector-constraints"][aria-selected="true"]',
    ) !== null
  );
}

function pathHealthIsOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-label="Path health"]') !== null;
}

function velocityPlanGenerated(): boolean {
  return (
    document.querySelector(
      '[data-tour="max-velocity-card"] .auto-velocity-status--current',
    ) !== null
  );
}

function intermediateElementSelected(): boolean {
  const path = activePathForProjectStore(projectStore.getState())?.path;
  const index = selectionStore.getState().selectedElementIndex;
  if (!path || index === null) {
    return false;
  }
  if (index <= 0 || index >= path.path_elements.length - 1) {
    return false;
  }
  return path.path_elements[index]?.type === "translation";
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
  summary: "Edit a path and run the simulation",
  durationMinutes: 3,
  completionMessage:
    "You edited the route, generated velocity caps, and ran the simulation.",
  practicePath: createTourPracticePath,
  steps: [
    {
      target: "path-breadcrumb",
      title: "Practice path",
      body: `This lesson uses “${tourPracticePathName}.” Your project will be restored when you finish or exit.`,
      placement: "below",
    },
    {
      target: "tool-waypoint",
      title: "Add a waypoint",
      body: "Select Waypoint, then click the field.",
      task: "Add one waypoint",
      keys: ["1"],
      placement: "right",
      interact: ["tool-waypoint", "path-canvas"],
      completeWhen: elementWasAdded,
    },
    {
      target: "path-canvas",
      title: "Move the waypoint",
      body: "Drag the new waypoint to change the route. Arrow keys move a selected element in small steps.",
      task: "Move one path element",
      keys: ["←", "↑", "↓", "→", "Shift"],
      placement: "right",
      interact: ["path-canvas"],
      prepare: { tool: "select" },
      completeWhen: pathGeometryChanged,
    },
    {
      target: "inspector-constraints",
      title: "Open Constraints",
      body: "Elements define the route. Constraints set limits on the robot's motion.",
      task: "Select the Constraints tab",
      placement: "left",
      interact: ["inspector-constraints"],
      prepare: { inspector: "open", inspectorTab: "elements" },
      completeWhen: constraintsTabIsOpen,
    },
    {
      target: "max-velocity-card",
      title: "Generate velocity caps",
      body: "Select Generate. BLine will add velocity caps based on the route.",
      task: "Generate velocity caps",
      placement: "left",
      interact: ["max-velocity-card"],
      prepare: { inspector: "open", inspectorTab: "constraints" },
      completeWhen: velocityPlanGenerated,
    },
    {
      target: "transport-play",
      title: "Run the simulation",
      body: "Select Play and watch the robot follow the path.",
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
  summary: "Add and adjust path elements",
  durationMinutes: 4,
  completionMessage: "You added, selected, and moved a path element.",
  practicePath: createShapePracticePath,
  steps: [
    {
      title: "Elements define the route",
      body: "BLine connects path elements with straight segments. Add intermediate elements only where the route needs to change direction.",
    },
    {
      target: "tool-rail",
      title: "Choose an element",
      body: "Waypoints store position and heading. Translation targets store position and shape the route between waypoints.",
      keys: ["1", "2"],
      placement: "right",
    },
    {
      target: "tool-translation",
      title: "Add a translation target",
      body: "Select Translation, then click above or below the line.",
      task: "Add one translation target",
      keys: ["2"],
      placement: "right",
      interact: ["tool-translation", "path-canvas"],
      prepare: { selectElement: 0 },
      completeWhen: elementWasAdded,
    },
    {
      target: "inspector-panel",
      title: "Find the new element",
      body: "The Elements tab lists the route from start to finish. Select the translation target you added.",
      task: "Select the translation target",
      placement: "left",
      interact: ["inspector-panel"],
      prepare: {
        inspector: "open",
        inspectorTab: "elements",
        tool: "select",
        clearSelection: true,
      },
      completeWhen: intermediateElementSelected,
    },
    {
      target: "path-canvas",
      title: "Move the element",
      body: "Drag the selected element and watch the route update.",
      task: "Move the translation target",
      placement: "right",
      interact: ["path-canvas", "inspector-panel"],
      prepare: { tool: "select" },
      completeWhen: pathGeometryChanged,
    },
    {
      target: "path-canvas",
      title: "Review the handoff",
      body: "The dashed circle is the handoff radius. It shows when BLine begins steering toward the next element. Use the fewest elements that describe the route clearly.",
      placement: "right",
    },
  ],
};

export const constraintsTour: TourDefinition = {
  id: "constrain-optimize",
  title: "Set Speed",
  summary: "Generate and edit velocity constraints",
  durationMinutes: 5,
  completionMessage: "You generated a velocity cap and set it to Manual.",
  practicePath: createConstraintsPracticePath,
  steps: [
    {
      title: "Constraints limit motion",
      body: "This practice path has a sharp corner. Velocity constraints control how quickly the robot approaches each part of the route.",
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
      body: "Each section represents part of the route. Open sections use the global maximum. Capped sections use the displayed velocity limit.",
      placement: "left",
      prepare: { inspector: "open", inspectorTab: "constraints" },
    },
    {
      target: "max-velocity-card",
      title: "Generate velocity caps",
      body: "Select Generate. Review the lower cap BLine adds near the corner.",
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
      body: "Select Manual. Manual caps remain unchanged when you generate constraints again.",
      task: "Change the selected cap to Manual",
      placement: "left",
      interact: ["max-velocity-card"],
      completeWhen: selectedVelocityCapIsManual,
    },
  ],
};

export const simulateTour: TourDefinition = {
  id: "simulate-verify",
  title: "Check a Run",
  summary: "Simulate and prepare for robot testing",
  durationMinutes: 4,
  completionMessage:
    "You checked the simulation and prepared for robot testing.",
  practicePath: createSimulatePracticePath,
  steps: [
    {
      title: "Review the sample path",
      body: "This path includes a corner, a rotation target, and an event trigger. The simulation shows when each part becomes active.",
    },
    {
      target: "transport-play",
      title: "Run the simulation",
      body: "Select Play and watch the robot move through the route.",
      task: "Play the simulation",
      keys: ["Space", "J", "K", "L"],
      placement: "above",
      interact: ["simulation-transport"],
      completeWhen: simulationIsPlaying,
    },
    {
      target: "simulation-transport",
      title: "Scrub the timeline",
      body: "Drag the timeline to inspect the route at a specific time. Rotation targets and event triggers appear as the simulation reaches them.",
      placement: "above",
      interact: ["simulation-transport"],
    },
    {
      target: "path-health",
      title: "Open Path Health",
      body: "Path Health checks for structural issues such as missing elements, off-field positions, and empty event keys.",
      task: "Open Path Health",
      placement: "below",
      interact: ["path-health"],
      completeWhen: pathHealthIsOpen,
    },
    {
      title: "Know the limits",
      body: "The simulation does not model wheel slip, battery voltage, controller tuning, or collisions. It checks the path structure and timing.",
    },
    {
      title: "Test on the robot",
      body: "Verify the path on the robot before competition. Change one setting at a time and use the result to refine the constraints.",
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

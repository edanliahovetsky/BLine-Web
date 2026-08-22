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
 * Lesson 4: a complete little auto — corner, mid-segment rotation, and an
 * event — so the simulation has something worth watching.
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

export function captureElementCount(): void {
  elementCountAtStepStart =
    activePathForProjectStore(projectStore.getState())?.path.path_elements
      .length ?? 0;
}

function elementWasAdded(): boolean {
  const current =
    activePathForProjectStore(projectStore.getState())?.path.path_elements
      .length ?? 0;
  return current > elementCountAtStepStart;
}

function simulationIsPlaying(): boolean {
  return document.querySelector('[aria-label="Pause simulation"]') !== null;
}

function constraintsTabIsOpen(): boolean {
  return (
    document.querySelector(
      '[data-testid="constraint-card-max_velocity_meters_per_sec"]',
    ) !== null
  );
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

export const editorBasicsTour: TourDefinition = {
  id: editorBasicsTourId,
  title: "Editor basics",
  summary: "Place, shape, constrain, and simulate a path",
  practicePath: createTourPracticePath,
  steps: [
    {
      target: "path-breadcrumb",
      title: "You are on a practice path",
      body: `Every edit applies to the path named here. The tour moved you to “${tourPracticePathName}”, so try anything — your real autos are untouched.`,
      placement: "below",
    },
    {
      target: "tool-waypoint",
      title: "Place a waypoint",
      body: "Click the highlighted Waypoint tool, then click anywhere on the field to drop one. Each tool has a number key.",
      keys: ["1"],
      placement: "right",
      interact: ["tool-waypoint", "path-canvas"],
      completeWhen: elementWasAdded,
    },
    {
      target: "path-canvas",
      title: "Shape the path",
      body: "You are back on the Select tool. Drag any element to move it — with one selected, arrow keys nudge it 5 cm, and Shift takes bigger steps.",
      keys: ["←", "↑", "↓", "→", "Shift"],
      placement: "right",
      interact: ["path-canvas"],
      prepare: { tool: "select" },
    },
    {
      target: "inspector-panel",
      title: "Every element, in order",
      body: "The inspector lists the path from start to finish. Select a row to type exact coordinates or duplicate it.",
      keys: ["⌘D", "[", "]"],
      placement: "left",
      interact: ["inspector-panel"],
      prepare: { inspector: "open" },
    },
    {
      target: "inspector-constraints",
      title: "Open the Constraints tab",
      body: "Click the highlighted Constraints tab. Geometry says where the robot drives; constraints say how fast.",
      placement: "left",
      interact: ["inspector-constraints"],
      prepare: { inspector: "open" },
      completeWhen: constraintsTabIsOpen,
    },
    {
      target: "max-velocity-card",
      title: "Generate a velocity plan",
      body: "Click Generate to let the optimizer propose max-velocity caps from the path's shape. The simulation drives with these caps, so generate before you play — and review what it proposes.",
      placement: "left",
      interact: ["max-velocity-card"],
      completeWhen: velocityPlanGenerated,
    },
    {
      target: "transport-play",
      title: "Watch the run",
      body: "Play the simulation to see the robot follow your path under those caps, then keep refining. That is the whole loop.",
      keys: ["Space", "J", "K", "L"],
      placement: "above",
      interact: ["simulation-transport"],
    },
  ],
};

export const shapePathsTour: TourDefinition = {
  id: "shape-paths",
  title: "Draw better paths",
  summary: "Path elements, segments, and handoffs — the polyline model",
  practicePath: createShapePracticePath,
  steps: [
    {
      title: "BLine drives point to point",
      body: "A path is an ordered list of path elements, and the robot drives point to point — from one element to the next in straight segments. Extra elements approximate a curve; there is no spline underneath.",
    },
    {
      target: "tool-rail",
      title: "Two kinds of path elements",
      body: "Waypoints carry a position and a heading; translation targets carry only a position. Use a waypoint where heading matters — usually the start and end — and translation targets to shape the route between.",
      keys: ["1", "2"],
      placement: "right",
    },
    {
      target: "tool-translation",
      title: "Bend the route",
      body: "This path is a straight line. Click the highlighted Translation tool (or press 2), then click above or below the line to bend the route through a new intermediate element.",
      keys: ["2"],
      placement: "right",
      interact: ["tool-translation", "path-canvas"],
      prepare: { selectElement: 0 },
      completeWhen: elementWasAdded,
    },
    {
      target: "inspector-panel",
      title: "Rotation targets control, event triggers trigger",
      body: "Between elements, a rotation target controls the robot's heading along the segment, and an event trigger starts robot behavior. Both are placed by t-ratio — 0 is the segment start, 1 is the end — and neither bends the route.",
      placement: "left",
      interact: ["inspector-panel"],
      prepare: { inspector: "open", tool: "select" },
    },
    {
      title: "Intermediate elements are pass-through, not stops",
      body: "Each intermediate element has a handoff radius — a circle around it. The moment the robot enters that circle, BLine steers for the next element, so the route flows through instead of stopping.",
    },
    {
      target: "path-canvas",
      title: "Select your new element",
      body: "Click the translation target you just added and note its dashed circle — that is its handoff radius. Its properties, including Handoff Radius, appear in the inspector.",
      placement: "right",
      interact: ["path-canvas", "inspector-panel"],
      prepare: { tool: "select" },
      completeWhen: intermediateElementSelected,
    },
    {
      title: "Bigger circle, earlier turn",
      body: "The radius is a speed–precision trade-off. A larger handoff radius starts the turn earlier, so the robot can carry a higher max velocity through a sharp corner. A smaller radius visits the point precisely — but demands a lower cap into it.",
    },
    {
      title: "Fewer elements, better paths",
      body: "Every added intermediate element creates another handoff and another place where the speed plan needs review. Use the fewest elements that describe the route clearly.",
    },
  ],
};

export const constraintsTour: TourDefinition = {
  id: "constrain-optimize",
  title: "Constrain and optimize",
  summary: "Velocity caps, the optimizer, and who owns the plan",
  practicePath: createConstraintsPracticePath,
  steps: [
    {
      title: "Geometry says where. Constraints say how fast.",
      body: "A polyline has no time schedule. Max translation velocity is the control you will use most: it caps how aggressively BLine approaches corners, clearances, and the final pose. This practice path has a sharp corner on purpose.",
    },
    {
      target: "inspector-constraints",
      title: "Open the Constraints tab",
      body: "Click Constraints to see the velocity cards for this path.",
      placement: "left",
      interact: ["inspector-constraints"],
      prepare: { inspector: "open" },
      completeWhen: constraintsTabIsOpen,
    },
    {
      target: "max-velocity-card",
      title: "Read the segment bar",
      body: "The bar maps the stretches between path elements (W1, T2, …). Open stretches drive at the global max; a cap on a stretch slows just that part of the route.",
      placement: "left",
    },
    {
      target: "max-velocity-card",
      title: "Generate caps for the corner",
      body: "Click Generate. The optimizer proposes max-velocity caps from the geometry with a safety factor — watch it place a lower cap where the route turns sharply.",
      placement: "left",
      interact: ["max-velocity-card"],
      completeWhen: velocityPlanGenerated,
    },
    {
      target: "max-velocity-card",
      title: "Select a cap and make it yours",
      body: "Click a generated stretch in the bar to select it. Edit its value and it becomes Manual — manual caps survive optimizer reruns, and caps go stale when you move elements. You own the plan.",
      placement: "left",
      interact: ["max-velocity-card"],
      completeWhen: velocitySegmentSelected,
    },
    {
      title: "The recipe: fast straight, slow turn",
      body: "Leave open straights at the global max and cap the elements around each tight turn. If the robot overshoots a handoff, lower the cap into it first — or, for a corner you plan to take fast, start the turn earlier with a bigger handoff radius and a cap the robot can hold.",
    },
  ],
};

export const simulateTour: TourDefinition = {
  id: "simulate-verify",
  title: "Simulate and verify",
  summary: "What the preview proves — and what it cannot",
  practicePath: createSimulatePracticePath,
  steps: [
    {
      title: "A complete little auto",
      body: "This practice path has a corner, a mid-segment rotation target, and an event trigger — the pieces a real auto is made of. Watch how each shows up in the preview.",
    },
    {
      target: "transport-play",
      title: "Watch the run",
      body: "Press the highlighted play button (or Space), then scrub the timeline. Watch the robot turn during the second segment and the event marker fire as its progress passes the trigger.",
      keys: ["Space", "J", "K", "L"],
      placement: "above",
      interact: ["simulation-transport"],
      completeWhen: simulationIsPlaying,
    },
    {
      title: "An idealized preview — not a robot sim",
      body: "The preview follows your elements, constraints, and handoffs with ideal kinematics. It does not model PID controllers, wheel slip, battery sag, or collisions — a clean preview checks structure, it is not a robot validation.",
    },
    {
      target: "path-health",
      title: "Check path health",
      body: "The pulse icon runs the editor's structural checks — too few path elements, off-field elements, empty event keys. After the tour, open it any time and clear every issue before heading to the robot.",
      placement: "below",
    },
    {
      title: "Close the loop on the robot",
      body: "The full loop is geometry → velocity plan → optimizer → simulate → robot test. Change one thing at a time, and let observed robot behavior refine your caps.",
    },
    {
      target: "help-hub",
      title: "Keep going",
      body: "The documentation covers every concept here in depth. Find it any time under this menu, next to the keyboard reference and these lessons.",
      placement: "below",
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

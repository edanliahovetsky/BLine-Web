import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  type PathModel,
} from "../../core/model/path";
import { projectStore } from "../../state/projectStore";
import type { TourDefinition } from "./tourStore";

export const editorBasicsTourId = "editor-basics";

/** Scratch path a tour switches to so nothing it teaches touches real autos. */
export const tourPracticePathName = "Tour practice";

/**
 * The practice path starts with a small, valid two-waypoint run so the editor
 * has something to show (and Path Health has nothing to flag) before the
 * learner adds their own elements.
 */
export function createTourPracticePath(): PathModel {
  return createPathModel({
    path_elements: [
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 3,
          y_meters: 3,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: 0,
          t_ratio: 0,
        }),
      }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 6.5,
          y_meters: 4.5,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: 0,
          t_ratio: 0,
        }),
      }),
    ],
  });
}

/**
 * Element counts are captured when the tour starts so the "place a waypoint"
 * step can tell that the user actually added something.
 */
let elementCountAtStepStart = 0;

export function captureElementCount(): void {
  elementCountAtStepStart =
    projectStore.getState().project?.path.path_elements.length ?? 0;
}

function elementWasAdded(): boolean {
  const current =
    projectStore.getState().project?.path.path_elements.length ?? 0;
  return current > elementCountAtStepStart;
}

export const editorBasicsTour: TourDefinition = {
  id: editorBasicsTourId,
  title: "Editor basics",
  summary: "Place, shape, constrain, and simulate a path",
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

export const shapePathsTour: TourDefinition = {
  id: "shape-paths",
  title: "Draw better paths",
  summary: "Path elements, segments, and handoffs — the polyline model",
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
      body: "Click the highlighted Translation tool (or press 2), then click between the two waypoints. The route bends through the new element without adding a heading goal.",
      keys: ["2"],
      placement: "right",
      interact: ["tool-translation", "path-canvas"],
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
      title: "Tune the handoff",
      body: "Select an intermediate element and note its dashed circle. The radius decides where the route turns — if the robot overshoots it, lower the velocity cap into it before making the circle bigger.",
      placement: "right",
      interact: ["path-canvas", "inspector-panel"],
      prepare: { tool: "select" },
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
  steps: [
    {
      title: "Geometry says where. Constraints say how fast.",
      body: "A polyline has no time schedule. Max translation velocity is the control you will use most: it caps how aggressively BLine approaches corners, clearances, and the final pose.",
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
      title: "Cap velocity per segment",
      body: "The bar maps the stretches between path elements (W1, T2, …). Click a stretch to set its cap — keep open straights near the global max and slow only the sections that need care.",
      placement: "left",
      interact: ["max-velocity-card"],
    },
    {
      target: "max-velocity-card",
      title: "Let the optimizer propose caps",
      body: "Generate proposes maximum-velocity caps from the path's geometry, with a safety factor applied. It is a first proposal, not a decision — you own the plan, so review every cap.",
      placement: "left",
      interact: ["max-velocity-card"],
    },
    {
      target: "max-velocity-card",
      title: "Manual edits win",
      body: "Editing a generated cap converts it to Manual, and manual caps survive optimizer reruns. When you move elements, generated caps go stale — regenerate and re-review.",
      placement: "left",
      interact: ["max-velocity-card"],
    },
    {
      title: "The recipe: fast straight, slow turn",
      body: "Leave open straights at the global max and add a lower cap covering the elements around each tight turn. If the robot overshoots a handoff, lower the cap into it first — not the radius.",
    },
  ],
};

export const simulateTour: TourDefinition = {
  id: "simulate-verify",
  title: "Simulate and verify",
  summary: "What the preview proves — and what it cannot",
  steps: [
    {
      target: "transport-play",
      title: "Watch the run",
      body: "Press the highlighted play button (or Space), then scrub the timeline to inspect rotation timing and where the slowdown lands.",
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
      body: "The pulse icon runs the editor's structural checks — too few path elements, off-field elements, empty event keys. Clear these before heading to the robot.",
      placement: "below",
      interact: ["path-health"],
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

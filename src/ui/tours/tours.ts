import {
  createPathModel,
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathModel,
} from "../../core/model/path";
import {
  activePathForProjectStore,
  projectStore,
} from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import {
  tourStore,
  type TourAction,
  type TourDefinition,
  type TourFeedback,
  type TourStep,
  type TourStepPreparation,
} from "./tourStore";
import {
  anchorPositions,
  clearance,
  mission,
  near,
  practiceConfig,
} from "./tourScenario";
import { checkPlan, feedback } from "./tourChecks";
import {
  createEventLessonPath,
  createFastRotationPath,
  createFundamentalsDemoPath,
  createHandoffLessonPath,
  createLowAccelerationPath,
  createOverviewGroups,
  createOverviewPaths,
  createRotationLessonPath,
  createTuningRectanglePath,
  fundamentalsMarkers,
  fundamentalsZones,
  tuningMarkers,
} from "./courseScenarios";

export const editorBasicsTourId = "getting-started";
export const tourPracticePathName = "Tour practice";
let baselinePath: PathModel | null = null;
let baselineActions: Partial<Record<TourAction, number>> = {};
let baselineGeneration = 0;

export function createTourPracticePath() {
  return createFundamentalsDemoPath();
}
function currentPath() {
  return activePathForProjectStore(projectStore.getState())?.path ?? null;
}
function currentConfig() {
  return projectStore.getState().project?.config ?? practiceConfig();
}
function generationCount() {
  return Number(
    document
      .querySelector('[data-tour="max-velocity-card"]')
      ?.getAttribute("data-tour-generate-count") ?? 0,
  );
}
export function captureTourStepState() {
  baselinePath = structuredClone(currentPath());
  baselineActions = { ...tourStore.getState().actions };
  baselineGeneration = generationCount();
}
function outcome(check: (path: PathModel) => TourFeedback): () => TourFeedback {
  return () => {
    const path = currentPath();
    return path
      ? check(path)
      : {
          complete: false,
          message: "Reopen this lesson to restore its practice path.",
        };
  };
}
function acted(name: TourAction) {
  return (
    (tourStore.getState().actions[name] ?? 0) > (baselineActions[name] ?? 0)
  );
}
function action(name: TourAction, waiting: string, done: string) {
  return () => feedback(acted(name), waiting, done);
}
function shown(selector: string) {
  return !!document.querySelector(selector);
}
function openControl(selector: string, waiting: string) {
  return () => feedback(shown(selector), waiting, "Ready to continue.");
}
const endpoint = (path: PathModel) => path.path_elements.length - 1;
const bend = (path: PathModel) =>
  path.path_elements.findIndex(isTranslationTarget);
const rotation = (path: PathModel) =>
  path.path_elements.findIndex(isRotationTarget);
const event = (path: PathModel) => path.path_elements.findIndex(isEventTrigger);
const properties = (
  selectElement: TourStepPreparation["selectElement"],
): TourStepPreparation => ({
  inspector: "open",
  inspectorTab: "elements",
  tool: "select",
  selectElement,
});
const constraints = (selectSpeed?: number): TourStepPreparation => ({
  inspector: "open",
  inspectorTab: "constraints",
  tool: "select",
  selectSpeed,
});
const playback = ["simulation-transport"];
const elementExploration = [
  "path-canvas",
  "inspector-panel",
  "element-properties",
  "tool-select",
  ...playback,
];
const routeExploration = [
  ...elementExploration,
  "tool-waypoint",
  "tool-translation",
];
const constraintExploration = ["max-velocity-card", ...playback];

/** Ignore generated values when comparing what the learner authored. */
export function tourPathIntent(path: PathModel | null) {
  return (
    path &&
    JSON.stringify({
      elements: path.path_elements.map((element) => {
        const copy = structuredClone(element);
        const target = isWaypoint(copy)
          ? copy.translation_target
          : isTranslationTarget(copy)
            ? copy
            : null;
        if (
          target &&
          (target.handoff_radius_source === "auto" ||
            (target.intermediate_handoff_radius_meters === null &&
              !target.handoff_radius_source))
        ) {
          target.intermediate_handoff_radius_meters = null;
          delete target.handoff_radius_source;
        }
        return copy;
      }),
      constraints: path.constraints,
      ranges: path.ranged_constraints
        .filter((constraint) => constraint.source !== "auto_velocity")
        .map(({ key, value, start_ordinal, end_ordinal, source }) => ({
          key,
          value,
          start_ordinal,
          end_ordinal,
          source,
        })),
    })
  );
}

export const gettingStartedTour: TourDefinition = {
  id: editorBasicsTourId,
  title: "Getting Started",
  summary: "Find the canvas, panels, menus, and Path Groups",
  durationMinutes: 3,
  completionMessage: "You know where to find the editor controls.",
  practicePath: createFundamentalsDemoPath,
  practicePaths: createOverviewPaths,
  practiceGroups: createOverviewGroups,
  practiceConfig,
  steps: [
    {
      title: "Canvas",
      body: "The canvas shows your path, targets, and the robot’s preview motion.",
      target: "path-canvas",
      prepare: {
        inspector: "closed",
        navigator: "closed",
        tool: "select",
        simulation: "start",
        clearSelection: true,
      },
    },
    {
      title: "Toolbar",
      body: "The canvas toolbar contains the tools for selecting and adding path elements.",
      target: "tool-rail",
    },
    {
      title: "Sidebar",
      body: "Open the sidebar to see the selected path’s elements and constraints.",
      target: "inspector-toggle",
      visible: ["inspector-panel"],
      interact: ["inspector-toggle"],
      task: "Open the sidebar",
      prepare: { inspector: "closed" },
      check: openControl(
        '[data-tour="inspector-toggle"][aria-expanded="true"]',
        "Click Toggle inspector.",
      ),
    },
    {
      title: "Elements",
      body: "Switch to Elements to see the path’s drive order and selected element properties.",
      target: "inspector-elements",
      interact: ["inspector-elements"],
      task: "Open Elements",
      prepare: { inspector: "open", inspectorTab: "constraints" },
      check: openControl(
        '[data-tour="inspector-elements"][aria-selected="true"]',
        "Select Elements.",
      ),
    },
    {
      title: "Constraints",
      body: "Switch to Constraints to see the robot’s motion limits and handoff radii.",
      target: "inspector-constraints",
      interact: ["inspector-constraints"],
      task: "Open Constraints",
      check: openControl(
        '[data-tour="inspector-constraints"][aria-selected="true"]',
        "Select Constraints.",
      ),
    },
    {
      title: "Play bar",
      body: "The play bar lets you play, pause, and scrub through the robot’s motion.",
      target: "simulation-transport",
      prepare: { inspector: "closed" },
    },
    {
      title: "File menu",
      body: "Open File to find project, import, and export commands.",
      target: "export-menu-entry",
      interact: ["export-menu-entry"],
      task: "Open File",
      prepare: { closeMenus: true },
      check: openControl(
        '[data-tour="export-menu-entry"][aria-expanded="true"]',
        "Open File.",
      ),
    },
    {
      title: "Edit actions",
      body: "Undo and Redo reverse or restore edits; the Actions menu holds these commands on compact screens.",
      target: "edit-controls",
      prepare: { closeMenus: true },
    },
    {
      title: "Path menu",
      body: "Open Path to find commands for the current path.",
      target: "path-menu-entry",
      interact: ["path-menu-entry"],
      task: "Open Path",
      prepare: { closeMenus: true },
      check: openControl(
        '[data-tour="path-menu-entry"][aria-expanded="true"]',
        "Open Path.",
      ),
    },
    {
      title: "Path dropdown",
      body: "Open the path dropdown to see the paths available in this project.",
      target: "path-breadcrumb",
      interact: ["path-breadcrumb"],
      task: "Open the path dropdown",
      prepare: { closeMenus: true },
      check: openControl(
        '[data-tour="path-breadcrumb"] [aria-expanded="true"]',
        "Open the path dropdown.",
      ),
    },
    {
      title: "Path Groups",
      body: "Open the Project Navigator to see how Path Groups collect related paths for viewing together.",
      target: "navigator-button",
      visible: ["project-navigator", "navigator-groups"],
      interact: ["navigator-button"],
      task: "Open the Project Navigator",
      prepare: { closeMenus: true, navigator: "closed" },
      check: openControl(
        '[data-tour="project-navigator"]',
        "Open the Project Navigator.",
      ),
    },
  ],
};

export const fundamentalsTour: TourDefinition = {
  id: "bline-fundamentals",
  title: "BLine Fundamentals",
  summary: "Build a route with waypoints and translation targets",
  durationMinutes: 5,
  completionMessage:
    "You built a route and checked the robot’s bumper clearance.",
  practicePath: createFundamentalsDemoPath,
  practiceConfig,
  markers: fundamentalsZones,
  steps: [
    {
      title: "See a complete path",
      body: "This example has two waypoints, two translation targets, one rotation target, and one event trigger. Press Play, then pause or scrub as you like; Continue when you are done.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      prepare: { inspector: "closed", simulation: "start", tool: "select" },
      task: "Try playback",
      phase: "Observe",
      check: action(
        "play",
        "Press Play to try the example.",
        "Explore playback, then Continue when ready.",
      ),
    },
    {
      title: "Place Start and End",
      body: "Choose Waypoint and place one in Start, then choose Waypoint again and place one in End. A waypoint sets both position and heading.",
      target: "tool-waypoint",
      visible: ["path-canvas"],
      interact: ["tool-waypoint", "path-canvas", "element-properties"],
      prepare: {
        practicePath: createPathModel,
        inspector: "closed",
        clearSelection: true,
        tool: "select",
      },
      task: "Place two waypoints in the marked zones",
      phase: "Build",
      check: outcome((path) =>
        feedback(
          path.path_elements.filter(isWaypoint).length === 2 &&
            near(anchorPositions(path)[0], mission.start) &&
            near(anchorPositions(path).at(-1), mission.delivery),
          "Place Start in the left zone and End in the right zone; drag a waypoint to adjust it.",
          "Start and End are in their zones.",
        ),
      ),
    },
    {
      title: "Change a waypoint heading",
      body: "Drag a waypoint’s heading handle or enter a degree value, then play the path to see the robot turn. Keep exploring and Continue when ready.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      prepare: properties(endpoint),
      task: "Change a heading and play the path",
      check: outcome((path) =>
        feedback(
          path.path_elements.some((element, index) => {
            const before = baselinePath?.path_elements[index];
            return (
              isWaypoint(element) &&
              before &&
              isWaypoint(before) &&
              Math.abs(
                element.rotation_target.rotation_radians -
                  before.rotation_target.rotation_radians,
              ) > 0.01
            );
          }) && acted("play"),
          "Change either waypoint’s heading, then press Play.",
          "Try other headings or Continue when ready.",
        ),
      ),
    },
    {
      title: "Route around the obstacle",
      body: "A translation target changes the route without setting the robot’s heading. Add one between Start and End, then move it until the simulated bumpers clear the obstacle.",
      target: "tool-translation",
      visible: ["path-canvas", "simulation-transport"],
      interact: [...elementExploration, "tool-translation"],
      markers: fundamentalsMarkers,
      prepare: { ...properties(0), simulation: "start" },
      task: "Add a translation target and leave bumper clearance",
      phase: "Build",
      check: outcome((path) =>
        feedback(
          path.path_elements.some(isTranslationTarget) &&
            clearance(path, currentConfig(), true),
          "Add a translation target and adjust the route until the moving robot’s bumpers clear the obstacle.",
          "The simulated bumpers clear the obstacle.",
        ),
      ),
    },
    {
      title: "Try more route points",
      body: "Try two or three points around the obstacle and watch the motion; waypoints also set headings. Use as few path elements as the route needs, then Continue when you are done.",
      target: "path-canvas",
      visible: ["tool-rail", "simulation-transport"],
      interact: routeExploration,
      markers: fundamentalsMarkers,
      prepare: { ...properties(bend), simulation: "start" },
      phase: "Experiment",
    },
    {
      title: "Read the drive order",
      body: "The Elements list is the drive order. Drag its rows to reorder targets, then play to see the result; Continue when you are done exploring.",
      target: "inspector-panel",
      visible: ["path-canvas", "simulation-transport"],
      interact: routeExploration,
      markers: fundamentalsMarkers,
      prepare: properties(bend),
    },
  ],
};

const tuningStep = (step: TourStep): TourStep => ({
  ...step,
  markers: tuningMarkers,
  lockGeometry: true,
  autoGenerate: false,
});
export const pathTuningTour: TourDefinition = {
  id: "path-tuning",
  title: "Path Tuning",
  summary: "See target handoffs, then tune radii and velocity limits",
  durationMinutes: 6,
  completionMessage:
    "You generated starting values and tried your own manual settings.",
  practicePath: createHandoffLessonPath,
  practiceConfig,
  markers: fundamentalsMarkers,
  steps: [
    {
      title: "Approach the translation",
      body: "The robot steers from its current position toward the translation target. Watch the active target as the preview slows down.",
      target: "path-canvas",
      canvasLesson: "handoff-approach",
      autoGenerate: false,
      prepare: { inspector: "closed", simulation: "start", autoPlay: true },
    },
    {
      title: "Cross the handoff radius",
      body: "When the robot’s center enters this radius, BLine switches the active target. The purple flash marks that exact handoff.",
      target: "path-canvas",
      canvasLesson: "handoff-crossing",
      autoGenerate: false,
      prepare: { inspector: "closed", autoPlay: true },
    },
    {
      title: "Target the next element",
      body: "The robot now steers toward End and keeps moving through the turn. The radius chooses where that target change can happen.",
      target: "path-canvas",
      canvasLesson: "handoff-departure",
      autoGenerate: false,
      prepare: { inspector: "closed", autoPlay: true },
    },
    {
      title: "Lower acceleration makes a wider turn",
      body: "Acceleration is temporarily reduced from 3 to 0.6 m/s². The robot has less ability to change direction quickly, so its turn is wider at the same speed; higher acceleration allows a tighter turn.",
      target: "path-canvas",
      canvasLesson: "low-acceleration",
      autoGenerate: false,
      prepare: {
        practicePath: createLowAccelerationPath,
        inspector: "closed",
        simulation: "start",
        autoPlay: true,
      },
    },
    tuningStep({
      title: "A new route to tune",
      body: "This route goes around a tall obstacle through the Intermediate zone. Its positions and headings stay fixed while you tune radii and velocities; the generator has not run yet.",
      target: "path-canvas",
      prepare: {
        practicePath: createTuningRectanglePath,
        inspector: "closed",
        simulation: "start",
        clearSelection: true,
      },
    }),
    tuningStep({
      title: "Open Constraints",
      body: "Constraints set how fast the robot can move and accelerate. Velocity limits are the main way to control speed along the path.",
      target: "inspector-constraints",
      interact: ["inspector-constraints"],
      prepare: {
        inspector: "open",
        inspectorTab: "elements",
        clearSelection: true,
      },
      task: "Open Constraints",
      check: openControl(
        '[data-tour="inspector-constraints"][aria-selected="true"]',
        "Select Constraints.",
      ),
    }),
    tuningStep({
      title: "Select a constraint range",
      body: "Each velocity constraint applies to a range of approaches. Select a cell near the middle to see its range highlighted green on the canvas.",
      target: "max-velocity-card",
      visible: ["path-canvas"],
      interact: ["max-velocity-card"],
      prepare: { ...constraints(), clearSelection: true },
      task: "Select a middle velocity cell",
      check: () => {
        const selected = selectionStore.getState().selectedRangedConstraint;
        return feedback(
          !!selected &&
            selected.key === "max_velocity_meters_per_sec" &&
            selected.startOrdinal <= 3 &&
            selected.endOrdinal >= 3,
          "Select the velocity cell beside the middle translation target.",
          "The green highlight shows where this limit applies.",
        );
      },
    }),
    tuningStep({
      title: "The first slot",
      body: "The first velocity and radius slots govern the approach to Start when the robot begins away from it. This preview begins at Start, so that approach has no distance.",
      target: "max-velocity-card",
      visible: ["path-canvas"],
      prepare: constraints(1),
    }),
    tuningStep({
      title: "Generate starting values",
      body: "Generate suggests handoff radii and maximum velocities for this route. Use these values to build intuition, then preview and test your tuning on the robot.",
      target: "max-velocity-card",
      interact: ["max-velocity-card"],
      prepare: constraints(),
      task: "Click Generate",
      check: outcome((path) =>
        feedback(
          generationCount() > baselineGeneration &&
            checkPlan(path, currentConfig()).complete,
          "Click Generate to calculate the Auto values.",
          "Auto radii and velocities are ready to try.",
        ),
      ),
    }),
    tuningStep({
      title: "Play the generated path",
      body: "Play the route and watch how the robot rounds each turn. You can pause and scrub before continuing.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      prepare: { simulation: "start" },
      task: "Play the generated path",
      check: action(
        "play",
        "Press Play to try the generated values.",
        "Continue when you are ready to tune.",
      ),
    }),
    tuningStep({
      title: "Make a radius Manual",
      body: "Select a translation target’s radius on the right and choose Manual. Change its value to try an earlier or later handoff.",
      target: "max-velocity-card",
      visible: ["path-canvas", "simulation-transport"],
      interact: constraintExploration,
      prepare: { ...constraints(), selectElement: bend },
      task: "Set a translation radius to Manual",
      check: outcome((path) =>
        feedback(
          path.path_elements.some(
            (element) =>
              isTranslationTarget(element) &&
              element.handoff_radius_source === "manual" &&
              element.intermediate_handoff_radius_meters !== null,
          ),
          "Select a translation radius chip and switch it to Manual.",
          "This radius now keeps your value when you generate.",
        ),
      ),
    }),
    tuningStep({
      title: "Make a velocity Manual",
      body: "Select a velocity cell and choose Manual, then change its speed limit. This can be on any segment; manual values remain yours when you generate again.",
      target: "max-velocity-card",
      visible: ["path-canvas", "simulation-transport"],
      interact: constraintExploration,
      prepare: constraints(4),
      task: "Set a velocity constraint to Manual",
      check: outcome((path) =>
        feedback(
          path.ranged_constraints.some(
            (constraint) =>
              constraint.key === "max_velocity_meters_per_sec" &&
              constraint.source !== "auto_velocity" &&
              constraint.value > 0,
          ),
          "Select a velocity cell and switch it to Manual.",
          "This velocity limit now keeps your value when you generate.",
        ),
      ),
    }),
    tuningStep({
      title: "Explore radii and velocities",
      body: "Try combinations of radii and velocity limits, then play or scrub to see how they change the motion. Generate again if useful; Continue when you are done.",
      target: "max-velocity-card",
      visible: ["path-canvas", "simulation-transport"],
      interact: constraintExploration,
      prepare: constraints(),
      phase: "Experiment",
    }),
  ],
};

export const rotationTargetsTour: TourDefinition = {
  id: "rotation-targets",
  title: "Rotation targets",
  summary:
    "Set headings along a segment and see the limits of turning at speed",
  durationMinutes: 4,
  completionMessage: "You placed rotation targets and explored their timing.",
  practicePath: createRotationLessonPath,
  practiceConfig,
  steps: [
    {
      title: "Add a rotation target",
      body: "Rotation targets set a heading along a path segment. Choose Rotation and place one between Start and End; this path has a manual speed limit of 2 m/s.",
      target: "tool-rotation",
      visible: ["path-canvas"],
      interact: [...elementExploration, "tool-rotation"],
      autoGenerate: false,
      prepare: { ...properties(0), simulation: "start" },
      task: "Place a rotation target on the segment",
      check: outcome((path) =>
        feedback(
          path.path_elements.some(isRotationTarget),
          "Choose Rotation and click the segment.",
          "Rotation target placed.",
        ),
      ),
    },
    {
      title: "Move the rotation target",
      body: "Drag the target along its segment or change Rotation Pos. This t-ratio is how far along the segment it sits: 0 is the start and 1 is the end.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      autoGenerate: false,
      prepare: properties(rotation),
      task: "Try a different position",
      check: outcome((path) => {
        const target = path.path_elements.find(isRotationTarget);
        const before = baselinePath?.path_elements.find(isRotationTarget);
        return feedback(
          !!target &&
            !!before &&
            Math.abs(target.t_ratio - before.t_ratio) > 0.01,
          "Drag the rotation target or edit Rotation Pos.",
          "Keep exploring or Continue when ready.",
        );
      }),
    },
    {
      title: "Try a heading in motion",
      body: "Drag the rotation handle or enter a degree value, then play the path to watch the robot turn between the waypoints. Continue when you are done exploring.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      autoGenerate: false,
      prepare: properties(rotation),
      task: "Change the rotation and play",
      check: outcome((path) => {
        const target = path.path_elements.find(isRotationTarget);
        const before = baselinePath?.path_elements.find(isRotationTarget);
        return feedback(
          !!target &&
            !!before &&
            Math.abs(target.rotation_radians - before.rotation_radians) >
              0.01 &&
            acted("play"),
          "Change the target heading, then press Play.",
          "Keep exploring or Continue when ready.",
        );
      }),
    },
    {
      title: "Try Profiled Rotation",
      body: "Profiled Rotation spreads the desired heading along the approach. Turn it off to aim for the next heading immediately, within the robot’s turn limits, then play and compare the motion on the canvas.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      autoGenerate: false,
      prepare: properties(rotation),
      task: "Turn Profiled Rotation off and play",
      check: outcome((path) =>
        feedback(
          path.path_elements.some(
            (element) =>
              isRotationTarget(element) && !element.profiled_rotation,
          ) && acted("play"),
          "Turn Profiled Rotation off, then press Play.",
          "Try either mode and Continue when ready.",
        ),
      ),
    },
    {
      title: "When translation is too fast",
      body: "This straight path asks for 0°, then 180°, then 0° at a high manual speed. Play it: the robot may pass the middle target before it can turn far enough.",
      target: "transport-play",
      visible: ["path-canvas", "path-health"],
      interact: [...playback, "path-health", "lesson-health-dialog"],
      autoGenerate: false,
      prepare: {
        practicePath: createFastRotationPath,
        inspector: "open",
        inspectorTab: "elements",
        selectElement: rotation,
        simulation: "start",
      },
      task: "Play the fast rotation example",
      check: action(
        "play",
        "Press Play and watch the heading at the middle target.",
        "The turn needs more time than this approach allows.",
      ),
    },
    {
      title: "Give the turn enough time",
      body: "The rotation feasibility feedback checks whether the angular limits allow the requested turn in time. Try a lower manual velocity and play again to see the robot get more time to turn.",
      target: "max-velocity-card",
      visible: ["path-canvas", "simulation-transport", "path-health"],
      interact: [
        ...constraintExploration,
        "path-health",
        "lesson-health-dialog",
      ],
      autoGenerate: false,
      prepare: { ...constraints(2), pathHealth: "closed" },
      phase: "Experiment",
    },
  ],
};

export const eventTriggersTour: TourDefinition = {
  id: "event-triggers",
  title: "Event triggers",
  summary: "Move an event and add another on a different segment",
  durationMinutes: 3,
  completionMessage: "You positioned event keys on two path segments.",
  practicePath: createEventLessonPath,
  practiceConfig,
  steps: [
    {
      title: "Slide an event trigger",
      body: "Event triggers sit on a segment like rotation targets. Drag startIntake or edit Event Pos; its t-ratio measures progress from 0 to 1 along that segment.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      prepare: properties(event),
      task: "Move the existing event",
      check: outcome((path) => {
        const target = path.path_elements.find(isEventTrigger);
        const before = baselinePath?.path_elements.find(isEventTrigger);
        return feedback(
          !!target &&
            !!before &&
            Math.abs(target.t_ratio - before.t_ratio) > 0.01,
          "Drag startIntake or change Event Pos.",
          "The event now fires at its new position.",
        );
      }),
    },
    {
      title: "Watch the event fire",
      body: "When the robot crosses the trigger, BLine fires its event key; your robot code connects that key to an action. Play the path and watch the purple startIntake pulse.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      prepare: { simulation: "start", inspector: "closed" },
      task: "Play through the event",
      check: action(
        "finishRun",
        "Play the path through to End to see the event fire.",
        "The event key fired as the robot crossed its position.",
      ),
    },
    {
      title: "Add an event on the next segment",
      body: "Choose Event and add another trigger between the translation target and End. Set Event Pos to 0.6 and Lib Key to stopIntake.",
      target: "tool-event",
      visible: ["path-canvas", "element-properties"],
      interact: [...elementExploration, "tool-event"],
      prepare: { ...properties(bend), simulation: "start" },
      task: "Add stopIntake at 0.6 on the second segment",
      check: outcome((path) => {
        const bendIndex = bend(path);
        const endIndex = path.path_elements.reduce(
          (last, element, index) => (isWaypoint(element) ? index : last),
          -1,
        );
        return feedback(
          bendIndex >= 0 &&
            path.path_elements.some(
              (element, index) =>
                isEventTrigger(element) &&
                index > bendIndex &&
                index < endIndex &&
                element.lib_key.trim() === "stopIntake" &&
                Math.abs(element.t_ratio - 0.6) < 0.015,
            ),
          "Place the new event after the translation target, then set Event Pos 0.6 and Lib Key stopIntake.",
          "stopIntake is on the second segment at 0.6.",
        );
      }),
    },
    {
      title: "Try both events",
      body: "Play or scrub the path to see both event positions. Keep exploring their timing and Continue when you are done.",
      target: "simulation-transport",
      visible: ["path-canvas", "element-properties"],
      interact: [...elementExploration, "tool-event"],
      prepare: { simulation: "start", tool: "select" },
      phase: "Experiment",
    },
  ],
};

export const foundationalTours: readonly TourDefinition[] = [
  gettingStartedTour,
  fundamentalsTour,
  pathTuningTour,
  rotationTargetsTour,
  eventTriggersTour,
];
export const tours: readonly TourDefinition[] = foundationalTours;
export function findTour(tourId: string | null) {
  return tours.find((tour) => tour.id === tourId) ?? null;
}

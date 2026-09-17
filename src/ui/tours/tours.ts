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
import { robotSettingsTour } from "./robotSettingsLesson";
import { supplementalTours } from "./supplementalLessons";
import {
  createManagementPaths,
  createManagementGroups,
  createManagementTargets,
} from "./supplementalScenarios";
import { observedTourCondition } from "./tourInteraction";
import {
  createEventLessonPath,
  createFastRotationPath,
  createFundamentalsDemoPath,
  createHandoffLessonPath,
  createLowAccelerationPath,
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
  const opened = observedTourCondition(() => shown(selector));
  return () => feedback(opened(), waiting, "Ready to continue.");
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
  practicePath: () => createManagementPaths()[0].path,
  practicePaths: createManagementPaths,
  practiceGroups: createManagementGroups,
  practiceLinkedTargets: createManagementTargets,
  practiceConfig,
  steps: [
    {
      title: "Canvas",
      body: "The canvas shows your path and lets you preview the robot’s movement.",
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
      body: "Use these tools to select, move, and add path elements.",
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
      body: "Open Elements to see the path order. Select a row to edit its position, heading, or event key in the properties below the list.",
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
      interact: playback,
      prepare: { inspector: "closed" },
    },
    {
      title: "File menu",
      body: "Open File to create a New Path or manage projects. Import / Export contains both project and path transfers. Settings is the last item, below the divider.",
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
      body: "Undo reverses your last edit. Redo brings it back. On smaller screens, find both in the Actions menu.",
      target: "edit-controls",
      prepare: { closeMenus: true },
    },
    {
      title: "Edit menu",
      body: "Open Edit for Save Path As, Rename Path, and deletion commands. Linked Elements is below the divider.",
      target: "path-menu-entry",
      interact: ["path-menu-entry"],
      task: "Open Edit",
      prepare: { closeMenus: true },
      check: openControl(
        '[data-tour="path-menu-entry"][aria-expanded="true"]',
        "Open Edit.",
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
      body: "Open the Project Navigator to see Testing, Top Side Auto, and Bottom Side Auto beside the canvas. It temporarily hides the sidebar; closing Navigator restores it. Groups organize related paths.",
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
  summary: "Build a path with waypoints and translation targets",
  durationMinutes: 5,
  completionMessage:
    "You built a route and checked the robot’s bumper clearance.",
  practicePath: createFundamentalsDemoPath,
  practiceConfig,
  markers: fundamentalsZones,
  steps: [
    {
      title: "See a complete path",
      body: "This path has waypoints, translation targets, a rotation target, and an event trigger. Press Play to see how they work together. Pause or drag the play bar to take a closer look.",
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
      body: "Drag a waypoint’s heading handle or type an angle in degrees. Then press Play to see the robot turn.",
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
      body: "A translation target tells the robot where to go without setting its heading. Add one between Start and End. Move it until the robot’s bumpers clear the obstacle in the preview.",
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
      body: "Try adding two or three points around the obstacle. Use waypoints where you also want to set a heading. Press Play to see the result, and keep the path as simple as you can.",
      target: "path-canvas",
      visible: ["tool-rail", "simulation-transport"],
      interact: routeExploration,
      markers: fundamentalsMarkers,
      prepare: { ...properties(bend), simulation: "start" },
      phase: "Experiment",
    },
    {
      title: "Read the drive order",
      body: "The robot follows the order shown in Elements. Drag the rows to change that order, then press Play to see what happens.",
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
      body: "The robot drives toward the translation target. Watch what happens as it gets closer.",
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
      body: "The robot now heads toward End. The handoff radius controls when it switches targets and starts the turn.",
      target: "path-canvas",
      canvasLesson: "handoff-departure",
      autoGenerate: false,
      prepare: { inspector: "closed", autoPlay: true },
    },
    {
      title: "Lower acceleration makes a wider turn",
      body: "Here, acceleration drops from 3 to 0.6 m/s². The robot cannot change direction as quickly, so it makes a wider turn. Higher acceleration lets it turn more tightly at the same speed.",
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
      body: "This path goes around the obstacle. The points and headings are fixed for this exercise, so you can focus on handoff radii and speed limits. Generate has not run yet.",
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
      body: "A velocity limit can cover one or more parts of the path. Click a cell near the middle to see that part highlighted in green.",
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
      body: "The first velocity and radius cells apply as the robot moves toward Start. This preview begins at Start, so it skips that part.",
      target: "max-velocity-card",
      visible: ["path-canvas"],
      prepare: constraints(1),
    }),
    tuningStep({
      title: "Generate starting values",
      body: "Generate suggests handoff radii and maximum velocities. Try them in the preview, adjust as needed, and test on your robot.",
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
      body: "Select a velocity cell, choose Manual, and change its speed limit. Generate will keep your manual settings.",
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
      body: "Try different radii and speed limits. Play the path to see what changes. You can use Generate again, then continue when you are done.",
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
  summary: "Set headings and see how speed affects turning",
  durationMinutes: 4,
  completionMessage: "You placed rotation targets and explored their timing.",
  practicePath: createRotationLessonPath,
  practiceConfig,
  steps: [
    {
      title: "Add a rotation target",
      body: "A rotation target sets a heading partway along the path. Choose Rotation and place one between Start and End. This path has a speed limit of 2 m/s.",
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
      body: "Drag the target along the path or change Rotation Pos. The value runs from 0 at the start of the segment to 1 at the end.",
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
      body: "Drag the rotation handle or type an angle in degrees. Press Play to watch the robot turn.",
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
      body: "With Profiled Rotation on, the target heading changes gradually along the path. Turn it off and the robot tries to reach the next heading right away, within its turn limits. Press Play to compare.",
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
      body: "This path asks the robot to face 0°, then 180°, then 0° while driving quickly. Press Play. It may pass the middle target before it has time to turn.",
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
      body: "The rotation warning tells you when a turn needs more time than the path allows. Lower the manual speed limit and play again. A slower drive gives the robot more time to turn.",
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
  summary: "Place events and save reusable Lib Keys in the trigger manager",
  durationMinutes: 5,
  completionMessage:
    "You moved events, registered a reusable Lib Key, and found the tools for managing keys across a project.",
  practicePath: createEventLessonPath,
  practiceConfig,
  steps: [
    {
      title: "Slide an event trigger",
      body: "Events have positions along a segment, just like rotation targets. Drag startIntake or change Event Pos. A value of 0 is the segment’s start; 1 is its end.",
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
      body: "When the robot reaches an event trigger, BLine sends its event key to your robot code. Your code decides what to do. Press Play and watch for the purple startIntake flash.",
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
      title: "Open the trigger manager",
      body: "Lib Keys belong to the project, so you can reuse them across its paths. Open Event Triggers in File → Settings to manage them. The key you already used, startIntake, appears automatically.",
      target: "settings-nav-event-triggers",
      settingsSection: "event-triggers",
      settingsNavigateFrom: "robot",
      visible: ["settings-dialog"],
      interact: ["settings-nav"],
      prepare: {
        inspector: "closed",
        simulation: "start",
        closeMenus: true,
      },
      task: "Open Event Triggers",
      check: openControl(
        '[data-tour="settings-nav-event-triggers"][aria-current="page"]',
        "Choose Event Triggers in the settings menu.",
      ),
    },
    {
      title: "Register a Lib Key",
      body: "Click +, enter stopIntake, and confirm with the checkmark. Registering a key makes it available in the inspector without adding an event to the path. In your own project, click Save when you finish in Settings; this lesson applies edits to its practice project as you go.",
      target: "settings-event-triggers",
      settingsSection: "event-triggers",
      visible: ["settings-dialog"],
      interact: ["settings-event-triggers"],
      task: "Register stopIntake",
      check: () =>
        feedback(
          currentConfig().gui.event_trigger_keys?.includes("stopIntake") ??
            false,
          "Click +, enter stopIntake, then click the checkmark.",
          "stopIntake is ready to reuse.",
        ),
    },
    {
      title: "Find a registered key",
      body: "Type stop into the search field beside the magnifying glass. The list filters as you type. Each row shows how many times its key is used in this project's events and protrusion settings; stopIntake has no uses yet.",
      target: "settings-event-triggers",
      settingsSection: "event-triggers",
      visible: ["settings-dialog"],
      interact: ["settings-event-triggers"],
      task: "Search for stop",
      check: () =>
        feedback(
          document
            .querySelector<HTMLInputElement>(
              '[aria-label="Search event triggers"]',
            )
            ?.value.trim()
            .toLowerCase() === "stop",
          "Type stop in the search field.",
          "The list now shows matching keys.",
        ),
    },
    {
      title: "Manage registered keys",
      body: "Open the ⋯ menu beside stopIntake. Rename All replaces that key in every path and protrusion setting in the project. Duplicate registers a new key without copying event elements. Delete removes the registration and clears matching Lib Keys, leaving the event elements in place. These edits can be undone. Keep stopIntake for the next step.",
      target: "settings-event-triggers",
      settingsSection: "event-triggers",
      visible: ["settings-dialog"],
      interact: ["settings-event-triggers"],
      task: "Open the key's action menu",
      check: openControl(
        '[aria-label="Event trigger actions for stopIntake"][aria-expanded="true"]',
        "Click the ⋯ button beside stopIntake.",
      ),
    },
    {
      title: "Add an event on the next segment",
      body: "Choose Event and add another trigger between the translation target and End. Set Event Pos to 0.6. In Lib Key, type stop and press Tab to complete stopIntake. You can also choose a suggestion with the arrow keys and Enter or click it.",
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
                index > 0 &&
                index < bendIndex &&
                element.lib_key.trim() === "startIntake",
            ) &&
            path.path_elements.some(
              (element, index) =>
                isEventTrigger(element) &&
                index > bendIndex &&
                index < endIndex &&
                element.lib_key.trim() === "stopIntake" &&
                Math.abs(element.t_ratio - 0.6) < 0.015,
            ),
          "Keep startIntake on the first segment and add stopIntake on the second at Event Pos 0.6.",
          "stopIntake is on the second segment at 0.6.",
        );
      }),
    },
    {
      title: "Try both events",
      body: "Play the path to see both events fire. Try moving them to change when they happen, then continue when you are done.",
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
  robotSettingsTour,
];
export const tours: readonly TourDefinition[] = [
  ...foundationalTours,
  ...supplementalTours,
];
export function findTour(tourId: string | null) {
  return tours.find((tour) => tour.id === tourId) ?? null;
}

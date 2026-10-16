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
import { checkPlan, feedback, withEventKeyCaseHint } from "./tourChecks";
import { settingsTours } from "./robotSettingsLesson";
import { advancedTours, importExportTour } from "./supplementalLessons";
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
const lastAnchor = (path: PathModel) =>
  path.path_elements.reduce(
    (last, element, index) =>
      isWaypoint(element) || isTranslationTarget(element) ? index : last,
    -1,
  );
/** The segment from the translation target to End. */
const secondSegment = (path: PathModel) => {
  const from = bend(path);
  const to = lastAnchor(path);
  return from >= 0 && to > from ? ([from, to] as const) : null;
};
const secondSegmentEvents = (path: PathModel) => {
  const segment = secondSegment(path);
  return segment
    ? path.path_elements
        .slice(segment[0] + 1, segment[1])
        .filter(isEventTrigger)
    : [];
};
/** The event the learner adds after the translation target. */
const secondSegmentEventIndex = (path: PathModel | null) => {
  const segment = path ? secondSegment(path) : null;
  if (!path || !segment) return null;
  for (let index = segment[1] - 1; index > segment[0]; index -= 1)
    if (isEventTrigger(path.path_elements[index])) return index;
  return null;
};
/** Show me's first stop when another element's properties are showing. */
const selectSecondSegmentEvent = {
  target: "lesson-element",
  done: () => {
    const index = secondSegmentEventIndex(currentPath());
    return (
      index !== null && selectionStore.getState().selectedElementIndex === index
    );
  },
};
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

/** A requirement met once during this step, such as opening a menu. */
function seen(label: string, selector: string, hint: string) {
  const opened = observedTourCondition(() => shown(selector));
  return { label, check: () => feedback(opened(), hint, "") };
}
const sidebarOpen = observedTourCondition(() =>
  shown('[data-tour="inspector-toggle"][aria-expanded="true"]'),
);
const elementsOpened = observedTourCondition(() =>
  shown('[data-tour="inspector-elements"][aria-selected="true"]'),
);
const constraintsAfterElements = observedTourCondition(
  () =>
    elementsOpened() &&
    shown('[data-tour="inspector-constraints"][aria-selected="true"]'),
);
const headingChanged = (path: PathModel) =>
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
  });
const elementCount = () => currentPath()?.path_elements.length ?? 0;
/** Latched per step attempt: an extra element appeared, then went away. */
const extraPoint = (() => {
  let token = "";
  let added = false;
  let removed = false;
  return () => {
    const state = tourStore.getState();
    const current = `${state.activeTourId}:${state.attemptId}:${state.stepIndex}`;
    if (current !== token) {
      token = current;
      added = false;
      removed = false;
    }
    const baseline = baselinePath?.path_elements.length ?? 0;
    if (elementCount() > baseline) added = true;
    if (added && elementCount() <= baseline) removed = true;
    return { added, removed };
  };
})();
const extraPointAdded = () => extraPoint().added;
const extraPointRemoved = () => extraPoint().removed;
const played = {
  label: "Played the path",
  check: action("play", "Press Play.", ""),
};

export const gettingStartedTour: TourDefinition = {
  id: editorBasicsTourId,
  title: "Getting Started",
  summary: "Find the canvas, sidebar, menus, and Path Groups",
  durationMinutes: 2,
  recap: [
    "Build on the canvas with the tool bar, and preview with the play bar.",
    "The sidebar holds Elements and Constraints; File and Edit hold path and project commands.",
    "The Project Navigator groups related paths.",
  ],
  practicePath: () => createManagementPaths()[0].path,
  practicePaths: createManagementPaths,
  practiceGroups: createManagementGroups,
  practiceLinkedTargets: createManagementTargets,
  practiceConfig,
  steps: [
    {
      title: "The editor at a glance",
      body: "The canvas shows your path. The tool bar on the left selects and adds elements, and the play bar below previews the robot’s motion.",
      target: "path-canvas",
      showMe: ["tool-rail", "simulation-transport"],
      prepare: {
        inspector: "closed",
        navigator: "closed",
        tool: "select",
        simulation: "start",
        clearSelection: true,
      },
    },
    {
      title: "Sidebar",
      task: "Open the sidebar, then try both tabs",
      body: "Elements lists the path in drive order; select a row to edit it. Constraints holds speed limits and handoff radii.",
      target: "inspector-toggle",
      visible: ["inspector-panel"],
      interact: [
        "inspector-toggle",
        "inspector-elements",
        "inspector-constraints",
      ],
      showMe: [
        "inspector-toggle",
        "inspector-elements",
        "inspector-constraints",
      ],
      prepare: { inspector: "closed", inspectorTab: "constraints" },
      checks: [
        {
          label: "Sidebar open",
          check: () =>
            feedback(
              sidebarOpen(),
              "Click the sidebar button at top right.",
              "",
            ),
        },
        {
          label: "Elements tab",
          check: () => feedback(elementsOpened(), "Click Elements.", ""),
        },
        {
          label: "Constraints tab",
          check: () =>
            feedback(constraintsAfterElements(), "Then click Constraints.", ""),
        },
      ],
    },
    {
      title: "Menus",
      task: "Open File, then Edit",
      body: "File creates paths and projects, imports and exports, and opens Settings. Edit renames, saves copies, and deletes. Undo and Redo sit at the top right.",
      target: "export-menu-entry",
      interact: ["export-menu-entry", "path-menu-entry"],
      showMe: ["export-menu-entry", "path-menu-entry", "edit-controls"],
      prepare: { closeMenus: true, inspector: "closed" },
      checks: [
        seen(
          "File opened",
          '[data-tour="export-menu-entry"][aria-expanded="true"]',
          "Click File.",
        ),
        seen(
          "Edit opened",
          '[data-tour="path-menu-entry"][aria-expanded="true"]',
          "Click Edit.",
        ),
      ],
    },
    {
      title: "Path dropdown",
      task: "Open the path dropdown",
      body: "A project holds many paths. Choose the one to edit from this dropdown.",
      target: "path-breadcrumb",
      interact: ["path-breadcrumb"],
      prepare: { closeMenus: true },
      check: openControl(
        '[data-tour="path-breadcrumb"] [aria-expanded="true"]',
        "Click the path name at the top.",
      ),
    },
    {
      title: "Path Groups",
      task: "Open the Project Navigator",
      body: "The Navigator lists every path and the Path Groups that organize them, such as Top Side Auto. Close it to bring the sidebar back.",
      target: "navigator-button",
      visible: ["project-navigator", "navigator-groups"],
      interact: ["navigator-button"],
      prepare: { closeMenus: true, navigator: "closed" },
      check: openControl(
        '[data-tour="project-navigator"]',
        "Click the Navigator button at top left.",
      ),
    },
  ],
};

export const fundamentalsTour: TourDefinition = {
  id: "bline-fundamentals",
  title: "BLine Fundamentals",
  summary: "Build a path with waypoints and translation targets",
  durationMinutes: 5,
  recap: [
    "Waypoints set position and heading; translation targets set position only.",
    "The robot follows the Elements order, and the preview shows whether its bumpers clear obstacles.",
  ],
  practicePath: createFundamentalsDemoPath,
  practiceConfig,
  markers: fundamentalsZones,
  steps: [
    {
      title: "See a complete path",
      task: "Press Play to watch the example",
      body: "This path uses every element type: waypoints, translation targets, a rotation target, and an event. Pause or drag the play bar to look closer.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      prepare: { inspector: "closed", simulation: "start", tool: "select" },
      phase: "Observe",
      check: action("play", "Press Play.", "Explore playback, then Continue."),
    },
    {
      title: "Place Start and End",
      task: "Place a waypoint in each marked zone",
      body: "Choose Waypoint and click inside Start. Choose Waypoint again and click inside End. Drag a waypoint to adjust it.",
      why: "A waypoint sets both position and heading, the direction the robot faces. Every path needs a point to start from and one to finish at.",
      target: "tool-waypoint",
      visible: ["path-canvas"],
      interact: ["tool-waypoint", "path-canvas", "element-properties"],
      showMe: ["tool-waypoint", "lesson-start-zone", "lesson-goal-zone"],
      prepare: {
        practicePath: createPathModel,
        inspector: "closed",
        clearSelection: true,
        tool: "select",
      },
      phase: "Build",
      checks: [
        {
          label: "Waypoint in Start",
          check: outcome((path) =>
            feedback(
              path.path_elements.length > 0 &&
                isWaypoint(path.path_elements[0]) &&
                near(anchorPositions(path)[0], mission.start),
              path.path_elements.length
                ? "Drag the first waypoint into the Start zone."
                : "Choose Waypoint, then click inside Start.",
              "",
            ),
          ),
        },
        {
          label: "Waypoint in End",
          check: outcome((path) => {
            const count = path.path_elements.filter(isWaypoint).length;
            return feedback(
              count === 2 &&
                near(anchorPositions(path).at(-1), mission.delivery),
              count > 2
                ? "Keep just two waypoints: press ⌘Z or Ctrl+Z to remove the extra one."
                : count === 2
                  ? "Drag the second waypoint into the End zone."
                  : "Choose Waypoint again, then click inside End.",
              "",
            );
          }),
        },
      ],
    },
    {
      title: "Change a waypoint heading",
      task: "Change a heading, then press Play",
      body: "Drag a waypoint’s heading handle, or type an angle in degrees below the element list. Then play the path to watch the robot turn.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      prepare: properties(endpoint),
      checks: [
        {
          label: "Heading changed",
          check: outcome((path) =>
            feedback(
              headingChanged(path),
              "Drag a heading handle or type a new angle.",
              "",
            ),
          ),
        },
        played,
      ],
    },
    {
      title: "Fix a mistake",
      task: "Add an extra point, then remove it",
      body: "Choose Translation and click the path to add a point. Then remove it: select it and press Delete, click its row’s remove button, or press ⌘Z.",
      why: "Placing returns you to Select, so a stray click won’t add more points. Undo (⌘Z or Ctrl+Z) reverses any edit, including a deletion.",
      target: "tool-translation",
      visible: ["path-canvas", "simulation-transport"],
      interact: [...elementExploration, "tool-translation"],
      showMe: ["tool-translation", "inspector-panel"],
      keys: ["Delete", "Backspace", "⌘Z", "Ctrl+Z"],
      prepare: { ...properties(0), simulation: "start" },
      phase: "Build",
      checks: [
        {
          label: "Extra point added",
          check: () =>
            feedback(
              extraPointAdded(),
              "Choose Translation, then click the line between Start and End.",
              "",
            ),
        },
        {
          label: "Extra point removed",
          check: () =>
            feedback(
              extraPointRemoved(),
              "Select it and press Delete, use its row’s remove button, or press ⌘Z.",
              "",
            ),
        },
      ],
    },
    {
      title: "Route around the obstacle",
      task: "Add a translation target that clears the obstacle",
      body: "Add a translation target between Start and End, then drag it until the preview clears the obstacle. Delete or ⌘Z removes any extra point.",
      why: "A translation target sets where the robot goes without fixing its heading. Select is the tool for moving and deleting points.",
      keys: ["Delete", "⌘Z"],
      target: "tool-translation",
      visible: ["path-canvas", "simulation-transport"],
      interact: [...elementExploration, "tool-translation"],
      showMe: ["tool-translation", "lesson-structure"],
      markers: fundamentalsMarkers,
      prepare: { ...properties(0), simulation: "start" },
      phase: "Build",
      checks: [
        {
          label: "Translation target added",
          check: outcome((path) =>
            feedback(
              path.path_elements.some(isTranslationTarget),
              "Choose Translation, then click the line between Start and End.",
              "",
            ),
          ),
        },
        {
          label: "Bumpers clear the obstacle",
          check: outcome((path) =>
            feedback(
              path.path_elements.some(isTranslationTarget) &&
                clearance(path, currentConfig(), true),
              "Drag the translation target farther from the obstacle.",
              "",
            ),
          ),
        },
      ],
    },
    {
      title: "Try more route points",
      body: "Add two or three more points around the obstacle and press Play. Use Select to move points; Delete or ⌘Z removes extras.",
      why: "Use waypoints only where the heading matters. Simpler paths are easier to tune.",
      keys: ["Delete", "⌘Z"],
      target: "path-canvas",
      visible: ["tool-rail", "simulation-transport"],
      interact: routeExploration,
      markers: fundamentalsMarkers,
      prepare: { ...properties(bend), simulation: "start" },
      phase: "Experiment",
    },
    {
      title: "Read the drive order",
      body: "The robot visits elements in the order Elements lists them. Drag a row to reorder it, then press Play to see the change.",
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
  recap: [
    "The handoff radius sets when the robot switches to its next target.",
    "Generate gives starting radii and speed limits; Manual values stay when you generate again.",
  ],
  practicePath: createHandoffLessonPath,
  practiceConfig,
  markers: fundamentalsMarkers,
  steps: [
    {
      title: "Approach the translation",
      body: "Watch the robot drive toward the translation target.",
      target: "path-canvas",
      canvasLesson: "handoff-approach",
      autoGenerate: false,
      prepare: { inspector: "closed", simulation: "start", autoPlay: true },
    },
    {
      title: "Cross the handoff radius",
      body: "When the robot’s center enters the handoff radius, BLine switches to the next target. The purple flash marks that moment.",
      target: "path-canvas",
      canvasLesson: "handoff-crossing",
      autoGenerate: false,
      prepare: { inspector: "closed", autoPlay: true },
    },
    {
      title: "Target the next element",
      body: "The robot now heads for End. A larger radius switches sooner, so the turn starts earlier.",
      target: "path-canvas",
      canvasLesson: "handoff-departure",
      autoGenerate: false,
      prepare: { inspector: "closed", autoPlay: true },
    },
    {
      title: "Lower acceleration makes a wider turn",
      body: "Here acceleration drops from 3 to 0.6 m/s². The robot can’t change direction as quickly, so it swings wider.",
      why: "At the same speed, higher acceleration lets the robot turn more tightly.",
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
      body: "This route goes around the obstacle. Its points are locked so you can focus on handoff radii and speed limits. Generate hasn’t run yet.",
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
      task: "Open Constraints",
      body: "Constraints set how fast the robot moves and accelerates along each part of the path.",
      target: "inspector-constraints",
      interact: ["inspector-constraints"],
      prepare: {
        inspector: "open",
        inspectorTab: "elements",
        clearSelection: true,
      },
      check: openControl(
        '[data-tour="inspector-constraints"][aria-selected="true"]',
        "Click Constraints.",
      ),
    }),
    tuningStep({
      title: "Find a speed limit",
      task: "Click the speed limit for the drive into Intermediate",
      body: "Speed limits are the m/s cells, one per stretch, top to bottom in drive order.",
      target: "max-velocity-card",
      visible: ["path-canvas"],
      interact: ["max-velocity-card"],
      prepare: { ...constraints(), clearSelection: true },
      // The stretch from the top corner down to Intermediate.
      segment: () => [1, 2],
      showMe: [{ target: "lesson-speed-3", echo: "lesson-segment" }],
      check: () => {
        const selection = selectionStore.getState();
        const selected = selection.selectedRangedConstraint;
        const speed = selected?.key === "max_velocity_meters_per_sec";
        return feedback(
          speed && selected.startOrdinal <= 3 && selected.endOrdinal >= 3,
          speed && selected.endOrdinal < 2
            ? "The first one is the drive to Start, before this path begins. Pick the one that ends at Intermediate."
            : speed
              ? "That one covers the green stretch. Pick the one that ends at Intermediate."
              : selection.selectedElementIndex !== null
                ? "That’s a handoff radius (m). Speed limits are the m/s cells."
                : "",
          "The green stretch is where this limit applies.",
        );
      },
    }),
    tuningStep({
      title: "The first slot",
      body: "The first velocity and radius cells cover the approach to Start. This preview begins at Start, so it skips that part.",
      target: "max-velocity-card",
      visible: ["path-canvas"],
      prepare: constraints(1),
    }),
    tuningStep({
      title: "Generate starting values",
      task: "Click Generate",
      body: "Generate suggests handoff radii and speed limits from your robot’s settings. Treat them as starting values to test on the robot.",
      target: "max-velocity-card",
      interact: ["max-velocity-card"],
      prepare: constraints(),
      check: outcome((path) =>
        feedback(
          generationCount() > baselineGeneration &&
            checkPlan(path, currentConfig()).complete,
          "Click Generate.",
          "Generated radii and speed limits are ready.",
        ),
      ),
    }),
    tuningStep({
      title: "Play the generated path",
      task: "Play the generated path",
      body: "Watch how the robot rounds each turn. Pause or scrub to look closer.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      prepare: { simulation: "start" },
      check: action(
        "play",
        "Press Play.",
        "Continue when you’re ready to tune.",
      ),
    }),
    tuningStep({
      title: "Make a radius Manual",
      task: "Set a translation radius to Manual",
      body: "Select a translation target’s radius chip, choose Manual, and change the value to hand off earlier or later.",
      why: "Generate replaces Auto values but keeps Manual ones, so your tuning survives the next Generate.",
      target: "max-velocity-card",
      visible: ["path-canvas", "simulation-transport"],
      interact: constraintExploration,
      prepare: { ...constraints(), selectElement: bend },
      check: outcome((path) =>
        feedback(
          path.path_elements.some(
            (element) =>
              isTranslationTarget(element) &&
              element.handoff_radius_source === "manual" &&
              element.intermediate_handoff_radius_meters !== null,
          ),
          "Select a translation radius chip and choose Manual.",
          "This radius keeps your value when you generate.",
        ),
      ),
    }),
    tuningStep({
      title: "Make a velocity Manual",
      task: "Set a velocity cell to Manual",
      body: "Select a velocity cell, choose Manual, and change its limit. Generate keeps manual values.",
      target: "max-velocity-card",
      visible: ["path-canvas", "simulation-transport"],
      interact: constraintExploration,
      prepare: constraints(4),
      check: outcome((path) =>
        feedback(
          path.ranged_constraints.some(
            (constraint) =>
              constraint.key === "max_velocity_meters_per_sec" &&
              constraint.source !== "auto_velocity" &&
              constraint.value > 0,
          ),
          "Select a velocity cell and choose Manual.",
          "This limit keeps your value when you generate.",
        ),
      ),
    }),
    tuningStep({
      title: "Explore radii and velocities",
      body: "Try other radii and speed limits and play the path after each change. Generate again whenever you like.",
      target: "max-velocity-card",
      visible: ["path-canvas", "simulation-transport"],
      interact: constraintExploration,
      prepare: constraints(),
      phase: "Experiment",
    }),
  ],
};

const rotationChanged = (path: PathModel) => {
  const target = path.path_elements.find(isRotationTarget);
  const before = baselinePath?.path_elements.find(isRotationTarget);
  return (
    !!target &&
    !!before &&
    Math.abs(target.rotation_radians - before.rotation_radians) > 0.01
  );
};
export const rotationTargetsTour: TourDefinition = {
  id: "rotation-targets",
  title: "Rotation targets",
  summary: "Set headings and see how speed affects turning",
  durationMinutes: 4,
  recap: [
    "A rotation target sets the robot’s heading partway along a segment.",
    "Profiled Rotation spreads a turn along the path; driving slower gives a turn more time.",
  ],
  practicePath: createRotationLessonPath,
  practiceConfig,
  steps: [
    {
      title: "Add a rotation target",
      task: "Place a rotation target between Start and End",
      body: "A rotation target sets the robot’s heading partway along a segment. Choose Rotation, then click the segment.",
      why: "Heading, also called rotation, is the direction the robot faces. This path has a 2 m/s speed limit.",
      target: "tool-rotation",
      visible: ["path-canvas"],
      interact: [...elementExploration, "tool-rotation"],
      autoGenerate: false,
      prepare: { ...properties(0), simulation: "start" },
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
      task: "Move the rotation target",
      body: "Drag it along the path or change Rotation Pos: 0 is the start of the segment and 1 is its end.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      autoGenerate: false,
      prepare: properties(rotation),
      check: outcome((path) => {
        const target = path.path_elements.find(isRotationTarget);
        const before = baselinePath?.path_elements.find(isRotationTarget);
        return feedback(
          !!target &&
            !!before &&
            Math.abs(target.t_ratio - before.t_ratio) > 0.01,
          "Drag the rotation target or edit Rotation Pos.",
          "Keep exploring or Continue.",
        );
      }),
    },
    {
      title: "Try a heading in motion",
      task: "Change the heading, then press Play",
      body: "Drag the rotation handle or type an angle in degrees, then watch the robot turn.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      autoGenerate: false,
      prepare: properties(rotation),
      checks: [
        {
          label: "Heading changed",
          check: outcome((path) =>
            feedback(
              rotationChanged(path),
              "Drag the rotation handle or type a new angle.",
              "",
            ),
          ),
        },
        played,
      ],
    },
    {
      title: "Try Profiled Rotation",
      task: "Turn Profiled Rotation off, then press Play",
      body: "Profiled Rotation spreads the turn along the path. Turned off, the robot turns toward the new heading as fast as its limits allow.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      autoGenerate: false,
      prepare: properties(rotation),
      checks: [
        {
          label: "Profiled Rotation off",
          check: outcome((path) =>
            feedback(
              path.path_elements.some(
                (element) =>
                  isRotationTarget(element) && !element.profiled_rotation,
              ),
              "Turn the Profiled Rotation switch off.",
              "",
            ),
          ),
        },
        played,
      ],
    },
    {
      title: "When translation is too fast",
      task: "Play the fast rotation example",
      body: "This path asks for 0°, then 180°, then 0° at speed. Watch the middle target: the robot may pass it before it finishes turning.",
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
      check: action(
        "play",
        "Press Play and watch the heading at the middle target.",
        "The turn needs more time than this approach allows.",
      ),
    },
    {
      title: "Give the turn enough time",
      body: "The rotation warning flags turns that need more time. Lower the manual speed limit and play again; a slower drive gives the robot time to turn.",
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
  eventKeys: ["startIntake", "stopIntake"],
  recap: [
    "An event trigger sits at a position along a segment, from 0 to 1.",
    "When the robot crosses it, BLine sends its Lib Key to your robot code.",
  ],
  practicePath: createEventLessonPath,
  practiceConfig,
  steps: [
    {
      title: "Slide an event trigger",
      task: "Move `startIntake`",
      body: "Drag `startIntake` along the path or change Event Pos: 0 is the start of its segment and 1 is the end.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      prepare: properties(event),
      check: outcome((path) => {
        const target = path.path_elements.find(isEventTrigger);
        const before = baselinePath?.path_elements.find(isEventTrigger);
        return feedback(
          !!target &&
            !!before &&
            Math.abs(target.t_ratio - before.t_ratio) > 0.01,
          "Drag `startIntake` or change Event Pos.",
          "The event now fires at its new position.",
        );
      }),
    },
    {
      title: "Watch the event fire",
      task: "Play the path through to End",
      body: "When the robot crosses an event, BLine sends its key to your robot code, which decides what to do. Watch for the purple flash.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      prepare: { simulation: "start", inspector: "closed" },
      check: action(
        "finishRun",
        "Play the path until the robot reaches End.",
        "The key fired as the robot crossed the event.",
      ),
    },
    {
      title: "Add an event on the next stretch",
      task: "Add `stopIntake` between the translation target and End",
      why: "Event Pos runs from 0 where the stretch starts to 1 where it ends, so 0.6 fires a little past halfway. Robot code matches the Lib Key exactly, capitals included.",
      target: "tool-event",
      visible: ["path-canvas", "element-properties"],
      interact: [...elementExploration, "tool-event"],
      prepare: { ...properties(bend), simulation: "start" },
      segment: secondSegment,
      element: (path) => secondSegmentEventIndex(path),
      checks: [
        {
          label: "Place an event there",
          showMe: [
            {
              target: "tool-event",
              done: () =>
                shown('[data-tour="tool-event"][aria-pressed="true"]'),
            },
            "lesson-segment",
          ],
          check: outcome((path) =>
            feedback(
              secondSegmentEvents(path).length > 0,
              path.path_elements.filter(isEventTrigger).length >
                (baselinePath?.path_elements.filter(isEventTrigger).length ?? 0)
                ? "That one is before the translation target. Undo it (⌘Z or Ctrl+Z) and click past the target."
                : "",
              "",
            ),
          ),
        },
        {
          label: "Lib Key `stopIntake`",
          showMe: [selectSecondSegmentEvent, "lesson-lib-key"],
          check: outcome((path) => {
            const keys = secondSegmentEvents(path)
              .map((event) => event.lib_key.trim())
              .filter(Boolean);
            const wrong = keys.find((key) => key !== "stopIntake");
            return withEventKeyCaseHint(
              feedback(
                keys.includes("stopIntake"),
                wrong
                  ? `This one says “${wrong}”. Click \`stopIntake\` to fix it.`
                  : "",
                "",
              ),
              keys,
              ["stopIntake"],
            );
          }),
        },
        {
          label: "Event Pos 0.6",
          showMe: [selectSecondSegmentEvent, "lesson-event-pos"],
          check: outcome((path) => {
            const ratio = secondSegmentEvents(path).at(-1)?.t_ratio;
            return feedback(
              secondSegmentEvents(path).some(
                (event) => Math.abs(event.t_ratio - 0.6) < 0.015,
              ),
              ratio === undefined
                ? ""
                : ratio <= 0 || ratio >= 1
                  ? "Event Pos runs from 0 to 1. Type 0.6."
                  : Math.abs(ratio - 0.6) < 0.15
                    ? `Close: it’s ${ratio.toFixed(2)}. Type exactly 0.6.`
                    : "",
              "",
            );
          }),
        },
      ],
    },
    {
      title: "Try both events",
      body: "Play the path to see both events fire. Move them to change when they happen.",
      target: "simulation-transport",
      visible: ["path-canvas", "element-properties"],
      interact: [...elementExploration, "tool-event"],
      prepare: { simulation: "start", tool: "select" },
      phase: "Experiment",
    },
  ],
};

export interface TourSection {
  id: "core" | "settings" | "advanced";
  title: string;
  lessons: readonly TourDefinition[];
}
/** The lesson list, in recommended order. */
export const tourSections: readonly TourSection[] = [
  {
    id: "core",
    title: "Core",
    lessons: [
      gettingStartedTour,
      fundamentalsTour,
      eventTriggersTour,
      importExportTour,
    ],
  },
  { id: "settings", title: "Settings", lessons: settingsTours },
  {
    id: "advanced",
    title: "Advanced",
    lessons: [pathTuningTour, rotationTargetsTour, ...advancedTours],
  },
];
export const tours: readonly TourDefinition[] = tourSections.flatMap(
  (section) => section.lessons,
);
export function findTour(tourId: string | null) {
  return tours.find((tour) => tour.id === tourId) ?? null;
}

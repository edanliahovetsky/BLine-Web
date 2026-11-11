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
import {
  checkPlan,
  eventPosHint,
  feedback,
  withEventKeyCaseHint,
  wrongStretchHint,
} from "./tourChecks";
import { settingsTours } from "./robotSettingsLesson";
import { advancedTours, importExportTour } from "./supplementalLessons";
import {
  createManagementPaths,
  createManagementGroups,
  createManagementTargets,
} from "./supplementalScenarios";
import { observedTourCondition } from "./tourInteraction";
import { constraintCell, radiusCell, showProperties } from "./tourShowMe";
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
export const tourPracticePathName = "Lesson practice";
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
const secondSegmentEventIndex = (path: PathModel | null): number | null => {
  const segment = path ? secondSegment(path) : null;
  if (!path || !segment) return null;
  for (let index = segment[1] - 1; index > segment[0]; index -= 1)
    if (isEventTrigger(path.path_elements[index])) return index;
  return null;
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
// The sidebar opens on Elements, which counts once the learner can see it.
const elementsOpened = observedTourCondition(
  () =>
    shown('[data-tour="inspector-toggle"][aria-expanded="true"]') &&
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
/** A near miss for building steps: Start or End was deleted along the way. */
const lostWaypointHint = () =>
  (currentPath()?.path_elements.filter(isWaypoint).length ?? 2) < 2
    ? "That removed Start or End. Press ⌘Z or Ctrl+Z, or choose Restart lesson in the ⋯ menu."
    : "";
const played = {
  label: "Played it",
  showMe: ["transport-play"],
  check: action("play", "", ""),
};
/** Show me's stop for a canvas tool, skipped once that tool is chosen. */
const chooseTool = (tool: string) => ({
  target: `tool-${tool}`,
  done: () => shown(`[data-tour="tool-${tool}"][aria-pressed="true"]`),
});
const stopIntakePosHint = eventPosHint();
const indexOrNull = (index: number) => (index >= 0 ? index : null);

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
      body: "The canvas shows your path. Build it with the tool bar on the left, and preview it with the play bar below.",
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
      task: "Open the sidebar, then click both tabs",
      body: "Elements lists your path’s points in drive order. Constraints holds speed limits.",
      target: "inspector-toggle",
      visible: ["inspector-panel"],
      interact: [
        "inspector-toggle",
        "inspector-elements",
        "inspector-constraints",
      ],
      prepare: { inspector: "closed", inspectorTab: "elements" },
      checks: [
        {
          label: "Sidebar open",
          showMe: ["inspector-toggle"],
          check: () => feedback(sidebarOpen(), "", ""),
        },
        {
          label: "Elements tab",
          showMe: ["inspector-elements"],
          check: () => feedback(elementsOpened(), "", ""),
        },
        {
          label: "Constraints tab",
          showMe: ["inspector-constraints"],
          check: () => feedback(constraintsAfterElements(), "", ""),
        },
      ],
    },
    {
      title: "Menus",
      task: "Open File, then Edit",
      body: "File holds projects, import, export, and Settings. Edit renames and deletes paths and groups.",
      target: "export-menu-entry",
      interact: ["export-menu-entry", "path-menu-entry"],
      prepare: { closeMenus: true, inspector: "closed" },
      checks: [
        {
          ...seen(
            "File opened",
            '[data-tour="export-menu-entry"][aria-expanded="true"]',
            "",
          ),
          showMe: ["export-menu-entry"],
        },
        {
          ...seen(
            "Edit opened",
            '[data-tour="path-menu-entry"][aria-expanded="true"]',
            "",
          ),
          showMe: ["path-menu-entry"],
        },
      ],
    },
    {
      title: "Path dropdown",
      task: "Open the path dropdown",
      body: "A project holds many paths. Pick the one to edit here.",
      target: "path-breadcrumb",
      interact: ["path-breadcrumb"],
      showMe: [{ target: "path-breadcrumb" }],
      prepare: { closeMenus: true },
      check: openControl(
        '[data-tour="path-breadcrumb"] [aria-expanded="true"]',
        "",
      ),
    },
    {
      title: "Path Groups",
      task: "Open the Project Navigator",
      body: "It lists every path and the Path Groups that organize them.",
      target: "navigator-button",
      visible: ["project-navigator", "navigator-groups"],
      interact: ["navigator-button"],
      showMe: [{ target: "navigator-button" }],
      prepare: { closeMenus: true, navigator: "closed" },
      check: openControl('[data-tour="project-navigator"]', ""),
    },
  ],
};

/** The waypoint the learner placed in a zone, if any. */
const waypointIn = (path: PathModel, zone: typeof mission.start) =>
  anchorPositions(path).findIndex((point) => near(point, zone));

export const fundamentalsTour: TourDefinition = {
  id: "bline-fundamentals",
  title: "BLine Fundamentals",
  summary: "Build a path with waypoints and translation targets",
  durationMinutes: 5,
  recap: [
    "Waypoints set position and rotation; translation targets set position only.",
    "The robot follows the Elements order, and the preview shows whether its bumpers clear obstacles.",
  ],
  practicePath: createFundamentalsDemoPath,
  practiceConfig,
  markers: fundamentalsZones,
  steps: [
    {
      title: "See a complete path",
      task: "Press Play to watch a finished path",
      body: "Drag the play bar to look closer.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      showMe: [{ target: "transport-play" }],
      prepare: { inspector: "closed", simulation: "start", tool: "select" },
      phase: "Observe",
      check: action("play", "", ""),
    },
    {
      title: "Place Start and End",
      task: "Place waypoints in Start and End",
      body: "Placing switches back to Select, so pick Waypoint again for End.",
      why: "A waypoint sets where the robot is and which way it faces. Every path starts and ends with one.",
      target: "tool-waypoint",
      visible: ["path-canvas"],
      interact: ["tool-waypoint", "path-canvas", "element-properties"],
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
          showMe: [chooseTool("waypoint"), "lesson-start-zone"],
          check: outcome((path) =>
            feedback(
              path.path_elements.length > 0 &&
                isWaypoint(path.path_elements[0]) &&
                near(anchorPositions(path)[0], mission.start),
              path.path_elements.length && waypointIn(path, mission.start) < 0
                ? "Drag the first waypoint into the Start zone."
                : "",
              "",
            ),
          ),
        },
        {
          label: "Waypoint in End",
          showMe: [chooseTool("waypoint"), "lesson-goal-zone"],
          check: outcome((path) => {
            const count = path.path_elements.filter(isWaypoint).length;
            return feedback(
              count === 2 &&
                near(anchorPositions(path).at(-1), mission.delivery),
              count > 2
                ? "That’s an extra waypoint. Press ⌘Z or Ctrl+Z to undo it."
                : count === 2
                  ? "Drag the second waypoint into the End zone."
                  : "",
              "",
            );
          }),
        },
      ],
    },
    {
      title: "Turn a waypoint",
      task: "Change End’s rotation, then press Play",
      body: "Rotation is the way the robot faces. Type degrees, or drag the box’s front dot.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      prepare: properties(endpoint),
      element: endpoint,
      checks: [
        {
          label: "Rotation changed",
          showMe: [
            ...showProperties(endpoint),
            { target: "label:Rotation (deg)", echo: "lesson-element" },
          ],
          check: outcome((path) => feedback(headingChanged(path), "", "")),
        },
        played,
      ],
    },
    {
      title: "Fix a mistake",
      task: "Add an extra point, then remove it",
      body: "Select it and press Delete, or press ⌘Z.",
      why: "Placing returns you to Select, so a stray click won’t add more points. Undo (⌘Z or Ctrl+Z) reverses any edit, including a deletion.",
      target: "tool-translation",
      visible: ["path-canvas", "simulation-transport"],
      interact: [...elementExploration, "tool-translation"],
      keys: ["Delete", "⌘Z", "Ctrl+Z"],
      prepare: { ...properties(0), simulation: "start" },
      segment: (path) => [0, lastAnchor(path)],
      element: (path) =>
        indexOrNull(path.path_elements.findIndex(isTranslationTarget)),
      phase: "Build",
      checks: [
        {
          label: "Extra point added",
          showMe: [chooseTool("translation"), "lesson-segment"],
          check: () =>
            feedback(
              extraPointAdded(),
              extraPointAdded() ? "" : lostWaypointHint(),
              "",
            ),
        },
        {
          label: "Extra point removed",
          showMe: ["lesson-element"],
          check: () => feedback(extraPointRemoved(), "", ""),
        },
      ],
    },
    {
      title: "Route around the obstacle",
      task: "Route the robot around the obstacle",
      body: "Add a translation target and drag it until the robot’s box clears.",
      why: "The box drawn around the robot is its bumpers. A translation target sets where the robot goes, not which way it faces. Delete or ⌘Z removes any extra point.",
      keys: ["Delete", "⌘Z"],
      target: "tool-translation",
      visible: ["path-canvas", "simulation-transport"],
      interact: [...elementExploration, "tool-translation"],
      markers: fundamentalsMarkers,
      prepare: { ...properties(0), simulation: "start" },
      segment: (path) => [0, lastAnchor(path)],
      element: (path) =>
        indexOrNull(path.path_elements.findIndex(isTranslationTarget)),
      phase: "Build",
      checks: [
        {
          label: "Translation target added",
          showMe: [chooseTool("translation"), "lesson-segment"],
          check: outcome((path) =>
            feedback(
              path.path_elements.some(isTranslationTarget),
              lostWaypointHint(),
              "",
            ),
          ),
        },
        {
          label: "Robot clears the obstacle",
          showMe: [{ target: "lesson-element", echo: "lesson-structure" }],
          check: outcome((path) =>
            feedback(
              path.path_elements.some(isTranslationTarget) &&
                clearance(path, currentConfig(), true),
              path.path_elements.some(isTranslationTarget)
                ? "Drag the translation target farther from the obstacle."
                : "",
              "",
            ),
          ),
        },
      ],
    },
    {
      title: "Try more route points",
      body: "The robot visits points in the order Elements lists them. Add points, drag rows to reorder, and press Play.",
      why: "Use waypoints only where rotation matters. Simpler paths are easier to tune.",
      keys: ["Delete", "⌘Z"],
      target: "inspector-panel",
      visible: ["path-canvas", "simulation-transport"],
      interact: routeExploration,
      markers: fundamentalsMarkers,
      prepare: { ...properties(bend), simulation: "start" },
      phase: "Experiment",
    },
  ],
};

const tuningStep = (step: TourStep): TourStep => ({
  ...step,
  markers: tuningMarkers,
  lockGeometry: true,
  autoGenerate: false,
});
/** Show me's stop for a constraint cell, skipped once its editor is open. */
/** Manual speed limits, and whether any has a value of the learner’s own. */
function manualSpeeds(path: PathModel) {
  const manual = path.ranged_constraints.filter(
    (constraint) =>
      constraint.key === "max_velocity_meters_per_sec" &&
      constraint.source !== "auto_velocity" &&
      constraint.value > 0,
  );
  const before = baselinePath?.ranged_constraints ?? [];
  const changed = manual.some(
    (constraint) =>
      !before.some(
        (old) =>
          old.key === constraint.key &&
          old.start_ordinal <= constraint.start_ordinal &&
          old.end_ordinal >= constraint.end_ordinal &&
          Math.abs(old.value - constraint.value) < 1e-6,
      ),
  );
  return { manual: manual.length > 0, changed };
}
const speedFourManual = () => {
  const path = currentPath();
  return !!path && manualSpeeds(path).manual;
};
export const pathTuningTour: TourDefinition = {
  id: "path-tuning",
  title: "Path Tuning",
  summary: "See target handoffs, then tune radii and speed limits",
  durationMinutes: 6,
  recap: [
    "The handoff radius sets when the robot moves on to its next point.",
    "Generate gives starting radii and speed limits; Manual values stay when you generate again.",
  ],
  practicePath: createHandoffLessonPath,
  practiceConfig,
  markers: fundamentalsMarkers,
  steps: [
    {
      title: "Approach the translation target",
      body: "Watch the robot drive toward the bend, a translation target.",
      target: "path-canvas",
      canvasLesson: "handoff-approach",
      autoGenerate: false,
      prepare: { inspector: "closed", simulation: "start", autoPlay: true },
    },
    {
      title: "Cross the handoff radius",
      body: "The circle around the point is its handoff radius. When the robot’s center enters it, the robot moves on to the next point.",
      why: "The purple flash marks the moment of handoff. The robot never stops at the point itself.",
      target: "path-canvas",
      canvasLesson: "handoff-crossing",
      autoGenerate: false,
      prepare: { inspector: "closed", autoPlay: true },
    },
    {
      title: "Target the next element",
      body: "Now it heads for End. A bigger radius hands off sooner, so the turn starts earlier.",
      target: "path-canvas",
      canvasLesson: "handoff-departure",
      autoGenerate: false,
      prepare: { inspector: "closed", autoPlay: true },
    },
    {
      title: "Lower acceleration makes a wider turn",
      body: "Here acceleration drops from 3 to 0.6 m/s². The robot can’t change direction as fast, so it swings wider.",
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
      title: "Open Constraints",
      task: "Open Constraints",
      body: "This new route’s points are locked, so you can focus on speed limits and handoff radii.",
      target: "inspector-constraints",
      interact: ["inspector-constraints"],
      showMe: [{ target: "inspector-constraints" }],
      prepare: {
        practicePath: createTuningRectanglePath,
        inspector: "open",
        inspectorTab: "elements",
        simulation: "start",
        clearSelection: true,
      },
      check: openControl(
        '[data-tour="inspector-constraints"][aria-selected="true"]',
        "",
      ),
    }),
    tuningStep({
      title: "Find a speed limit",
      task: "Click the speed limit for the drive into Intermediate",
      body: "The m/s cells are speed limits: first the drive to Start, then one per stretch.",
      why: "The drive to Start comes before this preview begins, so the canvas doesn’t draw it.",
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
      title: "Generate starting values",
      task: "Click Generate",
      body: "Generate fills in speed limits and handoff radii from your robot’s settings.",
      why: "Treat them as starting values to test on the robot.",
      target: "max-velocity-card",
      interact: ["max-velocity-card"],
      showMe: [{ target: "text:Generate" }],
      prepare: constraints(),
      check: outcome((path) =>
        feedback(
          generationCount() > baselineGeneration &&
            checkPlan(path, currentConfig()).complete,
          "",
          "Starting values are ready.",
        ),
      ),
    }),
    tuningStep({
      title: "Play the generated path",
      task: "Play the generated path",
      body: "Watch how the robot rounds each corner.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      showMe: [{ target: "transport-play" }],
      prepare: { simulation: "start" },
      check: action("play", "", ""),
    }),
    tuningStep({
      title: "Make a radius Manual",
      task: "Make Intermediate’s handoff radius Manual",
      body: "Generate replaces Auto values but keeps Manual ones, so your tuning survives.",
      why: "A bigger radius hands off sooner and cuts the corner more.",
      target: "max-velocity-card",
      visible: ["path-canvas", "simulation-transport"],
      interact: constraintExploration,
      prepare: { ...constraints(), selectElement: bend },
      element: () => 2,
      showMe: [
        radiusCell(2, "lesson-element"),
        {
          target: "label:Handoff distance source",
          done: () =>
            currentPath()?.path_elements[2]?.type === "translation" &&
            (
              currentPath()?.path_elements[2] as {
                handoff_radius_source?: string;
              }
            ).handoff_radius_source === "manual",
        },
        "label:Handoff distance 3 (m)",
      ],
      check: outcome((path) => {
        const manual = path.path_elements.map(
          (element) =>
            isTranslationTarget(element) &&
            element.handoff_radius_source === "manual" &&
            element.intermediate_handoff_radius_meters !== null,
        );
        return feedback(
          manual[2],
          manual.some(Boolean)
            ? "That’s another point’s radius. Set it back to Auto, then pick Intermediate’s: the third m cell."
            : "",
          "This radius keeps your value when you generate.",
        );
      }),
    }),
    tuningStep({
      title: "Make a speed limit Manual",
      task: "Make a speed limit Manual",
      body: "Pick an m/s cell, choose Manual, and change its value.",
      target: "max-velocity-card",
      visible: ["path-canvas", "simulation-transport"],
      interact: constraintExploration,
      prepare: constraints(4),
      showMe: [
        constraintCell("max_velocity_meters_per_sec", 4, "lesson-speed-4"),
        { target: "label:Velocity constraint mode", done: speedFourManual },
        "label:Constraint * value",
      ],
      check: outcome((path) => {
        const { manual, changed } = manualSpeeds(path);
        return feedback(
          changed,
          manual ? "It’s Manual. Now change its value." : "",
          "This limit keeps your value when you generate.",
        );
      }),
    }),
    tuningStep({
      title: "Explore radii and speed limits",
      body: "Try other radii and speed limits, and play the path after each change. Generate again whenever you like.",
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
  summary: "Turn the robot partway along a path and see how speed affects it",
  durationMinutes: 4,
  recap: [
    "A rotation target sets which way the robot faces partway along a stretch.",
    "Profiled Rotation spreads a turn along the path; driving slower gives a turn more time.",
  ],
  practicePath: createRotationLessonPath,
  practiceConfig,
  steps: [
    {
      title: "Add a rotation target",
      task: "Place a rotation target between Start and End",
      body: "A rotation target turns the robot partway along a stretch.",
      why: "Rotation is the way the robot faces. This path has a 2 m/s speed limit.",
      target: "tool-rotation",
      visible: ["path-canvas"],
      interact: [...elementExploration, "tool-rotation"],
      autoGenerate: false,
      prepare: { ...properties(0), simulation: "start" },
      segment: (path) => [0, lastAnchor(path)],
      showMe: [chooseTool("rotation"), "lesson-segment"],
      check: outcome((path) =>
        feedback(path.path_elements.some(isRotationTarget), "", ""),
      ),
    },
    {
      title: "Move the rotation target",
      task: "Slide the rotation target along the path",
      body: "Rotation Pos works like Event Pos: 0 where the stretch starts, 1 where it ends.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      autoGenerate: false,
      prepare: properties(rotation),
      element: (path) => indexOrNull(rotation(path)),
      showMe: [{ target: "lesson-element", echo: "label:Rotation Pos (0-1)" }],
      check: outcome((path) => {
        const target = path.path_elements.find(isRotationTarget);
        const before = baselinePath?.path_elements.find(isRotationTarget);
        return feedback(
          !!target &&
            !!before &&
            Math.abs(target.t_ratio - before.t_ratio) > 0.01,
          "",
          "",
        );
      }),
    },
    {
      title: "Try a rotation in motion",
      task: "Change its rotation, then press Play",
      body: "Type degrees in Rotation (deg), or drag the dot on its front edge.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      autoGenerate: false,
      prepare: properties(rotation),
      element: (path) => indexOrNull(rotation(path)),
      checks: [
        {
          label: "Rotation changed",
          showMe: [
            ...showProperties((path) => indexOrNull(rotation(path))),
            { target: "label:Rotation (deg)", echo: "lesson-element" },
          ],
          check: outcome((path) => feedback(rotationChanged(path), "", "")),
        },
        played,
      ],
    },
    {
      title: "Try Profiled Rotation",
      task: "Turn Profiled Rotation off, then press Play",
      element: (path) => indexOrNull(rotation(path)),
      body: "On: the turn spreads along the path. Off: a full-speed turn.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      autoGenerate: false,
      prepare: properties(rotation),
      checks: [
        {
          label: "Profiled Rotation off",
          showMe: [
            ...showProperties((path) => indexOrNull(rotation(path))),
            "label:Profiled Rotation",
          ],
          check: outcome((path) =>
            feedback(
              path.path_elements.some(
                (element) =>
                  isRotationTarget(element) && !element.profiled_rotation,
              ),
              "",
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
      body: "This path asks for 0°, then 180°, then 0° at speed. Watch the middle target.",
      target: "transport-play",
      visible: ["path-canvas", "path-health"],
      interact: [...playback, "path-health", "lesson-health-dialog"],
      autoGenerate: false,
      showMe: [{ target: "transport-play" }],
      prepare: {
        practicePath: createFastRotationPath,
        inspector: "open",
        inspectorTab: "elements",
        selectElement: rotation,
        simulation: "start",
      },
      check: action(
        "play",
        "",
        "The robot passed the middle target before it finished turning.",
      ),
    },
    {
      title: "Give the turn enough time",
      body: "The yellow ! badge at bottom right flags turns that need more time. Lower the speed limit to 1 m/s and play again.",
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
  summary: "Move an event and add another on the next stretch",
  durationMinutes: 3,
  eventKeys: ["startIntake", "stopIntake"],
  recap: [
    "An event trigger sits partway along a stretch of path, from 0 at its start to 1 at its end.",
    "When the robot crosses it, BLine sends its Lib Key to your robot code.",
  ],
  practicePath: createEventLessonPath,
  practiceConfig,
  steps: [
    {
      title: "Slide an event trigger",
      task: "Slide `startIntake` along the path",
      body: "An event trigger tells your robot code when to act. Event Pos: 0 at one point, 1 at the next.",
      target: "element-properties",
      visible: ["path-canvas", "simulation-transport"],
      interact: elementExploration,
      prepare: properties(event),
      element: (path) => indexOrNull(event(path)),
      showMe: [{ target: "lesson-element", echo: "lesson-event-pos" }],
      check: outcome((path) => {
        const target = path.path_elements.find(isEventTrigger);
        const before = baselinePath?.path_elements.find(isEventTrigger);
        return feedback(
          !!target &&
            !!before &&
            Math.abs(target.t_ratio - before.t_ratio) > 0.01,
          "",
          "It now fires at the new spot.",
        );
      }),
    },
    {
      title: "Watch the event fire",
      task: "Play the path to End",
      body: "When the robot crosses the event, it flashes purple: BLine sends its key to your robot code.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      showMe: [{ target: "transport-play" }],
      prepare: { simulation: "start", inspector: "closed" },
      check: () =>
        feedback(
          acted("finishRun"),
          // Paused partway: the key fires only when the robot gets there.
          acted("play") &&
            shown('[data-tour="transport-play"][aria-label="Play simulation"]')
            ? "Let it run all the way to End."
            : "",
          "The purple flash was the key firing.",
        ),
    },
    {
      title: "Add an event on the next stretch",
      task: "Add `stopIntake` between the translation target and End",
      why: "Event Pos runs from 0 where the stretch starts to 1 where it ends, so 0.6 fires a little past halfway. Robot code matches the Lib Key exactly, capitals included.",
      target: "tool-event",
      visible: ["path-canvas", "element-properties"],
      interact: [...elementExploration, "tool-event"],
      // The sidebar opens once the event is placed; closed, it can’t cover
      // the canvas in a narrow window.
      prepare: {
        inspector: "closed",
        inspectorTab: "elements",
        tool: "select",
        simulation: "start",
      },
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
                ? wrongStretchHint("the translation target and End")
                : "",
              "",
            ),
          ),
        },
        {
          label: "Lib Key `stopIntake`",
          showMe: [
            ...showProperties(secondSegmentEventIndex),
            "lesson-lib-key",
          ],
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
          showMe: [
            ...showProperties(secondSegmentEventIndex),
            "lesson-event-pos",
          ],
          check: outcome((path) =>
            feedback(
              secondSegmentEvents(path).some(
                (event) => Math.abs(event.t_ratio - 0.6) < 0.015,
              ),
              stopIntakePosHint(
                secondSegmentEventIndex(path) ?? undefined,
                secondSegmentEvents(path).at(-1)?.t_ratio,
                0.6,
              ),
              "",
            ),
          ),
        },
      ],
    },
    {
      title: "Try both events",
      body: "Play the path to see both events fire. Drag either one to change when it fires.",
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

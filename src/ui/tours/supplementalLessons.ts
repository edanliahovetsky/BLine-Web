import { getPathElementLinkedTargetId } from "../../core/linkedTargets";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  isWaypoint,
  type PathModel,
} from "../../core/model/path";
import type { LinkedTarget, ProjectPathGroup } from "../../core/model/project";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import { feedback, firstSeen } from "./tourChecks";
import { createImportExportTour } from "./importExportLesson";
import { offlineTour } from "./offlineLesson";
import { practiceConfig } from "./tourScenario";
import {
  createLinkedElementGroups,
  createLinkedElementPaths,
  createManagementGroups,
  createManagementPaths,
  createManagementTargets,
  createPathLinkingGroups,
  createPathLinkingPaths,
  createPathLinkingTargets,
  linkingMarkers,
  managementPathIds as managementIds,
  organizationMarkers,
  scorePose,
  supplementalPathIds as ids,
} from "./supplementalScenarios";
import { tourStore, type TourDefinition, type TourStep } from "./tourStore";
import { observedTourCondition } from "./tourInteraction";
import { constraintCell, radiusCell, showProperties } from "./tourShowMe";

interface SupplementalTour extends TourDefinition {
  practiceGroups?(): ProjectPathGroup[];
  practiceLinkedTargets?(): LinkedTarget[];
}

const navigation = ["navigator-button", "project-navigator"];
const transport = ["simulation-transport", "transport-timeline"];
const linkedEditing = [
  "path-canvas",
  "path-breadcrumb",
  "inspector-panel",
  "element-properties",
  "linked-elements-dialog",
];
const constraints = [
  "inspector-panel",
  "inspector-constraints",
  "constraint-popout",
  "max-velocity-card",
  "path-canvas",
];
const project = () => projectStore.getState().project;
const pathById = (id: string) =>
  project()?.paths.find((path) => path.path_id === id);
const activePathIs = (id: string) =>
  projectStore.getState().activePathId === id;
const present = (selector: string) =>
  typeof document !== "undefined" && !!document.querySelector(selector);
const navigatorOpen = () => present('[data-tour="project-navigator"]');
const groupNamed = (name: string) =>
  project()?.path_groups.find(
    (group) => group.display_name.trim().toLowerCase() === name.toLowerCase(),
  );
const hasAction = (action: string) =>
  Number(
    (tourStore.getState().actions as Record<string, number>)[action] ?? 0,
  ) > 0;

function previewing(groupId: string) {
  return projectStore.getState().activePathGroupId === groupId;
}

function scoreTarget() {
  return project()?.linked_targets.find(
    (target) =>
      target.kind === "waypoint" &&
      target.display_name.trim().toLowerCase() === "score",
  );
}

function scoringElements() {
  return [
    pathById(ids.stagingScore)?.path.path_elements.at(-1),
    pathById(ids.scorePickup)?.path.path_elements[0],
  ];
}

function linkedScoreUses() {
  const target = scoreTarget();
  return (
    !!target &&
    scoringElements().every(
      (element) => getPathElementLinkedTargetId(element) === target.target_id,
    )
  );
}

function changedSharedScorePose() {
  const target = scoreTarget();
  if (!target || !linkedScoreUses()) return false;
  const heading = target.rotation_radians ?? 0;
  const moved =
    Math.hypot(
      target.x_meters - scorePose.x_meters,
      target.y_meters - scorePose.y_meters,
    ) > 0.05;
  const turned =
    Math.abs(Math.atan2(Math.sin(heading), Math.cos(heading))) > 0.05;
  return (
    moved &&
    turned &&
    scoringElements().every(
      (element) =>
        !!element &&
        isWaypoint(element) &&
        Math.abs(element.translation_target.x_meters - target.x_meters) <
          1e-6 &&
        Math.abs(element.translation_target.y_meters - target.y_meters) <
          1e-6 &&
        Math.abs(element.rotation_target.rotation_radians - heading) < 1e-6,
    )
  );
}

function lastOrdinal(path = pathById(ids.stagingPickup)?.path) {
  return (
    path?.path_elements.filter(
      (element) =>
        element.type === "waypoint" || element.type === "translation",
    ).length ?? 0
  );
}
function minimumConstraints() {
  return (
    pathById(ids.stagingPickup)?.path.ranged_constraints.filter(
      (constraint) => constraint.key === "min_velocity_meters_per_sec",
    ) ?? []
  );
}

function hasTransitionMinimum(path: PathModel | undefined) {
  if (!path) return false;
  const lastOrdinal = path.path_elements.filter(
    (element) => element.type === "waypoint" || element.type === "translation",
  ).length;
  const minimums = path.ranged_constraints.filter(
    (constraint) => constraint.key === "min_velocity_meters_per_sec",
  );
  const maximum =
    path.ranged_constraints.find(
      (constraint) =>
        constraint.key === "max_velocity_meters_per_sec" &&
        constraint.start_ordinal <= lastOrdinal &&
        constraint.end_ordinal >= lastOrdinal,
    )?.value ??
    path.constraints.max_velocity_meters_per_sec ??
    2;
  return (
    minimums.length > 0 &&
    minimums.every(
      (constraint) =>
        constraint.start_ordinal === lastOrdinal &&
        constraint.end_ordinal === lastOrdinal &&
        Math.abs(constraint.value - 1.5) < 1e-6 &&
        constraint.value < maximum,
    )
  );
}

/** Done once a Play starts while `condition` holds, during this step. */
function playedWhile(condition: () => boolean) {
  let token = "";
  let plays = 0;
  let latched = false;
  return () => {
    const state = tourStore.getState();
    const current = `${state.activeTourId}:${state.attemptId}:${state.stepIndex}`;
    const count = state.actions.play ?? 0;
    if (current !== token) {
      token = current;
      plays = count;
      latched = false;
    }
    if (count > plays) {
      if (condition()) latched = true;
      plays = count;
    }
    return latched;
  };
}

const activePath = () => pathById(projectStore.getState().activePathId ?? "");
const middleHandoffMode = () => {
  const element = activePath()?.path.path_elements[1];
  return element?.type === "translation"
    ? (element.handoff_mode ??
        project()?.config.kinematic_constraints.default_handoff_mode ??
        "radius")
    : null;
};
const playedWithProgress = playedWhile(
  () => middleHandoffMode() === "progress",
);
const switchedToRadius = observedTourCondition(
  () => playedWithProgress() && middleHandoffMode() === "radius",
);
const playedWithRadius = playedWhile(
  () => switchedToRadius() && middleHandoffMode() === "radius",
);

/** Show me's first stop: open the path dropdown, then pick `name`. */
const choosePath = (name: string) => [
  {
    target: "path-breadcrumb",
    done: () => present('[data-tour="path-breadcrumb"] [aria-expanded="true"]'),
  },
  `text:${name}`,
];
/** Show me's stop for a constraint cell, skipped once its editor is open. */

const groupFocused = (name: string) =>
  present(`[aria-label="Focus ${name}"][aria-pressed="true"]`);
const startingGroups = createManagementGroups().length;
const openedAtStart = firstSeen<string | null>();

const managementSteps: TourStep[] = [
  {
    title: "Choose a path",
    task: "Open Top - Score to Pickup",
    body: "This project has two autos and some test paths.",
    target: "path-breadcrumb",
    visible: ["path-canvas"],
    interact: ["path-breadcrumb"],
    showMe: choosePath("Top - Score to Pickup"),
    prepare: { navigator: "closed", inspector: "closed", simulation: "start" },
    check: () => feedback(activePathIs(managementIds.topScorePickup), "", ""),
  },
  {
    title: "Open the Project Navigator",
    task: "Open the Project Navigator",
    body: "It lists every path beside the canvas. Drag its right edge to resize it.",
    target: "navigator-button",
    interact: navigation,
    showMe: [{ target: "navigator-button" }],
    check: () =>
      feedback(
        navigatorOpen(),
        "",
        "Testing, Top Side Auto, and Bottom Side Auto each hold three paths.",
      ),
  },
  {
    title: "Create a Path Group",
    task: "Create a Path Group named My Auto",
    target: "navigator-groups",
    interact: navigation,
    prepare: { navigator: "open" },
    showMe: [
      {
        target: "label:Create Path Group",
        done: () => present('[aria-label="Path Group name"]'),
      },
      "label:Path Group name",
    ],
    check: () =>
      feedback(
        !!groupNamed("My Auto"),
        (project()?.path_groups.length ?? 0) > startingGroups &&
          !present('[aria-label="Path Group name"]')
          ? "Double-click the new group’s name to rename it My Auto."
          : "",
        "",
      ),
  },
  {
    title: "Connect its three paths",
    task: "Select My Auto, then click each Top path’s dot",
    why: "The dot connects a path to the selected group. A path can belong to several groups, so these paths stay in Top Side Auto too.",
    target: "navigator-paths",
    interact: navigation,
    prepare: { navigator: "open" },
    checks: (
      [
        ["Top - Start to Score", managementIds.topStartScore],
        ["Top - Score to Pickup", managementIds.topScorePickup],
        ["Top - Pickup to Score", managementIds.topPickupScore],
      ] as const
    ).map(([label, id]) => ({
      label,
      showMe: [
        {
          target: "label:Focus My Auto",
          done: () => groupFocused("My Auto"),
        },
        `label:Connect to ${label}`,
      ],
      check: () =>
        feedback(
          !!groupNamed("My Auto")?.path_ids.includes(id),
          !groupNamed("My Auto")
            ? "Create My Auto first: go Back."
            : // Clicking a path’s name opens it instead of connecting it.
              projectStore.getState().activePathId !==
                  openedAtStart("path", projectStore.getState().activePathId) &&
                !groupFocused("My Auto")
              ? "Click My Auto first, then the dots beside the paths."
              : "",
          "",
        ),
    })),
  },
  {
    title: "Preview the group",
    task: "Click My Auto to preview it",
    body: "The selected path stays bright and the rest of the group fades.",
    why: "Each path’s End is linked to the next Start, so they move together.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    showMe: [{ target: "label:Focus My Auto" }],
    prepare: { navigator: "open", showGhostPaths: true },
    check: () =>
      feedback(
        !!groupNamed("My Auto") && previewing(groupNamed("My Auto")!.group_id),
        "",
        "The three paths are visible together.",
      ),
  },
  {
    title: "Work on one path",
    task: "Open Top - Pickup to Score",
    body: "You can edit and play it while the rest of the group stays visible.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: ["path-breadcrumb", "path-canvas", ...transport],
    showMe: choosePath("Top - Pickup to Score"),
    prepare: { navigator: "closed", showGhostPaths: true },
    check: () => feedback(activePathIs(managementIds.topPickupScore), "", ""),
  },
  {
    title: "Explore your groups",
    body: "Click a path or group to preview it, and double-click a name to rename it. Your robot code decides the order paths run.",
    visible: ["path-canvas", "simulation-transport"],
    interact: [...navigation, "path-breadcrumb", "path-canvas", ...transport],
  },
];

/** What the shared Score still needs, said only once part of it is done. */
function scoreEditHint() {
  const target = scoreTarget();
  if (!target) return "";
  if (!linkedScoreUses()) return "Keep both waypoints linked to Score.";
  const moved =
    Math.hypot(
      target.x_meters - scorePose.x_meters,
      target.y_meters - scorePose.y_meters,
    ) > 0.05;
  const heading = target.rotation_radians ?? 0;
  const turned =
    Math.abs(Math.atan2(Math.sin(heading), Math.cos(heading))) > 0.05;
  return moved && !turned
    ? "Now change its rotation too."
    : turned && !moved
      ? "Now move it too."
      : "";
}
/** The waypoint linked to Score in whichever path is open. */
const scoreIndex = (path: PathModel) => {
  const id = scoreTarget()?.target_id;
  const index = path.path_elements.findIndex(
    (element) => !!id && getPathElementLinkedTargetId(element) === id,
  );
  return index >= 0 ? index : null;
};
const linkMenu = {
  target: "element-link",
  done: () =>
    present('[data-tour="element-link-menu"]') ||
    present('[data-tour="linked-elements-dialog"]'),
};

const linkedElementSteps: TourStep[] = [
  {
    title: "See where the paths meet",
    task: "Click Score and Pickup to preview the group",
    body: "Start to Score ends where Score to Pickup starts.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    showMe: [{ target: "label:Focus Score and Pickup" }],
    prepare: { navigator: "open", inspector: "closed", showGhostPaths: true },
    check: () =>
      feedback(
        previewing("lesson-score-cycle"),
        "",
        "The first path ends where the next starts.",
      ),
  },
  {
    title: "Create a linked waypoint",
    task: "Link End to a new waypoint named Score",
    body: "A linked waypoint is one shared point that several paths can use.",
    target: "element-link",
    visible: ["path-canvas"],
    interact: linkedEditing,
    showMe: [
      linkMenu,
      {
        target: "text:New Linked Waypoint",
        done: () => present('[data-tour="linked-elements-dialog"]'),
      },
      "text:Create & Link",
    ],
    prepare: {
      navigator: "closed",
      inspector: "open",
      inspectorTab: "elements",
      selectElement: (path) => path.path_elements.length - 1,
      tool: "select",
    },
    check: () =>
      feedback(
        !!scoreTarget() &&
          getPathElementLinkedTargetId(scoringElements()[0]) ===
            scoreTarget()?.target_id,
        "",
        "End now uses the shared Score.",
      ),
  },
  {
    title: "Link the next path's Start",
    task: "On Score to Pickup, link Start to Score",
    body: "Select its Start, then use Link → Choose Existing.",
    target: "path-breadcrumb",
    visible: ["element-properties", "path-canvas"],
    interact: linkedEditing,
    prepare: {
      navigator: "closed",
      inspector: "open",
      inspectorTab: "elements",
    },
    element: () => 0,
    checks: [
      {
        label: "Score to Pickup open",
        showMe: choosePath("Score to Pickup"),
        check: () => feedback(activePathIs(ids.scorePickup), "", ""),
      },
      {
        label: "Start linked to Score",
        showMe: [
          {
            target: "lesson-element",
            done: () =>
              activePathIs(ids.scorePickup) &&
              selectionStore.getState().selectedElementIndex === 0,
          },
          linkMenu,
          {
            target: "text:Choose Existing",
            done: () => present('[data-tour="linked-elements-dialog"]'),
          },
          "text:Link Selected",
        ],
        check: () => feedback(linkedScoreUses(), "", ""),
      },
    ],
  },
  {
    title: "Edit once, update both paths",
    task: "Move Score and change its rotation",
    body: "Both paths update together.",
    why: "Linked waypoints share position and rotation. Linked translation targets share only position.",
    target: "element-properties",
    visible: ["path-canvas"],
    interact: linkedEditing,
    element: scoreIndex,
    showMe: [
      ...showProperties(scoreIndex),
      { target: "label:Rotation (deg)", echo: "label:X (m)" },
    ],
    prepare: {
      inspector: "open",
      inspectorTab: "elements",
      tool: "select",
      showGhostPaths: true,
    },
    check: () =>
      feedback(
        changedSharedScorePose(),
        scoreEditHint(),
        "Both paths have the new position and rotation.",
      ),
  },
  {
    title: "Check the other path",
    task: "Open Start to Score and press Play",
    body: "Its End moved and turned along with Score.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: [...linkedEditing, ...transport],
    prepare: { simulation: "start" },
    checks: [
      {
        label: "Start to Score open",
        showMe: choosePath("Start to Score"),
        check: () =>
          feedback(
            activePathIs(ids.stagingScore) && changedSharedScorePose(),
            "",
            "",
          ),
      },
      {
        label: "Played the path",
        showMe: ["transport-play"],
        check: () => feedback(hasAction("play"), "", ""),
      },
    ],
  },
  {
    title: "Each path keeps its own settings",
    body: "Linking shares only position and rotation. Each path keeps its own handoff radii, constraints, and Profiled Rotation.",
    why: "Exports use the linked point’s current pose.",
    visible: ["path-canvas"],
    interact: [...linkedEditing, ...transport],
  },
];

// Start to Pickup has two points, so End is the second cell.
// Start to Pickup runs Start, a translation target, then End: End is cell 3.
const minimumCell = "testid:constraint-cell-min_velocity_meters_per_sec-3";
const pathLinkingSteps: TourStep[] = [
  {
    title: "Preview both paths",
    task: "Click Pickup and Score to preview the group",
    body: "These paths meet at a linked waypoint named Pickup.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    showMe: [{ target: "label:Focus Pickup and Score" }],
    prepare: { navigator: "open", inspector: "closed", showGhostPaths: true },
    check: () =>
      feedback(
        previewing("lesson-pickup-chain"),
        "",
        "The first path’s End is the second path’s Start.",
      ),
  },
  {
    title: "Inspect the next Start",
    task: "Click the grey Pickup to Score path",
    body: "Clicking a faint path on the canvas switches to it.",
    target: "path-canvas",
    visible: ["path-canvas", "element-properties"],
    interact: linkedEditing,
    showMe: [{ target: "lesson-chain-score" }],
    prepare: {
      navigator: "closed",
      inspector: "open",
      inspectorTab: "elements",
      showGhostPaths: true,
      tool: "select",
    },
    check: () =>
      feedback(
        activePathIs(ids.pickupExit),
        "",
        "Its Start is linked to Pickup, where the first path ends.",
      ),
  },
  {
    title: "Set the speed near End",
    task: "Switch back to Start to Pickup and open Constraints",
    target: "path-canvas",
    interact: ["path-breadcrumb", ...constraints],
    prepare: {
      inspector: "open",
      inspectorTab: "elements",
      showGhostPaths: true,
      tool: "select",
    },
    checks: [
      {
        label: "Start to Pickup open",
        showMe: choosePath("Start to Pickup"),
        check: () => feedback(activePathIs(ids.stagingPickup), "", ""),
      },
      {
        label: "Constraints open",
        showMe: ["inspector-constraints"],
        check: () =>
          feedback(
            present(
              '[data-tour="inspector-constraints"][aria-selected="true"]',
            ),
            "",
            "",
          ),
      },
    ],
  },
  {
    title: "Choose the transition speed",
    task: "Set Min Velocity to 1.5 m/s at End",
    body: "It keeps the robot moving into the next path.",
    why: "Min Velocity keeps the robot from slowing to a stop near End. The cells under a constraint are the path’s points in order: W1 is Start, T1 the translation target, and W2 End.",
    target: "inspector-panel",
    visible: ["path-canvas"],
    interact: constraints,
    prepare: { inspector: "open", inspectorTab: "constraints" },
    checks: [
      {
        label: "Added",
        showMe: [
          {
            target: "label:Add constraint",
            done: () => present("details.add-constraint-menu[open]"),
          },
          "text:Min Velocity",
        ],
        check: () => feedback(minimumConstraints().length > 0, "", ""),
      },
      {
        label: "Only on End (W2)",
        showMe: [minimumCell],
        check: () =>
          feedback(
            minimumConstraints().length > 0 &&
              minimumConstraints().every(
                (constraint) =>
                  constraint.start_ordinal === lastOrdinal() &&
                  constraint.end_ordinal === lastOrdinal(),
              ),
            minimumConstraints().length
              ? "Drag the Min Velocity bar so it covers only the End cell (W2)."
              : "",
            "",
          ),
      },
      {
        label: "1.5 m/s",
        showMe: [
          constraintCell("min_velocity_meters_per_sec", 3, minimumCell),
          "label:Constraint * value",
        ],
        check: () =>
          feedback(
            hasTransitionMinimum(pathById(ids.stagingPickup)?.path),
            minimumConstraints().some((constraint) => constraint.value >= 2)
              ? "Keep it below the 2 m/s speed limit: type 1.5."
              : "",
            "",
          ),
      },
    ],
  },
  {
    title: "Play the first path",
    task: "Play Start to Pickup",
    body: "Watch it hold 1.5 m/s into End: the speed it carries into the next path.",
    target: "transport-play",
    visible: ["path-canvas"],
    interact: [...transport, ...constraints],
    showMe: [{ target: "transport-play" }],
    prepare: { simulation: "start" },
    check: () =>
      feedback(activePathIs(ids.stagingPickup) && hasAction("play"), "", ""),
  },
  {
    title: "Run both paths in robot code",
    body: "Run the next path right after the first in your robot code. Matching End and Start poses plus a minimum speed make the handoff smooth.",
    why: "A Path Group only organizes paths; your robot code decides which runs next.",
    visible: ["path-canvas", "simulation-transport"],
    interact: ["path-breadcrumb", "path-canvas", ...transport],
    prepare: { inspector: "closed", showGhostPaths: true },
  },
];

const definitions: SupplementalTour[] = [
  createImportExportTour(),
  {
    id: "path-management",
    title: "Path Management",
    summary: "Organize autos and test paths with Path Groups",
    durationMinutes: 4,
    recap: [
      "Path Groups organize related paths, and a path can belong to several.",
      "Previewing a group shows its other paths faintly while you edit one.",
    ],
    practicePath: () => createManagementPaths()[0].path,
    practicePaths: createManagementPaths,
    practiceGroups: createManagementGroups,
    practiceLinkedTargets: createManagementTargets,
    practiceConfig,
    steps: managementSteps,
  },
  offlineTour,
  {
    id: "current-pose-start",
    title: "Current-pose Starts",
    summary: "Start a path wherever the robot is when it runs",
    durationMinutes: 3,
    recap: [
      "A path without an authored start begins wherever the robot is.",
      "The grey ghost only sets the preview’s starting pose; it is never exported.",
    ],
    practiceConfig,
    practicePath: () =>
      createPathModel({
        preview: {
          start_pose: { x_meters: 3, y_meters: 3, rotation_radians: 0 },
        },
        path_elements: [
          createRotationTarget({ rotation_radians: Math.PI / 2, t_ratio: 0.5 }),
          createTranslationTarget({ x_meters: 7, y_meters: 4 }),
        ],
      }),
    steps: [
      {
        title: "Move the preview start",
        task: "Drag the grey ghost waypoint somewhere else",
        body: "With no Start, the path begins wherever the robot is. The grey ghost stands in for it.",
        why: "Drag the dot on its front edge to rotate it, or select it and use the arrow keys for fine moves. Generated constraints use its pose too.",
        target: "path-canvas",
        prepare: { inspector: "closed", simulation: "start", tool: "select" },
        interact: ["path-canvas"],
        visible: ["path-canvas", "inspector-panel"],
        showMe: [{ target: "lesson-start-pose" }],
        check: () => {
          const pose = activePath()?.path.preview?.start_pose;
          return feedback(
            !!pose && Math.hypot(pose.x_meters - 3, pose.y_meters - 3) > 0.05,
            "",
            "The preview now starts there.",
          );
        },
      },
      {
        title: "Try the path",
        task: "Press Play",
        body: "The robot heads from the ghost to the target and turns on the way, without stopping.",
        target: "transport-play",
        interact: ["path-canvas", ...transport],
        visible: ["path-canvas", ...transport],
        showMe: [{ target: "transport-play" }],
        check: () => feedback(hasAction("play"), "", ""),
      },
      {
        title: "What reaches the robot",
        body: "The ghost is never exported. Robot code starts from the robot’s real pose, so test from the expected starting area.",
        why: "Requesting a pose reset on a path without an authored start logs a warning and skips the reset. The last element must still be a waypoint or translation target.",
        visible: ["path-canvas", "inspector-panel"],
        interact: ["path-canvas", ...transport],
      },
    ],
  },
  {
    id: "handoff-modes",
    title: "Handoff Modes",
    summary: "Choose when the follower moves to the next point",
    durationMinutes: 4,
    recap: [
      "Radius hands off within a distance of the point; Progress hands off once that much of the line into it remains.",
      "Each point can override the project’s default mode from its cell in Constraints.",
    ],
    practiceConfig,
    practicePath: () =>
      createPathModel({
        path_elements: [
          createTranslationTarget({
            x_meters: 2,
            y_meters: 2,
            intermediate_handoff_radius_meters: 0.45,
          }),
          createTranslationTarget({
            x_meters: 5,
            y_meters: 2,
            intermediate_handoff_radius_meters: 0.45,
          }),
          createTranslationTarget({ x_meters: 5, y_meters: 5 }),
        ],
      }),
    steps: [
      {
        title: "Two ways to reach a handoff",
        body: "A handoff moves the robot on to its next point early. Radius hands off near the point; Progress hands off when that much of the line into it is left.",
        why: "Neither mode makes the robot stop. The final point has no handoff; it uses end tolerances instead.",
        visible: ["path-canvas", "inspector-panel"],
        prepare: {
          inspector: "open",
          inspectorTab: "constraints",
          simulation: "start",
          view: "frame-path",
        },
      },
      {
        title: "Change one point",
        task: "Set the middle point’s handoff to Progress",
        body: "In Constraints, click the middle m cell, then the arrow icon: Progress.",
        why: "Auto/Manual sets where the distance comes from; Radius/Progress sets how it is measured. Shift-click cells to change several at once.",
        target: "max-velocity-card",
        element: () => 1,
        showMe: [radiusCell(1, "lesson-element"), "label:Progress"],
        interact: ["path-canvas", "inspector-panel", "max-velocity-card"],
        visible: ["path-canvas", "inspector-panel"],
        check: () =>
          feedback(
            middleHandoffMode() === "progress",
            activePath()?.path.path_elements.some(
              (element, index) =>
                index !== 1 &&
                element.type === "translation" &&
                element.handoff_mode === "progress",
            )
              ? "That’s another point. The middle one is the second m cell."
              : "",
            "The middle point now uses Progress. The purple dashed line is its gate: crossing it hands off, even off to one side.",
          ),
      },
      {
        title: "Try both on a corner",
        task: "Play with Progress, then with Radius",
        body: "Watch where it turns at the middle point.",
        why: "Progress can leave a stretch while the robot is still off to the side, so check corner clearance. Rotation is separate: an early handoff doesn’t jump to the next rotation.",
        target: "transport-play",
        interact: [
          "path-canvas",
          "inspector-panel",
          "max-velocity-card",
          ...transport,
        ],
        visible: ["path-canvas", "inspector-panel", ...transport],
        element: () => 1,
        prepare: {
          inspector: "open",
          inspectorTab: "constraints",
          simulation: "start",
          view: "frame-path",
        },
        checks: [
          {
            label: "Played with Progress",
            showMe: ["transport-play"],
            check: () =>
              feedback(
                playedWithProgress(),
                middleHandoffMode() === "progress"
                  ? ""
                  : "Switch the middle point back to Progress first.",
                "",
              ),
          },
          {
            label: "Middle point on Radius",
            showMe: [radiusCell(1, "lesson-element"), "label:Radius"],
            check: () => feedback(switchedToRadius(), "", ""),
          },
          {
            label: "Played with Radius",
            showMe: ["transport-play"],
            check: () => feedback(playedWithRadius(), "", ""),
          },
        ],
      },
      {
        title: "Choose an inherited default",
        task: "Set the project default to Progress",
        body: "New points inherit this mode. A point whose mode you chose keeps it.",
        why: "The geometry buttons show the resolved mode, including a default stored in an imported file. Use the small reset on a selected tile to inherit again. Older projects use Radius.",
        settingsSection: "path-defaults",
        target: "settings-translation",
        visible: ["settings-dialog"],
        interact: ["settings-dialog"],
        showMe: [{ target: "label:Default Handoff Mode" }],
        check: () =>
          feedback(
            project()?.config.kinematic_constraints.default_handoff_mode ===
              "progress",
            "",
            "New handoffs will use Progress.",
          ),
      },
    ],
  },
  {
    id: "linked-elements",
    title: "Linked Elements",
    summary: "Link waypoints so both paths update when you edit them",
    durationMinutes: 4,
    recap: [
      "Linked waypoints keep the ends of connected paths together.",
      "Editing a linked point updates every path that uses it.",
    ],
    markers: organizationMarkers,
    practicePath: () => createLinkedElementPaths()[0].path,
    practicePaths: createLinkedElementPaths,
    practiceGroups: createLinkedElementGroups,
    practiceConfig,
    steps: linkedElementSteps,
  },
  {
    id: "path-linking",
    title: "Path Linking",
    summary: "Connect one path’s End to the next path’s Start",
    durationMinutes: 4,
    recap: [
      "A shared End and Start pose lets one path flow into the next.",
      "Min Velocity on End sets the speed the robot carries into the next path.",
    ],
    markers: linkingMarkers,
    practicePath: () => createPathLinkingPaths()[0].path,
    practicePaths: createPathLinkingPaths,
    practiceGroups: createPathLinkingGroups,
    practiceLinkedTargets: createPathLinkingTargets,
    practiceConfig,
    steps: pathLinkingSteps,
  },
];

export const importExportTour: TourDefinition = definitions[0];
export const advancedTours: readonly TourDefinition[] = definitions.slice(1);

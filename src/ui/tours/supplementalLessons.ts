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
import { feedback } from "./tourChecks";
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

const managementSteps: TourStep[] = [
  {
    title: "Choose a path",
    body: "This project has two autos and a few test paths. Use the path dropdown to select Top - Score to Pickup.",
    target: "path-breadcrumb",
    visible: ["path-canvas"],
    interact: ["path-breadcrumb"],
    task: "Select Top - Score to Pickup",
    prepare: { navigator: "closed", inspector: "closed", simulation: "start" },
    check: () =>
      feedback(
        activePathIs(managementIds.topScorePickup),
        "Select Top - Score to Pickup in the path dropdown.",
        "Top - Score to Pickup is selected.",
      ),
  },
  {
    title: "Open the Project Navigator",
    body: "Open the Project Navigator beside the canvas. Drag its right edge to resize it. Testing, Top Side Auto, and Bottom Side Auto each have three paths; the lines show their group memberships.",
    target: "navigator-button",
    interact: navigation,
    task: "Open the Project Navigator",
    check: () =>
      feedback(
        navigatorOpen(),
        "Click the navigator button.",
        "The lines show which paths belong to each group.",
      ),
  },
  {
    title: "Create a Path Group",
    body: "Click + beside Path Groups and name your group My Auto. We'll add the three top-side paths to it.",
    target: "navigator-groups",
    interact: navigation,
    prepare: { navigator: "open" },
    task: "Create My Auto",
    check: () =>
      feedback(
        !!groupNamed("My Auto"),
        "Create the group and save its name.",
        "My Auto created.",
      ),
  },
  {
    title: "Connect its three paths",
    body: "Select My Auto, then click the connection point beside each path whose name starts with Top. A path can belong to more than one group, so these stay in Top Side Auto too.",
    target: "navigator-paths",
    interact: navigation,
    prepare: { navigator: "open" },
    task: "Add the three top-side paths to My Auto",
    check: () =>
      feedback(
        [
          managementIds.topStartScore,
          managementIds.topScorePickup,
          managementIds.topPickupScore,
        ].every((id) => groupNamed("My Auto")?.path_ids.includes(id)),
        "Connect all three paths whose names start with Top.",
        "All three paths are in My Auto.",
      ),
  },
  {
    title: "Preview the group",
    body: "Click My Auto to preview it on the canvas. The selected path stays bright and the other paths are faint. Each path's End is linked to the next Start, so they stay together when you edit them.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", showGhostPaths: true },
    task: "Preview My Auto",
    check: () =>
      feedback(
        !!groupNamed("My Auto") && previewing(groupNamed("My Auto")!.group_id),
        "Click My Auto to preview it on the canvas.",
        "The three paths are visible together.",
      ),
  },
  {
    title: "Work on one path",
    body: "Select Top - Pickup to Score in the path dropdown. You can edit or play this path while the other paths in the group stay visible.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: ["path-breadcrumb", "path-canvas", ...transport],
    prepare: { navigator: "closed", showGhostPaths: true },
    task: "Select Top - Pickup to Score",
    check: () =>
      feedback(
        activePathIs(managementIds.topPickupScore),
        "Choose Top - Pickup to Score in the path dropdown.",
        "Top - Pickup to Score is selected.",
      ),
  },
  {
    title: "Explore your groups",
    body: "Single-click a path or group to preview it; double-click its name to rename it. Use the connection button to show or hide membership lines. Groups organize paths; your robot code decides their running order.",
    visible: ["path-canvas", "simulation-transport"],
    interact: [...navigation, "path-breadcrumb", "path-canvas", ...transport],
  },
];

const linkedElementSteps: TourStep[] = [
  {
    title: "See where the paths meet",
    body: "Click Score and Pickup in the Project Navigator to preview the group. Start to Score ends where Score to Pickup starts.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", inspector: "closed", showGhostPaths: true },
    task: "Preview Score and Pickup",
    check: () =>
      feedback(
        previewing("lesson-score-cycle"),
        "Click Score and Pickup to preview the group.",
        "The first path ends where the next starts.",
      ),
  },
  {
    title: "Create a linked waypoint",
    body: "Select End on Start to Score. Open Link beside the element type, choose New Linked Waypoint, and name it Score. Click Create & Link.",
    target: "element-link",
    visible: ["path-canvas"],
    interact: linkedEditing,
    prepare: {
      navigator: "closed",
      inspector: "open",
      inspectorTab: "elements",
      selectElement: (path) => path.path_elements.length - 1,
      tool: "select",
    },
    task: "Create a linked waypoint named Score",
    check: () =>
      feedback(
        !!scoreTarget() &&
          getPathElementLinkedTargetId(scoringElements()[0]) ===
            scoreTarget()?.target_id,
        "Create Score from Start to Score's End waypoint.",
        "End now uses the shared Score.",
      ),
  },
  {
    title: "Link the next path's Start",
    body: "Choose Score to Pickup and select Start. Open Link, choose Choose Existing, select Score, and click Link Selected.",
    target: "path-breadcrumb",
    visible: ["element-properties", "path-canvas"],
    interact: linkedEditing,
    prepare: {
      navigator: "closed",
      inspector: "open",
      inspectorTab: "elements",
    },
    task: "Link Score to Pickup's Start to Score",
    check: () =>
      feedback(
        linkedScoreUses(),
        "Link the first path’s End and the next path’s Start to Score.",
        "Both waypoints are linked to Score.",
      ),
  },
  {
    title: "Edit once, update both paths",
    body: "Move the linked waypoint and change its heading. Both paths update together. Linked waypoints share position and heading. Linked translations share only position.",
    target: "element-properties",
    visible: ["path-canvas"],
    interact: linkedEditing,
    prepare: {
      inspector: "open",
      inspectorTab: "elements",
      tool: "select",
      showGhostPaths: true,
    },
    task: "Move and turn Score",
    check: () =>
      feedback(
        changedSharedScorePose(),
        "Move Score and change its heading. Keep both waypoints linked.",
        "Both paths have the new position and heading.",
      ),
  },
  {
    title: "Check the other path",
    body: "Switch to Start to Score and select End. Its position and heading changed too. Press Play to see the updated path.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: [...linkedEditing, ...transport],
    task: "Select Start to Score and play it",
    prepare: { simulation: "start" },
    check: () =>
      feedback(
        activePathIs(ids.stagingScore) &&
          changedSharedScorePose() &&
          hasAction("play"),
        "Select Start to Score and press Play.",
        "The other path updated too.",
      ),
  },
  {
    title: "Each path keeps its own settings",
    body: "Link waypoints that should stay together. Each path still has its own handoff radii, constraints, and Profiled Rotation settings. Exported paths use the linked points’ current positions and headings.",
    visible: ["path-canvas"],
    interact: [...linkedEditing, ...transport],
  },
];

const pathLinkingSteps: TourStep[] = [
  {
    title: "Preview both paths",
    body: "Click Pickup and Score in the Project Navigator to preview the group. The first path’s End and the second path’s Start share a linked waypoint named Pickup.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", inspector: "closed", showGhostPaths: true },
    task: "Preview Pickup and Score",
    check: () =>
      feedback(
        previewing("lesson-pickup-chain"),
        "Click Pickup and Score to preview the group.",
        "Both paths meet at Pickup.",
      ),
  },
  {
    title: "Inspect the next Start",
    body: "Click the grey Pickup to Score path on the canvas to switch to it, then select Start. Its Link menu shows Pickup, the same linked waypoint used by the first path’s End.",
    target: "path-canvas",
    visible: ["path-canvas", "element-properties"],
    interact: linkedEditing,
    prepare: {
      navigator: "closed",
      inspector: "open",
      inspectorTab: "elements",
      showGhostPaths: true,
      tool: "select",
    },
    task: "Click the grey Pickup to Score path",
    check: () =>
      feedback(
        activePathIs(ids.pickupExit),
        "Click the grey path on the right to switch to Pickup to Score.",
        "Start is linked to Pickup.",
      ),
  },
  {
    title: "Set the speed near End",
    body: "Click the grey Start to Pickup path on the canvas to switch back, then open Constraints. Minimum velocity prevents the robot from slowing to a stop near End, helping it transition smoothly into the next path.",
    target: "path-canvas",
    interact: ["path-breadcrumb", ...constraints],
    prepare: {
      inspector: "open",
      inspectorTab: "elements",
      showGhostPaths: true,
      tool: "select",
    },
    task: "Open Constraints on Start to Pickup",
    check: () =>
      feedback(
        activePathIs(ids.stagingPickup) &&
          present('[data-tour="inspector-constraints"][aria-selected="true"]'),
        "Click the grey path on the left to switch to Start to Pickup, then open Constraints.",
        "The first path’s constraints are open.",
      ),
  },
  {
    title: "Choose the transition speed",
    body: "Click Add constraint and choose Min Velocity. Drag its cell to End (W2) and set it to 1.5 m/s. This is the speed you want the robot to carry into Pickup to Score for a smooth, unbroken transition.",
    target: "inspector-panel",
    visible: ["path-canvas"],
    interact: constraints,
    prepare: { inspector: "open", inspectorTab: "constraints" },
    task: "Set Min Velocity to 1.5 m/s on End",
    check: () =>
      feedback(
        hasTransitionMinimum(pathById(ids.stagingPickup)?.path),
        "Set Min Velocity to 1.5 m/s on End only.",
        "The transition speed is set to 1.5 m/s.",
      ),
  },
  {
    title: "Play the first path",
    body: "Play the path and watch how it keeps speed approaching End. The 1.5 m/s minimum is your chosen entry speed for Pickup to Score, so the robot can continue without stopping. This preview plays one path at a time.",
    target: "transport-play",
    visible: ["path-canvas"],
    interact: [...transport, ...constraints],
    prepare: { simulation: "start" },
    task: "Play Start to Pickup",
    check: () =>
      feedback(
        activePathIs(ids.stagingPickup) && hasAction("play"),
        "Press Play and watch the robot near End.",
        "Continue when you are ready.",
      ),
  },
  {
    title: "Run both paths in robot code",
    body: "Run the next path immediately after the first in your robot code. Match End and Start poses, and choose the first path’s minimum velocity for the speed you want to enter the next path. Here, 1.5 m/s carries the robot through a smooth, unbroken transition. A Path Group organizes the paths; your robot code controls the sequence.",
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
    completionMessage: "Lesson complete.",
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
    title: "Advanced — Current-pose Starts",
    summary: "Start a path wherever the robot is when it runs",
    durationMinutes: 3,
    completionMessage: "Lesson complete.",
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
        title: "An implicit start",
        body: "A single destination, or a path beginning with a rotation or event, starts from the robot’s current pose when execution begins. This example has a rotation target followed by a translation target. Its grey ghost waypoint represents the starting pose for preview only.",
        visible: ["path-canvas", "inspector-panel"],
        prepare: {
          inspector: "open",
          inspectorTab: "elements",
          simulation: "start",
          tool: "select",
        },
      },
      {
        title: "Move the preview start",
        body: "Drag the grey ghost waypoint to a different position. Drag its front edge to rotate it, just like a regular waypoint. Select it and use the arrow keys to adjust its position. Moving it changes the preview and generated constraints without adding an element to the list.",
        target: "path-canvas",
        prepare: { inspector: "closed", simulation: "start", tool: "select" },
        interact: ["path-canvas"],
        visible: ["path-canvas", "inspector-panel"],
        task: "Move the ghost waypoint",
        check: () => {
          const pose = pathById(projectStore.getState().activePathId ?? "")
            ?.path.preview?.start_pose;
          return feedback(
            !!pose && Math.hypot(pose.x_meters - 3, pose.y_meters - 3) > 0.05,
            "Drag the grey preview start to another position.",
            "The preview now starts at that position.",
          );
        },
      },
      {
        title: "Try the path",
        body: "Press Play. The leading rotation is placed along the line from the ghost to the destination, just like a rotation between two authored points. It does not require a stop. Tank drive ignores intermediate rotations and uses the path’s saved driving direction. The arrow buttons beside playback also set the direction exported to the robot; Backward travels rear-first without reversing the element order.",
        target: "transport-play",
        interact: ["path-canvas", ...transport],
        visible: ["path-canvas", ...transport],
        task: "Play from your preview start",
        check: () =>
          feedback(
            hasAction("play"),
            "Press Play to run the preview.",
            "Continue when you are ready.",
          ),
      },
      {
        title: "What reaches the robot",
        body: "The ghost is saved only in this project’s editor metadata. It cannot be linked and is not exported as a path element. Robot code samples the actual pose when the path starts, so test the expected starting area. Requesting a pose reset on a path without an authored start reports a warning and skips the reset. The last element must still be a waypoint or translation target.",
        visible: ["path-canvas", "inspector-panel"],
        interact: ["path-canvas", ...transport],
      },
    ],
  },
  {
    id: "handoff-modes",
    title: "Advanced — Handoff Modes",
    summary: "Choose when the follower moves to the next point",
    durationMinutes: 3,
    completionMessage: "Lesson complete.",
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
        body: "A handoff changes the translation target before the robot reaches the point. Radius waits until the robot is within the chosen distance. Progress measures along the incoming line: it hands off when that much distance remains, even if the robot is beside the line. The purple dashed gate marks that threshold; its visible ends do not limit lateral distance. Neither mode requires a stop.",
        visible: ["path-canvas"],
        prepare: {
          inspector: "open",
          inspectorTab: "constraints",
          simulation: "start",
        },
      },
      {
        title: "Change one point",
        body: "In Constraints, select the middle purple handoff chip. The row below it keeps Auto/Manual, the distance in metres, and Radius/Progress together. Auto generates the distance; Manual lets you enter it. The geometry mode is a separate choice. The final point uses end tolerances instead of a handoff.",
        task: "Set the middle handoff to Progress",
        check: () => {
          const element = pathById(projectStore.getState().activePathId ?? "")
            ?.path.path_elements[1];
          return feedback(
            element?.type === "translation" &&
              element.handoff_mode === "progress",
            "Select the middle purple chip, then choose Progress in its mode menu.",
            "This point uses Progress.",
          );
        },
        interact: ["path-canvas", "inspector-panel", "max-velocity-card"],
        visible: ["path-canvas", "inspector-panel"],
      },
      {
        title: "Choose an inherited default",
        body: "Settings → Path Defaults selects the project mode. Each handoff can override it or use Default; the parentheses show which mode that currently means, including any path default already stored in an imported file. Older projects use Radius.",
        settingsSection: "path-defaults",
        task: "Set the project default to Progress and save",
        check: () =>
          feedback(
            project()?.config.kinematic_constraints.default_handoff_mode ===
              "progress",
            "Choose Progress in Default Handoff Mode, then save Settings.",
            "New default handoffs will use Progress.",
          ),
      },
      {
        title: "Try both on a corner",
        task: "Play the path",
        check: () =>
          feedback(
            hasAction("play"),
            "Press Play to preview the corner.",
            "Continue when you are ready.",
          ),
        body: "Run the path, then compare Radius and Progress on the middle point. Progress can leave a segment while the robot is still laterally displaced, so inspect the corner clearance. Rotation progresses independently: an early translation handoff does not jump to an authored heading. A larger distance can still leave less space for the robot to complete its turn.",
        interact: [
          "path-canvas",
          "inspector-panel",
          "max-velocity-card",
          ...transport,
        ],
        visible: ["path-canvas", "inspector-panel", ...transport],
        prepare: {
          inspector: "open",
          inspectorTab: "constraints",
          simulation: "start",
        },
      },
    ],
  },
  {
    id: "linked-elements",
    title: "Advanced — Linked Elements",
    summary: "Link waypoints so both paths update when you edit them",
    durationMinutes: 4,
    completionMessage: "Lesson complete.",
    markers: organizationMarkers,
    practicePath: () => createLinkedElementPaths()[0].path,
    practicePaths: createLinkedElementPaths,
    practiceGroups: createLinkedElementGroups,
    practiceConfig,
    steps: linkedElementSteps,
  },
  {
    id: "path-linking",
    title: "Advanced — Path Linking",
    summary: "Connect one path’s End to the next path’s Start",
    durationMinutes: 4,
    completionMessage: "Lesson complete.",
    markers: linkingMarkers,
    practicePath: () => createPathLinkingPaths()[0].path,
    practicePaths: createPathLinkingPaths,
    practiceGroups: createPathLinkingGroups,
    practiceLinkedTargets: createPathLinkingTargets,
    practiceConfig,
    steps: pathLinkingSteps,
  },
];

export const supplementalTours: TourDefinition[] = definitions;

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
import { observedTourCondition } from "./tourInteraction";

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

const managementSteps: TourStep[] = [
  {
    title: "Choose a path",
    task: "Select Top - Score to Pickup",
    body: "This project has two autos and some test paths. Open the path dropdown and choose Top - Score to Pickup.",
    target: "path-breadcrumb",
    visible: ["path-canvas"],
    interact: ["path-breadcrumb"],
    prepare: { navigator: "closed", inspector: "closed", simulation: "start" },
    check: () =>
      feedback(
        activePathIs(managementIds.topScorePickup),
        "Click the path name at the top, then choose Top - Score to Pickup.",
        "Top - Score to Pickup is selected.",
      ),
  },
  {
    title: "Open the Project Navigator",
    task: "Open the Project Navigator",
    body: "The Navigator lists every path beside the canvas. Lines show which groups each path belongs to; drag its right edge to resize it.",
    target: "navigator-button",
    interact: navigation,
    check: () =>
      feedback(
        navigatorOpen(),
        "Click the Navigator button at top left.",
        "Testing, Top Side Auto, and Bottom Side Auto each hold three paths.",
      ),
  },
  {
    title: "Create a Path Group",
    task: "Create a group named My Auto",
    body: "Click + beside Path Groups, type My Auto, and press Enter.",
    target: "navigator-groups",
    interact: navigation,
    prepare: { navigator: "open" },
    check: () =>
      feedback(
        !!groupNamed("My Auto"),
        "Click + beside Path Groups, type My Auto, and press Enter.",
        "My Auto created.",
      ),
  },
  {
    title: "Connect its three paths",
    task: "Add the three Top paths to My Auto",
    body: "Select My Auto, then click the connection point beside each path whose name starts with Top.",
    why: "A path can belong to several groups, so these paths stay in Top Side Auto too.",
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
      check: () =>
        feedback(
          !!groupNamed("My Auto")?.path_ids.includes(id),
          groupNamed("My Auto")
            ? "Click its connection point while My Auto is selected."
            : "Create My Auto first.",
          "",
        ),
    })),
  },
  {
    title: "Preview the group",
    task: "Click My Auto to preview it",
    body: "The selected path stays bright and the rest of the group fades. Each path’s End is linked to the next Start, so they move together.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", showGhostPaths: true },
    check: () =>
      feedback(
        !!groupNamed("My Auto") && previewing(groupNamed("My Auto")!.group_id),
        "Click My Auto in the Navigator.",
        "The three paths are visible together.",
      ),
  },
  {
    title: "Work on one path",
    task: "Select Top - Pickup to Score",
    body: "Choose it in the path dropdown. You can edit and play it while the rest of the group stays visible.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: ["path-breadcrumb", "path-canvas", ...transport],
    prepare: { navigator: "closed", showGhostPaths: true },
    check: () =>
      feedback(
        activePathIs(managementIds.topPickupScore),
        "Choose Top - Pickup to Score in the path dropdown.",
        "Top - Pickup to Score is selected.",
      ),
  },
  {
    title: "Explore your groups",
    body: "Click a path or group to preview it, and double-click a name to rename it. Groups organize paths; your robot code decides the order they run.",
    visible: ["path-canvas", "simulation-transport"],
    interact: [...navigation, "path-breadcrumb", "path-canvas", ...transport],
  },
];

const linkedElementSteps: TourStep[] = [
  {
    title: "See where the paths meet",
    task: "Click Score and Pickup to preview the group",
    body: "In the Navigator, click Score and Pickup. Start to Score ends where Score to Pickup starts.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", inspector: "closed", showGhostPaths: true },
    check: () =>
      feedback(
        previewing("lesson-score-cycle"),
        "Click Score and Pickup in the Navigator.",
        "The first path ends where the next starts.",
      ),
  },
  {
    title: "Create a linked waypoint",
    task: "Link End to a new waypoint named Score",
    body: "End on Start to Score is selected. Open Link beside its type, choose New Linked Waypoint, name it Score, and click Create & Link.",
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
    check: () =>
      feedback(
        !!scoreTarget() &&
          getPathElementLinkedTargetId(scoringElements()[0]) ===
            scoreTarget()?.target_id,
        "Open Link, choose New Linked Waypoint, and name it Score.",
        "End now uses the shared Score.",
      ),
  },
  {
    title: "Link the next path's Start",
    task: "Link Score to Pickup’s Start to Score",
    body: "Switch to Score to Pickup in the path dropdown and select Start. Open Link, choose Choose Existing, pick Score, and click Link Selected.",
    target: "path-breadcrumb",
    visible: ["element-properties", "path-canvas"],
    interact: linkedEditing,
    showMe: ["path-breadcrumb", "element-link"],
    prepare: {
      navigator: "closed",
      inspector: "open",
      inspectorTab: "elements",
    },
    check: () =>
      feedback(
        linkedScoreUses(),
        "Link Score to Pickup’s Start to Score.",
        "Both waypoints are linked to Score.",
      ),
  },
  {
    title: "Edit once, update both paths",
    task: "Move Score and change its heading",
    body: "Drag the linked waypoint and turn its heading. Both paths update together.",
    why: "Linked waypoints share position and heading. Linked translation targets share only position.",
    target: "element-properties",
    visible: ["path-canvas"],
    interact: linkedEditing,
    prepare: {
      inspector: "open",
      inspectorTab: "elements",
      tool: "select",
      showGhostPaths: true,
    },
    check: () =>
      feedback(
        changedSharedScorePose(),
        "Move Score and change its heading; keep both waypoints linked.",
        "Both paths have the new position and heading.",
      ),
  },
  {
    title: "Check the other path",
    task: "Select Start to Score and press Play",
    body: "Its End moved and turned along with Score.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: [...linkedEditing, ...transport],
    prepare: { simulation: "start" },
    checks: [
      {
        label: "Start to Score selected",
        check: () =>
          feedback(
            activePathIs(ids.stagingScore) && changedSharedScorePose(),
            "Choose Start to Score in the path dropdown.",
            "",
          ),
      },
      {
        label: "Played the path",
        check: () => feedback(hasAction("play"), "Press Play.", ""),
      },
    ],
  },
  {
    title: "Each path keeps its own settings",
    body: "Linking shares only position and heading. Each path keeps its own handoff radii, constraints, and Profiled Rotation. Exports use the linked point’s current pose.",
    visible: ["path-canvas"],
    interact: [...linkedEditing, ...transport],
  },
];

const pathLinkingSteps: TourStep[] = [
  {
    title: "Preview both paths",
    task: "Click Pickup and Score to preview the group",
    body: "These paths meet at a linked waypoint named Pickup: the first path’s End is the second path’s Start.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", inspector: "closed", showGhostPaths: true },
    check: () =>
      feedback(
        previewing("lesson-pickup-chain"),
        "Click Pickup and Score in the Navigator.",
        "Both paths meet at Pickup.",
      ),
  },
  {
    title: "Inspect the next Start",
    task: "Click the grey Pickup to Score path",
    body: "Clicking a faint path on the canvas switches to it. Its Start links to Pickup, the same point the first path ends on.",
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
    check: () =>
      feedback(
        activePathIs(ids.pickupExit),
        "Click the grey path on the right.",
        "Start is linked to Pickup.",
      ),
  },
  {
    title: "Set the speed near End",
    task: "Switch back to Start to Pickup and open Constraints",
    body: "Click the grey path on the left to switch back, then open Constraints.",
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
        label: "Start to Pickup selected",
        check: () =>
          feedback(
            activePathIs(ids.stagingPickup),
            "Click the grey path on the left.",
            "",
          ),
      },
      {
        label: "Constraints open",
        check: () =>
          feedback(
            present(
              '[data-tour="inspector-constraints"][aria-selected="true"]',
            ),
            "Click Constraints in the sidebar.",
            "",
          ),
      },
    ],
  },
  {
    title: "Choose the transition speed",
    task: "Set Min Velocity to 1.5 m/s at End",
    body: "Click Add constraint and choose Min Velocity. Its new bar starts at the top cell; drag it down to the bottom cell, beside End, and type 1.5.",
    why: "Min Velocity prevents the robot from slowing to a stop near End, so it carries 1.5 m/s into the next path for a smooth, unbroken transition.",
    target: "inspector-panel",
    visible: ["path-canvas"],
    interact: constraints,
    prepare: { inspector: "open", inspectorTab: "constraints" },
    checks: [
      {
        label: "Min Velocity added",
        check: () =>
          feedback(
            minimumConstraints().length > 0,
            "Click Add constraint, then choose Min Velocity.",
            "",
          ),
      },
      {
        label: "Only on End",
        check: () =>
          feedback(
            minimumConstraints().length > 0 &&
              minimumConstraints().every(
                (constraint) =>
                  constraint.start_ordinal === lastOrdinal() &&
                  constraint.end_ordinal === lastOrdinal(),
              ),
            "Drag the Min Velocity bar down to the bottom cell, beside End.",
            "",
          ),
      },
      {
        label: "1.5 m/s, below the speed limit",
        check: () =>
          feedback(
            hasTransitionMinimum(pathById(ids.stagingPickup)?.path),
            "Click the bar and type 1.5.",
            "",
          ),
      },
    ],
  },
  {
    title: "Play the first path",
    task: "Play Start to Pickup",
    body: "Watch the robot keep its speed as it nears End. That 1.5 m/s is the speed it carries into Pickup to Score. This preview plays one path at a time.",
    target: "transport-play",
    visible: ["path-canvas"],
    interact: [...transport, ...constraints],
    prepare: { simulation: "start" },
    check: () =>
      feedback(
        activePathIs(ids.stagingPickup) && hasAction("play"),
        "Press Play and watch the robot near End.",
        "Continue when you are ready.",
      ),
  },
  {
    title: "Run both paths in robot code",
    body: "Run the next path immediately after the first in your robot code. Matching End and Start poses plus a minimum speed make the handoff smooth.",
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
        title: "An implicit start",
        body: "A path that begins with a single destination, a rotation, or an event starts wherever the robot is. The grey ghost waypoint stands in for that pose in the preview.",
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
        task: "Drag the grey ghost waypoint somewhere else",
        body: "Drag the ghost to move it, or drag its front edge to rotate it. It changes only the preview, not the path’s elements.",
        why: "Select the ghost and use the arrow keys for fine moves. Generated constraints use its pose too.",
        target: "path-canvas",
        prepare: { inspector: "closed", simulation: "start", tool: "select" },
        interact: ["path-canvas"],
        visible: ["path-canvas", "inspector-panel"],
        check: () => {
          const pose = activePath()?.path.preview?.start_pose;
          return feedback(
            !!pose && Math.hypot(pose.x_meters - 3, pose.y_meters - 3) > 0.05,
            "Drag the grey ghost to another position.",
            "The preview now starts there.",
          );
        },
      },
      {
        title: "Try the path",
        task: "Press Play",
        body: "The leading rotation sits on the line from the ghost to the destination, just as between two authored points. The robot doesn’t stop to turn.",
        target: "transport-play",
        interact: ["path-canvas", ...transport],
        visible: ["path-canvas", ...transport],
        check: () =>
          feedback(
            hasAction("play"),
            "Press Play to run the preview.",
            "Continue when you are ready.",
          ),
      },
      {
        title: "What reaches the robot",
        body: "The ghost is saved only in this project’s editor data and is never exported. Robot code uses the real pose when the path starts, so test from the expected starting area.",
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
      "Radius hands off within a distance of the point; Progress hands off when that much of the incoming line remains.",
      "Each point can override the project’s default mode from its chip in Constraints.",
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
        body: "A handoff moves the robot on to its next target early. Radius hands off within a set distance of the point; Progress hands off when that much of the incoming line remains.",
        why: "Neither mode makes the robot stop. The final point has no handoff; it uses end tolerances instead.",
        visible: ["path-canvas", "inspector-panel"],
        prepare: {
          inspector: "open",
          inspectorTab: "constraints",
          simulation: "start",
        },
      },
      {
        title: "Change one point",
        task: "Set the middle handoff to Progress",
        body: "In Constraints, click the lower 0.45 m chip. In the row that opens below it, choose the Progress arrow button.",
        why: "Auto/Manual sets where the distance comes from; Radius/Progress sets how it is measured. Shift-click chips to change several at once.",
        target: "max-velocity-card",
        showMe: ["max-velocity-card", "element-handoff"],
        interact: ["path-canvas", "inspector-panel", "max-velocity-card"],
        visible: ["path-canvas", "inspector-panel"],
        check: () =>
          feedback(
            middleHandoffMode() === "progress",
            "Click the lower 0.45 m chip, then the Progress arrow button.",
            "The middle point now uses Progress.",
          ),
      },
      {
        title: "The progress gate",
        body: "The purple dashed line across the incoming segment is the progress gate. The robot hands off as it crosses that line, even if it is off to one side.",
        why: "The gate’s drawn ends are only a marker; they don’t limit how far to the side the robot can be.",
        target: "path-canvas",
        visible: ["path-canvas", "inspector-panel"],
      },
      {
        title: "Try both on a corner",
        task: "Play with Progress, then with Radius",
        body: "Play the path and watch where the robot turns at the middle point. Then switch the lower chip back to Radius and play again.",
        why: "Progress can leave a segment while the robot is still off to the side, so check corner clearance. Rotation is separate: an early handoff doesn’t jump to the next heading.",
        target: "transport-play",
        showMe: ["transport-play", "max-velocity-card"],
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
        checks: [
          {
            label: "Played with Progress",
            check: () =>
              feedback(
                playedWithProgress(),
                middleHandoffMode() === "progress"
                  ? "Press Play."
                  : "Switch the lower chip to Progress, then press Play.",
                "",
              ),
          },
          {
            label: "Switched the middle point to Radius",
            check: () =>
              feedback(
                switchedToRadius(),
                "Click the lower chip, then the Radius button.",
                "",
              ),
          },
          {
            label: "Played with Radius",
            check: () => feedback(playedWithRadius(), "Press Play again.", ""),
          },
        ],
      },
      {
        title: "Choose an inherited default",
        task: "Set the project default to Progress",
        body: "Path Defaults sets the handoff mode that new points inherit. A point whose mode you chose keeps it.",
        why: "The geometry buttons show the resolved mode, including a default stored in an imported file. Use the small reset on a selected tile to inherit again. Older projects use Radius.",
        settingsSection: "path-defaults",
        visible: ["settings-dialog"],
        interact: ["settings-dialog"],
        check: () =>
          feedback(
            project()?.config.kinematic_constraints.default_handoff_mode ===
              "progress",
            "Choose Progress in Default Handoff Mode.",
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

import { getPathElementLinkedTargetId } from "../../core/linkedTargets";
import { projectConfigDefaultLookup } from "../../core/config/projectConfig";
import { stringifyBLineJson } from "../../core/io/blineJson";
import { deserializePath, serializePath } from "../../core/io/projectSerde";
import { isWaypoint, type PathModel } from "../../core/model/path";
import type { LinkedTarget, ProjectPathGroup } from "../../core/model/project";
import { projectStore } from "../../state/projectStore";
import { feedback } from "./tourChecks";
import { observedTourCondition } from "./tourInteraction";
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
  createTransferPaths,
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
const pathMenus = [
  "path-menu-entry",
  "path-menu-panel",
  "top-menu-path-transfer",
];
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
const archiveMenuOpened = observedTourCondition(() =>
  present('[data-testid="top-menu-project-transfer"]'),
);
const groupNamed = (name: string) =>
  project()?.path_groups.find(
    (group) => group.display_name.trim().toLowerCase() === name.toLowerCase(),
  );
const hasAction = (action: string) =>
  Number(
    (tourStore.getState().actions as Record<string, number>)[action] ?? 0,
  ) > 0;

function previewing(groupId: string) {
  return (
    projectStore.getState().activePathGroupId === groupId && !navigatorOpen()
  );
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

function importedMatchingPath() {
  const currentProject = project();
  const original = pathById(ids.stagingScore);
  if (!currentProject || !original || !hasAction("import")) return false;
  const defaultLookup = projectConfigDefaultLookup(currentProject.config);
  // Runtime files round numbers and resolve omitted radii through the current
  // project defaults on import. Compare both paths after that same round trip.
  const runtimeSignature = (path: PathModel) =>
    stringifyBLineJson(
      serializePath(
        deserializePath(
          JSON.parse(stringifyBLineJson(serializePath(path))),
          defaultLookup,
        ),
      ),
    );
  const expected = runtimeSignature(original.path);
  return currentProject.paths.some(
    (path) =>
      path.path_id !== original.path_id &&
      runtimeSignature(path.path) === expected,
  );
}

function gentleFinalMinimum(path: PathModel | undefined) {
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
        constraint.value >= 0.1 &&
        constraint.value <= 0.5 &&
        constraint.value < maximum,
    )
  );
}

const transferSteps: TourStep[] = [
  {
    title: "Export one path",
    body: "Open Path, then Import / Export, and choose Export Path. This saves Start to Score as a JSON file with its elements, event keys, and constraints.",
    target: "path-menu-entry",
    visible: ["path-canvas"],
    interact: pathMenus,
    task: "Export Start to Score",
    prepare: { navigator: "closed", inspector: "closed", simulation: "start" },
    check: () =>
      feedback(
        hasAction("export"),
        "Choose Export Path in the Path menu.",
        "Practice path exported.",
      ),
  },
  {
    title: "Import the saved path",
    body: "Choose Path, Import / Export, then Import Path. Select the JSON file you just saved to add a copy to this project.",
    target: "path-menu-entry",
    interact: [...pathMenus, "lesson-import-file"],
    task: "Import the exported path JSON",
    check: () =>
      feedback(
        !!importedMatchingPath(),
        "Import the same path file you exported in the previous step.",
        "The imported route, event, and constraints match.",
      ),
  },
  {
    title: "Inspect the imported copy",
    body: "Select the imported copy in the path dropdown and press Play. The path keeps its elements and constraints and uses this project’s defaults.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: [
      "path-breadcrumb",
      ...transport,
      "path-canvas",
      "inspector-panel",
    ],
    task: "Select the imported copy and play it",
    prepare: { navigator: "closed", simulation: "start" },
    check: () =>
      feedback(
        !!importedMatchingPath() &&
          !activePathIs(ids.stagingScore) &&
          hasAction("play"),
        "Select the imported copy and press Play.",
        "Imported path inspected.",
      ),
  },
  {
    title: "Back up the whole project",
    body: "Open File, then Import / Export, to find Project Archive. Use an archive to save the whole project, including defaults, Path Groups, and linked elements.",
    target: "export-menu-entry",
    interact: [
      "export-menu-entry",
      "export-menu-panel",
      "top-menu-project-transfer",
    ],
    task: "Expand Import / Export in File",
    check: () =>
      feedback(
        archiveMenuOpened(),
        "Open File, then expand Import / Export.",
        "Use a project archive when you need the complete editable project.",
      ),
  },
];

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
    body: "Open the Project Navigator. Testing, Top Side Auto, and Bottom Side Auto each have three paths. Path Groups are flexible: organize by auto, testing, or whatever works for your team.",
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
    body: "Select My Auto and click Preview Path Group. The selected path stays bright and the other paths are faint. Each path's End is linked to the next Start, so they stay together when you edit them.",
    target: "navigator-preview",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", showGhostPaths: true },
    task: "Preview My Auto",
    check: () =>
      feedback(
        !!groupNamed("My Auto") && previewing(groupNamed("My Auto")!.group_id),
        "Select My Auto and click Preview Path Group.",
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
    body: "Try previewing Top Side Auto, Bottom Side Auto, and Testing. Use groups however you like. They help organize your project; your robot code decides which paths run and in what order.",
    visible: ["path-canvas", "simulation-transport"],
    interact: [...navigation, "path-breadcrumb", "path-canvas", ...transport],
  },
];

const linkedElementSteps: TourStep[] = [
  {
    title: "See where the paths meet",
    body: "Select Score and Pickup in the Project Navigator and click Preview Path Group. Start to Score ends where Score to Pickup starts.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", inspector: "closed", showGhostPaths: true },
    task: "Preview Score and Pickup",
    check: () =>
      feedback(
        previewing("lesson-score-cycle"),
        "Select Score and Pickup, then click Preview Path Group.",
        "The first path ends where the next starts.",
      ),
  },
  {
    title: "Create a linked waypoint",
    body: "Select End on Start to Score. Open Link in Element Properties, choose New Linked Waypoint, and name it Score. Click Create & Link.",
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
    body: "Select Pickup and Score in the Project Navigator and click Preview Path Group. The first path’s End and the second path’s Start share a linked waypoint named Pickup.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", inspector: "closed", showGhostPaths: true },
    task: "Preview Pickup and Score",
    check: () =>
      feedback(
        previewing("lesson-pickup-chain"),
        "Select Pickup and Score and click Preview Path Group.",
        "Both paths meet at Pickup.",
      ),
  },
  {
    title: "Inspect the next Start",
    body: "Choose Pickup to Score and select Start. Its Link menu shows Pickup, the same linked waypoint used by the first path’s End.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "element-properties"],
    interact: linkedEditing,
    prepare: {
      navigator: "closed",
      inspector: "open",
      inspectorTab: "elements",
      showGhostPaths: true,
    },
    task: "Select Pickup to Score",
    check: () =>
      feedback(
        activePathIs(ids.pickupExit),
        "Choose Pickup to Score in the path dropdown.",
        "Start is linked to Pickup.",
      ),
  },
  {
    title: "Set the speed near End",
    body: "Return to Start to Pickup and open Constraints. A minimum velocity keeps the robot moving as it nears End, until it is close enough to finish the path.",
    target: "path-breadcrumb",
    interact: ["path-breadcrumb", ...constraints],
    prepare: { inspector: "open", inspectorTab: "elements" },
    task: "Open Constraints on Start to Pickup",
    check: () =>
      feedback(
        activePathIs(ids.stagingPickup) &&
          present('[data-tour="inspector-constraints"][aria-selected="true"]'),
        "Select Start to Pickup, then click Constraints.",
        "The first path’s constraints are open.",
      ),
  },
  {
    title: "Try a small minimum velocity",
    body: "Click Add constraint and choose Min Velocity. Drag its cell to End (W2) and set it between 0.1 and 0.5 m/s. A value that is too high can make the robot overshoot or shake near End.",
    target: "inspector-panel",
    visible: ["path-canvas"],
    interact: constraints,
    prepare: { inspector: "open", inspectorTab: "constraints" },
    task: "Set Min Velocity between 0.1 and 0.5 m/s on End",
    check: () =>
      feedback(
        gentleFinalMinimum(pathById(ids.stagingPickup)?.path),
        "Set Min Velocity between 0.1 and 0.5 m/s on End only.",
        "Min Velocity now applies only near End.",
      ),
  },
  {
    title: "Play the first path",
    body: "Play the path and watch the robot near End. Tune the controller and maximum velocity first. Use a minimum velocity only when testing shows that it helps.",
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
    body: "A Path Group does not run paths in sequence. Run them in order in your robot code. FollowPath commands the robot to stop when it ends, so minimum velocity alone will not keep it moving between paths.",
    visible: ["path-canvas", "simulation-transport"],
    interact: ["path-breadcrumb", "path-canvas", ...transport],
    prepare: { inspector: "closed", showGhostPaths: true },
  },
];

const definitions: SupplementalTour[] = [
  {
    id: "import-export",
    title: "Importing and Exporting",
    summary:
      "Export a path, import its copy, and choose the right backup format",
    durationMinutes: 3,
    completionMessage: "Lesson complete.",
    markers: organizationMarkers.filter((marker) => marker.label !== "Pickup"),
    practicePath: () => createTransferPaths()[0].path,
    practicePaths: createTransferPaths,
    practiceConfig,
    steps: transferSteps,
  },
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

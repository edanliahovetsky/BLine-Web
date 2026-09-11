import { getPathElementLinkedTargetId } from "../../core/linkedTargets";
import { projectConfigDefaultLookup } from "../../core/config/projectConfig";
import { stringifyBLineJson } from "../../core/io/blineJson";
import { deserializePath, serializePath } from "../../core/io/projectSerde";
import { isWaypoint, type PathModel } from "../../core/model/path";
import type { LinkedTarget, ProjectPathGroup } from "../../core/model/project";
import { projectStore } from "../../state/projectStore";
import { feedback } from "./tourChecks";
import { practiceConfig } from "./tourScenario";
import {
  createLinkedElementGroups,
  createLinkedElementPaths,
  createManagementGroups,
  createManagementPaths,
  createPathLinkingGroups,
  createPathLinkingPaths,
  createPathLinkingTargets,
  createTransferPaths,
  linkingMarkers,
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
      target.display_name.trim().toLowerCase() === "score pose",
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
    body: "Staging to Score includes its route, event key, and constraints. Open Path, then Import / Export, and choose Export Path to save its runtime JSON.",
    target: "path-menu-entry",
    visible: ["path-canvas"],
    interact: pathMenus,
    task: "Export Staging to Score",
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
    body: "Choose Path, Import / Export, then Import Path and select the JSON you just saved. Import adds a separate path to this practice project.",
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
    body: "Use the path dropdown to select the imported copy, then play or scrub it. A path JSON carries this path's elements and constraints; it uses the current project's defaults.",
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
    body: "Open File and Import / Export to find Project Archive. An archive also keeps project defaults, Path Groups, and linked elements for editing; individual path JSON does not.",
    target: "export-menu-entry",
    interact: [
      "export-menu-entry",
      "export-menu-panel",
      "top-menu-project-transfer",
    ],
    task: "Expand Import / Export in File",
    check: () =>
      feedback(
        present('[data-testid="top-menu-project-transfer"]'),
        "Open File, then expand Import / Export.",
        "Use a project archive when you need the complete editable project.",
      ),
  },
];

const managementSteps: TourStep[] = [
  {
    title: "Choose a route",
    body: "This project has an opening score and two legs of a pickup cycle. Use the path dropdown to select Score to Pickup.",
    target: "path-breadcrumb",
    visible: ["path-canvas"],
    interact: ["path-breadcrumb"],
    task: "Select Score to Pickup",
    prepare: { navigator: "closed", inspector: "closed", simulation: "start" },
    check: () =>
      feedback(
        activePathIs(ids.scorePickup),
        "Select Score to Pickup in the path dropdown.",
        "Score to Pickup is active.",
      ),
  },
  {
    title: "See the existing combinations",
    body: "Open the Project Navigator to see Opening score and Pickup cycle. Path Groups collect reusable paths you want to view together.",
    target: "navigator-button",
    interact: navigation,
    task: "Open the Project Navigator",
    check: () =>
      feedback(
        navigatorOpen(),
        "Click the navigator button.",
        "The connections show each group's paths.",
      ),
  },
  {
    title: "Make a complete cycle",
    body: "Click + beside Path Groups and name the new group Two-piece cycle. It will combine the opening score with the pickup and return.",
    target: "navigator-groups",
    interact: navigation,
    prepare: { navigator: "open" },
    task: "Create Two-piece cycle",
    check: () =>
      feedback(
        !!groupNamed("Two-piece cycle"),
        "Create the group and save its name.",
        "Two-piece cycle created.",
      ),
  },
  {
    title: "Connect its three paths",
    body: "Select Two-piece cycle, then click the connection point beside each of the three paths. The same path can belong to several groups.",
    target: "navigator-paths",
    interact: navigation,
    prepare: { navigator: "open" },
    task: "Connect all three routes to Two-piece cycle",
    check: () =>
      feedback(
        [ids.stagingScore, ids.scorePickup, ids.pickupScore].every((id) =>
          groupNamed("Two-piece cycle")?.path_ids.includes(id),
        ),
        "Connect Staging to Score, Score to Pickup, and Pickup to Score.",
        "The complete cycle is connected.",
      ),
  },
  {
    title: "Preview the combination",
    body: "Select Two-piece cycle and click Preview Path Group. The active path stays bright and the other routes appear as faint overlays.",
    target: "navigator-preview",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", showGhostPaths: true },
    task: "Preview Two-piece cycle",
    check: () =>
      feedback(
        !!groupNamed("Two-piece cycle") &&
          previewing(groupNamed("Two-piece cycle")!.group_id),
        "Select Two-piece cycle and click Preview Path Group.",
        "The three routes are visible together.",
      ),
  },
  {
    title: "Work on one leg",
    body: "Select Pickup to Score in the path dropdown. You can edit or play one leg while keeping the rest of its group visible for context.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: ["path-breadcrumb", "path-canvas", ...transport],
    prepare: { navigator: "closed", showGhostPaths: true },
    task: "Select Pickup to Score",
    check: () =>
      feedback(
        activePathIs(ids.pickupScore),
        "Choose Pickup to Score in the path dropdown.",
        "Pickup to Score is active.",
      ),
  },
  {
    title: "Explore your groups",
    body: "Try the groups and playback, then continue when done. Groups organize the editor view; your robot code decides which paths run and in what order.",
    visible: ["path-canvas", "simulation-transport"],
    interact: [...navigation, "path-breadcrumb", "path-canvas", ...transport],
  },
];

const linkedElementSteps: TourStep[] = [
  {
    title: "View the shared scoring area",
    body: "In the Project Navigator, select Score and collect and click Preview Path Group. Staging to Score ends where Score to Pickup starts.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", inspector: "closed", showGhostPaths: true },
    task: "Preview Score and collect",
    check: () =>
      feedback(
        previewing("lesson-score-cycle"),
        "Select Score and collect, then click Preview Path Group.",
        "Both routes meet at the score pose.",
      ),
  },
  {
    title: "Create the shared score pose",
    body: "Select End on Staging to Score. In Element Properties, open Link, choose New Linked Waypoint, name it Score pose, and click Create & Link.",
    target: "element-properties",
    visible: ["path-canvas"],
    interact: linkedEditing,
    prepare: {
      navigator: "closed",
      inspector: "open",
      inspectorTab: "elements",
      selectElement: (path) => path.path_elements.length - 1,
      tool: "select",
    },
    task: "Create a linked waypoint named Score pose",
    check: () =>
      feedback(
        !!scoreTarget() &&
          getPathElementLinkedTargetId(scoringElements()[0]) ===
            scoreTarget()?.target_id,
        "Create Score pose from Staging to Score's End waypoint.",
        "End now uses the shared Score pose.",
      ),
  },
  {
    title: "Link the next path's Start",
    body: "Choose Score to Pickup and select Start. Open Link, choose Choose Existing, select Score pose, and click Link Selected.",
    target: "path-breadcrumb",
    visible: ["element-properties", "path-canvas"],
    interact: linkedEditing,
    prepare: {
      navigator: "closed",
      inspector: "open",
      inspectorTab: "elements",
    },
    task: "Link Score to Pickup's Start to Score pose",
    check: () =>
      feedback(
        linkedScoreUses(),
        "Link both routes' shared scoring waypoints to Score pose.",
        "Both waypoints use the same shared pose.",
      ),
  },
  {
    title: "Edit once, update both paths",
    body: "Move the linked scoring waypoint a little and change its heading with the handle or degree field. A linked waypoint shares position and heading; a linked translation shares position only.",
    target: "element-properties",
    visible: ["path-canvas"],
    interact: linkedEditing,
    prepare: {
      inspector: "open",
      inspectorTab: "elements",
      tool: "select",
      showGhostPaths: true,
    },
    task: "Move and turn Score pose",
    check: () =>
      feedback(
        changedSharedScorePose(),
        "Change both Score pose's position and heading while its two uses stay linked.",
        "The shared position and heading updated in both paths.",
      ),
  },
  {
    title: "Inspect the other use",
    body: "Switch back to Staging to Score and select End to inspect its updated position and heading. Play or scrub the route to see how that shared edit changes the approach.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: [...linkedEditing, ...transport],
    task: "Select Staging to Score and play it",
    prepare: { simulation: "start" },
    check: () =>
      feedback(
        activePathIs(ids.stagingScore) &&
          changedSharedScorePose() &&
          hasAction("play"),
        "Select Staging to Score and press Play.",
        "The other path has the updated score pose.",
      ),
  },
  {
    title: "Keep each route's tuning local",
    body: "Handoff radii, constraints, and profiled rotation remain local to each path. Link points that should always share a pose; export writes their current coordinates into each runtime path.",
    visible: ["path-canvas"],
    interact: [...linkedEditing, ...transport],
  },
];

const pathLinkingSteps: TourStep[] = [
  {
    title: "View the two-path plan",
    body: "Select Pickup chain in the Project Navigator and click Preview Path Group. These paths share a linked Pickup handoff waypoint so End and the next Start stay aligned.",
    target: "navigator-groups",
    visible: ["path-canvas"],
    interact: navigation,
    prepare: { navigator: "open", inspector: "closed", showGhostPaths: true },
    task: "Preview Pickup chain",
    check: () =>
      feedback(
        previewing("lesson-pickup-chain"),
        "Select Pickup chain and click Preview Path Group.",
        "Both paths meet at Pickup handoff.",
      ),
  },
  {
    title: "Inspect the next Start",
    body: "Choose Pickup to Score and select Start. Its Link menu names the same Pickup handoff used by the previous path's End.",
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
        "Its Start shares the pickup pose.",
      ),
  },
  {
    title: "Tune the incoming approach",
    body: "Return to Staging to Pickup and open Constraints. A minimum velocity can keep a nonzero translation command near End until the robot enters its tolerance.",
    target: "path-breadcrumb",
    interact: ["path-breadcrumb", ...constraints],
    prepare: { inspector: "open", inspectorTab: "elements" },
    task: "Open Constraints on Staging to Pickup",
    check: () =>
      feedback(
        activePathIs(ids.stagingPickup) &&
          present('[data-tour="inspector-constraints"][aria-selected="true"]'),
        "Select Staging to Pickup, then click Constraints.",
        "The incoming path's constraints are open.",
      ),
  },
  {
    title: "Try a small final-approach minimum",
    body: "Use Add constraint to add Min Velocity, then drag its range's left edge to End (W2). Try 0.1 to 0.5 m/s, below the 2 m/s maximum; too much minimum can cause overshoot or chatter.",
    target: "inspector-panel",
    visible: ["path-canvas"],
    interact: constraints,
    prepare: { inspector: "open", inspectorTab: "constraints" },
    task: "Set a small Min Velocity on End's approach only",
    check: () =>
      feedback(
        gentleFinalMinimum(pathById(ids.stagingPickup)?.path),
        "Keep Min Velocity between 0.1 and 0.5 m/s on End only, below its maximum.",
        "The small minimum applies only to the final approach.",
      ),
  },
  {
    title: "Inspect the arrival",
    body: "Play and scrub the incoming path to inspect its final approach. Start with controller tuning and maximum-velocity constraints before using a minimum for a tested special case.",
    target: "transport-play",
    visible: ["path-canvas"],
    interact: [...transport, ...constraints],
    prepare: { simulation: "start" },
    task: "Play Staging to Pickup",
    check: () =>
      feedback(
        activePathIs(ids.stagingPickup) && hasAction("play"),
        "Press Play to inspect the incoming approach.",
        "Incoming approach inspected.",
      ),
  },
  {
    title: "Your robot code connects the commands",
    body: "A Path Group does not run paths in sequence. Chain the commands in robot code and test the whole transition: FollowPath sends zero speeds when it ends, so a minimum alone does not guarantee continuous motion.",
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
    summary:
      "Combine reusable routes with Path Groups and choose an active path",
    durationMinutes: 4,
    completionMessage: "Lesson complete.",
    markers: organizationMarkers,
    practicePath: () => createManagementPaths()[0].path,
    practicePaths: createManagementPaths,
    practiceGroups: createManagementGroups,
    practiceConfig,
    steps: managementSteps,
  },
  {
    id: "linked-elements",
    title: "Advanced — Linked Elements",
    summary:
      "Share a scoring pose and update its position and heading across paths",
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
    summary:
      "Align linked endpoints and explore a cautious nonzero arrival command",
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

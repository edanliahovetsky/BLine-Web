import { getElementPosition } from "../../canvas/geometry";
import {
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  isAnchorElement,
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement,
  type PathModel,
} from "../../core/model/path";
import {
  activePathForProjectStore,
  projectStore,
} from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import type { TourDefinition, TourMarker } from "./tourStore";

export const editorBasicsTourId = "build-first-path";
export const tourPracticePathName = "Tour practice";

const startZone = { minX: 1.3, maxX: 2.7, minY: 0.9, maxY: 2.1 };
const goalZone = { minX: 5.3, maxX: 6.7, minY: 2.4, maxY: 3.6 };
const structureBounds = { minX: 4.9, maxX: 6.7, minY: 3.1, maxY: 4.9 };

const buildMarkers: readonly TourMarker[] = [
  { id: "lesson-start-zone", label: "Start zone", kind: "zone", xMeters: 2, yMeters: 1.5, widthMeters: 1.4, heightMeters: 1.2 },
  { id: "lesson-goal-zone", label: "Goal zone", kind: "zone", xMeters: 6, yMeters: 3, widthMeters: 1.4, heightMeters: 1.2 },
];
const shapeMarkers: readonly TourMarker[] = [
  { id: "lesson-structure", label: "Field structure", kind: "structure", xMeters: 5.8, yMeters: 4, widthMeters: 1.8, heightMeters: 1.8 },
];
const speedMarkers: readonly TourMarker[] = [
  { id: "lesson-corner", label: "Sharp corner", kind: "callout", xMeters: 8, yMeters: 2.5, widthMeters: 1.15, heightMeters: 1.15 },
];
const behaviorMarkers: readonly TourMarker[] = [
  { id: "lesson-game-piece", label: "Game piece", kind: "game-piece", xMeters: 8.5, yMeters: 6, widthMeters: 0.85, heightMeters: 0.85 },
];

function waypoint(x: number, y: number, rotation = 0) {
  return createWaypoint({
    translation_target: createTranslationTarget({ x_meters: x, y_meters: y }),
    rotation_target: createRotationTarget({ rotation_radians: rotation, t_ratio: 0 }),
  });
}

export function createTourPracticePath(): PathModel {
  return createPathModel();
}

function createShapePracticePath(): PathModel {
  return createPathModel({ path_elements: [waypoint(2.5, 4), waypoint(9, 4)] });
}

function createSpeedPracticePath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(2.5, 2.5),
      createTranslationTarget({ x_meters: 8, y_meters: 2.5 }),
      waypoint(8, 6),
    ],
  });
}

function createBehaviorPracticePath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(2.5, 3),
      createTranslationTarget({ x_meters: 8.5, y_meters: 5 }),
    ],
  });
}

function createVerifyPracticePath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(2.2, 2.1),
      createTranslationTarget({ x_meters: 6.2, y_meters: 3.1 }),
      createEventTrigger({ t_ratio: 0.62, lib_key: "" }),
      waypoint(19, 5.2, Math.PI / 2),
    ],
    ranged_constraints: [{
      key: "max_velocity_meters_per_sec",
      value: 2,
      start_ordinal: 2,
      end_ordinal: 3,
      source: "auto_velocity",
      auto_velocity: {
        velocity_safety_factor: 1,
        acceleration_safety_factor: 1,
        merge_tolerance_meters_per_sec: 0.3,
        input_signature: "tour-stale-geometry",
      },
    }],
  });
}

let elementCountAtStepStart = 0;
let pathAtStepStart = "";
let seekCountAtStepStart = 0;
let playCountAtStepStart = 0;
let propertyCountAtStepStart = 0;
let velocityEditCountAtStepStart = 0;
let generationCountAtStepStart = 0;
let lastPlacedElementIndex: number | null = null;

export function captureTourStepState(): void {
  const path = currentPath();
  elementCountAtStepStart = path?.path_elements.length ?? 0;
  pathAtStepStart = path ? JSON.stringify(path.path_elements) : "";
  seekCountAtStepStart = readTourCount("simulation-transport", "data-tour-seek-count");
  playCountAtStepStart = readTourCount("simulation-transport", "data-tour-play-count");
  propertyCountAtStepStart = readTourCount("element-properties", "data-tour-edit-count");
  velocityEditCountAtStepStart = readCount("[data-tour-velocity-edit-count]", "data-tour-velocity-edit-count");
  generationCountAtStepStart = readTourCount("max-velocity-card", "data-tour-generate-count");
}

function currentPath(): PathModel | null {
  return activePathForProjectStore(projectStore.getState())?.path ?? null;
}

function elementWasAdded(type: PathElement["type"]): boolean {
  const path = currentPath();
  if (!path || path.path_elements.length <= elementCountAtStepStart) return false;
  const index = selectionStore.getState().selectedElementIndex ?? path.path_elements.length - 1;
  if (path.path_elements[index]?.type !== type) return false;
  lastPlacedElementIndex = index;
  return true;
}

function waypointAddedInside(bounds: typeof startZone, minimum: number): boolean {
  const path = currentPath();
  if (!path || path.path_elements.length <= elementCountAtStepStart) return false;
  const waypoints = path.path_elements.filter(isWaypoint);
  const inside = waypoints.some(({ translation_target: point }) =>
    point.x_meters >= bounds.minX && point.x_meters <= bounds.maxX &&
    point.y_meters >= bounds.minY && point.y_meters <= bounds.maxY,
  );
  if (inside && waypoints.length >= minimum) {
    lastPlacedElementIndex = selectionStore.getState().selectedElementIndex;
    return true;
  }
  return false;
}

function pathGeometryChanged(): boolean {
  const path = currentPath();
  return Boolean(path && JSON.stringify(path.path_elements) !== pathAtStepStart);
}

function translationTargetIsSelected(): boolean {
  const path = currentPath();
  const index = selectionStore.getState().selectedElementIndex;
  return Boolean(path && index !== null && index === lastPlacedElementIndex && isTranslationTarget(path.path_elements[index]));
}

function pathClearsStructure(): boolean {
  const path = currentPath();
  if (!path || !path.path_elements.some(isTranslationTarget)) return false;
  const anchors = path.path_elements.flatMap((element, index) => {
    if (!isAnchorElement(element)) return [];
    const point = getElementPosition(path.path_elements, index);
    return point ? [point] : [];
  });
  return anchors.length >= 3 && anchors.slice(1).every((end, index) => segmentClearsRect(anchors[index], end));
}

function segmentClearsRect(start: { x_meters: number; y_meters: number }, end: { x_meters: number; y_meters: number }): boolean {
  for (let sample = 0; sample <= 40; sample += 1) {
    const ratio = sample / 40;
    const x = start.x_meters + (end.x_meters - start.x_meters) * ratio;
    const y = start.y_meters + (end.y_meters - start.y_meters) * ratio;
    if (x >= structureBounds.minX && x <= structureBounds.maxX && y >= structureBounds.minY && y <= structureBounds.maxY) return false;
  }
  return true;
}

function propertyWasEdited(): boolean {
  return propertyEditDelta() > 0;
}

function propertyEditDelta(): number {
  return readTourCount("element-properties", "data-tour-edit-count") - propertyCountAtStepStart;
}

function selectedWaypointPropertyWasEdited(): boolean {
  const path = currentPath();
  const index = selectionStore.getState().selectedElementIndex;
  return Boolean(propertyEditDelta() >= 2 && path && index !== null && isWaypoint(path.path_elements[index]));
}

function selectedHandoffRadiusWasEdited(): boolean {
  const path = currentPath();
  const index = selectionStore.getState().selectedElementIndex;
  const element = path && index !== null ? path.path_elements[index] : null;
  const radius = element && isTranslationTarget(element)
    ? element.intermediate_handoff_radius_meters
    : element && isWaypoint(element)
      ? element.translation_target.intermediate_handoff_radius_meters
      : null;
  return propertyWasEdited() && radius !== null;
}

function rotationTargetConfigured(): boolean {
  const element = currentPath()?.path_elements.find(isRotationTarget);
  return Boolean(propertyWasEdited() && element && Math.abs(element.rotation_radians - Math.PI / 2) < 0.02 && Math.abs(element.t_ratio - 0.5) < 0.011);
}

function eventTriggerConfigured(): boolean {
  const element = currentPath()?.path_elements.find(isEventTrigger);
  return Boolean(propertyWasEdited() && element?.lib_key.trim() === "startIntake" && Math.abs(element.t_ratio - 0.7) < 0.011);
}

function simulationWasPlayed(): boolean {
  return readTourCount("simulation-transport", "data-tour-play-count") > playCountAtStepStart;
}

function simulationWasScrubbed(): boolean {
  return readTourCount("simulation-transport", "data-tour-seek-count") > seekCountAtStepStart;
}

function constraintsTabIsOpen(): boolean {
  return document.querySelector('[data-tour="inspector-constraints"][aria-selected="true"]') !== null;
}

function velocityPlanWasGenerated(): boolean {
  return readTourCount("max-velocity-card", "data-tour-generate-count") > generationCountAtStepStart &&
    document.querySelector('[data-tour="max-velocity-card"] .auto-velocity-status--current') !== null;
}

function velocityValueWasEdited(): boolean {
  return readCount("[data-tour-velocity-edit-count]", "data-tour-velocity-edit-count") > velocityEditCountAtStepStart && selectedVelocityCapIsManual();
}

function selectedVelocityCapIsManual(): boolean {
  const path = currentPath();
  const selected = selectionStore.getState().selectedRangedConstraint;
  return Boolean(path && selected?.key === "max_velocity_meters_per_sec" && path.ranged_constraints[selected.index]?.source !== "auto_velocity");
}

function pathHealthIsOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-label="Path health"]') !== null;
}

function offFieldIssueIsClear(): boolean {
  const path = currentPath();
  if (!path || !pathGeometryChanged()) return false;
  return path.path_elements.every((_, index) => {
    const point = getElementPosition(path.path_elements, index);
    return !point || (point.x_meters >= 0 && point.x_meters <= 18 && point.y_meters >= 0 && point.y_meters <= 9);
  });
}

function emptyEventIssueIsClear(): boolean {
  return Boolean(propertyWasEdited() && currentPath()?.path_elements.filter(isEventTrigger).every((event) => event.lib_key.trim().length > 0));
}

function readTourCount(id: string, attribute: string): number {
  return readCount(`[data-tour="${id}"]`, attribute);
}

function readCount(selector: string, attribute: string): number {
  const value = Number(document.querySelector(selector)?.getAttribute(attribute) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export const buildFirstPathTour: TourDefinition = {
  id: editorBasicsTourId,
  title: "Build a First Path",
  summary: "Drive from a start zone to a goal",
  durationMinutes: 6,
  completionMessage: "You built a start pose, a final pose, and a straight route.",
  markers: buildMarkers,
  practicePath: createTourPracticePath,
  steps: [
    { target: "path-breadcrumb", title: "You are on a practice path", body: "This is a practice path. Nothing you do here changes your real paths.", placement: "below" },
    { target: "lesson-markers", title: "The mission", body: "The robot must drive from the start zone to the goal zone. You will build the path that takes it there.", placement: "right", cardPosition: "canvas-top-right" },
    { title: "What a path is", body: "A path is an ordered list of path elements on the field. The robot drives in a straight line from each element to the next." },
    { target: "tool-waypoint", title: "Place the start", body: "Click the highlighted Waypoint tool. Then click inside the start zone on the field.", task: "Place a waypoint inside the start zone", keys: ["1"], placement: "right", cardPosition: "canvas-top-right", interact: ["tool-waypoint", "path-canvas"], completeWhen: () => waypointAddedInside(startZone, 1) },
    { target: "path-canvas", title: "The start pose", body: "A waypoint has a position and a heading. The first waypoint sets the exact pose where the robot starts.", placement: "right", cardPosition: "canvas-top-right" },
    { target: "tool-waypoint", title: "Place the goal", body: "Click the Waypoint tool again. Place a second waypoint inside the goal zone.", task: "Place a waypoint inside the goal zone", keys: ["1"], placement: "right", cardPosition: "canvas-top-right", interact: ["tool-waypoint", "path-canvas"], completeWhen: () => waypointAddedInside(goalZone, 2) },
    { title: "The final pose", body: "The last waypoint is the final pose. The robot finishes when its position and heading are inside the end tolerances." },
    { target: "path-canvas", title: "Move an element", body: "You are back on the Select tool. Drag a waypoint and watch the segment follow it.", task: "Drag either waypoint", keys: ["←", "↑", "↓", "→"], placement: "right", cardPosition: "canvas-top-right", interact: ["path-canvas"], prepare: { tool: "select" }, completeWhen: pathGeometryChanged },
    { target: "element-properties", title: "Type exact values", body: "Select a waypoint. Type an exact X and Y in Element Properties.", task: "Edit a waypoint position", placement: "left", interact: ["element-properties"], prepare: { inspector: "open", inspectorTab: "elements" }, completeWhen: selectedWaypointPropertyWasEdited },
    { target: "transport-play", title: "Play the preview", body: "Press Play under the field. The preview shows how the robot follows your path.", task: "Play the preview", keys: ["Space"], placement: "above", cardPosition: "canvas-top-right", interact: ["simulation-transport"], completeWhen: simulationWasPlayed },
    { title: "What you built", body: "You set a start pose, a final pose, and a straight route. The next lesson shapes the route between them." },
  ],
};

export const shapeRouteTour: TourDefinition = {
  id: "shape-route",
  title: "Shape the Route",
  summary: "Route around a field structure",
  durationMinutes: 7,
  completionMessage: "You shaped a clear route and tuned its handoff radius.",
  markers: shapeMarkers,
  practicePath: createShapePracticePath,
  steps: [
    { target: "lesson-structure", title: "The route has a problem", body: "This route crosses a field structure. The robot cannot drive through it. You will bend the route around it.", placement: "right", cardPosition: "canvas-top-right" },
    { title: "Translation targets", body: "A translation target has a position but no heading. Use one to shape the route when the heading does not need to change." },
    { target: "tool-translation", title: "Bend the route", body: "Click the highlighted Translation tool. Click above the structure to add a target between the waypoints.", task: "Add a translation target above the structure", keys: ["2"], placement: "right", cardPosition: "canvas-top-right", interact: ["tool-translation", "path-canvas"], prepare: { selectElement: 0 }, completeWhen: () => elementWasAdded("translation") },
    { target: "inspector-panel", title: "Path order", body: "The inspector lists path elements in drive order. A new element is inserted after the selected one.", placement: "left", prepare: { inspector: "open", inspectorTab: "elements" } },
    { target: "path-canvas", title: "Clear the structure", body: "Drag the new target until the route clears the structure. Keep the two waypoints where they are.", task: "Move the target until both segments are clear", placement: "right", cardPosition: "canvas-top-right", interact: ["path-canvas"], prepare: { tool: "select" }, completeWhen: pathClearsStructure },
    { title: "Pass-through anchors", body: "The robot does not stop at an intermediate target. It passes through and continues toward the next element." },
    { target: "path-canvas", title: "Select the target", body: "Click the target you added. Note the dashed circle around it.", task: "Select the translation target", placement: "right", cardPosition: "canvas-top-right", interact: ["path-canvas"], prepare: { tool: "select", clearSelection: true }, completeWhen: translationTargetIsSelected },
    { target: "path-canvas", title: "The handoff radius", body: "The dashed circle is the handoff radius. When the robot enters the circle, it starts driving toward the next element.", placement: "right", cardPosition: "canvas-top-right" },
    { target: "element-properties", title: "Resize the handoff", body: "Change Handoff Radius in Element Properties. Watch the circle and the turn location change.", task: "Change Handoff Radius", placement: "left", interact: ["element-properties"], prepare: { inspector: "open", inspectorTab: "elements" }, completeWhen: selectedHandoffRadiusWasEdited },
    { title: "Choose the radius", body: "A larger radius starts the turn earlier and cuts the corner. A smaller radius makes the robot visit the point closely." },
    { target: "transport-play", title: "Confirm the route", body: "Play the preview. Confirm the robot clears the structure.", task: "Play the preview", placement: "above", cardPosition: "canvas-top-right", interact: ["simulation-transport"], completeWhen: simulationWasPlayed },
    { title: "Fewest elements win", body: "Every added element creates another handoff. Use the fewest elements that describe the route clearly." },
  ],
};

export const planSpeedTour: TourDefinition = {
  id: "plan-speed",
  title: "Plan the Speed",
  summary: "Make a fast straight and a slow corner",
  durationMinutes: 7,
  completionMessage: "You generated a speed plan and took ownership of a corner cap.",
  markers: speedMarkers,
  practicePath: createSpeedPracticePath,
  steps: [
    { target: "lesson-corner", title: "Where, then how fast", body: "Geometry says where the robot drives. Constraints say how fast it may drive each part. This path has a sharp corner on purpose.", placement: "right", cardPosition: "canvas-top-right" },
    { title: "The main control", body: "Max translation velocity is the constraint you will use most. It caps how aggressively the robot approaches corners and the final pose." },
    { target: "inspector-constraints", title: "Open Constraints", body: "Click the highlighted Constraints tab.", task: "Open the Constraints tab", placement: "left", interact: ["inspector-constraints"], prepare: { inspector: "open", inspectorTab: "elements" }, completeWhen: constraintsTabIsOpen },
    { target: "max-velocity-card", title: "The range bar", body: "The bar under Max Velocity maps the path from start to end. A ranged constraint caps the speed over one span of the path.", placement: "left", prepare: { inspector: "open", inspectorTab: "constraints" } },
    { target: "max-velocity-card", title: "Ordinals", body: "Path elements are numbered in drive order: W1, T2, W3. A range covers elements from a start number to an end number.", placement: "left" },
    { target: "max-velocity-card", title: "Generate a plan", body: "Click Generate. The optimizer proposes velocity caps from the path shape.", task: "Generate velocity caps", placement: "left", interact: ["max-velocity-card"], completeWhen: velocityPlanWasGenerated },
    { target: "max-velocity-card", title: "Read the result", body: "The optimizer placed a lower cap at the corner. Straight spans stay near the global maximum.", placement: "left" },
    { target: "max-velocity-card", title: "Take ownership", body: "Click the corner range in the bar. Type a new value. The range becomes Manual.", task: "Edit a generated velocity cap", placement: "left", interact: ["max-velocity-card"], completeWhen: velocityValueWasEdited },
    { target: "max-velocity-card", title: "Manual ranges", body: "Manual ranges survive when you run the optimizer again. The optimizer proposes a plan, but you own it.", placement: "left" },
    { target: "transport-play", title: "Watch the slowdown", body: "Play the preview. Watch the robot slow before the corner and speed up after it.", task: "Play the preview", placement: "above", cardPosition: "canvas-top-right", interact: ["simulation-transport"], completeWhen: simulationWasPlayed },
    { title: "The recipe", body: "Keep open straights fast. Cap the elements around each tight turn. If the robot overshoots a handoff, lower the cap before you grow the radius." },
  ],
};

export const headingEventsTour: TourDefinition = {
  id: "heading-events",
  title: "Add Heading and Events",
  summary: "Face a game piece and start the intake",
  durationMinutes: 8,
  completionMessage: "You placed a heading change and a mechanism event on one route.",
  markers: behaviorMarkers,
  practicePath: createBehaviorPracticePath,
  steps: [
    { target: "lesson-game-piece", title: "The mission", body: "The robot must pick up the game piece at the end of this path. It must face the piece before it arrives, and the intake must start while it drives.", placement: "right", cardPosition: "canvas-top-right" },
    { title: "Rotation targets", body: "A rotation target changes the heading along a segment. It does not bend the route." },
    { target: "tool-rotation", title: "Add a rotation target", body: "Click the highlighted Rotation tool. Click on the segment to place the target.", task: "Place a rotation target on the segment", keys: ["3"], placement: "right", cardPosition: "canvas-top-right", interact: ["tool-rotation", "path-canvas"], completeWhen: () => elementWasAdded("rotation") },
    { target: "path-canvas", title: "Position on the segment", body: "A rotation target sits at a position along its segment. 0 is the segment start and 1 is the end. The editor calls this Rotation Pos.", placement: "right", cardPosition: "canvas-top-right" },
    { target: "element-properties", title: "Face the piece", body: "Set Rotation to 90 degrees. Set Rotation Pos to 0.5.", task: "Set Rotation to 90 and Rotation Pos to 0.5", placement: "left", interact: ["element-properties"], prepare: { inspector: "open", inspectorTab: "elements" }, completeWhen: rotationTargetConfigured },
    { target: "element-properties", title: "Profiled rotation", body: "Profiled rotation turns gradually as the robot progresses. Non-profiled rotation drives toward the new heading immediately. Keep Profiled on for this pickup.", placement: "left" },
    { target: "tool-event", title: "Add an event trigger", body: "Click the highlighted Event tool. Place the trigger on the segment after the rotation target.", task: "Place an event trigger after the rotation target", keys: ["4"], placement: "right", cardPosition: "canvas-top-right", interact: ["tool-event", "path-canvas"], completeWhen: () => elementWasAdded("event_trigger") },
    { target: "element-properties", title: "Name the action", body: "Set the event key to startIntake. Set its position to 0.7.", task: "Set the key and event position", placement: "left", interact: ["element-properties"], prepare: { inspector: "open", inspectorTab: "elements" }, completeWhen: eventTriggerConfigured },
    { title: "Geometric progress", body: "The event fires when the robot's progress along the segment passes the marker. Progress comes from the robot's position, not from time." },
    { title: "The key is a name", body: "The path stores only the key. Robot code registers the startIntake action for that key." },
    { target: "transport-play", title: "Watch the run", body: "Play the preview. Watch the robot turn during the segment and the event marker fire.", task: "Play the preview", placement: "above", cardPosition: "canvas-top-right", interact: ["simulation-transport"], completeWhen: simulationWasPlayed },
    { target: "transport-timeline", title: "Scrub the timeline", body: "Drag the timeline under the field. Stop just before the event marker, then just after it.", task: "Scrub the simulation timeline", placement: "above", cardPosition: "canvas-top-right", interact: ["simulation-transport"], completeWhen: simulationWasScrubbed },
    { title: "Check placement this way", body: "Scrubbing is how you verify rotation timing and event placement. Use it whenever a marker must line up with the field." },
  ],
};

export const verifyExportTour: TourDefinition = {
  id: "verify-export",
  title: "Verify and Export",
  summary: "Repair a path and prepare it for the robot",
  durationMinutes: 7,
  completionMessage: "You repaired the path and learned the checks that come before a robot run.",
  practicePath: createVerifyPracticePath,
  steps: [
    { title: "Ship it", body: "This path is almost ready for a robot. It has some problems. You will find them, fix them, and learn how to export." },
    { target: "path-health", title: "Open Path Health", body: "Click the highlighted Path Health icon. It lists structural problems in the current path.", task: "Open Path Health", placement: "below", interact: ["path-health"], completeWhen: pathHealthIsOpen },
    { target: "path-canvas", title: "Fix the off-field element", body: "One element is outside the field. Drag it back inside the field boundary.", task: "Drag the off-field waypoint onto the field", placement: "right", cardPosition: "canvas-top-left", interact: ["path-canvas"], prepare: { tool: "select", pathHealth: "closed" }, completeWhen: offFieldIssueIsClear },
    { target: "element-properties", title: "Fix the empty event", body: "One event trigger has no key. Select it and type a key name.", task: "Give the event trigger a key", placement: "left", cardPosition: "canvas-top-left", interact: ["path-canvas", "element-properties", "inspector-panel"], prepare: { inspector: "open", inspectorTab: "elements" }, completeWhen: emptyEventIssueIsClear },
    { target: "inspector-constraints", title: "Refresh stale caps", body: "The geometry changed after these caps were generated, so they are stale. Open Constraints and click Generate again.", task: "Open Constraints and generate the caps again", placement: "left", interact: ["inspector-panel"], prepare: { inspector: "open", inspectorTab: "elements" }, completeWhen: velocityPlanWasGenerated },
    { target: "settings-menu-entry", title: "Field and robot settings", body: "Settings holds the field selection and your robot's bumper size. The preview and Path Health use these values, so keep them accurate.", placement: "below" },
    { target: "save-status", title: "Save state", body: "This status shows Saved when your work is stored. In the browser, projects live in browser storage. The desktop app writes files to the folder you opened.", placement: "above" },
    { target: "export-menu-entry", title: "Export", body: "Export Autos Folder writes config.json and one JSON file per path. Copy the autos folder into src/main/deploy in the robot project.", placement: "below" },
    { title: "What the preview cannot prove", body: "The preview uses ideal motion. It does not model PID controllers, wheel slip, or command scheduling." },
    { title: "The validation sequence", body: "Check structure in the editor. Then run the path in WPILib simulation. Then test on the robot at low speed." },
    { target: "help-hub", title: "Keep going", body: "You can build, shape, speed-plan, and verify a path. The documentation covers every topic here in more depth.", placement: "below" },
  ],
};

export const tours: readonly TourDefinition[] = [
  buildFirstPathTour,
  shapeRouteTour,
  planSpeedTour,
  headingEventsTour,
  verifyExportTour,
];

export function findTour(tourId: string | null): TourDefinition | null {
  return tours.find((tour) => tour.id === tourId) ?? null;
}

import {
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
import {
  tourStore,
  type TourAction,
  type TourDefinition,
  type TourFeedback,
  type TourStep,
  type TourStepPreparation,
  type TourExperiment,
} from "./tourStore";
import {
  anchorPositions,
  buildMarkers,
  createBuildPath,
  createEventsPath,
  createHandoffPath,
  createHeadingPath,
  createMissionPath,
  createShapePath,
  createSpeedLessonPath,
  elementPositionSignature,
  mission,
  missionMarkers,
  near,
  practiceConfig,
} from "./tourScenario";
import {
  checkClearance,
  checkDelivery,
  checkEvent,
  checkMission,
  checkPlan,
  checkRadius,
  checkSpeed,
  feedback,
  speedCap,
} from "./tourChecks";
import { pathGroupsTour } from "./pathGroupsTour";

export const editorBasicsTourId = "build-first-path";
export const tourPracticePathName = "Tour practice";
let baselinePath: PathModel | null = null;
let baselineActions: Partial<Record<TourAction, number>> = {};
let baselineGeneration = 0;
const stepPaths = new Map<string, PathModel | null>();
export function createTourPracticePath() {
  return createBuildPath();
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
  const state = tourStore.getState();
  if (state.stepIndex === 0) stepPaths.clear();
  baselinePath = structuredClone(currentPath());
  baselineActions = { ...state.actions };
  baselineGeneration = generationCount();
  const title = findTour(state.activeTourId)?.steps[state.stepIndex]?.title;
  if (title) stepPaths.set(title, baselinePath);
}
function outcome(check: (path: PathModel) => TourFeedback): () => TourFeedback {
  return () => {
    const path = currentPath();
    return path
      ? check(path)
      : {
          complete: false,
          message:
            "Exit and reopen this lesson from Guided tours to restore the practice path.",
        };
  };
}
function action(action: TourAction, waiting: string, done: string) {
  return () =>
    feedback(
      (tourStore.getState().actions[action] ?? 0) >
        (baselineActions[action] ?? 0),
      waiting,
      done,
    );
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
function sameAnchors(
  path: PathModel,
  before: PathModel | null | undefined = baselinePath,
) {
  return (
    JSON.stringify(
      anchorPositions(path).map(({ x_meters, y_meters }) => [
        x_meters,
        y_meters,
      ]),
    ) ===
    JSON.stringify(
      before &&
        anchorPositions(before).map(({ x_meters, y_meters }) => [
          x_meters,
          y_meters,
        ]),
    )
  );
}
function sameCaps(path: PathModel, ordinals: number[]) {
  return (
    !!baselinePath &&
    ordinals.every(
      (ordinal) =>
        speedCap(path, ordinal)?.value ===
        speedCap(baselinePath!, ordinal)?.value,
    )
  );
}
const placement = (
  type: "waypoint" | "translation" | "rotation" | "event_trigger",
  total: number,
): (() => TourFeedback) =>
  outcome((path) => {
    const expected =
      (baselinePath?.path_elements.filter((element) => element.type === type)
        .length ?? 0) +
      total -
      (baselinePath?.path_elements.length ?? 0);
    const count = path.path_elements.filter(
      (element) => element.type === type,
    ).length;
    if (path.path_elements.length > total || count > expected)
      return {
        complete: false,
        message:
          "There are extra elements. Press ⌘Z or Ctrl+Z until only the requested elements remain.",
      };
    const validTypes = [
      "waypoint",
      "translation",
      "rotation",
      "event_trigger",
    ].every(
      (candidate) =>
        path.path_elements.filter((element) => element.type === candidate)
          .length ===
        (candidate === type
          ? expected
          : (baselinePath?.path_elements.filter(
              (element) => element.type === candidate,
            ).length ?? 0)),
    );
    if (path.path_elements.length === total && !validTypes)
      return {
        complete: false,
        message:
          "An element uses the wrong tool. Undo it, then choose the highlighted tool.",
      };
    return feedback(
      path.path_elements.length === total && validTypes,
      "Place " +
        (type === "waypoint"
          ? "two waypoints"
          : "one " +
            (type === "event_trigger" ? "event trigger" : type + " target")) +
        ". Press ⌘Z or Ctrl+Z if you placed the wrong element.",
      "Targets placed.",
    );
  });
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
const preserveObservation = outcome((path) =>
  feedback(
    tourPathIntent(path) === tourPathIntent(baselinePath),
    "The path changed. Undo or redo the edit to restore the preview.",
    "",
  ),
);
const observe = (title: string, body: string): TourStep => ({
  title,
  body,
  phase: "Observe",
  target: "transport-play",
  task: "Watch the robot reach End",
  interact: ["simulation-transport"],
  prepare: { simulation: "start", tool: "select" },
  validate: preserveObservation,
  check: action(
    "finishRun",
    "Press Play and watch the robot reach End.",
    "Preview complete.",
  ),
});
const compare = (
  kind: TourExperiment,
  title: string,
  body: string,
): TourStep => ({
  title,
  body,
  phase: "Observe",
  experiment: kind,
  validate: preserveObservation,
  task: "Replay both runs",
  check: action(
    "replay",
    "Open Compare runs and press Replay.",
    "Comparison complete.",
  ),
});
const plan = (): TourStep => ({
  title: "Update the constraints",
  body: "Click Generate if the Auto values are out of date. Manual values stay unchanged.",
  task: "Update any outdated Auto values",
  phase: "Review",
  target: "max-velocity-card",
  interact: ["max-velocity-card"],
  prepare: constraints(),
  check: outcome((path) => checkPlan(path, currentConfig())),
});
function guided(
  steps: TourStep[],
  initial: NonNullable<TourStep["elements"]>,
): TourStep[] {
  let counts = initial;
  return steps.map((step, index) => {
    if (step.elements) counts = step.elements;
    // Placement checks explain intermediate counts themselves.
    return {
      ...step,
      prepare:
        index === 0
          ? { ...step.prepare, simulation: "start", tool: "select" }
          : step.prepare,
      elements: step.lockInteractionOnComplete ? undefined : { ...counts },
    };
  });
}
const pickupMarkers = missionMarkers
  .filter(
    (marker) =>
      marker.id.includes("pickup") ||
      marker.kind === "game-piece" ||
      marker.id === "lesson-start-zone",
  )
  .map((marker) => ({
    ...marker,
    label: marker.id === "lesson-pickup-pose" ? "End" : marker.label,
  }));
const routeMarkers = missionMarkers
  .filter(
    (marker) => marker.kind !== "game-piece" && !marker.id.includes("pickup"),
  )
  .map((marker) => ({
    ...marker,
    label:
      marker.id === "lesson-goal-zone"
        ? "End"
        : marker.id === "lesson-delivery-pose"
          ? "End heading"
          : marker.label,
  }));
const speedMarkers = [
  ...routeMarkers,
  ...missionMarkers
    .filter((marker) => marker.id === "lesson-pickup-pose")
    .map((marker) => ({ ...marker, label: "First bend" })),
];

export const buildFirstPathTour: TourDefinition = {
  id: editorBasicsTourId,
  title: "Build a First Path",
  summary: "Place two points, preview, and revise",
  durationMinutes: 4,
  completionMessage: "Lesson complete.",
  markers: buildMarkers,
  practicePath: createTourPracticePath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "Start and End",
        body: "Build a path between two waypoints, then preview it. This lesson uses a temporary project with example robot settings.",
        phase: "Build",
      },
      {
        title: "Place two waypoints",
        body: "Select Waypoint and place Start. Select Waypoint again and place End. Their order in the list determines the drive order. Each waypoint also sets a heading.",
        task: "Place two waypoints",
        target: "tool-waypoint",
        interact: ["tool-waypoint", "path-canvas"],
        keys: ["1"],
        check: placement("waypoint", 2),
        lockInteractionOnComplete: true,
        elements: { waypoint: 2 },
        prepare: { tool: "select", clearSelection: true },
      },
      observe(
        "Preview the path",
        "Press Play and watch the robot travel from Start to End.",
      ),
      {
        title: "Move End",
        body: "Select End and drag it, use the arrow keys, or edit its coordinates. Keep Start in place.",
        task: "Move End while keeping Start fixed",
        target: "path-canvas",
        interact: ["path-canvas", "element-properties"],
        prepare: properties(endpoint),
        check: outcome((path) =>
          feedback(
            !!baselinePath &&
              elementPositionSignature(path.path_elements[0]) ===
                elementPositionSignature(baselinePath.path_elements[0]) &&
              elementPositionSignature(path.path_elements[1]) !==
                elementPositionSignature(baselinePath.path_elements[1]),
            "Move End. If you moved Start, undo that edit first.",
            "End moved.",
          ),
        ),
        keys: ["←", "↑", "↓", "→"],
      },
      {
        title: "Undo the move",
        body: "Press ⌘Z or Ctrl+Z to restore End’s position. If you moved it several times, undo each move.",
        task: "Return to the route before moving End",
        target: "path-canvas",
        interact: ["path-canvas"],
        prepare: { tool: "select" },
        keys: ["⌘/Ctrl", "Z"],
        check: outcome((path) =>
          feedback(
            sameAnchors(path, stepPaths.get("Move End")),
            "Undo until End returns to its original position.",
            "End’s original position restored.",
          ),
        ),
      },
      {
        title: "Set End’s position",
        body: "Move End into the marked End zone at X 15, Y 2.5. Keep Start in place.",
        task: "Place End in its marked zone",
        phase: "Challenge",
        target: "path-canvas",
        interact: ["path-canvas", "element-properties"],
        prepare: properties(endpoint),
        check: outcome((path) => {
          if (
            !baselinePath ||
            elementPositionSignature(path.path_elements[0]) !==
              elementPositionSignature(baselinePath.path_elements[0])
          )
            return {
              complete: false,
              message: "Keep Start fixed. Press ⌘Z or Ctrl+Z to undo its move.",
            };
          return checkDelivery(path, currentConfig(), "End");
        }),
        hints: [
          "The zone is on the right side of the field.",
          "Select End on the canvas to open its X and Y fields.",
        ],
      },
      observe(
        "Preview the change",
        "Press Play and check where the robot finishes.",
      ),
      {
        title: "Adding more targets",
        body: "Two waypoints define a straight path. Add intermediate targets when you need a bend or more clearance.",
        phase: "Review",
      },
    ],
    {},
  ),
};

export const shapeRouteTour: TourDefinition = {
  id: "shape-route",
  title: "Shape the Route",
  summary: "Use a bend, drive order, and bumper clearance",
  durationMinutes: 4,
  completionMessage: "Lesson complete.",
  markers: routeMarkers,
  practicePath: createShapePath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "Route around the structure",
        body: "The straight path crosses the structure. Add a translation target to route around it. Translation targets set position without setting heading.",
        target: "lesson-structure",
      },
      {
        title: "Add a translation target",
        body: "Select Translation and place a target above the structure, near X 10.8, Y 6.8. With End selected, the new target is added after End.",
        task: "Place one translation target",
        target: "tool-translation",
        interact: ["tool-translation", "path-canvas"],
        prepare: { selectElement: endpoint, tool: "select" },
        keys: ["2"],
        check: placement("translation", 3),
        lockInteractionOnComplete: true,
        elements: { waypoint: 2, translation: 1 },
      },
      {
        title: "Reorder the targets",
        body: "Drag the Translation row between Start and End, or select it and press Alt+↑.",
        task: "Put Translation between the waypoints",
        target: "inspector-panel",
        interact: ["inspector-panel"],
        prepare: properties(bend),
        keys: ["Alt", "↑"],
        check: outcome((path) =>
          feedback(
            isWaypoint(path.path_elements[0]) &&
              isTranslationTarget(path.path_elements[1]) &&
              isWaypoint(path.path_elements[2]),
            "Move Translation above End using its grip or Alt+↑.",
            "Order: Start, Translation, End.",
          ),
        ),
      },
      {
        title: "Leave bumper clearance",
        body: "Move the translation target until both segments clear the structure. The path line follows the robot’s center, so leave room for the bumper.",
        task: "Leave bumper clearance around the structure",
        target: "path-canvas",
        interact: ["path-canvas", "element-properties"],
        prepare: properties(bend),
        check: outcome((path) => checkClearance(path, currentConfig())),
        hints: [
          "Leave space on both sides of the bend.",
          "Try X 10.8, Y 6.8. Dragging and coordinate edits both work.",
        ],
      },
      observe(
        "Preview the turn",
        "Press Play. Watch the inside bumper as the robot turns. It can cut inside the drawn segments.",
      ),
      {
        title: "Adjust the bend",
        body: "Move the translation target to another position that clears the structure. Keep Start and End in their marked zones.",
        task: "Revise the bend and keep the preview clear",
        phase: "Challenge",
        target: "path-canvas",
        interact: ["path-canvas", "element-properties"],
        prepare: properties(bend),
        check: outcome((path) => {
          if (sameAnchors(path))
            return {
              complete: false,
              message: "Move the bend to try a different approach.",
            };
          if (
            !near(anchorPositions(path)[0], mission.start) ||
            !near(anchorPositions(path).at(-1), mission.delivery)
          )
            return {
              complete: false,
              message: "Keep Start and End in their marked zones.",
            };
          return checkClearance(path, currentConfig(), true);
        }),
        hints: [
          "A wider bend can leave more room for the bumper.",
          "Try shifting the bend left or right while keeping it above the structure.",
        ],
      },
      {
        title: "Choosing targets",
        body: "Use translation targets for bends that do not need a heading. Add targets where the route needs them.",
        phase: "Review",
      },
    ],
    { waypoint: 2 },
  ),
};

export const planSpeedTour: TourDefinition = {
  id: "plan-speed",
  title: "Plan the Speed",
  summary: "Adjust speed limits and split shared cells",
  durationMinutes: 5,
  completionMessage: "Lesson complete.",
  markers: speedMarkers,
  practicePath: createSpeedLessonPath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "Adjust an approach speed",
        body: "This path has generated speed limits. Lower the limit before the second turn, then compare the previews.",
      },
      {
        title: "Open Constraints",
        body: "Open the Constraints tab. Speed cells are on the left, beside the targets they approach. Handoff radii are on the right.",
        task: "Open the Constraints tab",
        target: "inspector-constraints",
        interact: ["inspector-constraints"],
        prepare: {
          inspector: "open",
          inspectorTab: "elements",
          tool: "select",
        },
        check: () =>
          feedback(
            !!document.querySelector(
              '[data-tour="inspector-constraints"][aria-selected="true"]',
            ),
            "Select the Constraints tab.",
            "Constraints open.",
          ),
      },
      {
        title: "Slow the second turn",
        body: "Set the selected speed limit to 1.2 m/s or less. The original run is saved for comparison. Keep the other limits unchanged.",
        task: "Set the second-turn limit to 1.2 m/s or less",
        target: "lesson-corner-speed",
        visible: ["max-velocity-card"],
        interact: ["max-velocity-card"],
        prepare: constraints(3),
        captureReference: true,
        phase: "Experiment",
        check: outcome((path) => {
          const result = checkSpeed(path, 3, 1.2);
          return result.complete
            ? feedback(
                sameAnchors(path) && sameCaps(path, [1, 2, 4]),
                "Keep the other speed limits and target positions unchanged.",
                "Second-turn limit set.",
              )
            : result;
        }),
        hints: [
          "Editing an Auto value makes that cell Manual.",
          "Select the second-turn speed cell to reopen its value field.",
        ],
        demo: "speed",
      },
      compare(
        "speed",
        "Compare the speeds",
        "Open Compare runs and press Replay. Watch the speed and time through the second turn.",
      ),
      {
        title: "Regenerate Auto values",
        body: "Click Generate. Auto values are recalculated; your Manual limit stays unchanged.",
        task: "Generate and keep the Manual limit",
        target: "max-velocity-card",
        interact: ["max-velocity-card"],
        prepare: constraints(3),
        check: outcome((path) =>
          feedback(
            generationCount() > baselineGeneration &&
              checkPlan(path, currentConfig()).complete &&
              checkSpeed(path, 3, 1.2).complete &&
              sameCaps(path, [3]),
            "Click Generate. Keep the second-turn limit unchanged.",
            "Constraints updated. Manual limit unchanged.",
          ),
        ),
      },
      {
        title: "Split a shared speed cell",
        body: "Select the cell covering the first bend. Click Split until that bend has its own cell.",
        task: "Give the first bend its own speed cell",
        target: "lesson-pickup-speed",
        visible: ["max-velocity-card"],
        interact: ["max-velocity-card"],
        prepare: constraints(2),
        check: outcome((path) =>
          feedback(
            speedCap(path, 2)?.start_ordinal === 2 &&
              speedCap(path, 2)?.end_ordinal === 2,
            "Select the cell covering the first bend and click Split.",
            "The first bend has its own speed cell.",
          ),
        ),
        hints: [
          "A tall cell applies one value to several approaches.",
          "Split changes the editable ranges. It does not add path targets.",
        ],
      },
      {
        title: "Slow the first bend",
        body: "Set its limit to 0.9 m/s or less. Keep the second-turn and End approach limits unchanged.",
        task: "Set the first-bend limit to 0.9 m/s or less",
        phase: "Challenge",
        target: "lesson-pickup-speed",
        visible: ["max-velocity-card"],
        interact: ["max-velocity-card"],
        prepare: constraints(2),
        check: outcome((path) => {
          const result = checkSpeed(path, 2, 0.9);
          return result.complete
            ? feedback(
                sameCaps(path, [3, 4]),
                "Undo changes to the second-turn and End limits. Edit only the first-bend limit.",
                "First-bend limit set.",
              )
            : result;
        }),
        hints: [
          "Use the cell aligned with the first translation target.",
          "Split a shared cell before changing the first-bend limit.",
        ],
      },
      observe(
        "Preview both approaches",
        "Press Play and watch the speed before the first bend and second turn.",
      ),
      {
        title: "Tune on the robot",
        body: "Use Auto values as a starting point. Adjust local limits through previewing and robot testing. The values in this lesson are examples.",
        phase: "Review",
      },
    ],
    { waypoint: 2, translation: 2 },
  ),
};

export const handoffsTour: TourDefinition = {
  id: "understand-handoffs",
  title: "Understand Handoffs",
  summary: "Watch the target change, then tune where it happens",
  durationMinutes: 5,
  completionMessage: "Lesson complete.",
  markers: routeMarkers.filter((marker) => marker.kind !== "pose"),
  practicePath: createHandoffPath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "Drive toward the active target",
        body: "BLine steers from the robot’s live position toward one translation target at a time. This bend shapes a pass-through route. Entering its handoff circle switches the target to End, without requiring a stop at the bend.",
        prepare: { inspector: "closed" },
      },
      {
        title: "Set a small radius",
        body: "Set the bend’s Manual radius to 0.25 m. The circle marks how close the robot’s center must get before steering switches to End. Keep the 1 m/s limits so only the handoff location changes.",
        task: "Set the bend radius to Manual 0.25 m",
        target: "max-velocity-card",
        interact: ["max-velocity-card"],
        prepare: { ...constraints(), selectElement: bend },
        check: outcome((path) => checkFixedRadius(path, 0.25)),
        hints: [
          "The distance chip is on the right of the speed ledger.",
          "Select the bend's radius chip to open its Manual value field.",
        ],
      },
      {
        ...observe(
          "Watch the small-circle handoff",
          "Press Play. Watch the steering line point at the bend, then switch to End when the robot’s center enters the circle. The robot keeps moving through the handoff.",
        ),
        prepare: { simulation: "start", tool: "select", inspector: "closed" },
      },
      {
        title: "Increase the radius",
        body: "The run you watched stays as a dashed trace. Set 1.5 m to switch toward End earlier. An earlier handoff gives the robot more room to change direction smoothly, but can cut farther inside the bend.",
        task: "Set a Manual radius of 1.5 m",
        phase: "Experiment",
        target: "max-velocity-card",
        interact: ["max-velocity-card"],
        prepare: { ...constraints(), selectElement: bend, simulation: "start" },
        captureReference: true,
        check: outcome((path) => checkFixedRadius(path, 1.5)),
      },
      {
        ...observe(
          "Watch the earlier handoff",
          "Press Play again. The solid steering line switches to End earlier than in your dashed 0.25 m run. Compare the handoff dots and the room each turn leaves around the structure.",
        ),
        prepare: { simulation: "start", tool: "select", inspector: "closed" },
      },
      {
        title: "Choose where to hand off",
        body: "Choose a radius between 0.25 and 1.5 m that leaves bumper clearance around the structure. Use the traces to decide how early the robot may leave the bend. Keep the target positions and 1 m/s limits unchanged.",
        task: "Set a radius with bumper clearance",
        phase: "Challenge",
        target: "max-velocity-card",
        interact: ["max-velocity-card"],
        prepare: { ...constraints(), selectElement: bend, simulation: "start" },
        check: outcome((path) => {
          const radius = checkRadius(path, 0.25, 1.5);
          if (!radius.complete) return radius;
          if (!sameAnchors(path) || !fixedHandoffSpeed(path))
            return {
              complete: false,
              message:
                "Keep the target positions and 1 m/s speed limits unchanged. Undo any edits to them.",
            };
          const clear = checkClearance(path, currentConfig(), true);
          return clear.complete
            ? clear
            : {
                complete: false,
                message:
                  "The preview leaves too little bumper clearance. Try a smaller radius to hand off closer to the bend.",
              };
        }),
        hints: [
          "Watch the inside bumper edge, not just the robot center.",
          "A larger radius lets the robot leave the bend sooner and can cut into the space beside the structure.",
        ],
      },
      {
        ...observe(
          "Test your chosen radius",
          "Press Play and check the bumper through the turn. Radius chooses where steering may switch. If the robot struggles to reach that region at speed, lower the approach velocity before enlarging the circle and changing the route.",
        ),
        prepare: { simulation: "start", tool: "select", inspector: "closed" },
      },
      {
        title: "Pass through, then finish",
        body: "End uses position and heading tolerances. This preview uses circle entry at intermediate targets. For ordinary pass-through points, the docs recommend enabling t-ratio handoffs in robot code: circle entry or enough projected progress can advance the target, avoiding a return to a missed circle.",
        phase: "Review",
      },
    ],
    { waypoint: 2, translation: 1 },
  ),
};
function fixedHandoffSpeed(path: PathModel) {
  return (
    path.constraints.max_velocity_meters_per_sec === 1 &&
    [1, 2, 3].every(
      (ordinal) =>
        speedCap(path, ordinal)?.value === 1 &&
        speedCap(path, ordinal)?.source !== "auto_velocity",
    )
  );
}
function checkFixedRadius(path: PathModel, radius: number) {
  return !fixedHandoffSpeed(path) || !sameAnchors(path)
    ? {
        complete: false,
        message:
          "Undo changes to the target positions or 1 m/s speed limits before comparing radii.",
      }
    : checkRadius(path, radius, radius);
}

export const controlHeadingTour: TourDefinition = {
  id: "control-heading",
  title: "Control Heading",
  summary: "Change facing direction independently of the route",
  durationMinutes: 4,
  completionMessage: "Lesson complete.",
  markers: pickupMarkers,
  practicePath: createHeadingPath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "Face the piece",
        body: "The path ends at Pickup. Add a rotation target so the robot faces the piece before reaching End.",
        target: "lesson-game-piece",
      },
      {
        title: "Add a rotation target",
        body: "Select Rotation and place a target along the segment. Its position determines where the heading target applies.",
        task: "Place one rotation target",
        target: "tool-rotation",
        interact: ["tool-rotation", "path-canvas"],
        prepare: { tool: "select", selectElement: 0 },
        keys: ["3"],
        check: placement("rotation", 3),
        lockInteractionOnComplete: true,
        elements: { waypoint: 1, translation: 1, rotation: 1 },
      },
      {
        title: "Set the heading",
        body: "Set Rotation to 90°, Rotation Pos to 0.5, and enable Profiled Rotation. Position 0.5 is halfway along the segment.",
        task: "Set a profiled 90° rotation at 0.5",
        target: "element-properties",
        interact: ["element-properties"],
        prepare: properties(rotation),
        demo: "heading",
        check: outcome((path) => checkHeading(path, true, 0.5, 0.5)),
        hints: [
          "Profiled changes the desired heading along the segment.",
          "Back followed by Next reselects the rotation target and opens its fields.",
        ],
      },
      {
        title: "Turn Profiled off",
        body: "Disable Profiled Rotation. Keep Rotation at 90° and Rotation Pos at 0.5. The desired heading changes immediately; the robot still takes time to turn.",
        task: "Turn Profiled off without moving the target",
        phase: "Experiment",
        target: "element-properties",
        interact: ["element-properties"],
        prepare: properties(rotation),
        captureReference: true,
        check: outcome((path) => checkHeading(path, false, 0.5, 0.5)),
      },
      compare(
        "heading",
        "Compare the heading",
        "Replay both runs. Watch the robot’s front edge and heading readout.",
      ),
      {
        title: "Set the heading earlier",
        body: "Enable Profiled Rotation and set Rotation Pos between 0.25 and 0.4. Keep Rotation at 90° and leave Start and End in place.",
        task: "Set Rotation Pos between 0.25 and 0.4",
        phase: "Challenge",
        target: "element-properties",
        interact: ["element-properties", "path-canvas"],
        prepare: properties(rotation),
        check: outcome((path) => checkHeading(path, true, 0.25, 0.4)),
        experiment: "heading",
        hints: [
          "Rotation Pos controls geometric progress along this approach.",
          "Enable Profiled Rotation, keep Rotation at 90°, and try Rotation Pos 0.35.",
        ],
      },
      {
        title: "Position and heading",
        body: "Translation targets set position. Rotation targets set heading. Waypoints combine both.",
        phase: "Review",
      },
    ],
    { waypoint: 1, translation: 1 },
  ),
};
function checkHeading(
  path: PathModel,
  profiled: boolean,
  minimum: number,
  maximum: number,
) {
  const target = path.path_elements.find(isRotationTarget);
  return feedback(
    !!target &&
      target.profiled_rotation === profiled &&
      Math.abs(target.rotation_radians - Math.PI / 2) < 0.02 &&
      target.t_ratio >= minimum - 0.01 &&
      target.t_ratio <= maximum + 0.01 &&
      sameAnchors(path),
    "Keep the route fixed. Set Rotation 90, Profiled " +
      (profiled ? "on" : "off") +
      ", and Rotation Pos " +
      (minimum === maximum ? minimum : minimum + " to " + maximum) +
      ".",
    "Heading set to 90°.",
  );
}

export const triggerActionsTour: TourDefinition = {
  id: "trigger-actions",
  title: "Trigger Actions",
  summary: "Place events and compare trigger times",
  durationMinutes: 4,
  completionMessage: "Lesson complete.",
  markers: pickupMarkers,
  practicePath: createEventsPath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "Start the intake",
        body: "Add an event to start the intake before reaching Pickup. Its key identifies an action registered in robot code.",
      },
      {
        title: "Add an event",
        body: "Select Event and place a trigger along the segment. The purple marker shows its position.",
        task: "Place one event trigger",
        target: "tool-event",
        interact: ["tool-event", "path-canvas"],
        prepare: { tool: "select", selectElement: rotation },
        keys: ["4"],
        check: placement("event_trigger", 4),
        lockInteractionOnComplete: true,
        elements: {
          waypoint: 1,
          translation: 1,
          rotation: 1,
          event_trigger: 1,
        },
      },
      {
        title: "Set the event key",
        body: "Set Lib Key to startIntake and Event Pos to 0.7. The key must match the action in robot code. Position 0.7 is 70% along the segment.",
        task: "Set startIntake at position 0.7",
        target: "element-properties",
        interact: ["element-properties"],
        prepare: properties(event),
        check: outcome((path) => checkEvent(path)),
        hints: [
          "The event diamond is separate from the heading marker.",
          "Back followed by Next reselects the event and opens its key and position fields.",
        ],
      },
      {
        title: "Find the trigger",
        body: "Drag the timeline through the event. The purple flash marks when startIntake triggers. The preview does not simulate the intake itself.",
        task: "Scrub around the intake event",
        phase: "Observe",
        target: "transport-timeline",
        interact: ["simulation-transport"],
        prepare: { simulation: "start", tool: "select" },
        check: action(
          "scrub",
          "Drag the timeline to inspect the intake event.",
          "Timeline inspected.",
        ),
      },
      {
        title: "Reduce the speed",
        body: "Change the shared speed limit from 2 m/s to 1 m/s. Keep the event at 0.7. The original run is saved.",
        task: "Set the shared speed limit to 1 m/s",
        phase: "Experiment",
        target: "max-velocity-card",
        interact: ["max-velocity-card"],
        prepare: constraints(2),
        captureReference: true,
        demo: "events",
        check: outcome((path) =>
          feedback(
            sameAnchors(path) &&
              !!baselinePath &&
              JSON.stringify(path.path_elements) ===
                JSON.stringify(baselinePath.path_elements) &&
              [1, 2].every(
                (ordinal) =>
                  speedCap(path, ordinal)?.value === 1 &&
                  speedCap(path, ordinal)?.source !== "auto_velocity",
              ),
            "Set the shared speed cell to 1 m/s. Keep the heading, event key, and event position unchanged.",
            "Speed set to 1 m/s. Event position unchanged.",
          ),
        ),
      },
      compare(
        "events",
        "Compare event times",
        "Replay both runs and compare the event times. The slower run triggers later, at the same position along the path.",
      ),
      {
        title: "Move the event earlier",
        body: "Set Event Pos between 0.55 and 0.65. Keep the key as startIntake, the rotation target at 0.5, and the speed limit at 1 m/s.",
        task: "Move the event earlier without changing its key",
        phase: "Challenge",
        target: "element-properties",
        interact: ["element-properties", "path-canvas"],
        prepare: properties(event),
        experiment: "events",
        check: outcome((path) => {
          const trigger = path.path_elements.find(isEventTrigger);
          const heading = path.path_elements.find(isRotationTarget);
          return feedback(
            !!trigger &&
              trigger.lib_key === "startIntake" &&
              trigger.t_ratio >= 0.55 &&
              trigger.t_ratio <= 0.65 &&
              !!heading &&
              heading.profiled_rotation &&
              Math.abs(heading.t_ratio - 0.5) < 0.01 &&
              Math.abs(heading.rotation_radians - Math.PI / 2) < 0.02 &&
              sameAnchors(path) &&
              sameCaps(path, [1, 2]),
            "Use startIntake at 0.55 to 0.65. Preserve the heading target, route, and speed.",
            "Event moved earlier.",
          );
        }),
        hints: [
          "Event position is geometric progress, not seconds.",
          "Try Event Pos 0.6.",
        ],
      },
      {
        title: "Waiting for an action",
        body: "Path following continues after an event triggers. To wait for a mechanism, split the routine into separate paths and handle the wait in robot code.",
        phase: "Review",
      },
    ],
    { waypoint: 1, translation: 1, rotation: 1 },
  ),
};

export const verifyExportTour: TourDefinition = {
  id: "verify-export",
  title: "Check and Export",
  summary: "Check a complete routine and export its files",
  durationMinutes: 5,
  completionMessage: "Lesson complete.",
  markers: missionMarkers,
  practicePath: () => createMissionPath(true),
  practiceConfig,
  steps: (
    [
      {
        title: "Complete the routine",
        prepare: { simulation: "start", tool: "select" },
        body: "Reach Pickup facing 90°, trigger startIntake on the approach, clear the structure, and finish in Delivery facing −90°. Trigger prepareDelivery before End.",
        phase: "Challenge",
      },
      {
        title: "Check Path Health",
        body: "Open Path Health and read the issues. These checks identify path errors; use the preview to check motion and clearance.",
        task: "Read Path Health",
        target: "path-health",
        visible: ["lesson-health-dialog"],
        interact: ["path-health", "lesson-health-dialog"],
        check: () =>
          feedback(
            !!document.querySelector(
              '[role="dialog"][aria-label="Path health"]',
            ),
            "Open Path Health at the bottom of the inspector.",
            "Read the issue list before continuing.",
          ),
      },
      {
        title: "Fix the path",
        body: "Move End into Delivery and fill in the missing startIntake key. Keep the required headings and events. Add or move bends as needed for clearance.",
        task: "Fix End and the intake event",
        phase: "Challenge",
        target: "path-canvas",
        interact: [
          "path-canvas",
          "inspector-panel",
          "element-properties",
          "max-velocity-card",
          "tool-waypoint",
          "tool-translation",
          "tool-rotation",
          "tool-event",
        ],
        prepare: { ...properties(endpoint), pathHealth: "closed" },
        check: outcome((path) => checkMission(path, currentConfig())),
        hints: [
          "Delivery is centered at X 15, Y 2.5. The unnamed event belongs on the Pickup approach.",
          "Set that event key to startIntake. Keep prepareDelivery on the final approach and leave room for the bumper.",
        ],
      },
      plan(),
      observe(
        "Preview the routine",
        "Check the heading at Pickup, both event flashes, bumper clearance, and the final position in Delivery.",
      ),
      {
        title: "Inspect the export",
        body: "Open each file below. config.json contains runtime motion defaults. project.json contains editor settings and bumper dimensions. The path file contains targets, constraints, and event keys.",
        task: "Inspect config.json, project.json, and the path file",
        phase: "Review",
        handoff: true,
        check: () =>
          feedback(
            ["inspectConfig", "inspectProject", "inspectPath"].every(
              (name) =>
                (tourStore.getState().actions[name as TourAction] ?? 0) >
                (baselineActions[name as TourAction] ?? 0),
            ),
            "Select all three files below. Downloading is optional.",
            "All three files inspected.",
          ),
      },
      {
        title: "Test on the robot",
        body: "Extract the autos folder into src/main/deploy. Register both event keys and check the robot’s motion limits, tolerances, and handoff settings. Run WPILib simulation, then test at low speed.",
        phase: "Review",
      },
    ] satisfies TourStep[]
  ).map((step, index) =>
    index > 2
      ? {
          ...step,
          validate: outcome((path) => checkMission(path, currentConfig())),
        }
      : step,
  ),
};
export const tours: readonly TourDefinition[] = [
  buildFirstPathTour,
  shapeRouteTour,
  planSpeedTour,
  handoffsTour,
  controlHeadingTour,
  triggerActionsTour,
  pathGroupsTour,
  verifyExportTour,
];
export function findTour(tourId: string | null) {
  return tours.find((tour) => tour.id === tourId) ?? null;
}

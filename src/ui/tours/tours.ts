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
      "The requested elements are in place.",
    );
  });
function pathIntent(path: PathModel | null) {
  return (
    path &&
    JSON.stringify({
      elements: path.path_elements,
      constraints: path.constraints,
      ranges: path.ranged_constraints.map(
        ({ key, value, start_ordinal, end_ordinal, source }) => ({
          key,
          value,
          start_ordinal,
          end_ordinal,
          source,
        }),
      ),
    })
  );
}
const preserveObservation = outcome((path) =>
  feedback(
    pathIntent(path) === pathIntent(baselinePath),
    "The route changed during observation. Undo or redo the change to restore the run.",
    "",
  ),
);
const observe = (title: string, body: string): TourStep => ({
  title,
  body,
  phase: "Observe",
  target: "transport-play",
  task: "Watch the preview reach the end",
  interact: ["simulation-transport"],
  prepare: { simulation: "start", tool: "select" },
  validate: preserveObservation,
  check: action(
    "finishRun",
    "Press Play and watch the robot reach the endpoint.",
    "The preview reached the end. Replay it or continue.",
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
  task: "Replay the focused comparison",
  check: action(
    "replay",
    "Open Compare your path and replay the comparison.",
    "You observed the comparison. Close it and continue when ready.",
  ),
});
const plan = (): TourStep => ({
  title: "Check the generated plan",
  body: "Generate updates Auto values and preserves your Manual choices. Continue once the plan matches the route.",
  task: "Check that constraints match the route",
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
const pickupMarkers = missionMarkers.filter(
  (marker) =>
    marker.id.includes("pickup") ||
    marker.kind === "game-piece" ||
    marker.id === "lesson-start-zone",
);
const routeMarkers = missionMarkers.filter(
  (marker) => marker.kind !== "game-piece" && !marker.id.includes("pickup"),
);

export const buildFirstPathTour: TourDefinition = {
  id: editorBasicsTourId,
  title: "Build a First Path",
  summary: "Place two points, preview, and revise",
  durationMinutes: 4,
  completionMessage:
    "You built, previewed, and revised a path. Shape the Route adds a bend and bumper clearance.",
  markers: buildMarkers,
  practicePath: createTourPracticePath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "A route to Delivery",
        body: "Build a route from Start to Delivery and preview it. These lessons use an example robot and motion settings. Leaving practice restores your own project.",
        phase: "Build",
      },
      {
        title: "Place the endpoints",
        body: "Choose Waypoint and place Start, then choose Waypoint again and place Delivery. The list gives their drive order; each waypoint also supplies a heading.",
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
        "Play your first path",
        "Press Play. Watch the robot travel between your two points. This is the basic loop: place, preview, adjust.",
      ),
      {
        title: "Move the destination",
        body: "Select the endpoint and drag it, nudge it with the arrow keys, or edit its coordinates. Watch the straight segment follow.",
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
            "End moved and the route updated.",
          ),
        ),
        keys: ["←", "↑", "↓", "→"],
      },
      {
        title: "Undo the change",
        body: "Undo restores the previous edit. Press ⌘Z or Ctrl+Z. If you moved the endpoint several times, undo each move.",
        task: "Return to the route before moving End",
        target: "path-canvas",
        interact: ["path-canvas"],
        prepare: { tool: "select" },
        keys: ["⌘/Ctrl", "Z"],
        check: outcome((path) =>
          feedback(
            sameAnchors(path, stepPaths.get("Move the destination")),
            "Undo until End returns to its original position.",
            "The original route is restored.",
          ),
        ),
      },
      {
        title: "Your turn: reach Delivery",
        body: "Put End inside the Delivery zone. You can drag it or type X 15, Y 2.5. Keep Start where you placed it.",
        task: "Finish inside Delivery",
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
          return checkDelivery(path, currentConfig());
        }),
        hints: [
          "The zone is on the right side of the field.",
          "Select End on the canvas to open its X and Y fields.",
        ],
      },
      observe(
        "Check your delivery",
        "Watch the revised path finish in Delivery. You can repeat this edit and preview loop on your own paths.",
      ),
      {
        title: "Keep the useful points",
        body: "Two waypoints make a useful first path. Add more position targets when the route needs a bend or clearance.",
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
  completionMessage:
    "You shaped the route with a translation target. Plan the Speed controls how the robot approaches those targets.",
  markers: routeMarkers,
  practicePath: createShapePath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "Make room for the robot",
        body: "The direct route crosses a structure. Add a translation target above it. A translation target adds position while leaving heading to separate targets.",
        target: "lesson-structure",
      },
      {
        title: "Add a bend",
        body: "Choose Translation and place one target above the structure, near X 10.8, Y 6.8. End is selected, so the new target will be appended after it.",
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
        title: "Put it in drive order",
        body: "Drag the Translation row between Start and End. You can also select it and use Alt plus an up arrow. Watch the route change as the list order changes.",
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
            "Move the Translation row above End using its grip or Alt plus an up arrow.",
            "The route visits Start, the bend, then Delivery.",
          ),
        ),
      },
      {
        title: "Clear the structure",
        body: "Move the bend until the straight segments leave room for the whole bumper. The line marks the robot center.",
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
        "Watch the bend",
        "The robot can pass an intermediate target and keep moving. Watch its inside bumper edge; the preview can cut inside the straight segments.",
      ),
      {
        title: "Your turn: a different clear route",
        body: "Move the bend to another useful position. Keep Start and Delivery in their zones, and leave clearance for the simulated bumper.",
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
              message: "Keep Start and Delivery in their marked zones.",
            };
          return checkClearance(path, currentConfig(), true);
        }),
        hints: [
          "A wider bend can leave more room for the bumper.",
          "Try shifting the bend left or right while keeping it above the structure.",
        ],
      },
      {
        title: "Use the fewest useful anchors",
        body: "Use a translation target for a bend that does not need its own heading. Keep enough targets to describe the route clearly, then tune the approach speeds.",
        phase: "Review",
      },
    ],
    { waypoint: 2 },
  ),
};

export const planSpeedTour: TourDefinition = {
  id: "plan-speed",
  title: "Plan the Speed",
  summary: "See a local slowdown before editing grouped cells",
  durationMinutes: 5,
  completionMessage:
    "You compared a local slowdown, kept a Manual cap through Generate, and split a shared cell.",
  markers: missionMarkers,
  practicePath: createSpeedLessonPath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "Where, then how fast",
        body: "This route already has a generated speed proposal. You own the final choices. Slow the approach to the second turn and compare the motion.",
      },
      {
        title: "Open Constraints",
        body: "Open Constraints. Speed cells are on the left, aligned with the targets they approach. Radius chips are on the right.",
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
            "The speed and radius ledger is open.",
          ),
      },
      {
        title: "Slow the second turn",
        body: "The selected cell controls the approach above and right of the structure. A reference is saved. Predict how lowering this cap will change that approach, then set 1.2 m/s.",
        task: "Set the second-turn cap to 1.2 m/s or less",
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
                "Keep the other approaches and geometry unchanged.",
                "Only the second-turn approach has a lower Manual cap.",
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
        "Watch the local slowdown",
        "Replay the corner comparison. Watch each speed readout and the time spent approaching the second turn. The dashed reference also remains on the main field.",
      ),
      {
        title: "Generate without losing your cap",
        body: "Click Generate. It recalculates Auto values while keeping your chosen Manual speed.",
        task: "Generate and preserve the Manual corner cap",
        target: "max-velocity-card",
        interact: ["max-velocity-card"],
        prepare: constraints(3),
        check: outcome((path) =>
          feedback(
            generationCount() > baselineGeneration &&
              checkPlan(path, currentConfig()).complete &&
              checkSpeed(path, 3, 1.2).complete &&
              sameCaps(path, [3]),
            "Click Generate and wait for it to finish. Keep the second-turn cap unchanged.",
            "Generation finished and your Manual corner cap is unchanged.",
          ),
        ),
      },
      {
        title: "Separate a shared approach",
        body: "Pickup may share a tall speed cell with Start. Select the cell covering Pickup and use Split until Pickup has its own cell. Separate cells let you change just one approach.",
        task: "Give Pickup its own speed cell",
        target: "lesson-pickup-speed",
        visible: ["max-velocity-card"],
        interact: ["max-velocity-card"],
        prepare: constraints(2),
        check: outcome((path) =>
          feedback(
            speedCap(path, 2)?.start_ordinal === 2 &&
              speedCap(path, 2)?.end_ordinal === 2,
            "Select the cell covering Pickup and click Split. If it is already separate, continue.",
            "Pickup has a separate speed cell.",
          ),
        ),
        hints: [
          "A tall cell applies one value to several approaches.",
          "Split changes the editable ranges. It does not add path targets.",
        ],
      },
      {
        title: "Your turn: slow Pickup",
        body: "Set Pickup to 0.9 m/s or less. Preserve your second-turn cap and the Delivery speed. This gives the pickup approach its own intentional slowdown.",
        task: "Slow Pickup while preserving the later approaches",
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
                "Restore the second-turn and Delivery caps, then edit only Pickup.",
                "Pickup is slower and the later approaches retain their caps.",
              )
            : result;
        }),
        hints: [
          "Use the cell aligned with the first translation target.",
          "If cells have been merged again, split Pickup out before changing its value.",
        ],
      },
      observe(
        "Watch the two slow approaches",
        "Watch the robot approach Pickup and then the second turn. Local caps let you spend time where your routine needs it.",
      ),
      {
        title: "Choose speeds through testing",
        body: "Auto is a starting proposal. Lower the local speed before a difficult turn, preview the change, then tune through robot testing. Practice values are examples, not robot recommendations.",
        phase: "Review",
      },
    ],
    { waypoint: 2, translation: 2 },
  ),
};

export const handoffsTour: TourDefinition = {
  id: "understand-handoffs",
  title: "Understand Handoffs",
  summary: "Compare radii with a fixed approach speed",
  durationMinutes: 4,
  completionMessage:
    "You compared handoff radii at the same speed and checked clearance using the simulated bumper.",
  markers: routeMarkers,
  practicePath: createHandoffPath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "When does the next target take over?",
        body: "The bend sets a position to approach. Its handoff radius lets the follower switch to the next target before reaching the center. This experiment keeps every speed cap at 1 m/s.",
      },
      {
        title: "Try a small handoff",
        body: "Select the bend's radius chip on the right. Keep it Manual and set 0.25 m. The speed stays fixed so you can isolate the radius change.",
        task: "Set the bend radius to Manual 0.25 m",
        target: "max-velocity-card",
        interact: ["max-velocity-card"],
        prepare: { ...constraints(), selectElement: bend },
        check: outcome((path) => checkFixedRadius(path, 0.25)),
        demo: "handoff",
        hints: [
          "The distance chip is on the right of the speed ledger.",
          "Select the bend's radius chip to open its Manual value field.",
        ],
      },
      {
        title: "Switch targets earlier",
        body: "The small-radius run is saved. Increase the same radius to 1.5 m. Predict where the robot will begin cutting toward Delivery.",
        task: "Set a Manual radius of 1.5 m",
        phase: "Experiment",
        target: "max-velocity-card",
        interact: ["max-velocity-card"],
        prepare: { ...constraints(), selectElement: bend },
        captureReference: true,
        check: outcome((path) => checkFixedRadius(path, 1.5)),
      },
      compare(
        "handoff",
        "Compare the corner",
        "Both runs use the same geometry and speed caps. Replay the focused corner and watch when each robot turns toward Delivery.",
      ),
      {
        title: "Your turn: keep the bumper clear",
        body: "Choose a radius from 0.25 to 1.5 m that keeps the simulated bumper clear. Keep the bend and 1 m/s speed caps fixed for this experiment.",
        task: "Find a clear handoff at the controlled speed",
        phase: "Challenge",
        target: "max-velocity-card",
        interact: ["max-velocity-card"],
        prepare: { ...constraints(), selectElement: bend },
        experiment: "handoff",
        check: outcome((path) => {
          const radius = checkRadius(path, 0.25, 1.5);
          if (!radius.complete) return radius;
          if (!sameAnchors(path) || !fixedHandoffSpeed(path))
            return {
              complete: false,
              message:
                "Keep the geometry and every 1 m/s speed cap unchanged. Undo any edits to them.",
            };
          return checkClearance(path, currentConfig(), true);
        }),
        hints: [
          "Watch the inside bumper edge, not just the robot center.",
          "Compare a smaller radius at this speed and check the resulting trace.",
        ],
      },
      {
        title: "A smaller circle is not always better",
        body: "At higher speed, a tiny circle can be missed and the follower may turn back. Lower the approach speed first, then tune radius and geometry together. Judge the actual motion.",
        phase: "Review",
        demo: "handoff",
      },
      {
        title: "Pass-through and finishing are different",
        body: "Intermediate radius controls handoffs. Final translation and rotation tolerances control completion. This preview uses circle handoffs; robot code can also enable projection handoffs after passing a target. Verify that behavior on your robot.",
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
          "Keep the geometry and every 1 m/s speed cap fixed. Undo any edits to them to restore the comparison.",
      }
    : checkRadius(path, radius, radius);
}

export const controlHeadingTour: TourDefinition = {
  id: "control-heading",
  title: "Control Heading",
  summary: "Change facing direction independently of the route",
  durationMinutes: 4,
  completionMessage:
    "You controlled heading without changing the route and compared profiled and non-profiled rotation.",
  markers: pickupMarkers,
  practicePath: createHeadingPath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "Face Pickup on arrival",
        body: "The robot travels straight to Pickup. Add a rotation target so its front faces the piece before arrival. The route geometry can stay exactly as it is.",
        target: "lesson-game-piece",
      },
      {
        title: "Add a rotation target",
        body: "Choose Rotation and place one target along the segment. It sets heading at a fraction of the approach.",
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
        title: "Face the piece",
        body: "Set Rotation to 90 degrees, Rotation Pos to 0.5, and enable Profiled. Position 0.5 means halfway along the segment, not halfway through its time.",
        task: "Set a profiled 90° rotation at 0.5",
        target: "element-properties",
        interact: ["element-properties"],
        prepare: properties(rotation),
        demo: "heading",
        check: outcome((path) => checkHeading(path, true, 0.5, 0.5)),
        hints: [
          "Profiled changes the heading setpoint across progress.",
          "Back followed by Next reselects the rotation target and opens its fields.",
        ],
      },
      {
        title: "Compare a fixed heading setpoint",
        body: "Your profiled run is saved. Turn Profiled off while keeping 90° and position 0.5. Non-profiled switches the desired heading for the active interval; the robot still takes time to turn.",
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
        "Watch the heading change",
        "Replay both approaches. Watch the front edge and heading readout while checking that both robots follow the same straight route.",
      ),
      {
        title: "Your turn: face Pickup earlier",
        body: "Enable Profiled again and move the 90° rotation target earlier, to a position from 0.25 to 0.4. Keep both position anchors fixed.",
        task: "Reach the profiled 90° target earlier",
        phase: "Challenge",
        target: "element-properties",
        interact: ["element-properties", "path-canvas"],
        prepare: properties(rotation),
        check: outcome((path) => checkHeading(path, true, 0.25, 0.4)),
        experiment: "heading",
        hints: [
          "Rotation Pos controls geometric progress along this approach.",
          "Set Profiled on, Rotation 90, and Rotation Pos 0.35 for one valid result.",
        ],
      },
      {
        title: "Position and heading are separate",
        body: "Translation targets shape the route. Rotation targets and waypoint headings control facing direction. Trigger Actions adds a named mechanism action along the same approach.",
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
    "The heading target is set and the route geometry is unchanged.",
  );
}

export const triggerActionsTour: TourDefinition = {
  id: "trigger-actions",
  title: "Trigger Actions",
  summary: "Connect event keys to geometric progress",
  durationMinutes: 4,
  completionMessage:
    "You placed a named event, inspected its trigger, and saw how changing speed changes its time.",
  markers: pickupMarkers,
  practicePath: createEventsPath,
  practiceConfig,
  steps: guided(
    [
      {
        title: "Start the intake on approach",
        body: "This path already faces Pickup. Add an event that starts the intake while the robot keeps moving. The event key connects the path to an action registered in robot code.",
      },
      {
        title: "Add an event trigger",
        body: "Choose Event and place one trigger along the approach. The purple marker shows where geometric progress will trigger it.",
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
        title: "Name the action",
        body: "Set the key to startIntake and Event Pos to 0.7. The exact key must match the action in robot code. Position 0.7 is 70% of the segment.",
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
        title: "Scrub the trigger",
        body: "Drag the timeline around the purple flash and startIntake label. The flash marks the action trigger. The preview does not simulate an intake mechanism.",
        task: "Scrub around the intake event",
        phase: "Observe",
        target: "transport-timeline",
        interact: ["simulation-transport"],
        prepare: { simulation: "start", tool: "select" },
        check: action(
          "scrub",
          "Drag the timeline to inspect the intake event.",
          "You inspected the run with the timeline.",
        ),
      },
      {
        title: "Change time without moving the event",
        body: "The 2 m/s run is saved. Reduce the shared approach cap to 1 m/s. Predict which will change: the trigger's time, its geometric position, or both.",
        task: "Set the shared approach cap to 1 m/s",
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
            "Speed changed while the event and route stayed fixed.",
          ),
        ),
      },
      compare(
        "events",
        "Same position, different time",
        "Replay both runs on the shared clock. Compare the event times shown under each lane. Both trigger at the same geometric position, with the slower run triggering later.",
      ),
      {
        title: "Your turn: start the intake earlier",
        body: "Move startIntake earlier on the route, to a position from 0.55 to 0.65. Keep it after the 0.5 rotation target and preserve the 1 m/s cap.",
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
            "The event now triggers earlier along the same approach.",
          );
        }),
        hints: [
          "Event position is geometric progress, not seconds.",
          "Event Pos 0.6 is one valid result.",
        ],
      },
      {
        title: "Triggering is not waiting",
        body: "An event starts its registered action while path following continues. If the robot must wait for a mechanism to finish, split the routine into paths and coordinate that wait in robot code.",
        phase: "Review",
      },
    ],
    { waypoint: 1, translation: 1, rotation: 1 },
  ),
};

export const verifyExportTour: TourDefinition = {
  id: "verify-export",
  title: "Verify and Hand Off",
  summary: "Repair the mission and inspect the actual robot files",
  durationMinutes: 5,
  completionMessage:
    "You repaired a complete routine and inspected the files that go to the robot.",
  markers: missionMarkers,
  practicePath: () => createMissionPath(true),
  practiceConfig,
  steps: (
    [
      {
        title: "Finish the pickup and delivery",
        prepare: { simulation: "start", tool: "select" },
        body: "Repair this routine so it reaches Pickup facing 90°, triggers startIntake, clears the structure, then reaches Delivery facing -90° with prepareDelivery on the final approach. Start with Path Health.",
        phase: "Challenge",
      },
      {
        title: "Open Path Health",
        body: "Read the issues, then repair the mission. Health checks catch structural problems; the field goals tell you what the routine should accomplish.",
        task: "Read Path Health",
        target: "path-health",
        visible: ["lesson-health-dialog"],
        interact: ["path-health", "lesson-health-dialog"],
        check: () =>
          feedback(
            !!document.querySelector(
              '[role="dialog"][aria-label="Path health"]',
            ),
            "Open Path Health above the field.",
            "Read the issue list before continuing.",
          ),
      },
      {
        title: "Repair the whole mission",
        body: "Fix the destination and missing intake key. Keep the pickup pose, both named actions, and bumper clearance. Use as many useful bends as your solution needs.",
        task: "Complete the pickup and delivery mission",
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
        "Run the complete routine",
        "Watch the pickup heading, intake flash, structure clearance, and final delivery. This kinematic preview helps inspect intent; robot simulation and physical testing check the real behavior.",
      ),
      {
        title: "Inspect the robot handoff",
        body: "Inspect these actual files from your repaired project. config.json supplies runtime motion defaults; project.json preserves editor organization and bumper dimensions. The path file carries the route, constraints, and event keys.",
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
            "You inspected the runtime defaults, editor metadata, and path contents.",
          ),
      },
      {
        title: "From preview to robot",
        body: "Extract autos into src/main/deploy in the robot project. Register both event keys and verify motion limits, tolerances, and handoff settings in robot code. Run WPILib simulation, then a low-speed robot test. Keep a project archive below to edit this practice later.",
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
  verifyExportTour,
];
export function findTour(tourId: string | null) {
  return tours.find((tour) => tour.id === tourId) ?? null;
}

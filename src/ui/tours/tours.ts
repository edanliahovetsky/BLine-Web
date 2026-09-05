import {
  isEventTrigger,
  isRotationTarget,
  type PathElement,
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
} from "./tourStore";
import {
  anchorPositions,
  buildMarkers,
  createBuildPath,
  createHeadingPath,
  createMissionPath,
  createShapePath,
  createSpeedPath,
  elementPositionSignature,
  geometrySignature,
  mission,
  missionMarkers,
  near,
  practiceConfig,
} from "./tourScenario";
import {
  checkClearance,
  checkDelivery,
  checkEvent,
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
let middlePosition: string | null = null;
export function createTourPracticePath() {
  middlePosition = null;
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
  baselinePath = structuredClone(currentPath());
  baselineActions = { ...tourStore.getState().actions };
  baselineGeneration = generationCount();
}
function outcome(check: (path: PathModel) => TourFeedback): () => TourFeedback {
  return () => {
    const path = currentPath();
    return path
      ? check(path)
      : { complete: false, message: "Open the practice path." };
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
function added(type: PathElement["type"], total?: number) {
  return outcome((path) => {
    const complete =
      path.path_elements.length > (baselinePath?.path_elements.length ?? 0) &&
      (!total || path.path_elements.length === total) &&
      path.path_elements.some((element) => element.type === type);
    if (complete && type === "waypoint" && total === 3)
      middlePosition = elementPositionSignature(
        path.path_elements[selectionStore.getState().selectedElementIndex ?? 2],
      );
    return feedback(
      complete,
      `Place ${total === 2 ? "two waypoints" : "one " + (type === "event_trigger" ? "event trigger" : type)} on the field.`,
      "The new elements are in place.",
    );
  });
}
const observe = (title: string, body: string): TourStep => ({
  title,
  body,
  phase: "Observe",
  target: "transport-play",
  task: "Watch a complete preview run",
  interact: ["simulation-transport"],
  prepare: { simulation: "start" },
  check: action(
    "finishRun",
    "Press Play and let the preview reach the end.",
    "You watched the full run. Continue or replay it.",
  ),
});
const plan = (): TourStep => ({
  title: "Regenerate the constraints",
  body: "Generate recalculates Auto constraints while preserving Manual values. If this plan already matches the route, you can continue.",
  task: "Check that the plan matches the route",
  phase: "Review",
  target: "max-velocity-card",
  interact: ["max-velocity-card"],
  prepare: { inspector: "open", inspectorTab: "constraints" },
  check: outcome((path) => checkPlan(path, currentConfig())),
});
const compare = (kind: "handoff" | "speed", title: string): TourStep => ({
  title,
  body: "Open Compare your path and replay both lanes. The saved reference shows what changed. Use half speed or focus on the corner to look closely.",
  task: "Replay the comparison to its end",
  phase: "Observe",
  experiment: kind,
  check: action(
    "replay",
    "Open the comparison and let it finish playing.",
    "Comparison complete. You can replay or continue.",
  ),
});
const saveReference = (kind: "handoff" | "speed"): TourStep => ({
  title: "Keep a reference",
  body: "Open Compare your path and save the current path as a reference. It stays available after you edit the radius or speed.",
  task: "Save the current path as a reference",
  phase: "Experiment",
  experiment: kind,
  check: action(
    "reference",
    "Open the comparison and choose Save current as reference.",
    "Reference saved. Close the comparison, then continue to the edit.",
  ),
});

export const buildFirstPathTour: TourDefinition = {
  id: editorBasicsTourId,
  title: "Build a First Path",
  summary: "Build and revise a delivery route",
  durationMinutes: 6,
  completionMessage:
    "You can place, order, and revise a route. Shape the Route adds clearance around an obstacle.",
  markers: buildMarkers,
  practicePath: createTourPracticePath,
  practiceConfig,
  steps: [
    {
      title: "A route to Delivery",
      body: "Build a route from Start to Delivery. Each point is visited in list order. This practice workspace restores your own project when you leave.",
      phase: "Build",
    },
    {
      target: "tool-waypoint",
      title: "Place the endpoints",
      body: "Choose Waypoint and place a point near Start. Choose Waypoint again and place a second near Delivery. You can refine their positions later.",
      task: "Place two waypoints",
      keys: ["1"],
      interact: ["tool-waypoint", "path-canvas"],
      check: added("waypoint", 2),
      lockInteractionOnComplete: true,
    },
    {
      target: "inspector-panel",
      title: "Start and End",
      body: "The top row is Start and the bottom row is End. Their arrows also set the robot heading at those positions.",
      prepare: { inspector: "open", inspectorTab: "elements" },
      visible: ["inspector-panel"],
    },
    {
      target: "tool-waypoint",
      title: "Add a middle waypoint",
      body: "Place one more waypoint between your endpoints. With End selected, the new point is appended to the list.",
      task: "Place one middle waypoint",
      keys: ["1"],
      interact: ["tool-waypoint", "path-canvas"],
      prepare: { selectElement: 1 },
      check: added("waypoint", 3),
      lockInteractionOnComplete: true,
    },
    {
      target: "inspector-panel",
      title: "Put it in drive order",
      body: "Drag row 3 above row 2. Your new point should become the middle row, and the original destination should be last again.",
      task: "Drag the bottom row above the second row",
      interact: ["inspector-panel"],
      prepare: { inspector: "open", inspectorTab: "elements" },
      check: outcome((path) =>
        feedback(
          path.path_elements.length === 3 &&
            !!middlePosition &&
            elementPositionSignature(path.path_elements[1]) === middlePosition,
          "Drag using the grip on the bottom row.",
          "The route now visits Start, your middle point, then Delivery.",
        ),
      ),
      hints: [
        "List order is drive order. Watch the path segments while reordering.",
        "Use the row grip at the left edge of the inspector list.",
      ],
    },
    {
      target: "path-canvas",
      title: "Move an element",
      body: "Drag the middle waypoint. The route updates as the waypoint moves.",
      task: "Move the middle waypoint",
      keys: ["←", "↑", "↓", "→"],
      interact: ["path-canvas"],
      prepare: { tool: "select", selectElement: 1 },
      check: outcome((path) =>
        feedback(
          !!baselinePath &&
            elementPositionSignature(path.path_elements[1]) !==
              elementPositionSignature(baselinePath.path_elements[1]),
          "Move the middle point on the field.",
          "The middle point moved and both connected segments followed.",
        ),
      ),
    },
    {
      target: "element-properties",
      title: "Type exact values",
      body: "Put the final waypoint at the center of Delivery. Set X to 15 and Y to 2.5 in Element Properties.",
      task: "Set the final waypoint to X 15, Y 2.5",
      interact: ["element-properties"],
      prepare: {
        inspector: "open",
        inspectorTab: "elements",
        selectElement: 2,
      },
      check: outcome((path) =>
        feedback(
          near(anchorPositions(path).at(-1), mission.delivery, 0.02),
          "Set the selected endpoint to X 15 and Y 2.5.",
          "The endpoint is at the center of Delivery.",
        ),
      ),
    },
    observe(
      "Play the preview",
      "Watch the robot follow the list order from Start through the middle point to Delivery.",
    ),
    {
      title: "Your turn: revise the approach",
      body: "Change the route by moving only the middle waypoint. Keep both endpoints fixed, then consider how the new approach differs.",
      task: "Revise the middle while preserving both endpoints",
      phase: "Challenge",
      target: "path-canvas",
      interact: ["path-canvas", "element-properties"],
      prepare: { tool: "select", selectElement: 1 },
      check: outcome((path) => {
        const before = baselinePath?.path_elements;
        const after = path.path_elements;
        return feedback(
          !!before &&
            after.length === 3 &&
            elementPositionSignature(before[0]) ===
              elementPositionSignature(after[0]) &&
            elementPositionSignature(before[2]) ===
              elementPositionSignature(after[2]) &&
            elementPositionSignature(before[1]) !==
              elementPositionSignature(after[1]),
          "Move the middle waypoint while leaving Start and End at their original positions.",
          "You changed the approach without moving the endpoints.",
        );
      }),
      hints: [
        "The middle waypoint controls the approach from both directions.",
        "Restart exercise restores the route you had when this challenge began.",
      ],
    },
    observe(
      "Check your revision",
      "Watch the revised route. In the next lesson, the robot must also leave room for its bumper around a field structure.",
    ),
    {
      title: "Keep building",
      body: "A waypoint provides a position and heading. Use the ordered list to choose when the robot visits each one.",
      phase: "Review",
    },
  ],
};

export const shapeRouteTour: TourDefinition = {
  id: "shape-route",
  title: "Shape the Route",
  summary: "See how clearance and handoff radius interact",
  durationMinutes: 8,
  completionMessage:
    "You compared two handoffs and checked the simulated bumper around a structure.",
  markers: missionMarkers.filter(
    (marker) => marker.kind !== "game-piece" && !marker.id.includes("pickup"),
  ),
  practicePath: createShapePath,
  practiceConfig,
  steps: [
    {
      title: "The route has a problem",
      body: "The direct route to Delivery crosses a structure. Add a bend above it, leaving room for the whole robot.",
      target: "lesson-structure",
      phase: "Build",
    },
    {
      title: "Bend the route",
      body: "A translation target adds position without a heading. Select Translation and place one above the structure, near X 10.8, Y 6.8.",
      task: "Add one translation target above the structure",
      target: "tool-translation",
      keys: ["2"],
      interact: ["tool-translation", "path-canvas"],
      prepare: { selectElement: 0 },
      check: added("translation", 3),
      lockInteractionOnComplete: true,
    },
    {
      title: "Clear the structure",
      body: "Move the bend until both straight segments leave room for the bumper. The preview may cut farther inside the bend.",
      task: "Leave bumper clearance around the structure",
      target: "path-canvas",
      interact: ["path-canvas"],
      prepare: { tool: "select", selectElement: 1 },
      check: outcome((path) => checkClearance(path, currentConfig())),
      hints: [
        "The line marks the robot center. Its bumper extends beyond that line.",
        "Try moving the bend higher, near X 10.8, Y 6.8.",
      ],
    },
    {
      title: "Tune the handoff",
      body: "In Constraints, select the radius chip on the right beside the bend. Choose Manual and set 0.25 m. The robot will visit close to that point.",
      task: "Set the bend radius to Manual 0.25 m",
      target: "max-velocity-card",
      interact: ["max-velocity-card"],
      prepare: {
        inspector: "open",
        inspectorTab: "constraints",
        selectElement: 1,
      },
      check: outcome((path) => checkRadius(path, 0.25, 0.25)),
      hints: [
        "Radius controls when the follower hands off to the next anchor.",
        "Distance chips are on the right; speed cells are on the left.",
      ],
      demo: "handoff",
    },
    saveReference("handoff"),
    {
      title: "Start the turn earlier",
      body: "Increase the same Manual radius to 1.5 m. Watch the circle and preview curve change while you edit.",
      task: "Set a Manual radius of 1.5 m",
      target: "max-velocity-card",
      interact: ["max-velocity-card"],
      prepare: { inspector: "open", inspectorTab: "constraints" },
      check: outcome((path) => checkRadius(path, 1.5, 1.5)),
      phase: "Experiment",
      demo: "handoff",
      hints: [
        "A larger handoff radius switches to the next anchor sooner.",
        "Use the same distance chip on the right, then compare the saved path.",
      ],
    },
    compare("handoff", "Compare the corner"),
    {
      title: "Your turn: keep the bumper clear",
      body: "Choose a radius and bend position that keep the simulated bumper clear. A small radius or a wider route can both work.",
      task: "Find a clear simulated route",
      phase: "Challenge",
      target: "max-velocity-card",
      interact: ["max-velocity-card", "path-canvas"],
      prepare: {
        tool: "select",
        selectElement: 1,
        inspector: "open",
        inspectorTab: "constraints",
      },
      check: outcome((path) => checkClearance(path, currentConfig(), true)),
      experiment: "handoff",
      hints: [
        "If the robot cuts too close, reduce the radius or move the bend farther out.",
        "Compare the new trace with your reference and look at the bumper edge.",
      ],
    },
    plan(),
    observe(
      "Confirm the route",
      "Watch the full preview. Check the inside edge of the bumper as the robot passes the structure.",
    ),
    {
      title: "Position and handoff work together",
      body: "The target sets the planned route. Its handoff radius changes how closely the follower visits it. Judge clearance using the simulated bumper too.",
      phase: "Review",
    },
  ],
};

export const planSpeedTour: TourDefinition = {
  id: "plan-speed",
  title: "Plan the Speed",
  summary: "Compare a turn, preserve a cap, tune the delivery",
  durationMinutes: 8,
  completionMessage:
    "You tuned two approaches and verified that generation preserved a Manual cap.",
  markers: missionMarkers,
  practicePath: createSpeedPath,
  practiceConfig,
  steps: [
    {
      title: "Where, then how fast",
      body: "This route passes Pickup, turns above the structure, and approaches Delivery. Geometry sets where it drives; speed caps set how it approaches each anchor.",
      phase: "Build",
    },
    {
      title: "Open Constraints",
      body: "Open Constraints. Speed cells are on the left; the aligned distance chips on the right control handoff radius.",
      task: "Open the Constraints tab",
      target: "inspector-constraints",
      interact: ["inspector-constraints"],
      prepare: { inspector: "open", inspectorTab: "elements" },
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
      ...plan(),
      title: "Generate a plan",
      body: "Generate proposes speeds from the route and robot settings. Each speed cell controls the approach to its matching anchor.",
    },
    {
      title: "Find the second turn",
      body: "The highlighted speed cell controls the approach to the second translation target, above and right of the structure. Its row matches that target in drive order.",
      target: "lesson-corner-speed",
      visible: ["max-velocity-card"],
      phase: "Observe",
    },
    {
      title: "Give the turn its own speed cell",
      body: "Generate can combine adjacent approaches with the same speed. If the highlighted cell spans several rows, select it and click Split. Repeat on the part containing the second turn until that row has its own cell.",
      task: "Give the second turn a separate speed cell",
      target: "lesson-corner-speed",
      visible: ["max-velocity-card"],
      interact: ["max-velocity-card"],
      check: outcome((path) => {
        const cap = speedCap(path, 3);
        return feedback(
          cap?.start_ordinal === 3 && cap.end_ordinal === 3,
          "Split the highlighted segment until only the second-turn row is covered.",
          "This cell now controls only the approach to the second turn.",
        );
      }),
      hints: [
        "A tall cell shares one value across several approaches.",
        "Select the cell, then use Split below its value. Select the part covering the turn again if it needs another split.",
      ],
      hintTargets: ["lesson-corner-speed"],
    },
    saveReference("speed"),
    {
      title: "Take ownership",
      body: "Select the highlighted speed cell for the second turn. Set its speed to 1.2 m/s. Editing the value makes it Manual.",
      task: "Cap the second turn at 1.2 m/s or less",
      target: "lesson-corner-speed",
      visible: ["max-velocity-card"],
      interact: ["max-velocity-card"],
      check: outcome((path) => checkSpeed(path, 3, 1.2)),
      phase: "Experiment",
      hints: [
        "Each cell applies to an approach, so use the cell aligned with the second translation target.",
        "The speed value is on the left. Do not edit the radius distance chip.",
      ],
      hintTargets: ["lesson-corner-speed"],
      demo: "speed",
    },
    compare("speed", "Watch the slowdown"),
    {
      title: "Generate without losing your cap",
      body: "Click Generate again. The Manual corner cap should stay at your chosen value while the Auto plan is recalculated.",
      task: "Generate and preserve the Manual corner speed",
      target: "max-velocity-card",
      interact: ["max-velocity-card"],
      check: outcome((path) =>
        feedback(
          generationCount() > baselineGeneration &&
            checkPlan(path, currentConfig()).complete &&
            checkSpeed(path, 3, 1.2).complete &&
            speedCap(path, 3)?.value ===
              (baselinePath ? speedCap(baselinePath, 3)?.value : undefined),
          "Click Generate, then check that the corner cap stays Manual and unchanged.",
          "Generation finished and your Manual corner cap stayed unchanged.",
        ),
      ),
    },
    {
      title: "Your turn: a gentle delivery",
      body: "Slow the final approach to Delivery to 0.8 m/s or less. Keep the Manual second-turn cap unchanged.",
      task: "Tune Delivery while preserving the turn cap",
      target: "lesson-delivery-speed",
      interact: ["max-velocity-card"],
      visible: ["max-velocity-card"],
      phase: "Challenge",
      check: outcome((path) => {
        const result = checkSpeed(path, 4, 0.8);
        return result.complete
          ? feedback(
              speedCap(path, 3)?.value ===
                (baselinePath ? speedCap(baselinePath, 3)?.value : undefined),
              "Restore the second-turn cap to the value it had before this challenge.",
              "Delivery is slower and the second-turn cap is unchanged.",
            )
          : result;
      }),
      hints: [
        "The last speed cell belongs to the final waypoint.",
        "If one cap spans both approaches, split the segment before changing Delivery.",
      ],
      hintTargets: ["lesson-delivery-speed"],
      experiment: "speed",
    },
    observe(
      "Watch both approaches",
      "Watch the second turn and then Delivery. Notice the extra time the final slow approach adds.",
    ),
    {
      title: "Tune the approach that needs it",
      body: "Start with a generated plan, then own the specific caps your route needs. Use the comparison to see the time and motion cost of a lower cap.",
      phase: "Review",
    },
  ],
};

export const headingEventsTour: TourDefinition = {
  id: "heading-events",
  title: "Add Heading and Events",
  summary: "Face Pickup and start the intake on approach",
  durationMinutes: 8,
  completionMessage:
    "You aligned the pickup heading and moved an intake event using geometric progress.",
  markers: missionMarkers.filter(
    (marker) =>
      marker.id.includes("pickup") ||
      marker.kind === "game-piece" ||
      marker.id === "lesson-start-zone",
  ),
  practicePath: createHeadingPath,
  practiceConfig,
  steps: [
    {
      title: "Face Pickup on arrival",
      body: "The target pose puts the front bumper at the game piece. Add a 90° heading and startIntake before arrival. The event names a robot-code action; the preview shows its trigger.",
      phase: "Build",
      target: "lesson-game-piece",
    },
    {
      title: "Add a rotation target",
      body: "Choose Rotation and place one target along the segment. It changes heading without bending the route.",
      task: "Place one rotation target",
      target: "tool-rotation",
      keys: ["3"],
      interact: ["tool-rotation", "path-canvas"],
      check: added("rotation", 3),
      lockInteractionOnComplete: true,
    },
    {
      title: "Face the piece",
      body: "Set Rotation to 90 degrees and Rotation Pos to 0.5. Keep Profiled on so heading changes across the approach.",
      task: "Set a profiled 90° rotation at 0.5",
      target: "element-properties",
      interact: ["element-properties"],
      prepare: { inspector: "open", inspectorTab: "elements" },
      check: outcome((path) => {
        const rotation = path.path_elements.find(isRotationTarget);
        return feedback(
          !!rotation &&
            rotation.profiled_rotation &&
            Math.abs(rotation.rotation_radians - Math.PI / 2) < 0.02 &&
            Math.abs(rotation.t_ratio - 0.5) < 0.011,
          "Set Rotation 90, Rotation Pos 0.5, and enable Profiled.",
          "The robot has a profiled 90° heading target halfway along the segment.",
        );
      }),
      hints: [
        "Position 0 is the segment start and 1 is its end.",
        "Profiled changes heading gradually; the worked example compares both modes.",
      ],
      demo: "heading",
    },
    observe(
      "Watch the heading",
      "Watch the front of the robot turn toward Pickup as it approaches. Its route remains the same straight segment.",
    ),
    {
      title: "Add an event trigger",
      body: "Choose Event and place one trigger after the rotation target along the segment.",
      task: "Place one event trigger",
      target: "tool-event",
      keys: ["4"],
      interact: ["tool-event", "path-canvas"],
      check: added("event_trigger", 4),
      lockInteractionOnComplete: true,
    },
    {
      title: "Name the action",
      body: "Set the key to startIntake and the event position to 0.7. Robot code must register the action for that exact key.",
      task: "Set startIntake at position 0.7",
      target: "element-properties",
      interact: ["element-properties"],
      prepare: { inspector: "open", inspectorTab: "elements" },
      check: outcome((path) => checkEvent(path)),
    },
    observe(
      "Watch the run",
      "Watch the robot turn and flash purple as geometric progress reaches the event marker. The flash marks the trigger, not a simulated intake mechanism.",
    ),
    {
      title: "Scrub the timeline",
      body: "Drag the timeline around the purple flash. The event is attached to progress along the segment, so changing speed changes its time without changing its geometric position.",
      task: "Scrub around the event",
      target: "transport-timeline",
      interact: ["simulation-transport"],
      check: action(
        "scrub",
        "Drag the timeline to inspect the event during the approach.",
        "You inspected the run with the timeline.",
      ),
      phase: "Observe",
    },
    {
      title: "Your turn: start the intake earlier",
      body: "Move the event to position 0.6 while keeping its key and the profiled 90° rotation at 0.5. It should trigger earlier on the same route.",
      task: "Move startIntake to 0.6",
      phase: "Challenge",
      target: "element-properties",
      interact: ["path-canvas", "inspector-panel", "element-properties"],
      prepare: { inspector: "open", inspectorTab: "elements" },
      check: outcome((path) => {
        const result = checkEvent(path, 0.6);
        const rotation = path.path_elements.find(isRotationTarget);
        return result.complete
          ? feedback(
              !!rotation &&
                rotation.profiled_rotation &&
                Math.abs(rotation.rotation_radians - Math.PI / 2) < 0.02 &&
                Math.abs(rotation.t_ratio - 0.5) < 0.011 &&
                geometrySignature(path) !== "",
              "Keep the rotation at 90° and 0.5 with Profiled enabled.",
              "The intake event moved earlier and the heading target is preserved.",
            )
          : result;
      }),
      hints: [
        "The event position is a fraction of the segment, not seconds.",
        "Select the event diamond or its inspector row, then change Event Pos.",
      ],
    },
    observe(
      "Check the earlier trigger",
      "Watch for the purple flash closer to the rotation marker. The robot should still reach Pickup facing 90°.",
    ),
    {
      title: "Position, heading, and action",
      body: "Translation sets the route, rotation sets heading, and an event key triggers a registered action. Verify and Export combines these in a complete pickup and delivery routine.",
      phase: "Review",
    },
  ],
};

export const verifyExportTour: TourDefinition = {
  id: "verify-export",
  title: "Verify and Export",
  summary: "Repair and hand off a pickup and delivery routine",
  durationMinutes: 9,
  completionMessage:
    "You repaired a complete routine and inspected the files that go to the robot.",
  markers: missionMarkers,
  practicePath: () => createMissionPath(true),
  practiceConfig,
  steps: [
    {
      title: "Finish the pickup and delivery",
      body: "This routine turns toward Pickup, starts the intake, routes above the structure, and prepares Delivery. Its destination is misplaced and the intake event has no key. Repair it and inspect the export.",
      phase: "Challenge",
    },
    {
      title: "Open Path Health",
      body: "Open Path Health and read the problems. The panel checks structural issues; you still need to check whether the route accomplishes its mission.",
      task: "Read Path Health",
      target: "path-health",
      visible: ["lesson-health-dialog"],
      interact: ["path-health", "lesson-health-dialog"],
      check: () =>
        feedback(
          !!document.querySelector('[role="dialog"][aria-label="Path health"]'),
          "Open Path Health above the field.",
          "Read the issue list before continuing.",
        ),
    },
    {
      title: "Restore the delivery pose",
      body: "Put the final waypoint inside Delivery at X 15, Y 2.5. Moving it anywhere inside the field would clear an error, but would not complete the mission.",
      task: "Move the endpoint into Delivery",
      target: "path-canvas",
      interact: ["path-canvas", "element-properties"],
      prepare: {
        tool: "select",
        selectElement: 6,
        inspector: "open",
        inspectorTab: "elements",
        pathHealth: "closed",
      },
      check: outcome((path) => checkDelivery(path, currentConfig())),
      hints: [
        "Delivery is the zone on the right side of the field.",
        "Use the selected endpoint's X and Y fields for an exact placement.",
      ],
    },
    {
      title: "Repair the intake event",
      body: "Select the unnamed event on the first approach and give it the key startIntake. Keep prepareDelivery on the final approach.",
      task: "Name the intake event startIntake",
      target: "element-properties",
      interact: ["path-canvas", "inspector-panel", "element-properties"],
      prepare: {
        inspector: "open",
        inspectorTab: "elements",
        selectElement: 2,
      },
      check: outcome((path) => {
        const events = path.path_elements.filter(isEventTrigger);
        return feedback(
          events[0]?.lib_key === "startIntake" &&
            events[1]?.lib_key === "prepareDelivery",
          "Use startIntake for the first event and preserve prepareDelivery for the second.",
          "Both mechanism events now have the intended keys.",
        );
      }),
    },
    plan(),
    {
      title: "Check the whole mission",
      body: "Check Delivery and the simulated bumper around the structure. Structural health alone cannot tell whether a pickup and delivery routine does what you intended.",
      task: "Keep the route clear and finish inside Delivery",
      target: "path-canvas",
      interact: ["path-canvas", "inspector-panel", "max-velocity-card"],
      prepare: { tool: "select" },
      check: outcome((path) => {
        const destination = checkDelivery(path, currentConfig());
        return destination.complete
          ? checkClearance(path, currentConfig(), true)
          : destination;
      }),
      phase: "Challenge",
    },
    observe(
      "Run the complete routine",
      "Watch the pickup heading, the intake flash, clearance above the structure, and the final delivery approach. Both named events should trigger along the route.",
    ),
    {
      title: "Inspect the robot handoff",
      body: "These are the actual files from your repaired practice project. Inspect the shared configuration and path JSON before downloading the autos folder.",
      task: "Inspect config.json and the path file",
      phase: "Review",
      handoff: true,
      check: () =>
        feedback(
          (tourStore.getState().actions.inspectConfig ?? 0) > 0 &&
            (tourStore.getState().actions.inspectPath ?? 0) > 0,
          "Select config.json and then the path JSON below.",
          "You inspected the robot settings and the path contents. Download is optional.",
        ),
    },
    {
      title: "From preview to robot",
      body: "Extract the exported autos folder into src/main/deploy in your robot project. Register both event keys, check the robot dimensions and motion limits, then run WPILib simulation before a low-speed robot test.",
      phase: "Review",
    },
    {
      title: "Keep your repaired routine",
      body: "Keep a project archive if you want to continue editing this exercise later. Finishing returns to the lesson menu and restores your own project.",
      phase: "Review",
    },
  ],
};
export const tours: readonly TourDefinition[] = [
  buildFirstPathTour,
  shapeRouteTour,
  planSpeedTour,
  headingEventsTour,
  verifyExportTour,
];
export function findTour(tourId: string | null) {
  return tours.find((tour) => tour.id === tourId) ?? null;
}

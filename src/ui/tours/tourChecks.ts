import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathModel,
} from "../../core/model/path";
import type { ProjectConfig } from "../../core/model/project";
import { autoVelocityStatusForPath } from "../../core/constraints/autoVelocityApply";
import {
  anchorPositions,
  clearance,
  mission,
  near,
  practiceSimulation,
  withinField,
} from "./tourScenario";
import type { TourFeedback } from "./tourStore";

export function feedback(
  complete: boolean,
  waiting: string,
  success: string,
): TourFeedback {
  return { complete, message: complete ? success : waiting };
}
export function speedCap(path: PathModel, ordinal: number) {
  return path.ranged_constraints.find(
    (constraint) =>
      constraint.key === "max_velocity_meters_per_sec" &&
      Math.min(constraint.start_ordinal, constraint.end_ordinal) <= ordinal &&
      Math.max(constraint.start_ordinal, constraint.end_ordinal) >= ordinal,
  );
}
export function checkSpeed(
  path: PathModel,
  ordinal: number,
  maximum: number,
): TourFeedback {
  const cap = speedCap(path, ordinal);
  return feedback(
    !!cap &&
      cap.start_ordinal === ordinal &&
      cap.end_ordinal === ordinal &&
      cap.source !== "auto_velocity" &&
      cap.value > 0 &&
      cap.value <= maximum,
    `Choose the speed cell for ${ordinal === 2 ? "Pickup" : ordinal === 3 ? "the second turn" : "Delivery"} and set a Manual cap above 0 and at most ${maximum} m/s. Split a shared cell if needed.`,
    `The ${ordinal === 2 ? "Pickup approach" : ordinal === 3 ? "second turn" : "Delivery approach"} now has a Manual ${cap?.value.toFixed(2)} m/s cap.`,
  );
}
export function checkClearance(
  path: PathModel,
  config: ProjectConfig,
  preview = false,
): TourFeedback {
  const clear =
    clearance(path, config, preview) && withinField(path, config, preview);
  return feedback(
    clear,
    preview
      ? "The simulated bumper still clips the structure or a field edge. Adjust the approach speed, handoff radius, or bend position allowed in this exercise."
      : "Leave room for the whole bumper, not just the line. Move the bend farther above the structure.",
    preview
      ? "The simulated bumper clears the structure and stays inside the field."
      : "Both route segments leave room for the bumper.",
  );
}
export function checkDelivery(
  path: PathModel,
  config: ProjectConfig,
): TourFeedback {
  return feedback(
    near(anchorPositions(path).at(-1), mission.delivery) &&
      withinField(path, config),
    "Move the final waypoint into Delivery at X 15, Y 2.5. Keep the bumper inside the field.",
    "The final waypoint is inside Delivery with room for the bumper.",
  );
}
export function checkEvent(path: PathModel, ratio = 0.7): TourFeedback {
  const event = path.path_elements.find(isEventTrigger);
  const rotation = path.path_elements.find(isRotationTarget);
  return feedback(
    !!event &&
      !!rotation &&
      event.lib_key.trim() === "startIntake" &&
      Math.abs(event.t_ratio - ratio) < 0.015 &&
      event.t_ratio > rotation.t_ratio,
    `Set the event key to startIntake and its position to ${ratio}. It should follow the rotation target.`,
    "startIntake follows the rotation target at the requested position.",
  );
}
export function checkRadius(
  path: PathModel,
  minimum: number,
  maximum: number,
): TourFeedback {
  const target = path.path_elements.find(isTranslationTarget);
  return feedback(
    !!target &&
      target.handoff_radius_source === "manual" &&
      target.intermediate_handoff_radius_meters !== null &&
      target.intermediate_handoff_radius_meters >= minimum &&
      target.intermediate_handoff_radius_meters <= maximum,
    `Select the bend's radius chip, choose Manual, and use ${minimum === maximum ? minimum : `${minimum} to ${maximum}`} m.`,
    `The bend now uses a Manual ${target?.intermediate_handoff_radius_meters?.toFixed(2)} m handoff radius.`,
  );
}
export function checkPlan(
  path: PathModel,
  config: ProjectConfig,
): TourFeedback {
  return feedback(
    !autoVelocityStatusForPath(path, config).stale,
    "Generate the constraints for this route.",
    "The generated constraints already match this route and its settings.",
  );
}

export function checkMission(
  path: PathModel,
  config: ProjectConfig,
): TourFeedback {
  const anchors = anchorPositions(path);
  const pickupOrdinal = anchors.findIndex((anchor) =>
    near(anchor, mission.pickup, 0.2),
  );
  const pickupIndex = anchors[pickupOrdinal]?.index ?? -1;
  const events = path.path_elements.flatMap((element, index) =>
    isEventTrigger(element) ? [{ element, index }] : [],
  );
  if (
    anchors.length < 3 ||
    !near(anchors[0], mission.start) ||
    pickupOrdinal <= 0 ||
    pickupOrdinal >= anchors.length - 1
  )
    return {
      complete: false,
      message:
        "Keep Start in its zone and a target at the Pickup pose before Delivery.",
    };
  const intake = events.filter(
    ({ element }) => element.lib_key === "startIntake",
  );
  const deliveryEvents = events.filter(
    ({ element }) => element.lib_key === "prepareDelivery",
  );
  if (
    intake.length !== 1 ||
    deliveryEvents.length !== 1 ||
    intake[0].index <= anchors[pickupOrdinal - 1].index ||
    intake[0].index >= pickupIndex ||
    deliveryEvents[0].index <= anchors[anchors.length - 2].index ||
    deliveryEvents[0].index >= anchors[anchors.length - 1].index ||
    events.some(
      ({ element }) =>
        !element.lib_key.trim() || element.t_ratio <= 0 || element.t_ratio >= 1,
    )
  )
    return {
      complete: false,
      message:
        "Use one startIntake event on the Pickup approach and one prepareDelivery event on the final approach. Give every event a nonempty key and a position between 0 and 1.",
    };
  const endpoint = path.path_elements.at(-1);
  if (
    !endpoint ||
    !isWaypoint(endpoint) ||
    Math.abs(endpoint.rotation_target.rotation_radians + Math.PI / 2) > 0.02
  )
    return {
      complete: false,
      message: "Keep the final waypoint heading at -90° for Delivery.",
    };
  const delivery = checkDelivery(path, config);
  if (!delivery.complete) return delivery;
  const clear = checkClearance(path, config, true);
  if (!clear.complete) return clear;
  const trace = practiceSimulation(path, config).trace;
  const pickup = trace.reduce<(typeof trace)[number] | null>(
    (best, point) =>
      !best ||
      Math.hypot(
        point.x_m - mission.pickup.x_meters,
        point.y_m - mission.pickup.y_meters,
      ) <
        Math.hypot(
          best.x_m - mission.pickup.x_meters,
          best.y_m - mission.pickup.y_meters,
        )
        ? point
        : best,
    null,
  );
  const headingError = (actual: number, expected: number) =>
    Math.abs(
      Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)),
    );
  if (
    !pickup ||
    Math.hypot(
      pickup.x_m - mission.pickup.x_meters,
      pickup.y_m - mission.pickup.y_meters,
    ) > 0.35 ||
    headingError(pickup.theta_rad, Math.PI / 2) > Math.PI / 18
  )
    return {
      complete: false,
      message:
        "The preview must reach Pickup facing 90°. Adjust its heading, approach speed, or handoff radius to reach that pose.",
    };
  const end = trace.at(-1);
  return feedback(
    !!end &&
      near({ x_meters: end.x_m, y_meters: end.y_m }, mission.delivery) &&
      headingError(end.theta_rad, -Math.PI / 2) < Math.PI / 18,
    "The preview must finish inside Delivery facing -90°.",
    "The preview reaches both poses, carries both named events, and keeps the bumper clear.",
  );
}

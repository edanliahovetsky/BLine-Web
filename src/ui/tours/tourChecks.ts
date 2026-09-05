import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  type PathModel,
} from "../../core/model/path";
import type { ProjectConfig } from "../../core/model/project";
import { autoVelocityStatusForPath } from "../../core/constraints/autoVelocityApply";
import {
  anchorPositions,
  clearance,
  mission,
  near,
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
    `Choose the speed cell for ${ordinal === 3 ? "the second turn" : "Delivery"} and set a Manual cap above 0 and at most ${maximum} m/s.`,
    `The ${ordinal === 3 ? "second turn" : "Delivery approach"} now has a Manual ${cap?.value.toFixed(2)} m/s cap.`,
  );
}
export function checkClearance(
  path: PathModel,
  config: ProjectConfig,
  preview = false,
): TourFeedback {
  const clear = clearance(path, config, preview) && withinField(path, config);
  return feedback(
    clear,
    preview
      ? "The simulated bumper still clips the structure or the route is too close to a field edge. Move the bend farther out or reduce its radius."
      : "Leave room for the whole bumper, not just the line. Move the bend farther above the structure.",
    preview
      ? "The simulated bumper clears the structure, and the anchors stay inside the field."
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

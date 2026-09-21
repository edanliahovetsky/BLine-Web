import {
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  isAnchorElement,
  type PathModel,
} from "../model/path";
import { hasAuthoredStart, previewStartPose } from "../model/pathPreview";
import type {
  AutoVelocityProfile,
  JointAutoConstraintSolveResult,
} from "./autoVelocityConstraints";

/**
 * Give the generator an ordinary incoming segment for current-pose paths.
 * This private origin is removed again at the boundary; authored ordinals and
 * path elements never acquire a fake waypoint in the editor or robot export.
 */
export function withGenerationPreviewStart(path: PathModel): PathModel {
  if (hasAuthoredStart(path) || !path.path_elements.some(isAnchorElement))
    return path;
  const start = previewStartPose(path);
  return {
    ...path,
    path_elements: [
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: start.x_meters,
          y_meters: start.y_meters,
          intermediate_handoff_radius_meters: 0,
          handoff_radius_source: "manual",
        }),
        rotation_target: createRotationTarget({
          rotation_radians: start.rotation_radians,
        }),
      }),
      ...path.path_elements,
    ],
    // A waypoint contributes one translation ordinal and one rotation ordinal.
    ranged_constraints: path.ranged_constraints.map((range) => ({
      ...range,
      start_ordinal: range.start_ordinal + 1,
      end_ordinal: range.end_ordinal + 1,
    })),
  };
}

export function withoutGenerationPreviewStart(
  result: JointAutoConstraintSolveResult,
): JointAutoConstraintSolveResult {
  return {
    ...result,
    path: {
      ...result.path,
      path_elements: result.path.path_elements.slice(1),
      ranged_constraints: result.path.ranged_constraints.map((range) => ({
        ...range,
        start_ordinal: range.start_ordinal - 1,
        end_ordinal: range.end_ordinal - 1,
      })),
    },
    profile: profileWithoutGenerationStart(result.profile),
  };
}

export function profileWithoutGenerationStart(
  profile: AutoVelocityProfile,
): AutoVelocityProfile {
  return {
    ...profile,
    anchors: profile.anchors.map((anchor) => ({
      ...anchor,
      pathIndex: anchor.pathIndex - 1,
    })),
    corners: profile.corners.map((corner) => ({
      ...corner,
      anchorOrdinal: corner.anchorOrdinal - 1,
    })),
    segmentCaps: profile.segmentCaps
      .filter((cap) => cap.targetOrdinal > 1)
      .map((cap) => ({ ...cap, targetOrdinal: cap.targetOrdinal - 1 })),
    diagnostics: {
      ...profile.diagnostics,
      handoffs: profile.diagnostics.handoffs.map((handoff) => ({
        ...handoff,
        anchorOrdinal: handoff.anchorOrdinal - 1,
        incomingOrdinal: handoff.incomingOrdinal - 1,
        outgoingOrdinal: handoff.outgoingOrdinal - 1,
      })),
      ...(profile.diagnostics.rotationFeasibility
        ? {
            rotationFeasibility: profile.diagnostics.rotationFeasibility
              .filter((target) => target.elementIndex > 0)
              .map((target) => ({
                ...target,
                elementIndex: target.elementIndex - 1,
                eventOrdinal: target.eventOrdinal - 1,
              })),
          }
        : {}),
    },
  };
}

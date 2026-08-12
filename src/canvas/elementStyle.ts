import {
  isRotationTarget,
  isWaypoint,
  type PathElement,
} from "../core/model/path";

export const elementColors = {
  selected: "#ff8a3d",
  translation: "#58a6ff",
  waypoint: "#ff9f43",
  rotation: "#6bdc8b",
  event: "#a78bfa",
  simulation: "#62c7ff",
  simulationTrail: "#62c7ff",
  shadow: "rgba(5, 8, 11, 0.82)",
};

/**
 * Handoff radii keep BLine's original purple identity. Ownership is conveyed
 * by line treatment instead: generated rings are dashed and manual pins are
 * solid, so changing ownership does not make the underlying geometry look like
 * a different kind of path object.
 */
export const handoffRingColors = {
  auto: "#ff5cf4",
  manual: "#ff5cf4",
  unset: "#8296a6",
};

export function rotatableElementAccent(element: PathElement): string {
  if (isRotationTarget(element)) {
    return elementColors.rotation;
  }

  if (isWaypoint(element)) {
    return elementColors.waypoint;
  }

  return elementColors.selected;
}

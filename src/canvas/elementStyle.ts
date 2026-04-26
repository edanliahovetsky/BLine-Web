import {
  isRotationTarget,
  isWaypoint,
  type PathElement
} from "../core/model/path";

export const elementColors = {
  selected: "#ff8a3d",
  translation: "#58a6ff",
  waypoint: "#ff9f43",
  rotation: "#6bdc8b",
  event: "#a78bfa",
  handoff: "#ff5cf4",
  simulation: "#62c7ff",
  simulationTrail: "#62c7ff",
  shadow: "rgba(5, 8, 11, 0.82)"
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

import type { ProjectDocument } from "../core/io/projectSchema";
import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement
} from "../core/model/path";
import type { HistoryCommand } from "../state/historyStore";
import type { PointMeters } from "./geometry";

export function isTranslationBearingElement(element: PathElement): boolean {
  return isTranslationTarget(element) || isWaypoint(element);
}

export function createMoveElementCommand(
  index: number,
  previousPosition: PointMeters,
  nextPosition: PointMeters
): HistoryCommand<ProjectDocument> {
  return {
    description: `Move element ${index + 1}`,
    apply: (project) => updateProjectElementPosition(project, index, nextPosition),
    revert: (project) => updateProjectElementPosition(project, index, previousPosition)
  };
}

export function updateProjectElementPosition(
  project: ProjectDocument,
  index: number,
  position: PointMeters
): ProjectDocument {
  const nextProject = structuredClone(project);
  const element = nextProject.path.path_elements[index];

  if (isTranslationTarget(element)) {
    element.x_meters = position.x_meters;
    element.y_meters = position.y_meters;
    return nextProject;
  }

  if (isWaypoint(element)) {
    element.translation_target.x_meters = position.x_meters;
    element.translation_target.y_meters = position.y_meters;
    return nextProject;
  }

  throw new Error(`Element ${index} does not have an editable translation position`);
}

export function getElementLabel(element: PathElement): string {
  if (isTranslationTarget(element)) {
    return "TranslationTarget";
  }

  if (isWaypoint(element)) {
    return "Waypoint";
  }

  if (isRotationTarget(element)) {
    return "RotationTarget";
  }

  if (isEventTrigger(element)) {
    return "EventTrigger";
  }

  return "Element";
}

export function formatPointMeters(point: PointMeters | null): string {
  if (!point) {
    return "";
  }

  return `${point.x_meters.toFixed(2)}, ${point.y_meters.toFixed(2)} m`;
}

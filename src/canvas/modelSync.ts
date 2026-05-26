import type { ProjectDocument } from "../core/io/projectSchema";
import { UnitExpression } from "../core/math/units";
import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement,
} from "../core/model/path";
import type { HistoryCommand } from "../state/historyStore";
import type { PointExpression, PointMeters } from "./geometry";

export function isTranslationBearingElement(element: PathElement): boolean {
  return isTranslationTarget(element) || isWaypoint(element);
}

export function createMoveElementCommand(
  index: number,
  previousPosition: PointExpression,
  nextPosition: PointExpression,
): HistoryCommand<ProjectDocument> {
  return {
    description: `Move element ${index + 1}`,
    apply: (project) =>
      updateProjectElementPosition(project, index, nextPosition),
    revert: (project) =>
      updateProjectElementPosition(project, index, previousPosition),
  };
}

export function createSetElementRatioCommand(
  index: number,
  previousRatio: number,
  nextRatio: number,
): HistoryCommand<ProjectDocument> {
  return {
    description: `Move projected element ${index + 1}`,
    apply: (project) => updateProjectElementRatio(project, index, nextRatio),
    revert: (project) =>
      updateProjectElementRatio(project, index, previousRatio),
  };
}

export function createSetElementRotationCommand(
  index: number,
  previousRotation: UnitExpression<"Angle">,
  nextRotation: UnitExpression<"Angle">,
): HistoryCommand<ProjectDocument> {
  return {
    description: `Rotate element ${index + 1}`,
    apply: (project) =>
      updateProjectElementRotation(project, index, nextRotation),
    revert: (project) =>
      updateProjectElementRotation(project, index, previousRotation),
  };
}

export function updateProjectElementPosition(
  project: ProjectDocument,
  index: number,
  position: PointExpression,
): ProjectDocument {
  const nextProject = structuredClone(project);
  const element = nextProject.path.path_elements[index];

  if (isTranslationTarget(element)) {
    element.x = position.x;
    element.y = position.y;
    return nextProject;
  }

  if (isWaypoint(element)) {
    element.translation_target.x = position.x;
    element.translation_target.y = position.y;
    return nextProject;
  }

  throw new Error(
    `Element ${index} does not have an editable translation position`,
  );
}

export function updateProjectElementRotation(
  project: ProjectDocument,
  index: number,
  rotation: UnitExpression<"Angle">,
): ProjectDocument {
  const nextProject = structuredClone(project);
  const element = nextProject.path.path_elements[index];

  if (isRotationTarget(element)) {
    element.rotation = rotation;
    return nextProject;
  }

  if (isWaypoint(element)) {
    element.rotation_target.rotation = rotation;
    return nextProject;
  }

  throw new Error(`Element ${index} does not have an editable rotation`);
}

export function updateProjectElementRatio(
  project: ProjectDocument,
  index: number,
  tRatio: number,
): ProjectDocument {
  const nextProject = structuredClone(project);
  const element = nextProject.path.path_elements[index];
  const nextRatio = Math.max(0, Math.min(1, tRatio));

  if (isRotationTarget(element) || isEventTrigger(element)) {
    element.t_ratio = nextRatio;
    return nextProject;
  }

  throw new Error(`Element ${index} does not have an editable path ratio`);
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

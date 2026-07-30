import type { ProjectDocument } from "../core/io/projectSchema";
import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type HandoffRadiusSource,
  type PathElement,
} from "../core/model/path";
import type { HistoryCommand } from "../state/historyStore";
import type { PointMeters } from "./geometry";

export function isTranslationBearingElement(element: PathElement): boolean {
  return isTranslationTarget(element) || isWaypoint(element);
}

export function createMoveElementCommand(
  index: number,
  previousPosition: PointMeters,
  nextPosition: PointMeters,
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
  previousRotationRadians: number,
  nextRotationRadians: number,
): HistoryCommand<ProjectDocument> {
  return {
    description: `Rotate element ${index + 1}`,
    apply: (project) =>
      updateProjectElementRotation(project, index, nextRotationRadians),
    revert: (project) =>
      updateProjectElementRotation(project, index, previousRotationRadians),
  };
}

export interface HandoffRadiusState {
  radiusMeters: number | null;
  source: HandoffRadiusSource | null;
}

export interface HandoffRadiusUpdate {
  index: number;
  previous: HandoffRadiusState;
  next: HandoffRadiusState;
}

export function createSetHandoffRadiusCommand(
  index: number,
  previous: HandoffRadiusState,
  next: HandoffRadiusState,
): HistoryCommand<ProjectDocument> {
  return {
    description: `Set handoff radius ${index + 1}`,
    apply: (project) => updateProjectElementHandoffRadius(project, index, next),
    revert: (project) =>
      updateProjectElementHandoffRadius(project, index, previous),
  };
}

export function createSetHandoffRadiiCommand(
  updates: readonly HandoffRadiusUpdate[],
  description = `Set ${updates.length} handoff radii`,
): HistoryCommand<ProjectDocument> {
  return {
    description,
    apply: (project) =>
      updateProjectElementHandoffRadii(
        project,
        updates.map(({ index, next }) => ({ index, state: next })),
      ),
    revert: (project) =>
      updateProjectElementHandoffRadii(
        project,
        updates.map(({ index, previous }) => ({ index, state: previous })),
      ),
  };
}

export function updateProjectElementHandoffRadius(
  project: ProjectDocument,
  index: number,
  state: HandoffRadiusState,
): ProjectDocument {
  return updateProjectElementHandoffRadii(project, [{ index, state }]);
}

function updateProjectElementHandoffRadii(
  project: ProjectDocument,
  updates: readonly { index: number; state: HandoffRadiusState }[],
): ProjectDocument {
  const nextProject = structuredClone(project);
  for (const { index, state } of updates) {
    const element = nextProject.path.path_elements[index];
    const target = isTranslationTarget(element)
      ? element
      : isWaypoint(element)
        ? element.translation_target
        : null;

    if (!target) {
      throw new Error(`Element ${index} does not carry a handoff radius`);
    }

    target.intermediate_handoff_radius_meters = state.radiusMeters;
    if (state.source) {
      target.handoff_radius_source = state.source;
    } else {
      delete target.handoff_radius_source;
    }
  }
  return nextProject;
}

export function updateProjectElementPosition(
  project: ProjectDocument,
  index: number,
  position: PointMeters,
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

  throw new Error(
    `Element ${index} does not have an editable translation position`,
  );
}

export function updateProjectElementRotation(
  project: ProjectDocument,
  index: number,
  rotationRadians: number,
): ProjectDocument {
  const nextProject = structuredClone(project);
  const element = nextProject.path.path_elements[index];
  const nextRotation = normalizeRadians(rotationRadians);

  if (isRotationTarget(element)) {
    element.rotation_radians = nextRotation;
    return nextProject;
  }

  if (isWaypoint(element)) {
    element.rotation_target.rotation_radians = nextRotation;
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

function normalizeRadians(radians: number): number {
  if (!Number.isFinite(radians)) {
    return 0;
  }

  let normalized = radians;
  while (normalized <= -Math.PI) {
    normalized += Math.PI * 2;
  }
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  return normalized;
}

import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type HandoffRadiusSource,
  type PathElement,
  type PathModel,
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
): HistoryCommand<PathModel> {
  return {
    description: `Move element ${index + 1}`,
    apply: (path) => updatePathElementPosition(path, index, nextPosition),
    revert: (path) => updatePathElementPosition(path, index, previousPosition),
  };
}

export function createSetElementRatioCommand(
  index: number,
  previousRatio: number,
  nextRatio: number,
): HistoryCommand<PathModel> {
  return {
    description: `Move projected element ${index + 1}`,
    apply: (path) => updatePathElementRatio(path, index, nextRatio),
    revert: (path) => updatePathElementRatio(path, index, previousRatio),
  };
}

export function createSetElementRotationCommand(
  index: number,
  previousRotationRadians: number,
  nextRotationRadians: number,
): HistoryCommand<PathModel> {
  return {
    description: `Rotate element ${index + 1}`,
    apply: (path) =>
      updatePathElementRotation(path, index, nextRotationRadians),
    revert: (path) =>
      updatePathElementRotation(path, index, previousRotationRadians),
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
): HistoryCommand<PathModel> {
  return {
    description: `Set handoff radius ${index + 1}`,
    apply: (path) => updatePathElementHandoffRadius(path, index, next),
    revert: (path) => updatePathElementHandoffRadius(path, index, previous),
  };
}

export function createSetHandoffRadiiCommand(
  updates: readonly HandoffRadiusUpdate[],
  description = `Set ${updates.length} handoff radii`,
): HistoryCommand<PathModel> {
  return {
    description,
    apply: (path) =>
      updatePathElementHandoffRadii(
        path,
        updates.map(({ index, next }) => ({ index, state: next })),
      ),
    revert: (path) =>
      updatePathElementHandoffRadii(
        path,
        updates.map(({ index, previous }) => ({ index, state: previous })),
      ),
  };
}

export function updatePathElementHandoffRadius(
  path: PathModel,
  index: number,
  state: HandoffRadiusState,
): PathModel {
  return updatePathElementHandoffRadii(path, [{ index, state }]);
}

function updatePathElementHandoffRadii(
  path: PathModel,
  updates: readonly { index: number; state: HandoffRadiusState }[],
): PathModel {
  const nextPath = structuredClone(path);
  for (const { index, state } of updates) {
    const element = nextPath.path_elements[index];
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
  return nextPath;
}

export function updatePathElementPosition(
  path: PathModel,
  index: number,
  position: PointMeters,
): PathModel {
  const nextPath = structuredClone(path);
  const element = nextPath.path_elements[index];

  if (isTranslationTarget(element)) {
    element.x_meters = position.x_meters;
    element.y_meters = position.y_meters;
    return nextPath;
  }

  if (isWaypoint(element)) {
    element.translation_target.x_meters = position.x_meters;
    element.translation_target.y_meters = position.y_meters;
    return nextPath;
  }

  throw new Error(
    `Element ${index} does not have an editable translation position`,
  );
}

export function updatePathElementRotation(
  path: PathModel,
  index: number,
  rotationRadians: number,
): PathModel {
  const nextPath = structuredClone(path);
  const element = nextPath.path_elements[index];
  const nextRotation = normalizeRadians(rotationRadians);

  if (isRotationTarget(element)) {
    element.rotation_radians = nextRotation;
    return nextPath;
  }

  if (isWaypoint(element)) {
    element.rotation_target.rotation_radians = nextRotation;
    return nextPath;
  }

  throw new Error(`Element ${index} does not have an editable rotation`);
}

export function updatePathElementRatio(
  path: PathModel,
  index: number,
  tRatio: number,
): PathModel {
  const nextPath = structuredClone(path);
  const element = nextPath.path_elements[index];
  const nextRatio = Math.max(0, Math.min(1, tRatio));

  if (isRotationTarget(element) || isEventTrigger(element)) {
    element.t_ratio = nextRatio;
    return nextPath;
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

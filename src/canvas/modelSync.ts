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

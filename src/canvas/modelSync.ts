import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type HandoffRadiusSource,
  type HandoffMode,
  type PathElement,
  type PathModel,
} from "../core/model/path";
import type { HistoryCommand } from "../state/historyStore";
import type { PointMeters } from "./geometry";

export function isTranslationBearingElement(element: PathElement): boolean {
  return isTranslationTarget(element) || isWaypoint(element);
}

/** A null index edits the path default; an element index edits that target's override. */
export function createSetHandoffModeCommand(
  path: PathModel,
  index: number | null,
  mode: HandoffMode | undefined,
): HistoryCommand<PathModel> {
  const owner = (value: PathModel) => {
    if (index === null) return value;
    const element = value.path_elements[index];
    if (element?.type === "translation") return element;
    if (element?.type === "waypoint") return element.translation_target;
    throw new Error(`Element ${index} does not carry a handoff mode`);
  };
  const previous = owner(path).handoff_mode;
  const update = (value: PathModel, next: HandoffMode | undefined) => {
    const copy = structuredClone(value);
    const target = owner(copy);
    if (next === undefined) delete target.handoff_mode;
    else target.handoff_mode = next;
    return copy;
  };
  return {
    description: "Set handoff mode",
    apply: (value) => update(value, mode),
    revert: (value) => update(value, previous),
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

import {
  appendRangedConstraintInstance,
  splitRangedConstraintInstance,
} from "../../core/constraints/rangedConstraints";
import {
  canGenerateAutoConstraints,
  hasGeneratedAutoConstraints,
} from "../../core/constraints/autoConstraintGeneration";
import {
  anchorHandoffRadii,
  defaultHandoffRadiusMeters,
  type AnchorHandoffRadius,
  type AnchorRadiusState,
} from "../../core/model/handoffRadii";
import {
  defaultFieldGeometry,
  fieldCoordinateLengthMeters,
  fieldCoordinateWidthMeters,
  type FieldGeometry,
} from "../../core/field/fieldConfig";
import {
  getElementHeadingRadians,
  getElementPosition,
} from "../../canvas/geometry";
import type { ProjectConfig } from "../../core/model/project";
import {
  createEventTrigger,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  countAnchorElements,
  isEventTrigger,
  getHandoffRadiusSource,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type ConstraintKey,
  type EventTrigger,
  type PathElement,
  type PathModel,
  type RangedConstraint,
  type RangedConstraintKey,
  type RotationTarget,
  type TranslationTarget,
  type Waypoint,
} from "../../core/model/path";
import type { HistoryCommand } from "../../state/historyStore";

export type AddableElementType = PathElement["type"];

export const addableElementTypes: readonly AddableElementType[] = [
  "waypoint",
  "translation",
  "rotation",
  "event_trigger",
];

export function getAddableElementTypes(path: PathModel): AddableElementType[] {
  const anchorCount = countAnchorElements(path.path_elements);
  if (anchorCount < 2) {
    return ["waypoint", "translation"];
  }

  return [...addableElementTypes];
}

export function getSwitchableElementTypes(
  path: PathModel,
  index: number,
): AddableElementType[] {
  if (index < 0 || index >= path.path_elements.length) {
    return [];
  }

  const isEndpoint = index === 0 || index === path.path_elements.length - 1;
  if (isEndpoint) {
    return ["translation", "waypoint"];
  }

  return ["translation", "waypoint", "rotation", "event_trigger"];
}

/**
 * True when Generate would change something: an unpinned cap ordinal or an
 * unpinned interior-anchor radius for the optimizer to own.
 */
export function canGenerateConstraints(path: PathModel | null): boolean {
  return path !== null && canGenerateAutoConstraints(path);
}

/** True when there is optimizer output of either kind to drop. */
export function canClearGeneratedConstraints(path: PathModel | null): boolean {
  return path !== null && hasGeneratedAutoConstraints(path);
}

export type HandoffRadiusChipState = AnchorRadiusState;
export type HandoffRadiusChip = AnchorHandoffRadius;

export function handoffRadiusChipsForPath(
  path: PathModel,
  config: ProjectConfig,
): HandoffRadiusChip[] {
  return anchorHandoffRadii(
    path.path_elements,
    defaultHandoffRadiusMeters(config),
  );
}

export function createSetScalarConstraintCommand(
  key: ConstraintKey,
  previousValue: number | null,
  nextValue: number | null,
): HistoryCommand<PathModel> {
  return {
    description: `Set ${key}`,
    apply: (path) => updateScalarConstraint(path, key, nextValue),
    revert: (path) => updateScalarConstraint(path, key, previousValue),
  };
}

export function createAddRangedConstraintCommand(
  key: RangedConstraintKey,
  value: number,
  total: number,
): HistoryCommand<PathModel> {
  let addedSnapshot: RangedConstraint | null = null;

  return {
    description: `Add ranged ${key}`,
    apply: (path) => {
      const nextPath = structuredClone(path);
      const added = appendRangedConstraintInstance(
        nextPath.ranged_constraints,
        key,
        value,
        total,
      );
      addedSnapshot = added ? structuredClone(added) : null;
      if (added) {
        nextPath.constraints[key] = null;
      }
      return nextPath;
    },
    revert: (path) => {
      const nextPath = structuredClone(path);
      if (addedSnapshot) {
        const index = nextPath.ranged_constraints.findIndex(
          (constraint) =>
            constraint.key === addedSnapshot?.key &&
            constraint.value === addedSnapshot.value &&
            constraint.start_ordinal === addedSnapshot.start_ordinal &&
            constraint.end_ordinal === addedSnapshot.end_ordinal,
        );
        if (index >= 0) {
          nextPath.ranged_constraints.splice(index, 1);
        }
      }
      return nextPath;
    },
  };
}

export function createUpdateRangedConstraintCommand(
  index: number,
  previous: RangedConstraint,
  next: RangedConstraint,
): HistoryCommand<PathModel> {
  return {
    description: `Update ranged constraint ${index + 1}`,
    apply: (path) => replaceRangedConstraint(path, index, next),
    revert: (path) => replaceRangedConstraint(path, index, previous),
  };
}

export function createUpdateRangedConstraintsCommand(
  updates: Array<{
    index: number;
    previous: RangedConstraint;
    next: RangedConstraint;
  }>,
): HistoryCommand<PathModel> {
  return {
    description: `Update ${updates.length} ranged constraints`,
    apply: (path) => {
      const nextPath = structuredClone(path);
      for (const update of updates) {
        if (
          update.index >= 0 &&
          update.index < nextPath.ranged_constraints.length
        ) {
          nextPath.ranged_constraints[update.index] = structuredClone(
            update.next,
          );
          nextPath.constraints[update.next.key] = null;
        }
      }
      return nextPath;
    },
    revert: (path) => {
      const nextPath = structuredClone(path);
      for (const update of updates) {
        if (
          update.index >= 0 &&
          update.index < nextPath.ranged_constraints.length
        ) {
          nextPath.ranged_constraints[update.index] = structuredClone(
            update.previous,
          );
          nextPath.constraints[update.previous.key] = null;
        }
      }
      return nextPath;
    },
  };
}

export function createReplaceRangedConstraintsForKeyCommand(
  key: RangedConstraintKey,
  previous: readonly RangedConstraint[],
  next: readonly RangedConstraint[],
  description = `Set ranged ${key}`,
): HistoryCommand<PathModel> {
  return {
    description,
    apply: (path) => replaceRangedConstraintsForKey(path, key, next),
    revert: (path) => replaceRangedConstraintsForKey(path, key, previous),
  };
}

export function createInsertRangedConstraintCommand(
  constraint: RangedConstraint,
): HistoryCommand<PathModel> {
  let insertedIndex: number | null = null;

  return {
    description: `Insert ranged ${constraint.key}`,
    apply: (path) => {
      const nextPath = structuredClone(path);
      nextPath.ranged_constraints.push(structuredClone(constraint));
      insertedIndex = nextPath.ranged_constraints.length - 1;
      nextPath.constraints[constraint.key] = null;
      return nextPath;
    },
    revert: (path) => {
      const nextPath = structuredClone(path);
      const index =
        insertedIndex !== null
          ? insertedIndex
          : nextPath.ranged_constraints.findIndex((candidate) =>
              sameRangedConstraint(candidate, constraint),
            );
      if (index >= 0 && index < nextPath.ranged_constraints.length) {
        nextPath.ranged_constraints.splice(index, 1);
      }
      return nextPath;
    },
  };
}

export function createRemoveRangedConstraintCommand(
  index: number,
  constraint: RangedConstraint,
): HistoryCommand<PathModel> {
  return {
    description: `Remove ranged constraint ${index + 1}`,
    apply: (path) => {
      const nextPath = structuredClone(path);
      nextPath.ranged_constraints.splice(index, 1);
      return nextPath;
    },
    revert: (path) => {
      const nextPath = structuredClone(path);
      nextPath.ranged_constraints.splice(index, 0, structuredClone(constraint));
      return nextPath;
    },
  };
}

export function createSplitRangedConstraintCommand(
  index: number,
): HistoryCommand<PathModel> {
  let previousConstraints: RangedConstraint[] | null = null;

  return {
    description: `Split ranged constraint ${index + 1}`,
    apply: (path) => {
      const nextPath = structuredClone(path);
      previousConstraints = structuredClone(nextPath.ranged_constraints);
      const constraint = nextPath.ranged_constraints[index];
      if (constraint) {
        splitRangedConstraintInstance(nextPath.ranged_constraints, constraint);
      }
      return nextPath;
    },
    revert: (path) => {
      const nextPath = structuredClone(path);
      if (previousConstraints) {
        nextPath.ranged_constraints = structuredClone(previousConstraints);
      }
      return nextPath;
    },
  };
}

export function createDefaultElement(
  path: PathModel,
  config: ProjectConfig,
  type: AddableElementType,
  selectedIndex: number | null,
  field: FieldGeometry = defaultFieldGeometry,
): PathElement {
  const resolvedType = getAddableElementTypes(path).includes(type)
    ? type
    : "translation";
  const position = defaultPosition(path, field, selectedIndex);
  const headingRadians =
    selectedIndex === null
      ? 0
      : (getElementHeadingRadians(path.path_elements, selectedIndex) ?? 0);

  if (resolvedType === "translation") {
    return createTranslationTarget({
      x_meters: position.x_meters,
      y_meters: position.y_meters,
      intermediate_handoff_radius_meters: defaultHandoffRadiusMeters(config),
      handoff_radius_source: "auto",
    });
  }

  if (resolvedType === "waypoint") {
    return createWaypoint({
      translation_target: createTranslationTarget({
        x_meters: position.x_meters,
        y_meters: position.y_meters,
        intermediate_handoff_radius_meters: defaultHandoffRadiusMeters(config),
        handoff_radius_source: "auto",
      }),
      rotation_target: createRotationTarget({
        rotation_radians: headingRadians,
        t_ratio: 0,
      }),
    });
  }

  if (resolvedType === "rotation") {
    return createRotationTarget({
      rotation_radians: headingRadians,
      t_ratio: 0.5,
    });
  }

  return createEventTrigger({
    t_ratio: 0.5,
    lib_key: "event",
  });
}

export function createConvertedElement(
  path: PathModel,
  _config: ProjectConfig,
  index: number,
  nextType: AddableElementType,
  field: FieldGeometry = defaultFieldGeometry,
): PathElement | null {
  const element = path.path_elements[index];
  if (!element || element.type === nextType) {
    return null;
  }

  if (!getSwitchableElementTypes(path, index).includes(nextType)) {
    return null;
  }

  const position = getElementPosition(path.path_elements, index);
  const headingRadians =
    getElementHeadingRadians(path.path_elements, index) ?? 0;
  const handoffRadius = getExistingHandoffRadius(element);
  const handoffRadiusSource = getHandoffRadiusSource(element) ?? undefined;
  const ratio = getExistingRatio(element);

  if (nextType === "translation") {
    return createTranslationTarget({
      x_meters: position?.x_meters ?? field.length_meters / 2,
      y_meters: position?.y_meters ?? field.width_meters / 2,
      intermediate_handoff_radius_meters: handoffRadius,
      handoff_radius_source: handoffRadiusSource,
    });
  }

  if (nextType === "waypoint") {
    return createWaypoint({
      translation_target: createTranslationTarget({
        x_meters: position?.x_meters ?? field.length_meters / 2,
        y_meters: position?.y_meters ?? field.width_meters / 2,
        intermediate_handoff_radius_meters: handoffRadius,
        handoff_radius_source: handoffRadiusSource,
      }),
      rotation_target: createRotationTarget({
        rotation_radians: headingRadians,
        t_ratio: ratio ?? 0,
      }),
    });
  }

  if (nextType === "rotation") {
    return createRotationTarget({
      rotation_radians: headingRadians,
      t_ratio: ratio ?? 0.5,
    });
  }

  return createEventTrigger({
    t_ratio: ratio ?? 0.5,
    lib_key: isEventTrigger(element) ? element.lib_key : "event",
  });
}

export function getInsertionIndex(
  path: PathModel,
  type: AddableElementType,
  selectedIndex: number | null,
): number {
  const length = path.path_elements.length;
  const baseIndex = selectedIndex === null ? length : selectedIndex + 1;

  if (type === "rotation" || type === "event_trigger") {
    if (length < 2) {
      return length;
    }
    return clamp(baseIndex, 1, length - 1);
  }

  return clampIndex(baseIndex, length);
}

export function updateTranslationTarget(
  element: TranslationTarget,
  update: Partial<Omit<TranslationTarget, "type">>,
): TranslationTarget {
  return {
    ...element,
    ...update,
  };
}

export function updateWaypoint(
  element: Waypoint,
  update: {
    translation?: Partial<Omit<TranslationTarget, "type">>;
    rotation?: Partial<Omit<RotationTarget, "type">>;
  },
): Waypoint {
  return {
    ...element,
    translation_target: {
      ...element.translation_target,
      ...update.translation,
    },
    rotation_target: {
      ...element.rotation_target,
      ...update.rotation,
    },
  };
}

export function updateRotationTarget(
  element: RotationTarget,
  update: Partial<Omit<RotationTarget, "type">>,
): RotationTarget {
  return {
    ...element,
    ...update,
  };
}

export function updateEventTrigger(
  element: EventTrigger,
  update: Partial<Omit<EventTrigger, "type">>,
): EventTrigger {
  return {
    ...element,
    ...update,
  };
}

export function elementTypeLabel(element: PathElement): string {
  if (isTranslationTarget(element)) {
    return "Translation";
  }

  if (isWaypoint(element)) {
    return "Waypoint";
  }

  if (isRotationTarget(element)) {
    return "Rotation";
  }

  if (isEventTrigger(element)) {
    return "Event Trigger";
  }

  return "Element";
}

export function elementTypeValue(element: PathElement): AddableElementType {
  return element.type;
}

function getExistingHandoffRadius(element: PathElement): number | null {
  if (isTranslationTarget(element)) {
    return element.intermediate_handoff_radius_meters;
  }

  if (isWaypoint(element)) {
    return element.translation_target.intermediate_handoff_radius_meters;
  }

  return 0.25;
}

function getExistingRatio(element: PathElement): number | null {
  if (isRotationTarget(element) || isEventTrigger(element)) {
    return element.t_ratio;
  }

  if (isWaypoint(element)) {
    return element.rotation_target.t_ratio;
  }

  return null;
}

function updateScalarConstraint(
  path: PathModel,
  key: ConstraintKey,
  value: number | null,
): PathModel {
  const nextPath = structuredClone(path);
  nextPath.constraints[key] = value;
  if (value !== null) {
    nextPath.ranged_constraints = nextPath.ranged_constraints.filter(
      (constraint) => constraint.key !== key,
    );
  }
  return nextPath;
}

function replaceRangedConstraint(
  path: PathModel,
  index: number,
  constraint: RangedConstraint,
): PathModel {
  const nextPath = structuredClone(path);
  if (index >= 0 && index < nextPath.ranged_constraints.length) {
    nextPath.ranged_constraints[index] = structuredClone(constraint);
    nextPath.constraints[constraint.key] = null;
  }
  return nextPath;
}

function replaceRangedConstraintsForKey(
  path: PathModel,
  key: RangedConstraintKey,
  constraints: readonly RangedConstraint[],
): PathModel {
  const nextPath = structuredClone(path);
  nextPath.ranged_constraints = [
    ...nextPath.ranged_constraints.filter(
      (constraint) => constraint.key !== key,
    ),
    ...constraints.map((constraint) => structuredClone(constraint)),
  ];
  nextPath.constraints[key] =
    constraints.length > 0 ? null : nextPath.constraints[key];
  return nextPath;
}

function sameRangedConstraint(
  candidate: RangedConstraint,
  target: RangedConstraint,
): boolean {
  return (
    candidate.key === target.key &&
    candidate.value === target.value &&
    candidate.start_ordinal === target.start_ordinal &&
    candidate.end_ordinal === target.end_ordinal &&
    candidate.source === target.source
  );
}

function defaultPosition(
  path: PathModel,
  field: FieldGeometry,
  selectedIndex: number | null,
): { x_meters: number; y_meters: number } {
  const selectedPosition =
    selectedIndex === null
      ? null
      : getElementPosition(path.path_elements, selectedIndex);
  const fallbackPosition =
    selectedPosition ??
    getElementPosition(
      path.path_elements,
      Math.max(0, path.path_elements.length - 1),
    );

  return clampFieldPosition(
    {
      x_meters: (fallbackPosition?.x_meters ?? field.length_meters / 2) + 0.75,
      y_meters: (fallbackPosition?.y_meters ?? field.width_meters / 2) + 0.35,
    },
    field,
  );
}

function clampFieldPosition(
  point: { x_meters: number; y_meters: number },
  field: FieldGeometry,
) {
  return {
    x_meters: clamp(point.x_meters, 0, fieldCoordinateLengthMeters(field)),
    y_meters: clamp(point.y_meters, 0, fieldCoordinateWidthMeters(field)),
  };
}

function clampIndex(index: number, length: number): number {
  return clamp(index, 0, Math.max(0, length));
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

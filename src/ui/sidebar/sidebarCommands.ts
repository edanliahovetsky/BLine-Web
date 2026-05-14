import {
  appendRangedConstraintInstance,
  splitRangedConstraintInstance,
} from "../../core/constraints/rangedConstraints";
import {
  fieldCoordinateOffsetMeters,
  fieldLengthMeters,
  fieldWidthMeters,
} from "../../canvas/constants";
import {
  getElementHeadingRadians,
  getElementPosition,
} from "../../canvas/geometry";
import { robotSizeFromConfig } from "../../canvas/robotFootprint";
import { remapRangedConstraints } from "../../core/constraints/rangedConstraints";
import type { ProjectDocument } from "../../core/io/projectSchema";
import {
  createEventTrigger,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  countAnchorElements,
  isAnchorElement,
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type ConstraintKey,
  type EventTrigger,
  type PathElement,
  type RangedConstraint,
  type RangedConstraintKey,
  type RotationTarget,
  type TranslationTarget,
  type Waypoint,
  Constraints,
  ConstraintValue,
} from "../../core/model/path";
import type { HistoryCommand } from "../../state/historyStore";
import { UnitExpression, units } from "../../core/math/units";

export type AddableElementType = PathElement["type"];

export const addableElementTypes: readonly AddableElementType[] = [
  "waypoint",
  "translation",
  "rotation",
  "event_trigger",
];

export function getAddableElementTypes(
  project: ProjectDocument,
): AddableElementType[] {
  const anchorCount = countAnchorElements(project.path.path_elements);
  if (anchorCount < 2) {
    return ["waypoint", "translation"];
  }

  return [...addableElementTypes];
}

export function getSwitchableElementTypes(
  project: ProjectDocument,
  index: number,
): AddableElementType[] {
  if (index < 0 || index >= project.path.path_elements.length) {
    return [];
  }

  const isEndpoint =
    index === 0 || index === project.path.path_elements.length - 1;
  if (isEndpoint) {
    return ["translation", "waypoint"];
  }

  return ["translation", "waypoint", "rotation", "event_trigger"];
}

export function createInsertPathElementCommand(
  index: number,
  element: PathElement,
): HistoryCommand<ProjectDocument> {
  let previousConstraints: RangedConstraint[] | null = null;

  return {
    description: `Insert ${element.type} element`,
    apply: (project) => {
      const nextProject = structuredClone(project);
      const previousElements = nextProject.path.path_elements.slice();
      previousConstraints ??= structuredClone(
        nextProject.path.ranged_constraints,
      );
      const insertionIndex = clampIndex(
        index,
        nextProject.path.path_elements.length,
      );
      nextProject.path.path_elements.splice(
        insertionIndex,
        0,
        structuredClone(element),
      );
      remapRangedConstraints(nextProject.path, previousElements);
      return nextProject;
    },
    revert: (project) => {
      const nextProject = structuredClone(project);
      const previousElements = nextProject.path.path_elements.slice();
      const removalIndex = clampIndex(
        index,
        nextProject.path.path_elements.length - 1,
      );
      nextProject.path.path_elements.splice(removalIndex, 1);
      if (previousConstraints) {
        nextProject.path.ranged_constraints =
          structuredClone(previousConstraints);
      } else {
        remapRangedConstraints(nextProject.path, previousElements);
      }
      return nextProject;
    },
  };
}

export function createRemovePathElementCommand(
  index: number,
  element: PathElement,
): HistoryCommand<ProjectDocument> {
  let previousConstraints: RangedConstraint[] | null = null;

  return {
    description: `Remove ${element.type} element`,
    apply: (project) => {
      const nextProject = structuredClone(project);
      if (index >= 0 && index < nextProject.path.path_elements.length) {
        const previousElements = nextProject.path.path_elements.slice();
        previousConstraints ??= structuredClone(
          nextProject.path.ranged_constraints,
        );
        nextProject.path.path_elements.splice(index, 1);
        remapRangedConstraints(nextProject.path, previousElements);
      }
      return nextProject;
    },
    revert: (project) => {
      const nextProject = structuredClone(project);
      const previousElements = nextProject.path.path_elements.slice();
      const insertionIndex = clampIndex(
        index,
        nextProject.path.path_elements.length,
      );
      nextProject.path.path_elements.splice(
        insertionIndex,
        0,
        structuredClone(element),
      );
      if (previousConstraints) {
        nextProject.path.ranged_constraints =
          structuredClone(previousConstraints);
      } else {
        remapRangedConstraints(nextProject.path, previousElements);
      }
      return nextProject;
    },
  };
}

export function createUpdatePathElementCommand(
  index: number,
  previousElement: PathElement,
  nextElement: PathElement,
): HistoryCommand<ProjectDocument> {
  return {
    description: `Update element ${index + 1}`,
    apply: (project) => replaceElement(project, index, nextElement),
    revert: (project) => replaceElement(project, index, previousElement),
  };
}

export function createChangePathElementTypeCommand(
  index: number,
  previousElement: PathElement,
  nextElement: PathElement,
): HistoryCommand<ProjectDocument> {
  let previousConstraints: RangedConstraint[] | null = null;

  return {
    description: `Change element ${index + 1} type`,
    apply: (project) => {
      previousConstraints ??= structuredClone(project.path.ranged_constraints);
      return replaceElementAndRemap(project, index, nextElement);
    },
    revert: (project) => {
      const nextProject = replaceElementAndRemap(
        project,
        index,
        previousElement,
      );
      if (previousConstraints) {
        nextProject.path.ranged_constraints =
          structuredClone(previousConstraints);
      }
      return nextProject;
    },
  };
}

export function createMovePathElementCommand(
  fromIndex: number,
  toIndex: number,
): HistoryCommand<ProjectDocument> {
  let previousConstraints: RangedConstraint[] | null = null;

  return {
    description: `Reorder element ${fromIndex + 1}`,
    apply: (project) => {
      previousConstraints ??= structuredClone(project.path.ranged_constraints);
      return moveElement(project, fromIndex, toIndex);
    },
    revert: (project) => {
      const nextProject = moveElement(project, toIndex, fromIndex);
      if (previousConstraints) {
        nextProject.path.ranged_constraints =
          structuredClone(previousConstraints);
      }
      return nextProject;
    },
  };
}

export function createSetScalarConstraintCommand<K extends ConstraintKey>(
  key: K,
  previousValue: Constraints[K],
  nextValue: Constraints[K],
): HistoryCommand<ProjectDocument> {
  return {
    description: `Set ${key}`,
    apply: (project) => updateScalarConstraint(project, key, nextValue),
    revert: (project) => updateScalarConstraint(project, key, previousValue),
  };
}

export function createAddRangedConstraintCommand<K extends RangedConstraintKey>(
  key: K,
  value: ConstraintValue<K>,
  total: number,
): HistoryCommand<ProjectDocument> {
  let addedSnapshot: RangedConstraint | null = null;

  return {
    description: `Add ranged ${key}`,
    apply: (project) => {
      const nextProject = structuredClone(project);
      const added = appendRangedConstraintInstance(
        nextProject.path.ranged_constraints,
        key,
        value,
        total,
      );
      addedSnapshot = added ? structuredClone(added) : null;
      if (added) {
        nextProject.path.constraints[key] = null;
      }
      return nextProject;
    },
    revert: (project) => {
      const nextProject = structuredClone(project);
      if (addedSnapshot) {
        const index = nextProject.path.ranged_constraints.findIndex(
          (constraint) =>
            constraint.key === addedSnapshot?.key &&
            constraint.value === addedSnapshot.value &&
            constraint.start_ordinal === addedSnapshot.start_ordinal &&
            constraint.end_ordinal === addedSnapshot.end_ordinal,
        );
        if (index >= 0) {
          nextProject.path.ranged_constraints.splice(index, 1);
        }
      }
      return nextProject;
    },
  };
}

export function createUpdateRangedConstraintCommand(
  index: number,
  previous: RangedConstraint,
  next: RangedConstraint,
): HistoryCommand<ProjectDocument> {
  return {
    description: `Update ranged constraint ${index + 1}`,
    apply: (project) => replaceRangedConstraint(project, index, next),
    revert: (project) => replaceRangedConstraint(project, index, previous),
  };
}

export function createUpdateRangedConstraintsCommand(
  updates: Array<{
    index: number;
    previous: RangedConstraint;
    next: RangedConstraint;
  }>,
): HistoryCommand<ProjectDocument> {
  return {
    description: `Update ${updates.length} ranged constraints`,
    apply: (project) => {
      const nextProject = structuredClone(project);
      for (const update of updates) {
        if (
          update.index >= 0 &&
          update.index < nextProject.path.ranged_constraints.length
        ) {
          nextProject.path.ranged_constraints[update.index] = structuredClone(
            update.next,
          );
          nextProject.path.constraints[update.next.key] = null;
        }
      }
      return nextProject;
    },
    revert: (project) => {
      const nextProject = structuredClone(project);
      for (const update of updates) {
        if (
          update.index >= 0 &&
          update.index < nextProject.path.ranged_constraints.length
        ) {
          nextProject.path.ranged_constraints[update.index] = structuredClone(
            update.previous,
          );
          nextProject.path.constraints[update.previous.key] = null;
        }
      }
      return nextProject;
    },
  };
}

export function createReplaceRangedConstraintsForKeyCommand<
  K extends RangedConstraintKey,
>(
  key: K,
  previous: readonly RangedConstraint<K>[],
  next: readonly RangedConstraint<K>[],
  description = `Set ranged ${key}`,
): HistoryCommand<ProjectDocument> {
  return {
    description,
    apply: (project) => replaceRangedConstraintsForKey(project, key, next),
    revert: (project) => replaceRangedConstraintsForKey(project, key, previous),
  };
}

export function createInsertRangedConstraintCommand(
  constraint: RangedConstraint,
): HistoryCommand<ProjectDocument> {
  let insertedIndex: number | null = null;

  return {
    description: `Insert ranged ${constraint.key}`,
    apply: (project) => {
      const nextProject = structuredClone(project);
      nextProject.path.ranged_constraints.push(structuredClone(constraint));
      insertedIndex = nextProject.path.ranged_constraints.length - 1;
      nextProject.path.constraints[constraint.key] = null;
      return nextProject;
    },
    revert: (project) => {
      const nextProject = structuredClone(project);
      const index =
        insertedIndex !== null
          ? insertedIndex
          : nextProject.path.ranged_constraints.findIndex((candidate) =>
              sameRangedConstraint(candidate, constraint),
            );
      if (index >= 0 && index < nextProject.path.ranged_constraints.length) {
        nextProject.path.ranged_constraints.splice(index, 1);
      }
      return nextProject;
    },
  };
}

export function createRemoveRangedConstraintCommand(
  index: number,
  constraint: RangedConstraint,
): HistoryCommand<ProjectDocument> {
  return {
    description: `Remove ranged constraint ${index + 1}`,
    apply: (project) => {
      const nextProject = structuredClone(project);
      nextProject.path.ranged_constraints.splice(index, 1);
      return nextProject;
    },
    revert: (project) => {
      const nextProject = structuredClone(project);
      nextProject.path.ranged_constraints.splice(
        index,
        0,
        structuredClone(constraint),
      );
      return nextProject;
    },
  };
}

export function createSplitRangedConstraintCommand(
  index: number,
): HistoryCommand<ProjectDocument> {
  let previousConstraints: RangedConstraint[] | null = null;

  return {
    description: `Split ranged constraint ${index + 1}`,
    apply: (project) => {
      const nextProject = structuredClone(project);
      previousConstraints = structuredClone(
        nextProject.path.ranged_constraints,
      );
      const constraint = nextProject.path.ranged_constraints[index];
      if (constraint) {
        splitRangedConstraintInstance(
          nextProject.path.ranged_constraints,
          constraint,
        );
      }
      return nextProject;
    },
    revert: (project) => {
      const nextProject = structuredClone(project);
      if (previousConstraints) {
        nextProject.path.ranged_constraints =
          structuredClone(previousConstraints);
      }
      return nextProject;
    },
  };
}

export function createDefaultElement(
  project: ProjectDocument,
  type: AddableElementType,
  selectedIndex: number | null,
): PathElement {
  const resolvedType = getAddableElementTypes(project).includes(type)
    ? type
    : "translation";
  const position = defaultPosition(project, selectedIndex);
  const headingRadians =
    selectedIndex === null
      ? 0
      : (getElementHeadingRadians(project.path.path_elements, selectedIndex) ??
        0);

  if (resolvedType === "translation") {
    return createTranslationTarget({
      x_meters: position.x_meters,
      y_meters: position.y_meters,
      intermediate_handoff_radius_meters: 0.25,
    });
  }

  if (resolvedType === "waypoint") {
    return createWaypoint({
      translation_target: createTranslationTarget({
        x_meters: position.x_meters,
        y_meters: position.y_meters,
        intermediate_handoff_radius_meters: 0.25,
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
  project: ProjectDocument,
  index: number,
  nextType: AddableElementType,
): PathElement | null {
  const element = project.path.path_elements[index];
  if (!element || element.type === nextType) {
    return null;
  }

  if (!getSwitchableElementTypes(project, index).includes(nextType)) {
    return null;
  }

  const position = getElementPosition(project.path.path_elements, index);
  const headingRadians =
    getElementHeadingRadians(project.path.path_elements, index) ?? 0;
  const handoffRadius = getExistingHandoffRadius(element);
  const ratio = getExistingRatio(element);

  if (nextType === "translation") {
    return createTranslationTarget({
      x_meters: position?.x_meters ?? fieldLengthMeters / 2,
      y_meters: position?.y_meters ?? fieldWidthMeters / 2,
      intermediate_handoff_radius: handoffRadius,
    });
  }

  if (nextType === "waypoint") {
    return createWaypoint({
      translation_target: createTranslationTarget({
        x_meters: position?.x_meters ?? fieldLengthMeters / 2,
        y_meters: position?.y_meters ?? fieldWidthMeters / 2,
        intermediate_handoff_radius: handoffRadius,
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

export function canMovePathElement(
  project: ProjectDocument,
  fromIndex: number,
  toIndex: number,
): boolean {
  if (fromIndex === toIndex) {
    return false;
  }

  const elements = project.path.path_elements;
  if (
    fromIndex < 0 ||
    fromIndex >= elements.length ||
    toIndex < 0 ||
    toIndex >= elements.length
  ) {
    return false;
  }

  const nextElements = elements.slice();
  const [element] = nextElements.splice(fromIndex, 1);
  nextElements.splice(toIndex, 0, element);
  return isValidElementOrder(nextElements);
}

export function getInsertionIndex(
  project: ProjectDocument,
  type: AddableElementType,
  selectedIndex: number | null,
): number {
  const length = project.path.path_elements.length;
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

function replaceElement(
  project: ProjectDocument,
  index: number,
  element: PathElement,
): ProjectDocument {
  const nextProject = structuredClone(project);
  if (index >= 0 && index < nextProject.path.path_elements.length) {
    nextProject.path.path_elements[index] = structuredClone(element);
  }
  return nextProject;
}

function replaceElementAndRemap(
  project: ProjectDocument,
  index: number,
  element: PathElement,
): ProjectDocument {
  const nextProject = structuredClone(project);
  if (index >= 0 && index < nextProject.path.path_elements.length) {
    const previousElements = nextProject.path.path_elements.slice();
    nextProject.path.path_elements[index] = structuredClone(element);
    remapRangedConstraints(nextProject.path, previousElements);
  }
  return nextProject;
}

function moveElement(
  project: ProjectDocument,
  fromIndex: number,
  toIndex: number,
): ProjectDocument {
  const nextProject = structuredClone(project);
  const elements = nextProject.path.path_elements;
  if (
    fromIndex < 0 ||
    fromIndex >= elements.length ||
    toIndex < 0 ||
    toIndex >= elements.length ||
    fromIndex === toIndex
  ) {
    return nextProject;
  }

  const previousElements = elements.slice();
  const [element] = elements.splice(fromIndex, 1);
  elements.splice(toIndex, 0, element);

  if (!isValidElementOrder(elements)) {
    nextProject.path.path_elements = previousElements;
    return nextProject;
  }

  remapRangedConstraints(nextProject.path, previousElements);
  return nextProject;
}

function isValidElementOrder(elements: readonly PathElement[]): boolean {
  if (elements.filter(isAnchorElement).length < 2) {
    return elements.every(isAnchorElement);
  }

  return elements.every((element, index) => {
    if (isAnchorElement(element)) {
      return true;
    }

    const hasPreviousAnchor = elements.slice(0, index).some(isAnchorElement);
    const hasNextAnchor = elements.slice(index + 1).some(isAnchorElement);
    return hasPreviousAnchor && hasNextAnchor;
  });
}

function getExistingHandoffRadius(
  element: PathElement,
): UnitExpression<"Length"> | null {
  if (isTranslationTarget(element)) {
    return element.intermediate_handoff_radius;
  }

  if (isWaypoint(element)) {
    return element.translation_target.intermediate_handoff_radius;
  }

  return units.Meter.of(0.25);
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

function updateScalarConstraint<K extends ConstraintKey>(
  project: ProjectDocument,
  key: K,
  value: Constraints[K],
): ProjectDocument {
  const nextProject = structuredClone(project);
  nextProject.path.constraints[key] = value;
  if (value !== null) {
    nextProject.path.ranged_constraints =
      nextProject.path.ranged_constraints.filter(
        (constraint) => constraint.key !== key,
      );
  }
  return nextProject;
}

function replaceRangedConstraint(
  project: ProjectDocument,
  index: number,
  constraint: RangedConstraint,
): ProjectDocument {
  const nextProject = structuredClone(project);
  if (index >= 0 && index < nextProject.path.ranged_constraints.length) {
    nextProject.path.ranged_constraints[index] = structuredClone(constraint);
    nextProject.path.constraints[constraint.key] = null;
  }
  return nextProject;
}

function replaceRangedConstraintsForKey<K extends RangedConstraintKey>(
  project: ProjectDocument,
  key: K,
  constraints: readonly RangedConstraint[],
): ProjectDocument {
  const nextProject = structuredClone(project);
  nextProject.path.ranged_constraints = [
    ...nextProject.path.ranged_constraints.filter(
      (constraint) => constraint.key !== key,
    ),
    ...constraints.map((constraint) => structuredClone(constraint)),
  ];
  nextProject.path.constraints[key] =
    constraints.length > 0 ? null : nextProject.path.constraints[key];
  return nextProject;
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
  project: ProjectDocument,
  selectedIndex: number | null,
): { x_meters: number; y_meters: number } {
  const selectedPosition =
    selectedIndex === null
      ? null
      : getElementPosition(project.path.path_elements, selectedIndex);
  const fallbackPosition =
    selectedPosition ??
    getElementPosition(
      project.path.path_elements,
      Math.max(0, project.path.path_elements.length - 1),
    );

  return clampFieldPosition(
    {
      x_meters: (fallbackPosition?.x_meters ?? fieldLengthMeters / 2) + 0.75,
      y_meters: (fallbackPosition?.y_meters ?? fieldWidthMeters / 2) + 0.35,
    },
    project,
  );
}

function clampFieldPosition(
  point: { x_meters: number; y_meters: number },
  project: ProjectDocument,
) {
  const robotSizeMeters = robotSizeFromConfig(project.config);
  const halfRobotLength = robotSizeMeters.lengthMeters / 2;
  const halfRobotWidth = robotSizeMeters.widthMeters / 2;
  return {
    x_meters: clamp(
      point.x_meters,
      halfRobotLength,
      fieldLengthMeters - fieldCoordinateOffsetMeters * 2 - halfRobotLength,
    ),
    y_meters: clamp(
      point.y_meters,
      halfRobotWidth,
      fieldWidthMeters - fieldCoordinateOffsetMeters * 2 - halfRobotWidth,
    ),
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

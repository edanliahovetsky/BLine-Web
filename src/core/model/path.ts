export const translationConstraintKeys = [
  "max_velocity_meters_per_sec",
  "max_acceleration_meters_per_sec2",
] as const;

export const rotationConstraintKeys = [
  "max_velocity_deg_per_sec",
  "max_acceleration_deg_per_sec2",
] as const;

export const terminalToleranceKeys = [
  "end_translation_tolerance_meters",
  "end_rotation_tolerance_deg",
] as const;

export const rangedConstraintKeys = [
  ...translationConstraintKeys,
  ...rotationConstraintKeys,
] as const;

export const constraintKeys = [
  ...translationConstraintKeys,
  ...terminalToleranceKeys,
  ...rotationConstraintKeys,
] as const;

export type TranslationConstraintKey =
  (typeof translationConstraintKeys)[number];
export type RotationConstraintKey = (typeof rotationConstraintKeys)[number];
export type RangedConstraintKey = (typeof rangedConstraintKeys)[number];
export type ConstraintKey = (typeof constraintKeys)[number];
export type RangedConstraintSource = "manual" | "auto_velocity";

export interface AutoVelocityConstraintMetadata {
  velocity_safety_factor: number;
  acceleration_safety_factor: number;
  merge_tolerance_meters_per_sec?: number;
}

export interface Constraints {
  max_velocity_meters_per_sec: number | null;
  max_acceleration_meters_per_sec2: number | null;
  max_velocity_deg_per_sec: number | null;
  max_acceleration_deg_per_sec2: number | null;
  end_translation_tolerance_meters: number | null;
  end_rotation_tolerance_deg: number | null;
}

export interface RangedConstraint {
  key: RangedConstraintKey;
  value: number;
  start_ordinal: number;
  end_ordinal: number;
  source?: RangedConstraintSource;
  auto_velocity?: AutoVelocityConstraintMetadata | null;
}

export interface TranslationTarget {
  type: "translation";
  x_meters: number;
  y_meters: number;
  intermediate_handoff_radius_meters: number | null;
}

export interface RotationTarget {
  type: "rotation";
  rotation_radians: number;
  t_ratio: number;
  profiled_rotation: boolean;
  legacy_position: readonly [number, number] | null;
  legacy_converted: boolean;
}

export interface EventTrigger {
  type: "event_trigger";
  t_ratio: number;
  lib_key: string;
}

export interface Waypoint {
  type: "waypoint";
  translation_target: TranslationTarget;
  rotation_target: RotationTarget;
}

export type PathElement =
  | TranslationTarget
  | RotationTarget
  | EventTrigger
  | Waypoint;

export interface PathModel {
  path_elements: PathElement[];
  constraints: Constraints;
  ranged_constraints: RangedConstraint[];
}

export function createConstraints(
  overrides: Partial<Constraints> = {},
): Constraints {
  return {
    max_velocity_meters_per_sec: null,
    max_acceleration_meters_per_sec2: null,
    max_velocity_deg_per_sec: null,
    max_acceleration_deg_per_sec2: null,
    end_translation_tolerance_meters: null,
    end_rotation_tolerance_deg: null,
    ...overrides,
  };
}

export function createTranslationTarget(
  overrides: Partial<Omit<TranslationTarget, "type">> = {},
): TranslationTarget {
  return {
    type: "translation",
    x_meters: 0,
    y_meters: 0,
    intermediate_handoff_radius_meters: null,
    ...overrides,
  };
}

export function createRotationTarget(
  overrides: Partial<Omit<RotationTarget, "type">> = {},
): RotationTarget {
  return {
    type: "rotation",
    rotation_radians: 0,
    t_ratio: 0,
    profiled_rotation: true,
    legacy_position: null,
    legacy_converted: false,
    ...overrides,
  };
}

export function createEventTrigger(
  overrides: Partial<Omit<EventTrigger, "type">> = {},
): EventTrigger {
  return {
    type: "event_trigger",
    t_ratio: 0,
    lib_key: "",
    ...overrides,
  };
}

export function createWaypoint(
  overrides: Partial<Omit<Waypoint, "type">> = {},
): Waypoint {
  return {
    type: "waypoint",
    translation_target: createTranslationTarget(),
    rotation_target: createRotationTarget(),
    ...overrides,
  };
}

export function createPathModel(overrides: Partial<PathModel> = {}): PathModel {
  return {
    path_elements: [],
    constraints: createConstraints(),
    ranged_constraints: [],
    ...overrides,
  };
}

export function getPathElement(path: PathModel, index: number): PathElement {
  if (
    Number.isInteger(index) &&
    index >= 0 &&
    index < path.path_elements.length
  ) {
    return path.path_elements[index];
  }
  throw new RangeError("Index out of range");
}

export function reorderPathElements(
  path: PathModel,
  newOrder: readonly number[],
): PathModel {
  if (newOrder.length !== path.path_elements.length) {
    throw new Error("New order must match elements length");
  }

  const seen = new Set<number>();
  for (const index of newOrder) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= path.path_elements.length ||
      seen.has(index)
    ) {
      throw new Error("New order must contain each element index exactly once");
    }
    seen.add(index);
  }

  return {
    ...path,
    path_elements: newOrder.map((index) => path.path_elements[index]),
  };
}

export function isTranslationTarget(
  element: PathElement,
): element is TranslationTarget {
  return element.type === "translation";
}

export function isRotationTarget(
  element: PathElement,
): element is RotationTarget {
  return element.type === "rotation";
}

export function isEventTrigger(element: PathElement): element is EventTrigger {
  return element.type === "event_trigger";
}

export function isWaypoint(element: PathElement): element is Waypoint {
  return element.type === "waypoint";
}

export function isAnchorElement(
  element: PathElement,
): element is TranslationTarget | Waypoint {
  return isTranslationTarget(element) || isWaypoint(element);
}

export function isRotationEventElement(
  element: PathElement,
): element is RotationTarget | Waypoint {
  return isRotationTarget(element) || isWaypoint(element);
}

export function isRangedConstraintKey(key: string): key is RangedConstraintKey {
  return (rangedConstraintKeys as readonly string[]).includes(key);
}

export function isTranslationConstraintKey(
  key: string,
): key is TranslationConstraintKey {
  return (translationConstraintKeys as readonly string[]).includes(key);
}

export function isRotationConstraintKey(
  key: string,
): key is RotationConstraintKey {
  return (rotationConstraintKeys as readonly string[]).includes(key);
}

export function countAnchorElements(elements: readonly PathElement[]): number {
  return elements.filter(isAnchorElement).length;
}

export function countRotationEventElements(
  elements: readonly PathElement[],
): number {
  return elements.filter(isRotationEventElement).length;
}

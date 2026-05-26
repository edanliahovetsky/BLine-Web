import { DimensionName, UnitExpression, units } from "../math/units";

export const translationConstraintKeys = [
  "max_velocity",
  "max_acceleration",
] as const;

export const rotationConstraintKeys = [
  "max_angular_velocity",
  "max_angular_acceleration",
] as const;

export const terminalToleranceKeys = [
  "end_translation_tolerance",
  "end_rotation_tolerance",
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

export const constraintDimensions = {
  max_velocity: "LinearVelocity",
  max_acceleration: "LinearAcceleration",
  max_angular_velocity: "AngularVelocity",
  max_angular_acceleration: "AngularAcceleration",
  end_translation_tolerance: "Length",
  end_rotation_tolerance: "Angle",
} as const satisfies Record<ConstraintKey, DimensionName>;

export type ConstraintValue<K extends ConstraintKey> = UnitExpression<
  (typeof constraintDimensions)[K]
>;

export type Constraints = {
  [K in ConstraintKey]: ConstraintValue<K> | null;
};

export interface RangedConstraint<
  K extends RangedConstraintKey = RangedConstraintKey,
> {
  key: K;
  value: ConstraintValue<K>;
  start_ordinal: number;
  end_ordinal: number;
  source?: RangedConstraintSource;
  auto_velocity?: AutoVelocityConstraintMetadata | null;
}

export interface TranslationTarget {
  type: "translation";
  x: UnitExpression<"Length">;
  y: UnitExpression<"Length">;
  intermediate_handoff_radius: UnitExpression<"Length"> | null;
}

export interface RotationTarget {
  type: "rotation";
  rotation: UnitExpression<"Angle">;
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
  ranged_constraints: RangedConstraint<RangedConstraintKey>[];
}

export function createConstraints(
  overrides: Partial<Constraints> = {},
): Constraints {
  return {
    max_velocity: null,
    max_acceleration: null,
    max_angular_velocity: null,
    max_angular_acceleration: null,
    end_translation_tolerance: null,
    end_rotation_tolerance: null,
    ...overrides,
  };
}

interface TranslationTargetOverridesMeters {
  x_meters?: number;
  y_meters?: number;
  intermediate_handoff_radius_meters?: number | null;
}

function applyTranslationTargetOverridesMeters(
  overrides: TranslationTargetOverridesMeters,
): {
  x: UnitExpression<"Length">;
  y: UnitExpression<"Length">;
  intermediate_handoff_radius: UnitExpression<"Length"> | null;
} {
  return {
    x: units.Meter.of(overrides.x_meters ?? 0),
    y: units.Meter.of(overrides.y_meters ?? 0),
    intermediate_handoff_radius: overrides.intermediate_handoff_radius_meters
      ? units.Meter.of(overrides.intermediate_handoff_radius_meters)
      : null,
  };
}

export function createTranslationTarget(
  overrides: Partial<Omit<TranslationTarget, "type">> &
    TranslationTargetOverridesMeters = {},
): TranslationTarget {
  return {
    type: "translation",
    ...applyTranslationTargetOverridesMeters(overrides),
    ...overrides,
  };
}

interface RotationTargetOverridesMeters {
  rotation_radians?: number;
}

function applyRotationTargetOverridesMeters(
  overrides: RotationTargetOverridesMeters,
): { rotation: UnitExpression<"Angle"> } {
  return {
    rotation: units.Radian.of(overrides.rotation_radians ?? 0),
  };
}

export function createRotationTarget(
  overrides: Partial<Omit<RotationTarget, "type">> &
    RotationTargetOverridesMeters = {},
): RotationTarget {
  return {
    type: "rotation",
    ...applyRotationTargetOverridesMeters(overrides),
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
  overrides: Partial<
    Omit<Waypoint, "type"> & {
      translation_target: TranslationTargetOverridesMeters;
      rotation_target: RotationTargetOverridesMeters;
    }
  > = {},
): Waypoint {
  return {
    type: "waypoint",
    translation_target: createTranslationTarget(overrides.translation_target),
    rotation_target: createRotationTarget(overrides.rotation_target),
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

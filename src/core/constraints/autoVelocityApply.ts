import {
  defaultAutoVelocityAccelerationSafetyFactor,
  defaultAutoVelocityMergeToleranceMetersPerSec,
  defaultAutoVelocityVelocitySafetyFactor,
  getDefaultOptionalConfigValue,
} from "../config/projectConfig";
import {
  countAnchorElements,
  type AutoVelocityConstraintMetadata,
  type PathModel,
  type RangedConstraint,
} from "../model/path";
import type { SimulationConfig } from "../sim/types";
import {
  autoVelocityConstraintForCap,
  generateAutoVelocityProfile,
} from "./autoVelocityConstraints";

export interface AutoVelocityRefreshOptions {
  whenPresentOnly?: boolean;
}

export interface AutoVelocityOrdinalOptions {
  refreshExistingAutoVelocity?: boolean;
}

const autoVelocityKey = "max_velocity_meters_per_sec";

export function refreshAutoVelocityConstraints(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityRefreshOptions = {},
): PathModel {
  const hasExistingAutoVelocity = path.ranged_constraints.some(
    (constraint) =>
      constraint.key === autoVelocityKey &&
      constraint.source === "auto_velocity",
  );
  if (options.whenPresentOnly !== false && !hasExistingAutoVelocity) {
    return path;
  }

  const total = countAnchorElements(path.path_elements);
  if (total <= 0) {
    return path;
  }

  const settings = autoVelocitySettings(path, config);
  const profile = generateAutoVelocityProfile(path, config, {
    velocitySafetyFactor: settings.velocitySafetyFactor,
    accelerationSafetyFactor: settings.accelerationSafetyFactor,
  });
  const existing = ordinalConstraintMap(path.ranged_constraints, total);
  const metadata: AutoVelocityConstraintMetadata = {
    velocity_safety_factor: settings.velocitySafetyFactor,
    acceleration_safety_factor: settings.accelerationSafetyFactor,
    merge_tolerance_meters_per_sec: settings.mergeToleranceMps,
  };

  for (const cap of profile.segmentCaps) {
    const current = existing.get(cap.targetOrdinal);
    if (current && current.source !== "auto_velocity") {
      continue;
    }
    existing.set(
      cap.targetOrdinal,
      autoVelocityConstraintForCap(cap, metadata),
    );
  }

  return {
    ...path,
    ranged_constraints: [
      ...path.ranged_constraints.filter(
        (constraint) => constraint.key !== autoVelocityKey,
      ),
      ...constraintsFromOrdinalMap(existing, total, settings.mergeToleranceMps),
    ],
  };
}

export function applyAutoVelocityConstraintsToOrdinals(
  path: PathModel,
  config: SimulationConfig,
  ordinals: readonly number[],
  options: AutoVelocityOrdinalOptions = {},
): PathModel {
  const total = countAnchorElements(path.path_elements);
  if (total <= 0) {
    return path;
  }

  const targetOrdinals = new Set(
    ordinals
      .map((ordinal) => Math.trunc(ordinal))
      .filter((ordinal) => ordinal >= 1 && ordinal <= total),
  );
  const shouldRefreshExisting = options.refreshExistingAutoVelocity ?? true;
  if (targetOrdinals.size === 0 && !shouldRefreshExisting) {
    return path;
  }

  const settings = autoVelocitySettings(path, config);
  const profile = generateAutoVelocityProfile(path, config, {
    velocitySafetyFactor: settings.velocitySafetyFactor,
    accelerationSafetyFactor: settings.accelerationSafetyFactor,
  });
  const existing = ordinalConstraintMap(path.ranged_constraints, total);
  const metadata: AutoVelocityConstraintMetadata = {
    velocity_safety_factor: settings.velocitySafetyFactor,
    acceleration_safety_factor: settings.accelerationSafetyFactor,
    merge_tolerance_meters_per_sec: settings.mergeToleranceMps,
  };
  let changed = false;

  for (const cap of profile.segmentCaps) {
    const current = existing.get(cap.targetOrdinal);
    const isRequestedOrdinal = targetOrdinals.has(cap.targetOrdinal);
    const isRefreshableAuto =
      shouldRefreshExisting && current?.source === "auto_velocity";
    if (!isRequestedOrdinal && !isRefreshableAuto) {
      continue;
    }
    if (current && current.source !== "auto_velocity") {
      continue;
    }

    existing.set(
      cap.targetOrdinal,
      autoVelocityConstraintForCap(cap, metadata),
    );
    changed = true;
  }

  if (!changed) {
    return path;
  }

  return {
    ...path,
    ranged_constraints: [
      ...path.ranged_constraints.filter(
        (constraint) => constraint.key !== autoVelocityKey,
      ),
      ...constraintsFromOrdinalMap(existing, total, settings.mergeToleranceMps),
    ],
  };
}

function autoVelocitySettings(
  path: PathModel,
  config: SimulationConfig,
): {
  velocitySafetyFactor: number;
  accelerationSafetyFactor: number;
  mergeToleranceMps: number;
} {
  const metadata = path.ranged_constraints.find(
    (constraint) =>
      constraint.key === autoVelocityKey &&
      constraint.source === "auto_velocity",
  )?.auto_velocity;

  return {
    velocitySafetyFactor:
      metadata?.velocity_safety_factor ??
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_velocity_safety_factor",
      ) ??
      defaultAutoVelocityVelocitySafetyFactor,
    accelerationSafetyFactor:
      metadata?.acceleration_safety_factor ??
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_acceleration_safety_factor",
      ) ??
      defaultAutoVelocityAccelerationSafetyFactor,
    mergeToleranceMps:
      metadata?.merge_tolerance_meters_per_sec ??
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_merge_tolerance_meters_per_sec",
      ) ??
      defaultAutoVelocityMergeToleranceMetersPerSec,
  };
}

function ordinalConstraintMap(
  constraints: readonly RangedConstraint[],
  total: number,
): Map<number, RangedConstraint> {
  const map = new Map<number, RangedConstraint>();

  for (const constraint of constraints) {
    if (constraint.key !== autoVelocityKey) {
      continue;
    }

    for (const ordinal of ordinalsForConstraint(constraint, total)) {
      map.set(ordinal, {
        ...constraint,
        source:
          constraint.source === "auto_velocity" ? "auto_velocity" : undefined,
        auto_velocity:
          constraint.source === "auto_velocity"
            ? (constraint.auto_velocity ?? null)
            : null,
        start_ordinal: ordinal,
        end_ordinal: ordinal,
      });
    }
  }

  return map;
}

function constraintsFromOrdinalMap(
  map: ReadonlyMap<number, RangedConstraint>,
  total: number,
  autoMergeToleranceMps: number,
): RangedConstraint[] {
  const constraints: RangedConstraint[] = [];

  for (let ordinal = 1; ordinal <= total; ordinal += 1) {
    const constraint = map.get(ordinal);
    if (!constraint) {
      continue;
    }

    const last = constraints.at(-1);
    if (
      last &&
      canMergeOrdinalConstraint(
        last,
        constraint,
        ordinal,
        autoMergeToleranceMps,
      )
    ) {
      last.value = mergedOrdinalConstraintValue(last, constraint);
      last.end_ordinal = ordinal;
      continue;
    }

    constraints.push({
      ...constraint,
      start_ordinal: ordinal,
      end_ordinal: ordinal,
    });
  }

  return constraints;
}

function canMergeOrdinalConstraint(
  previous: RangedConstraint,
  next: RangedConstraint,
  nextOrdinal: number,
  autoMergeToleranceMps: number,
): boolean {
  const valuesMatch =
    previous.source === "auto_velocity" &&
    next.source === "auto_velocity" &&
    previous.key === autoVelocityKey
      ? Math.abs(previous.value - next.value) <= autoMergeToleranceMps
      : previous.value === next.value;

  return (
    previous.end_ordinal === nextOrdinal - 1 &&
    previous.key === next.key &&
    valuesMatch &&
    previous.source === next.source &&
    sameAutoVelocityMetadata(previous.auto_velocity, next.auto_velocity)
  );
}

function mergedOrdinalConstraintValue(
  previous: RangedConstraint,
  next: RangedConstraint,
): number {
  return previous.source === "auto_velocity" && next.source === "auto_velocity"
    ? Math.min(previous.value, next.value)
    : previous.value;
}

function sameAutoVelocityMetadata(
  left: RangedConstraint["auto_velocity"],
  right: RangedConstraint["auto_velocity"],
): boolean {
  return (
    (left?.velocity_safety_factor ?? null) ===
      (right?.velocity_safety_factor ?? null) &&
    (left?.acceleration_safety_factor ?? null) ===
      (right?.acceleration_safety_factor ?? null) &&
    (left?.merge_tolerance_meters_per_sec ?? null) ===
      (right?.merge_tolerance_meters_per_sec ?? null)
  );
}

function ordinalsForConstraint(
  constraint: RangedConstraint,
  total: number,
): number[] {
  const start = clampOrdinal(constraint.start_ordinal, total);
  const end = clampOrdinal(constraint.end_ordinal, total);
  const ordinals: number[] = [];
  for (
    let ordinal = Math.min(start, end);
    ordinal <= Math.max(start, end);
    ordinal += 1
  ) {
    ordinals.push(ordinal);
  }
  return ordinals;
}

function clampOrdinal(ordinal: number, total: number): number {
  return Math.max(1, Math.min(Math.trunc(ordinal), Math.max(1, total)));
}

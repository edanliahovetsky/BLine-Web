import {
  defaultAutoVelocityAccelerationSafetyFactor,
  defaultAutoVelocityMergeToleranceMetersPerSec,
  defaultAutoVelocityVelocitySafetyFactor,
  getDefaultOptionalConfigValue,
} from "../config/projectConfig";
import {
  countAnchorElements,
  getHandoffRadiusSource,
  type AutoVelocityConstraintMetadata,
  type PathModel,
  type RangedConstraint,
} from "../model/path";
import type { SimulationConfig } from "../sim/types";
import { ordinalsForConstraint } from "./rangedConstraints";
import {
  autoVelocityConstraintForCap,
  autoVelocityInputSignature,
  generateAutoVelocityProfile,
  type AutoVelocityGenerationOptions,
} from "./autoVelocityConstraints";

export interface AutoVelocitySettings {
  velocitySafetyFactor: number;
  accelerationSafetyFactor: number;
  mergeToleranceMps: number;
}

export interface AutoVelocityRefreshOptions {
  whenPresentOnly?: boolean;
  /** Optimizer settings to solve with, for callers editing them live. */
  settings?: AutoVelocitySettings;
}

export interface AutoVelocityOrdinalOptions {
  refreshExistingAutoVelocity?: boolean;
}

export interface AutoVelocityStatus {
  currentSignature: string | null;
  expectedMetadata: AutoVelocityConstraintMetadata;
  autoConstraintCount: number;
  hasAutoConstraints: boolean;
  stale: boolean;
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

  const settings = options.settings ?? autoVelocitySettings(config);
  const profile = generateAutoVelocityProfile(
    path,
    config,
    autoVelocityOptions(settings),
  );
  const existing = autoVelocityConstraintsByOrdinal(
    path.ranged_constraints,
    total,
  );
  const metadata = autoVelocityMetadataFor(path, config, settings);

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
      ...autoVelocityConstraintsFromOrdinalMap(
        existing,
        total,
        settings.mergeToleranceMps,
      ),
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

  const settings = autoVelocitySettings(config);
  const profile = generateAutoVelocityProfile(
    path,
    config,
    autoVelocityOptions(settings),
  );
  const existing = autoVelocityConstraintsByOrdinal(
    path.ranged_constraints,
    total,
  );
  const metadata = autoVelocityMetadataFor(path, config, settings);
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
      ...autoVelocityConstraintsFromOrdinalMap(
        existing,
        total,
        settings.mergeToleranceMps,
      ),
    ],
  };
}

export function setAutoVelocityConstraintMode(
  path: PathModel,
  config: SimulationConfig,
  ordinals: readonly number[],
  mode: "auto" | "manual",
  settings = autoVelocitySettings(config),
): PathModel {
  const total = countAnchorElements(path.path_elements);
  const selected = new Set(
    ordinals
      .map((ordinal) => Math.trunc(ordinal))
      .filter((ordinal) => ordinal >= 1 && ordinal <= total),
  );
  if (selected.size === 0) return path;

  const profile = generateAutoVelocityProfile(
    path,
    config,
    autoVelocityOptions(settings),
  );
  const existing = autoVelocityConstraintsByOrdinal(
    path.ranged_constraints,
    total,
  );
  const metadata = autoVelocityMetadataFor(path, config, settings);
  const caps = new Map(
    profile.segmentCaps.map((cap) => [cap.targetOrdinal, cap]),
  );

  for (const [ordinal, constraint] of existing) {
    const cap = caps.get(ordinal);
    if (
      cap &&
      constraint.source === "auto_velocity" &&
      !(mode === "manual" && selected.has(ordinal))
    ) {
      existing.set(ordinal, autoVelocityConstraintForCap(cap, metadata));
    }
  }
  for (const ordinal of selected) {
    const current = existing.get(ordinal);
    const cap = caps.get(ordinal);
    if (mode === "manual" && current) {
      existing.set(ordinal, {
        key: autoVelocityKey,
        value: current.value,
        start_ordinal: ordinal,
        end_ordinal: ordinal,
      });
    } else if (mode === "auto" && cap) {
      existing.set(ordinal, autoVelocityConstraintForCap(cap, metadata));
    }
  }

  return {
    ...path,
    ranged_constraints: [
      ...path.ranged_constraints.filter(
        (constraint) => constraint.key !== autoVelocityKey,
      ),
      ...autoVelocityConstraintsFromOrdinalMap(
        existing,
        total,
        settings.mergeToleranceMps,
      ),
    ],
  };
}

export interface AutoVelocityRefreshRequest {
  options: AutoVelocityGenerationOptions;
  settings: AutoVelocitySettings;
  signature: string | null;
  /** Whether a stamped generated cap can determine staleness on its own. */
  hasGeneratedVelocityCaps: boolean;
  /** True when the generated caps no longer match the current path inputs. */
  stale: boolean;
}

/**
 * Describes the regeneration a path is currently owed, or null when it has no
 * generated radius or velocity output to keep in sync.
 *
 * Generated caps carry a persisted input signature. Auto radii do not, so a
 * radii-only request remains nominally stale and the sync coordinator remembers
 * the last signature it applied for that project.
 */
export function autoVelocityRefreshRequest(
  path: PathModel,
  config: SimulationConfig,
): AutoVelocityRefreshRequest | null {
  const generated = path.ranged_constraints.filter(
    (constraint) =>
      constraint.key === autoVelocityKey &&
      constraint.source === "auto_velocity",
  );
  const hasGeneratedRadii = path.path_elements.some(
    (element) => getHandoffRadiusSource(element) === "auto",
  );
  if (generated.length === 0 && !hasGeneratedRadii) {
    return null;
  }

  const settings = autoVelocitySettings(config);
  const options = autoVelocityOptions(settings);
  const signature = autoVelocityInputSignature(path, config, options);

  return {
    options,
    settings,
    signature,
    hasGeneratedVelocityCaps: generated.length > 0,
    stale:
      generated.length === 0 ||
      signature === null ||
      generated.some(
        (constraint) => constraint.auto_velocity?.input_signature !== signature,
      ) ||
      generated.some(
        (constraint) =>
          !autoVelocityMetadataMatchesSettings(
            constraint.auto_velocity,
            settings,
          ),
      ),
  };
}

export function autoVelocityInputsChanged(
  previousPath: PathModel,
  previousConfig: SimulationConfig,
  path: PathModel,
  config: SimulationConfig,
): boolean {
  const previousSettings = autoVelocitySettings(previousConfig);
  const settings = autoVelocitySettings(config);
  return (
    autoVelocityInputSignature(
      previousPath,
      previousConfig,
      autoVelocityOptions(previousSettings),
    ) !==
      autoVelocityInputSignature(path, config, autoVelocityOptions(settings)) ||
    previousSettings.mergeToleranceMps !== settings.mergeToleranceMps
  );
}

export function autoVelocityStatusForPath(
  path: PathModel,
  config: SimulationConfig,
  settings = autoVelocitySettings(config),
): AutoVelocityStatus {
  const currentSignature = autoVelocityInputSignature(
    path,
    config,
    autoVelocityOptions(settings),
  );
  const expectedMetadata = autoVelocityMetadataFor(path, config, settings);
  const generated = path.ranged_constraints.filter(
    (constraint) =>
      constraint.key === autoVelocityKey &&
      constraint.source === "auto_velocity",
  );
  return {
    currentSignature,
    expectedMetadata,
    autoConstraintCount: generated.length,
    hasAutoConstraints: generated.length > 0,
    stale:
      generated.length === 0 ||
      generated.some(
        (constraint) =>
          !currentSignature ||
          constraint.auto_velocity?.input_signature !== currentSignature ||
          !autoVelocityMetadataMatchesSettings(
            constraint.auto_velocity,
            settings,
          ),
      ),
  };
}

export function autoVelocityConstraintIsStale(
  constraint: RangedConstraint,
  status: AutoVelocityStatus | null | undefined,
): boolean {
  return (
    constraint.key === autoVelocityKey &&
    constraint.source === "auto_velocity" &&
    (!status?.currentSignature ||
      constraint.auto_velocity?.input_signature !== status.currentSignature ||
      !autoVelocityMetadataMatchesSettings(
        constraint.auto_velocity,
        status.expectedMetadata,
      ))
  );
}

function autoVelocityMetadataMatchesSettings(
  metadata: AutoVelocityConstraintMetadata | null | undefined,
  settings: AutoVelocitySettings | AutoVelocityConstraintMetadata,
): boolean {
  return (
    metadata?.velocity_safety_factor ===
      ("velocitySafetyFactor" in settings
        ? settings.velocitySafetyFactor
        : settings.velocity_safety_factor) &&
    metadata.acceleration_safety_factor ===
      ("accelerationSafetyFactor" in settings
        ? settings.accelerationSafetyFactor
        : settings.acceleration_safety_factor) &&
    (metadata.merge_tolerance_meters_per_sec ??
      defaultAutoVelocityMergeToleranceMetersPerSec) ===
      ("mergeToleranceMps" in settings
        ? settings.mergeToleranceMps
        : (settings.merge_tolerance_meters_per_sec ??
          defaultAutoVelocityMergeToleranceMetersPerSec))
  );
}

export function autoVelocityGenerationOptions(settings: {
  velocitySafetyFactor: number;
  accelerationSafetyFactor: number;
}): AutoVelocityGenerationOptions {
  return autoVelocityOptions(settings);
}

function autoVelocityOptions(settings: {
  velocitySafetyFactor: number;
  accelerationSafetyFactor: number;
}): AutoVelocityGenerationOptions {
  return {
    velocitySafetyFactor: settings.velocitySafetyFactor,
    accelerationSafetyFactor: settings.accelerationSafetyFactor,
  };
}

/**
 * Stamps the inputs the caps were solved from, so a later edit can tell at a
 * glance whether they still describe the current path.
 */
function autoVelocityMetadataFor(
  path: PathModel,
  config: SimulationConfig,
  settings: {
    velocitySafetyFactor: number;
    accelerationSafetyFactor: number;
    mergeToleranceMps: number;
  },
): AutoVelocityConstraintMetadata {
  const metadata: AutoVelocityConstraintMetadata = {
    velocity_safety_factor: settings.velocitySafetyFactor,
    acceleration_safety_factor: settings.accelerationSafetyFactor,
    merge_tolerance_meters_per_sec: settings.mergeToleranceMps,
  };
  const signature = autoVelocityInputSignature(
    path,
    config,
    autoVelocityOptions(settings),
  );
  if (signature) {
    metadata.input_signature = signature;
  }
  return metadata;
}

/** Project settings that should be used for the next optimizer run. */
export function autoVelocitySettingsForPath(
  _path: PathModel,
  config: SimulationConfig,
): AutoVelocitySettings {
  return autoVelocitySettings(config);
}

function autoVelocitySettings(config: SimulationConfig): AutoVelocitySettings {
  return {
    velocitySafetyFactor:
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_velocity_safety_factor",
      ) ?? defaultAutoVelocityVelocitySafetyFactor,
    accelerationSafetyFactor:
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_acceleration_safety_factor",
      ) ?? defaultAutoVelocityAccelerationSafetyFactor,
    mergeToleranceMps:
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_merge_tolerance_meters_per_sec",
      ) ?? defaultAutoVelocityMergeToleranceMetersPerSec,
  };
}

export function autoVelocityConstraintsByOrdinal(
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

export function autoVelocityConstraintsFromOrdinalMap(
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

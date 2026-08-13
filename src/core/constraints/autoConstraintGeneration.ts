import {
  seedHandoffRadii,
  seedableHandoffElementIndexes,
} from "../bend/autoSeedHandoffRadii";
import {
  countAnchorElements,
  getHandoffRadiusSource,
  isTranslationTarget,
  isWaypoint,
  setHandoffRadiusSource,
  type PathElement,
  type PathModel,
} from "../model/path";
import type { SimulationConfig } from "../sim/types";
import {
  autoVelocityGenerationOptions,
  autoVelocitySettingsForPath,
  refreshAutoVelocityConstraints,
  type AutoVelocitySettings,
} from "./autoVelocityApply";
import {
  autoVelocityInputSignature,
  jointAutoConstraintSearchPlan,
  primeAutoVelocityProfileCache,
  solveJointAutoConstraints,
  solveJointAutoConstraintsOracle,
  type AutoVelocityGenerationOptions,
  type AutoVelocityProfile,
  type JointAutoConstraintSolveStats,
  type JointAutoConstraintSolveStatus,
  type JointAutoConstraintSearchPlan,
} from "./autoVelocityConstraints";

export interface AutoConstraintGenerationOptions {
  /** Optimizer settings to solve with, for callers editing them live. */
  settings?: AutoVelocitySettings;
}

export type AutoConstraintSolver = "production" | "oracle";

const autoVelocityKey = "max_velocity_meters_per_sec";
/** A fully searchable 16-anchor path; larger searches get a quiet UI warning. */
export const autoConstraintLargePathWarningBudget = 1_124;

/**
 * The whole optimizer: seed the handoff radii nobody pinned, select generated
 * radii against whole-path traces, then solve velocity caps for that geometry.
 * One pass, because the radii are inputs to the cap solve.
 */
export function generateAutoRadiiAndCaps(
  path: PathModel,
  config: SimulationConfig,
  options: AutoConstraintGenerationOptions = {},
): PathModel {
  return generate(path, config, options, false);
}

/**
 * The background variant: only touches a path already carrying generated
 * values, so a first Generate stays an explicit choice. Deterministic and
 * idempotent — re-seeding ignores whatever the last pass wrote — which is what
 * keeps the sync from chasing its own output.
 */
export function refreshAutoRadiiAndCaps(
  path: PathModel,
  config: SimulationConfig,
  options: AutoConstraintGenerationOptions = {},
): PathModel {
  if (!hasGeneratedAutoConstraints(path)) {
    return path;
  }

  return generate(path, config, options, true);
}

function generate(
  path: PathModel,
  config: SimulationConfig,
  options: AutoConstraintGenerationOptions,
  whenPresentOnly: boolean,
): PathModel {
  const settings =
    options.settings ?? autoVelocitySettingsForPath(path, config);

  const input = autoRadiiCapSolveInput(path, config, settings);
  primeAutoVelocityProfileCache(
    autoVelocityInputSignature(input.path, config, input.options),
    input.profile,
  );
  return refreshAutoVelocityConstraints(input.path, config, {
    whenPresentOnly,
    settings,
  });
}

export interface AutoHandoffRadiusAssignment {
  elementIndex: number;
  /** Null clears radius output that stopped being geometrically observable. */
  radiusMeters: number | null;
}

export interface AutoRadiiCapSolveInput {
  /** The exact radius path the jointly solved profile describes. */
  path: PathModel;
  radii: AutoHandoffRadiusAssignment[];
  profile: AutoVelocityProfile;
  stats: JointAutoConstraintSolveStats;
  status: JointAutoConstraintSolveStatus;
  options: AutoVelocityGenerationOptions;
}

/** Work projected for the same seeded search domain production generation uses. */
export function autoRadiiCapSearchPlan(
  path: PathModel,
  config: SimulationConfig,
  settings: AutoVelocitySettings,
): JointAutoConstraintSearchPlan {
  const seeded = seedHandoffRadii(path);
  return jointAutoConstraintSearchPlan(
    seeded.path,
    config,
    autoVelocityGenerationOptions(settings),
  );
}

/**
 * Resolves the complete joint policy. Split out so a worker can hand the main
 * thread radii and the exact profile solved with them as one atomic result.
 */
export function autoRadiiCapSolveInput(
  path: PathModel,
  config: SimulationConfig,
  settings: AutoVelocitySettings,
  solver: AutoConstraintSolver = "production",
): AutoRadiiCapSolveInput {
  const options = autoVelocityGenerationOptions(settings);
  const seeded = seedHandoffRadii(path);
  const solved =
    solver === "oracle"
      ? solveJointAutoConstraintsOracle(seeded.path, config, options, {
          maxEvaluations: 8_000,
        })
      : solveJointAutoConstraints(seeded.path, config, options);
  const assignedElementIndexes = new Set([
    ...autoHandoffRadiusElementIndexes(path.path_elements),
    ...autoHandoffRadiusElementIndexes(solved.path.path_elements),
  ]);

  return {
    path: solved.path,
    radii: [...assignedElementIndexes]
      .sort((left, right) => left - right)
      .map((elementIndex) => ({
        elementIndex,
        radiusMeters:
          getHandoffRadiusSource(solved.path.path_elements[elementIndex]) ===
          "auto"
            ? storedRadius(solved.path.path_elements[elementIndex])
            : null,
      })),
    profile: solved.profile,
    stats: solved.stats,
    status: solved.status,
    options,
  };
}

/** Writes radii resolved elsewhere back onto the path, tagged generated. */
export function applyGeneratedAutoRadii(
  path: PathModel,
  radii: readonly AutoHandoffRadiusAssignment[],
): PathModel {
  if (radii.length === 0) {
    return path;
  }

  const byElementIndex = new Map(
    radii.map((assignment) => [
      assignment.elementIndex,
      assignment.radiusMeters,
    ]),
  );

  return {
    ...path,
    path_elements: path.path_elements.map((element, index) => {
      if (!byElementIndex.has(index)) {
        return element;
      }
      const radiusMeters = byElementIndex.get(index) ?? null;
      if (radiusMeters === null) {
        return getHandoffRadiusSource(element) === "auto"
          ? withClearedHandoffRadius(element)
          : element;
      }
      return setHandoffRadiusSource(
        withHandoffRadius(element, radiusMeters),
        "auto",
      );
    }),
  };
}

/** True where the path carries optimizer output of either kind. */
export function hasGeneratedAutoConstraints(path: PathModel): boolean {
  return (
    hasGeneratedAutoVelocityCaps(path) ||
    autoHandoffRadiusElementIndexes(path.path_elements).length > 0
  );
}

export function hasGeneratedAutoVelocityCaps(path: PathModel): boolean {
  return path.ranged_constraints.some(
    (constraint) =>
      constraint.key === autoVelocityKey &&
      constraint.source === "auto_velocity",
  );
}

/** Anchors whose handoff radius the optimizer currently owns. */
export function autoHandoffRadiusElementIndexes(
  elements: readonly PathElement[],
): number[] {
  return elements.flatMap((element, index) =>
    getHandoffRadiusSource(element) === "auto" ? [index] : [],
  );
}

/**
 * True when Generate would change something: at least one cap ordinal or one
 * interior-anchor radius is not pinned by hand. With everything pinned it would
 * be a silent no-op.
 */
export function canGenerateAutoConstraints(path: PathModel): boolean {
  if (seedableHandoffElementIndexes(path.path_elements).length > 0) {
    return true;
  }

  const total = countAnchorElements(path.path_elements);
  if (total <= 0) {
    return false;
  }

  const manualOrdinals = new Set<number>();
  for (const constraint of path.ranged_constraints) {
    if (
      constraint.key !== autoVelocityKey ||
      constraint.source === "auto_velocity"
    ) {
      continue;
    }
    const start = Math.max(1, Math.trunc(constraint.start_ordinal));
    const end = Math.min(total, Math.trunc(constraint.end_ordinal));
    for (let ordinal = start; ordinal <= end; ordinal += 1) {
      manualOrdinals.add(ordinal);
    }
  }

  for (let ordinal = 1; ordinal <= total; ordinal += 1) {
    if (!manualOrdinals.has(ordinal)) {
      return true;
    }
  }

  return false;
}

/**
 * Drops the optimizer's output: generated caps go away and generated radii
 * revert to unset, leaving pinned values of either kind in place.
 */
export function clearGeneratedAutoConstraints(path: PathModel): PathModel {
  const autoRadiusIndexes = new Set(
    autoHandoffRadiusElementIndexes(path.path_elements),
  );

  return {
    ...path,
    path_elements: path.path_elements.map((element, index) =>
      autoRadiusIndexes.has(index)
        ? withClearedHandoffRadius(element)
        : element,
    ),
    ranged_constraints: path.ranged_constraints.filter(
      (constraint) =>
        !(
          constraint.key === autoVelocityKey &&
          constraint.source === "auto_velocity"
        ),
    ),
  };
}

function storedRadius(element: PathElement | undefined): number | null {
  if (element && isTranslationTarget(element)) {
    return element.intermediate_handoff_radius_meters;
  }
  if (element && isWaypoint(element)) {
    return element.translation_target.intermediate_handoff_radius_meters;
  }
  return null;
}

function withHandoffRadius(
  element: PathElement,
  radiusMeters: number,
): PathElement {
  if (isTranslationTarget(element)) {
    return { ...element, intermediate_handoff_radius_meters: radiusMeters };
  }

  if (isWaypoint(element)) {
    return {
      ...element,
      translation_target: {
        ...element.translation_target,
        intermediate_handoff_radius_meters: radiusMeters,
      },
    };
  }

  return element;
}

function withClearedHandoffRadius(element: PathElement): PathElement {
  if (isTranslationTarget(element)) {
    return setHandoffRadiusSource(
      { ...element, intermediate_handoff_radius_meters: null },
      null,
    );
  }

  if (isWaypoint(element)) {
    return setHandoffRadiusSource(
      {
        ...element,
        translation_target: {
          ...element.translation_target,
          intermediate_handoff_radius_meters: null,
        },
      },
      null,
    );
  }

  return element;
}

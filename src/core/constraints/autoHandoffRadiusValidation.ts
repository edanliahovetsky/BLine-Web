import { getDefaultOptionalConfigValue } from "../config/projectConfig";
import {
  getHandoffRadiusSource,
  isTranslationTarget,
  isWaypoint,
  type PathElement,
  type PathModel,
} from "../model/path";
import type { SimulationConfig } from "../sim/types";
import {
  evaluateAutoHandoffRadiusObjectiveInputs,
  generateAutoVelocityProfile,
  type AutoVelocityGenerationOptions,
  type AutoVelocityHandoffDiagnostic,
} from "./autoVelocityConstraints";
import {
  autoHandoffRadiusObjectiveCost,
  type AutoHandoffRadiusObjectiveWeights,
} from "./autoHandoffRadiusObjective";

export interface HandoffRadiusValidationResult {
  path: PathModel;
  /** Elements whose generated radius the trace-scored search adjusted. */
  shrunkElementIndexes: number[];
}

export interface AutoHandoffRadiusValidationOptions extends AutoVelocityGenerationOptions {
  objectiveWeights?: AutoHandoffRadiusObjectiveWeights;
  candidateIncomingLegFractions?: readonly number[];
}

interface AutoRadiusCoordinate {
  elementIndex: number;
  incomingLegMeters: number;
}

const defaultCandidateIncomingLegFractions = [
  0.15, 0.18, 0.2, 0.23, 0.25, 0.28, 0.3, 0.33, 0.35, 0.38, 0.4,
] as const;
const minValidatedRadiusMeters = 0.05;
const maxIncomingLegRatio = 0.9;
const defaultRadiusMeters = 0.45;
const radiusSearchPasses = 2;
const fullSolveRepairRounds = 2;
const fullSolveRepairThreshold = 1.15;
const fullSolveRepairFactor = 0.85;

/**
 * Selects generated radii by scoring the complete simulated path. Each
 * coordinate tries the same incoming-leg-relative candidate grid while every
 * other radius remains in place, so neighboring corners and manual pins are
 * part of every evaluation. This replaces the old shrink-until-a-gate-passes
 * heuristic, which could not distinguish two passing radii and could not see
 * longitudinally early handoffs on reversals.
 */
export function validateAutoHandoffRadii(
  path: PathModel,
  config: SimulationConfig,
  options: AutoHandoffRadiusValidationOptions = {},
): HandoffRadiusValidationResult {
  const anchors = anchorRecords(path.path_elements);
  const autoCoordinates = anchors.flatMap((anchor, anchorOrdinal) => {
    const previous = anchors[anchorOrdinal - 1];
    if (
      anchorOrdinal === 0 ||
      anchorOrdinal === anchors.length - 1 ||
      !previous ||
      getHandoffRadiusSource(path.path_elements[anchor.elementIndex]) !== "auto"
    ) {
      return [];
    }
    const incomingLegMeters = Math.hypot(
      anchor.x - previous.x,
      anchor.y - previous.y,
    );
    return incomingLegMeters <= minValidatedRadiusMeters
      ? []
      : [{ elementIndex: anchor.elementIndex, incomingLegMeters }];
  });
  if (autoCoordinates.length === 0) {
    return { path, shrunkElementIndexes: [] };
  }

  const fractions =
    options.candidateIncomingLegFractions ??
    defaultCandidateIncomingLegFractions;
  const configuredDefault =
    getDefaultOptionalConfigValue(
      config,
      "intermediate_handoff_radius_meters",
    ) ?? defaultRadiusMeters;
  const velocityOptions = {
    velocitySafetyFactor: options.velocitySafetyFactor,
    accelerationSafetyFactor: options.accelerationSafetyFactor,
    sampleStepMeters: options.sampleStepMeters,
    includeGeneratedRadiiInCacheKey: true,
  };
  let candidatePath = refineCoordinateRadii(
    path,
    autoCoordinates,
    configuredDefault,
    fractions,
    config,
    velocityOptions,
    options.objectiveWeights,
  );
  if (hasCoupledMinimumRadii(candidatePath, autoCoordinates)) {
    const alternate = refineCoordinateRadii(
      bestWholePathStart(
        path,
        autoCoordinates,
        configuredDefault,
        fractions,
        config,
        velocityOptions,
        options.objectiveWeights,
      ),
      autoCoordinates,
      configuredDefault,
      fractions,
      config,
      velocityOptions,
      options.objectiveWeights,
    );
    if (
      radiusCost(alternate, config, velocityOptions, options.objectiveWeights) <
      radiusCost(
        candidatePath,
        config,
        velocityOptions,
        options.objectiveWeights,
      ) -
        1e-9
    ) {
      candidatePath = alternate;
    }
  }
  candidatePath = repairFullSolveFailures(
    candidatePath,
    config,
    velocityOptions,
    anchors,
  );

  return {
    path: candidatePath,
    shrunkElementIndexes: changedElementIndexes(path, candidatePath),
  };
}

function refineCoordinateRadii(
  path: PathModel,
  coordinates: readonly AutoRadiusCoordinate[],
  configuredDefault: number,
  fractions: readonly number[],
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions,
  weights: AutoHandoffRadiusObjectiveWeights | undefined,
): PathModel {
  let candidatePath = path;
  for (let pass = 0; pass < radiusSearchPasses; pass += 1) {
    let changed = false;
    for (const { elementIndex, incomingLegMeters } of coordinates) {
      const currentRadius =
        storedRadius(candidatePath.path_elements[elementIndex]) ??
        configuredDefault;
      const candidates = radiusCandidates(
        incomingLegMeters,
        currentRadius,
        configuredDefault,
        fractions,
      );
      let bestPath = candidatePath;
      let bestRadius = currentRadius;
      let bestCost = radiusCost(candidatePath, config, options, weights);

      for (const radiusMeters of candidates) {
        const trial = withRadiusAt(candidatePath, elementIndex, radiusMeters);
        const cost = radiusCost(trial, config, options, weights);
        if (
          cost < bestCost - 1e-9 ||
          (Math.abs(cost - bestCost) <= 1e-9 && radiusMeters < bestRadius)
        ) {
          bestPath = trial;
          bestRadius = radiusMeters;
          bestCost = cost;
        }
      }
      if (bestRadius !== currentRadius) {
        changed = true;
      }
      candidatePath = bestPath;
    }
    if (!changed) {
      break;
    }
  }
  return candidatePath;
}

function hasCoupledMinimumRadii(
  path: PathModel,
  coordinates: readonly AutoRadiusCoordinate[],
): boolean {
  let previousAtMinimum = false;
  for (const { elementIndex } of coordinates) {
    const radius = storedRadius(path.path_elements[elementIndex]);
    const atMinimum =
      radius !== null && radius <= minValidatedRadiusMeters + 1e-9;
    if (atMinimum && previousAtMinimum) {
      return true;
    }
    previousAtMinimum = atMinimum;
  }
  return false;
}

/**
 * Coordinate descent only sees one radius change at a time. When several
 * oversized seeds fail together, every one-dimensional move can look worse
 * even though a moderate joint assignment is much better. Score a cheap
 * family of coherent, incoming-leg-relative starts when the normal search
 * collapses adjacent coordinates to the radius floor, then refine the best
 * alternate basin.
 */
function bestWholePathStart(
  path: PathModel,
  coordinates: readonly AutoRadiusCoordinate[],
  configuredDefault: number,
  fractions: readonly number[],
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions,
  weights: AutoHandoffRadiusObjectiveWeights | undefined,
): PathModel {
  const starts = [
    path,
    withCoordinateRadii(path, coordinates, () => minValidatedRadiusMeters),
    withCoordinateRadii(path, coordinates, () => configuredDefault),
    ...fractions.map((fraction) =>
      withCoordinateRadii(
        path,
        coordinates,
        (coordinate) => coordinate.incomingLegMeters * fraction,
      ),
    ),
  ];
  const seen = new Set<string>();
  let bestPath = path;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const candidate of starts) {
    const signature = coordinates
      .map(
        ({ elementIndex }) =>
          storedRadius(candidate.path_elements[elementIndex]) ?? "unset",
      )
      .join(",");
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);

    const cost = radiusCost(candidate, config, options, weights);
    if (cost < bestCost - 1e-9) {
      bestPath = candidate;
      bestCost = cost;
    }
  }

  return bestPath;
}

function withCoordinateRadii(
  path: PathModel,
  coordinates: readonly AutoRadiusCoordinate[],
  radiusFor: (coordinate: AutoRadiusCoordinate) => number,
): PathModel {
  const radiiByElementIndex = new Map(
    coordinates.map((coordinate) => [
      coordinate.elementIndex,
      boundedRadius(coordinate.incomingLegMeters, radiusFor(coordinate)),
    ]),
  );
  return {
    ...path,
    path_elements: path.path_elements.map((element, elementIndex) => {
      const radiusMeters = radiiByElementIndex.get(elementIndex);
      return radiusMeters === undefined
        ? element
        : withHandoffRadius(element, radiusMeters);
    }),
  };
}

function repairFullSolveFailures(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions,
  anchors: readonly { elementIndex: number; x: number; y: number }[],
): PathModel {
  let candidate = path;
  for (let round = 0; round < fullSolveRepairRounds; round += 1) {
    const profile = generateAutoVelocityProfile(candidate, config, options);
    const failures = profile.diagnostics.handoffs.filter(
      (handoff) =>
        handoff.skippedOutgoingSegment ||
        diagnosticMaxRatio(handoff) > fullSolveRepairThreshold,
    );
    if (failures.length === 0) {
      break;
    }

    let changed = false;
    for (const failure of failures) {
      const elementIndex = anchors[failure.anchorOrdinal - 1]?.elementIndex;
      if (
        elementIndex === undefined ||
        getHandoffRadiusSource(candidate.path_elements[elementIndex]) !== "auto"
      ) {
        continue;
      }
      const current = storedRadius(candidate.path_elements[elementIndex]);
      if (current === null || current <= minValidatedRadiusMeters) {
        continue;
      }
      candidate = withRadiusAt(
        candidate,
        elementIndex,
        Math.round(
          Math.max(minValidatedRadiusMeters, current * fullSolveRepairFactor) *
            1000,
        ) / 1000,
      );
      changed = true;
    }
    if (!changed) {
      break;
    }
  }
  return candidate;
}

function diagnosticMaxRatio(handoff: AutoVelocityHandoffDiagnostic): number {
  return Math.max(
    handoff.combinedErrorMeters /
      Math.max(handoff.toleranceMeters, Number.EPSILON),
    handoff.postHandoffPeakErrorMeters /
      Math.max(handoff.postHandoffToleranceMeters, Number.EPSILON),
    handoff.overshootErrorMeters /
      Math.max(handoff.overshootToleranceMeters, Number.EPSILON),
    handoff.corridorDeviationMeters /
      Math.max(handoff.corridorToleranceMeters, Number.EPSILON),
  );
}

function withRadiusAt(
  path: PathModel,
  elementIndex: number,
  radiusMeters: number,
): PathModel {
  return {
    ...path,
    path_elements: path.path_elements.map((element, index) =>
      index === elementIndex
        ? withHandoffRadius(element, radiusMeters)
        : element,
    ),
  };
}

function radiusCandidates(
  incomingLegMeters: number,
  currentRadius: number,
  configuredDefault: number,
  fractions: readonly number[],
): number[] {
  return [
    ...new Set(
      [
        minValidatedRadiusMeters,
        configuredDefault,
        currentRadius,
        ...fractions.map((fraction) => incomingLegMeters * fraction),
      ].map((radius) => boundedRadius(incomingLegMeters, radius)),
    ),
  ].sort((left, right) => left - right);
}

function boundedRadius(
  incomingLegMeters: number,
  radiusMeters: number,
): number {
  return (
    Math.round(
      Math.max(
        minValidatedRadiusMeters,
        Math.min(maxIncomingLegRatio * incomingLegMeters, radiusMeters),
      ) * 1000,
    ) / 1000
  );
}

function radiusCost(
  path: PathModel,
  config: SimulationConfig,
  options: AutoVelocityGenerationOptions,
  weights: AutoHandoffRadiusObjectiveWeights | undefined,
): number {
  const evaluations = evaluateAutoHandoffRadiusObjectiveInputs(
    path,
    config,
    options,
  );
  return evaluations.length === 0
    ? 0
    : Math.min(
        ...evaluations.map((evaluation) =>
          autoHandoffRadiusObjectiveCost(evaluation, weights),
        ),
      );
}

function changedElementIndexes(before: PathModel, after: PathModel): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < after.path_elements.length; index += 1) {
    if (
      storedRadius(before.path_elements[index]) !==
      storedRadius(after.path_elements[index])
    ) {
      indexes.push(index);
    }
  }
  return indexes;
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

function anchorRecords(
  elements: readonly PathElement[],
): Array<{ elementIndex: number; x: number; y: number }> {
  return elements.flatMap((element, elementIndex) => {
    if (isTranslationTarget(element)) {
      return [{ elementIndex, x: element.x_meters, y: element.y_meters }];
    }
    if (isWaypoint(element)) {
      return [
        {
          elementIndex,
          x: element.translation_target.x_meters,
          y: element.translation_target.y_meters,
        },
      ];
    }
    return [];
  });
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

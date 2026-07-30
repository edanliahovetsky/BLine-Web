import type {
  AutoVelocityCorner,
  AutoVelocityDiagnostics,
} from "./autoVelocityConstraints";

export interface AutoHandoffRadiusObjectiveInput {
  corners: readonly AutoVelocityCorner[];
  diagnostics: AutoVelocityDiagnostics;
}

export interface AutoHandoffRadiusObjectiveWeights {
  completionFailure: number;
  skippedSegment: number;
  constraintViolation: number;
  earlyHandoff: number;
  reversalEarlyHandoffMultiplier: number;
  corridor: number;
  tracking: number;
  time: number;
}

/**
 * Radius selection trades path fidelity against traversal time. Constraint
 * violations remain expensive, but passing candidates are still distinguishable:
 * the old selector treated every passing radius as equally good and therefore
 * kept whichever oversized seed happened to pass first.
 */
export const defaultAutoHandoffRadiusObjectiveWeights: AutoHandoffRadiusObjectiveWeights =
  {
    completionFailure: 1_000_000,
    skippedSegment: 1_000_000,
    constraintViolation: 20_000,
    earlyHandoff: 28,
    reversalEarlyHandoffMultiplier: 5,
    corridor: 3,
    tracking: 2,
    time: 4.5,
  };

export function autoHandoffRadiusObjectiveCost(
  profile: AutoHandoffRadiusObjectiveInput,
  weights: AutoHandoffRadiusObjectiveWeights = defaultAutoHandoffRadiusObjectiveWeights,
): number {
  let cost = finitePositive(profile.diagnostics.totalTimeS) * weights.time;

  if (!profile.diagnostics.reachedEnd) {
    cost += weights.completionFailure;
  }

  for (const handoff of profile.diagnostics.handoffs) {
    if (handoff.skippedOutgoingSegment) {
      cost += weights.skippedSegment;
    }

    const handoffRatio =
      handoff.combinedErrorMeters /
      Math.max(handoff.toleranceMeters, minPositive);
    const postHandoffRatio =
      handoff.postHandoffPeakErrorMeters /
      Math.max(handoff.postHandoffToleranceMeters, minPositive);
    const overshootRatio =
      handoff.overshootErrorMeters /
      Math.max(handoff.overshootToleranceMeters, minPositive);
    const corridorRatio =
      handoff.corridorDeviationMeters /
      Math.max(handoff.corridorToleranceMeters, minPositive);
    const ratios = [
      handoffRatio,
      postHandoffRatio,
      overshootRatio,
      corridorRatio,
    ].map(finiteRatio);

    for (const ratio of ratios) {
      cost += weights.constraintViolation * Math.max(0, ratio - 1) ** 2;
    }

    const corner = profile.corners.find(
      (candidate) => candidate.anchorOrdinal === handoff.anchorOrdinal,
    );
    const turnAngle = corner?.turnAngleRadians ?? 0;
    const reversalBlend = clamp(
      (turnAngle - reversalPenaltyStartRadians) /
        (Math.PI - reversalPenaltyStartRadians),
      0,
      1,
    );
    const earlyHandoffWeight =
      weights.earlyHandoff *
      (1 + (weights.reversalEarlyHandoffMultiplier - 1) * reversalBlend ** 8);
    cost += earlyHandoffWeight * finiteRatio(handoff.earlyHandoffRatio) ** 2;
    cost += weights.corridor * corridorRatio ** 2;
    cost +=
      weights.tracking *
      (handoffRatio ** 2 + postHandoffRatio ** 2 + overshootRatio ** 2);
  }

  return cost;
}

const minPositive = 1e-9;
const reversalPenaltyStartRadians = (150 * Math.PI) / 180;

function finiteRatio(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 1_000;
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

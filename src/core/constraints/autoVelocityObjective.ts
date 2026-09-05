export interface AutoVelocityObjectiveWeights {
  reach: number;
  violationMax: number;
  violationSum: number;
  time: number;
  capReserve: number;
  smoothness: number;
}

export interface AutoVelocityObjectiveInput {
  reachedEndRatio: number;
  handoffRatios: readonly number[];
  totalTimeS: number;
  capsByOrdinal: ReadonlyMap<number, number>;
}

export interface AutoVelocityObjectiveTerms {
  reachOverLimitSquared: number;
  maxOverLimitSquared: number;
  sumOverLimitSquared: number;
  totalTimeS: number;
  safeCapReserve: number;
  capSmoothness: number;
}

export const defaultAutoVelocityObjectiveWeights: AutoVelocityObjectiveWeights =
  {
    reach: 1_000_000,
    violationMax: 20_000,
    violationSum: 5_000,
    time: 2,
    capReserve: 0.5,
    smoothness: 0.001,
  };

export const autoVelocityTieBreakWeights: AutoVelocityObjectiveWeights = {
  reach: 0,
  violationMax: 0,
  violationSum: 0,
  time: 0,
  capReserve: 1,
  smoothness: 0.001,
};

export function autoVelocityObjectiveCost(
  input: AutoVelocityObjectiveInput,
  weights: AutoVelocityObjectiveWeights = defaultAutoVelocityObjectiveWeights,
): number {
  const terms = autoVelocityObjectiveTerms(input);
  return (
    weights.reach * terms.reachOverLimitSquared +
    weights.violationMax * terms.maxOverLimitSquared +
    weights.violationSum * terms.sumOverLimitSquared +
    weights.time * terms.totalTimeS -
    weights.capReserve * terms.safeCapReserve +
    weights.smoothness * terms.capSmoothness
  );
}

export function autoVelocityObjectiveTerms(
  input: AutoVelocityObjectiveInput,
): AutoVelocityObjectiveTerms {
  const ratios = [input.reachedEndRatio, ...input.handoffRatios];
  let maxOver = 0;
  let sumOverLimitSquared = 0;

  for (const ratio of ratios) {
    const over = Math.max(0, finiteCostRatio(ratio) - 1);
    maxOver = Math.max(maxOver, over);
    sumOverLimitSquared += over ** 2;
  }

  const reachOver = Math.max(0, finiteCostRatio(input.reachedEndRatio) - 1);

  return {
    reachOverLimitSquared: reachOver ** 2,
    maxOverLimitSquared: maxOver ** 2,
    sumOverLimitSquared,
    totalTimeS: finitePositive(input.totalTimeS),
    safeCapReserve:
      reachOver === 0 && maxOver === 0 ? capSum(input.capsByOrdinal) : 0,
    capSmoothness: capSmoothness(input.capsByOrdinal),
  };
}

export function autoVelocityTieBreakCost(
  input: AutoVelocityObjectiveInput,
): number {
  return autoVelocityObjectiveCost(input, autoVelocityTieBreakWeights);
}

function finiteCostRatio(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 1_000;
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1_000;
}

function capSum(caps: ReadonlyMap<number, number>): number {
  let sum = 0;
  for (const value of caps.values()) {
    sum += value;
  }
  return sum;
}

function capSmoothness(caps: ReadonlyMap<number, number>): number {
  const values = [...caps.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value);
  let smoothness = 0;
  for (let index = 1; index < values.length; index += 1) {
    smoothness += (values[index] - values[index - 1]) ** 2;
  }
  return smoothness;
}

/** Bounded, deterministic search; the caller owns simulation and feasibility. */
export interface RotationSearchVariable {
  min: number;
  max: number;
  quantum: number;
  kind: "cap" | "radius";
}

export interface RotationSearchEvaluation {
  feasible: boolean;
  translationFeasible: boolean;
  translationViolation: number;
  violation: number;
  timeS: number;
}

export function rotationSearchBudget(variables: number): number {
  return Math.min(420, 80 + 40 * variables);
}

export function searchRotationConstraints<T extends RotationSearchEvaluation>(
  variables: readonly RotationSearchVariable[],
  seed: readonly number[],
  evaluate: (values: readonly number[], stable: boolean) => T,
): { values: number[]; result: T; evaluations: number; budget: number } {
  const budget = rotationSearchBudget(variables.length);
  let evaluations = 0;
  let phaseBudget = Math.floor(budget * 0.85);
  const cache = new Map<string, { values: number[]; result: T }>();
  const trial = (values: readonly number[], stable = false) => {
    const normalized = values.map((value, i) => {
      const variable = variables[i]!;
      return Math.max(
        variable.min,
        Math.min(
          variable.max,
          Math.round(value / variable.quantum) * variable.quantum,
        ),
      );
    });
    const key = `${stable}:${normalized.map((value) => value.toFixed(4)).join(",")}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const candidate = {
      values: normalized,
      result: evaluate(normalized, stable),
    };
    evaluations += 1;
    cache.set(key, candidate);
    return candidate;
  };
  const better = (a: T, b: T) => {
    if (a.translationFeasible !== b.translationFeasible)
      return a.translationFeasible;
    if (
      !a.translationFeasible &&
      Math.abs(a.translationViolation - b.translationViolation) > 1e-6
    )
      return a.translationViolation < b.translationViolation;
    if (a.feasible !== b.feasible) return a.feasible;
    if (a.feasible) return a.timeS < b.timeS - 1e-6;
    return (
      a.violation < b.violation - 1e-6 ||
      (Math.abs(a.violation - b.violation) <= 1e-6 && a.timeS < b.timeS - 1e-6)
    );
  };
  let best = trial(seed);
  const consider = (values: readonly number[], stable = false) => {
    if (evaluations >= phaseBudget) return;
    const candidate = trial(values, stable);
    if (better(candidate.result, best.result)) best = candidate;
  };
  // Broad cap scales find feasible basins without deriving a speed from the
  // preview controller's tracking lag. Independent radius starts allow an
  // early handoff to move later without inventing microscopic trigger circles.
  for (const radiusFraction of [null, 0, 0.15, 0.4]) {
    for (const factor of [1, 0.75, 0.5, 0.3, 0.15, 0.07]) {
      consider(
        seed.map((value, i) =>
          variables[i]!.kind === "cap"
            ? value * factor
            : radiusFraction === null
              ? value
              : variables[i]!.min +
                radiusFraction * (variables[i]!.max - variables[i]!.min),
        ),
      );
    }
  }
  const polish = (stable: boolean) => {
    for (const fraction of [0.2, 0.06, 0.015, 0.004]) {
      for (let sweep = 0; sweep < 5; sweep += 1) {
        const before = best;
        for (let i = 0; i < variables.length; i += 1) {
          const variable = variables[i]!;
          const step = Math.max(
            variable.quantum,
            fraction * (variable.max - variable.min),
          );
          const center = best.values[i]!;
          for (const value of [
            center - step,
            center + step,
            ...(sweep === 0
              ? variable.kind === "radius"
                ? [variable.min, variable.max]
                : [variable.max]
              : []),
          ]) {
            const values = [...best.values];
            values[i] = value;
            consider(values, stable);
          }
        }
        if (best === before || evaluations >= phaseBudget) break;
      }
    }
  };
  polish(false);
  // Reserve the final phase for the persisted values at 20, 10 and 5 ms.
  // A coarse-only winner is never reported as valid.
  phaseBudget = budget;
  const coarseFeasible = best.result.feasible;
  best = trial(best.values, true);
  if (
    !best.result.translationFeasible ||
    (coarseFeasible && !best.result.feasible)
  ) {
    const finalists = [...cache.values()]
      .filter((candidate) => candidate.result.feasible)
      .sort((a, b) => a.result.timeS - b.result.timeS)
      .slice(0, 8);
    for (const candidate of finalists) consider(candidate.values, true);
    for (const factor of [0.98, 0.94, 0.85, 0.7, 0.5]) {
      consider(
        best.values.map((value, i) =>
          variables[i]!.kind === "cap" ? value * factor : value,
        ),
        true,
      );
    }
  }
  return { ...best, evaluations, budget };
}

import { describe, expect, it } from "vitest";
import {
  autoVelocityObjectiveCost,
  autoVelocityObjectiveTerms,
  autoVelocityTieBreakCost,
} from "../../../src/core/constraints/autoVelocityObjective";

describe("autoVelocityObjective", () => {
  it("dominates unsafe handoff violations over cap reserve", () => {
    const safe = {
      reachedEndRatio: 0,
      handoffRatios: [0.8, 0.95],
      totalTimeS: 4.2,
      capsByOrdinal: new Map([
        [2, 2.2],
        [3, 2.4],
      ]),
    };
    const unsafeFaster = {
      reachedEndRatio: 0,
      handoffRatios: [1.02, 0.95],
      totalTimeS: 3.9,
      capsByOrdinal: new Map([
        [2, 4],
        [3, 4],
      ]),
    };

    expect(autoVelocityObjectiveCost(safe)).toBeLessThan(
      autoVelocityObjectiveCost(unsafeFaster),
    );
  });

  it("rewards cap reserve only after all ratios are safe", () => {
    const lowCaps = {
      reachedEndRatio: 0,
      handoffRatios: [0.9],
      totalTimeS: 5,
      capsByOrdinal: new Map([
        [2, 1.5],
        [3, 1.5],
      ]),
    };
    const highCaps = {
      ...lowCaps,
      capsByOrdinal: new Map([
        [2, 2.5],
        [3, 2.5],
      ]),
    };

    expect(autoVelocityObjectiveCost(highCaps)).toBeLessThan(
      autoVelocityObjectiveCost(lowCaps),
    );
    expect(autoVelocityTieBreakCost(highCaps)).toBeLessThan(
      autoVelocityTieBreakCost(lowCaps),
    );
  });

  it("reports squared over-limit terms", () => {
    const terms = autoVelocityObjectiveTerms({
      reachedEndRatio: 1.1,
      handoffRatios: [0.5, 1.2],
      totalTimeS: 2,
      capsByOrdinal: new Map([[2, 1]]),
    });

    expect(terms.reachOverLimitSquared).toBeCloseTo(0.01);
    expect(terms.maxOverLimitSquared).toBeCloseTo(0.04);
    expect(terms.sumOverLimitSquared).toBeCloseTo(0.05);
    expect(terms.safeCapReserve).toBe(0);
  });
});

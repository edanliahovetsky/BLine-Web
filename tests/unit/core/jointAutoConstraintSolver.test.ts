import { describe, expect, it } from "vitest";
import { seedHandoffRadii } from "../../../src/core/bend/autoSeedHandoffRadii";
import { solveJointAutoConstraints } from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";

describe("solveJointAutoConstraints", () => {
  it("solves coupled handoff radii and adjacent velocity caps as one bounded policy", () => {
    const path = createPathModel({
      path_elements: [
        [5.7, 2.5],
        [7, 4],
        [14.88016, 2.7264],
        [10.9, 5.5],
      ].map(([x, y]) => createTranslationTarget({ x_meters: x, y_meters: y })),
    });
    const seeded = seedHandoffRadii(path).path;

    const result = solveJointAutoConstraints(seeded, {});

    expect(result.status).toBe("valid");
    expect(result.profile.diagnostics.reachedEnd).toBe(true);
    expect(
      result.profile.diagnostics.handoffs.every(
        (handoff) => handoff.passed && !handoff.skippedOutgoingSegment,
      ),
    ).toBe(true);
    expect(result.profile.segmentCaps).toHaveLength(4);
    expect(result.stats.evaluations).toBeLessThanOrEqual(180);
    expect(["converged", "evaluation-budget"]).toContain(
      result.stats.terminationReason,
    );
  });
});

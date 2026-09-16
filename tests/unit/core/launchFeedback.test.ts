import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createProjectConfig } from "../../../src/core/config/projectConfig";
import { deserializePath } from "../../../src/core/io/projectSerde";
import { applyGeneratedAutoRadii } from "../../../src/core/constraints/autoConstraintGeneration";
import {
  autoVelocitySettingsForPath,
  refreshAutoVelocityConstraints,
} from "../../../src/core/constraints/autoVelocityApply";
import { simulatePathWithTrace } from "../../../src/core/sim/simulatePath";
import { evaluateRotationFeasibility } from "../../../src/core/sim/rotationFeasibility";
import {
  requestAutoRadiiAndCaps,
  resetAutoVelocityRunner,
  supersededAutoVelocityProfile,
} from "../../../src/platform/autoVelocityRunner";

// Chief Delphi topic 509778, post 213. The attachment omits robot settings.
// Use published Beta 1 project defaults, not the solver's legacy flat defaults.
it("preserves manual launch-feedback constraints and reports the 0.05 m/s result as best-effort", async () => {
  const path = deserializePath(
    JSON.parse(
      readFileSync(
        new URL(
          "../../fixtures/simulation/launch_feedback_213.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const config = createProjectConfig();
  const settings = autoVelocitySettingsForPath(path, config);
  resetAutoVelocityRunner();
  try {
    const run = await requestAutoRadiiAndCaps(path, config, settings);
    expect(run).not.toBe(supersededAutoVelocityProfile);
    if (run === supersededAutoVelocityProfile)
      throw new Error("Unexpected superseded reproduction");
    expect(run.status).toBe("best-effort");
    expect(run.stats.stabilityValidationPassed).toBe(false);
    expect(run.profile.diagnostics.maxHandoffErrorRatio).toBeGreaterThan(1);
    expect(
      run.profile.segmentCaps.find((cap) => cap.targetOrdinal === 6)?.value,
    ).toBeCloseTo(0.05);
    const generated = refreshAutoVelocityConstraints(
      applyGeneratedAutoRadii(path, run.radii),
      config,
      { settings },
    );
    const manual = generated.ranged_constraints.filter(
      (c) => c.source !== "auto_velocity",
    );
    expect(manual).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "max_velocity_meters_per_sec",
          value: 4.5,
          start_ordinal: 2,
          end_ordinal: 5,
        }),
        expect.objectContaining({
          key: "min_velocity_meters_per_sec",
          value: 0.5,
          start_ordinal: 1,
          end_ordinal: 1,
        }),
      ]),
    );
    expect(manual).toHaveLength(2);
    const slow = simulatePathWithTrace(generated, config);
    expect(slow.total_time_s).toBeGreaterThan(50);
    const faster = {
      ...generated,
      ranged_constraints: generated.ranged_constraints.map((c) =>
        c.key === "max_velocity_meters_per_sec" && c.start_ordinal === 6
          ? { ...c, value: 0.5 }
          : c,
      ),
    };
    const fasterSimulation = simulatePathWithTrace(faster, config);
    expect(fasterSimulation.total_time_s).toBeLessThan(10);
    // Slowing only the final segment cannot repair the earlier 135-degree turn.
    const earlierTurn = (
      candidate: typeof generated,
      trace: typeof slow.trace,
    ) =>
      evaluateRotationFeasibility(candidate, config, trace).find(
        (target) => target.elementIndex === 4,
      );
    expect(earlierTurn(generated, slow.trace)).toMatchObject({
      passed: false,
      reason: "insufficient-time",
    });
    expect(earlierTurn(faster, fasterSimulation.trace)).toEqual(
      earlierTurn(generated, slow.trace),
    );
  } finally {
    resetAutoVelocityRunner();
  }
}, 30_000);

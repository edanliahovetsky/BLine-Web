import { describe, expect, it } from "vitest";
import { refreshAutoVelocityConstraints } from "../../../src/core/constraints/autoVelocityApply";
import { checkPlan, eventKeyCaseHint } from "../../../src/ui/tours/tourChecks";
import {
  createSpeedPath,
  practiceConfig,
} from "../../../src/ui/tours/tourScenario";

describe("lesson outcome checks", () => {
  it("accepts a current plan without demanding an unnecessary Generate click", () => {
    const config = practiceConfig();
    const path = createSpeedPath();
    expect(checkPlan(path, config).complete).toBe(false);
    const generated = refreshAutoVelocityConstraints(path, config, {
      whenPresentOnly: false,
    });
    expect(checkPlan(generated, config).complete).toBe(true);
  });

  it("names a capitalization slip only when the letters otherwise match", () => {
    expect(eventKeyCaseHint(["stopintake"], ["stopIntake"])).toBe(
      'Keys are case-sensitive — you typed "stopintake"; use "stopIntake".',
    );
    expect(eventKeyCaseHint(["stopIntake"], ["stopIntake"])).toBeNull();
    expect(eventKeyCaseHint(["stop"], ["stopIntake"])).toBeNull();
  });
});

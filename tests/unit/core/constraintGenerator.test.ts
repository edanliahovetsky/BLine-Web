import { describe, expect, it } from "vitest";

import { constraintGenerator } from "../../../src/core/constraints/constraintGenerator";
import { generateAutoVelocityProfile } from "../../../src/core/constraints/autoVelocityConstraints";

describe("production constraint generator adapter", () => {
  it("uses the production velocity generator without automatic radii", () => {
    expect(constraintGenerator.capabilities.automaticHandoffRadii).toBe(false);
    expect(constraintGenerator.generateVelocityProfile).toBe(
      generateAutoVelocityProfile,
    );
  });
});

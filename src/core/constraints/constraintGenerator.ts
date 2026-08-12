import { generateAutoVelocityProfile } from "./autoVelocityConstraints";

export interface ConstraintGeneratorCapabilities {
  automaticHandoffRadii: boolean;
}

/**
 * The seam between constraint presentation and generation. The UI branch keeps
 * the production velocity implementation and advertises that radius generation
 * is unavailable. generator-overhaul supplies the expanded adapter.
 */
export interface ConstraintGenerator {
  capabilities: ConstraintGeneratorCapabilities;
  generateVelocityProfile: typeof generateAutoVelocityProfile;
}

export const constraintGenerator: ConstraintGenerator = {
  capabilities: {
    automaticHandoffRadii: false,
  },
  generateVelocityProfile: generateAutoVelocityProfile,
};

import type { PathModel } from "../core/model/path";
import type { SimulationConfig } from "../core/sim/types";
import type { AutoVelocitySettings } from "../core/constraints/autoVelocityApply";
import type { AutoHandoffRadiusAssignment } from "../core/constraints/autoConstraintGeneration";
import type {
  AutoVelocityProfile,
  JointAutoConstraintSolveStats,
  JointAutoConstraintSolveStatus,
} from "../core/constraints/autoVelocityConstraints";

export interface AutoVelocityWorkerRequest {
  kind: "generate-radii-and-caps";
  requestId: number;
  path: PathModel;
  config: SimulationConfig;
  settings: AutoVelocitySettings;
}

export type AutoVelocityWorkerResponse =
  | {
      kind: "generated-radii-and-caps";
      requestId: number;
      profile: AutoVelocityProfile;
      /** Cache key of the seeded-and-validated path the profile was solved for. */
      cacheKey: string | null;
      radii: AutoHandoffRadiusAssignment[];
      stats: JointAutoConstraintSolveStats;
      status: JointAutoConstraintSolveStatus;
    }
  | {
      kind: "failed";
      requestId: number;
      message: string;
    };

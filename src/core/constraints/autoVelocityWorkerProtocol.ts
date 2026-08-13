import type { PathModel } from "../model/path";
import type { SimulationConfig } from "../sim/types";
import type { AutoVelocitySettings } from "./autoVelocityApply";
import type {
  AutoConstraintSolver,
  AutoHandoffRadiusAssignment,
} from "./autoConstraintGeneration";
import type {
  AutoVelocityProfile,
  JointAutoConstraintSolveStats,
  JointAutoConstraintSolveStatus,
} from "./autoVelocityConstraints";

export interface AutoVelocityWorkerRequest {
  kind: "generate-radii-and-caps";
  requestId: number;
  path: PathModel;
  config: SimulationConfig;
  settings: AutoVelocitySettings;
  solver: AutoConstraintSolver;
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

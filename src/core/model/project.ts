import {
  createProjectConfig,
  type CanonicalProjectConfig,
} from "../config/projectConfig";
import type { PathModel } from "./path";

export const projectSchemaVersion = 1;

export type ProjectSchemaVersion = typeof projectSchemaVersion;
export type ProjectConfig = CanonicalProjectConfig;

export interface ProjectPath {
  path_id: string;
  display_name: string;
  file_name: string;
  path: PathModel;
}

export interface ProjectPathGroup {
  group_id: string;
  display_name: string;
  path_ids: string[];
}

export type LinkedTargetKind = "translation" | "waypoint";

export interface LinkedTarget {
  target_id: string;
  display_name: string;
  kind: LinkedTargetKind;
  x_meters: number;
  y_meters: number;
  rotation_radians?: number | null;
  locked?: boolean;
}

/** Team-owned editing data. Open-editor state deliberately lives elsewhere. */
export interface Project {
  schema_version: ProjectSchemaVersion;
  project_id: string;
  display_name: string;
  config: ProjectConfig;
  paths: ProjectPath[];
  path_groups: ProjectPathGroup[];
  linked_targets: LinkedTarget[];
}

export interface CreateProjectInput {
  project_id: string;
  display_name: string;
  config?: unknown;
  paths?: ProjectPath[];
  path_groups?: ProjectPathGroup[];
  linked_targets?: LinkedTarget[];
}

export function createProject({
  project_id,
  display_name,
  config,
  paths = [],
  path_groups = [],
  linked_targets = [],
}: CreateProjectInput): Project {
  return {
    schema_version: projectSchemaVersion,
    project_id,
    display_name,
    config: createProjectConfig(config),
    paths: structuredClone(paths),
    path_groups: structuredClone(path_groups),
    linked_targets: structuredClone(linked_targets),
  };
}

export function cloneProject(project: Project): Project {
  return structuredClone(project);
}

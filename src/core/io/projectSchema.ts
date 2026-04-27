import type { PathModel, ConstraintKey } from "../model/path";
import {
  createProjectConfig,
  type CanonicalProjectConfig
} from "../config/projectConfig";

export const projectSchemaVersion = 1;

export type ProjectSchemaVersion = typeof projectSchemaVersion;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type ProjectConfig = CanonicalProjectConfig;

export interface ProjectDocument {
  schema_version: ProjectSchemaVersion;
  project_id: string;
  display_name: string;
  path_file_name: string | null;
  path: PathModel;
  config: ProjectConfig;
}

export interface ProjectPathDocument {
  path_id: string;
  display_name: string;
  file_name: string;
  path: PathModel;
}

export interface ProjectWorkspaceDocument {
  schema_version: ProjectSchemaVersion;
  project_id: string;
  display_name: string;
  config: ProjectConfig;
  paths: ProjectPathDocument[];
  active_path_id: string | null;
}

export interface SerializedRangedConstraint {
  value: number;
  start_ordinal: number;
  end_ordinal: number;
}

export type SerializedConstraintValue = number | SerializedRangedConstraint[];
export type SerializedConstraints = Partial<Record<ConstraintKey, SerializedConstraintValue>>;

export interface SerializedTranslationTarget {
  type: "translation";
  x_meters: number;
  y_meters: number;
  intermediate_handoff_radius_meters?: number;
}

export interface SerializedRotationTarget {
  type: "rotation";
  rotation_radians: number;
  t_ratio: number;
  profiled_rotation: boolean;
}

export interface SerializedEventTrigger {
  type: "event_trigger";
  t_ratio: number;
  lib_key: string;
}

export interface SerializedWaypointTranslationTarget {
  x_meters: number;
  y_meters: number;
  intermediate_handoff_radius_meters?: number;
}

export interface SerializedWaypointRotationTarget {
  rotation_radians: number;
  profiled_rotation: boolean;
}

export interface SerializedWaypoint {
  type: "waypoint";
  translation_target: SerializedWaypointTranslationTarget;
  rotation_target: SerializedWaypointRotationTarget;
}

export type SerializedPathElement =
  | SerializedTranslationTarget
  | SerializedRotationTarget
  | SerializedEventTrigger
  | SerializedWaypoint;

export interface SerializedPathDocument {
  path_elements: SerializedPathElement[];
  constraints?: SerializedConstraints;
}

export interface SerializedProjectDocument {
  schema_version: ProjectSchemaVersion;
  project_id: string;
  display_name: string;
  path_file_name?: string | null;
  path: SerializedPathDocument;
  config: ProjectConfig;
}

export interface SerializedProjectPathDocument {
  path_id: string;
  display_name: string;
  file_name: string;
  path: SerializedPathDocument;
}

export interface SerializedProjectWorkspaceDocument {
  schema_version: ProjectSchemaVersion;
  project_id: string;
  display_name: string;
  config: ProjectConfig;
  paths: SerializedProjectPathDocument[];
  active_path_id?: string | null;
}

export interface CreateProjectDocumentInput {
  project_id: string;
  display_name: string;
  path_file_name?: string | null;
  path: PathModel;
  config?: unknown;
}

export interface CreateProjectPathDocumentInput {
  path_id: string;
  display_name: string;
  file_name: string;
  path: PathModel;
}

export interface CreateProjectWorkspaceDocumentInput {
  project_id: string;
  display_name: string;
  config?: unknown;
  paths?: ProjectPathDocument[];
  active_path_id?: string | null;
}

export function createProjectDocument({
  project_id,
  display_name,
  path_file_name = null,
  path,
  config
}: CreateProjectDocumentInput): ProjectDocument {
  return {
    schema_version: projectSchemaVersion,
    project_id,
    display_name,
    path_file_name,
    path,
    config: createProjectConfig(config)
  };
}

export function createProjectPathDocument({
  path_id,
  display_name,
  file_name,
  path
}: CreateProjectPathDocumentInput): ProjectPathDocument {
  return {
    path_id,
    display_name,
    file_name,
    path
  };
}

export function createProjectWorkspaceDocument({
  project_id,
  display_name,
  config,
  paths = [],
  active_path_id = paths[0]?.path_id ?? null
}: CreateProjectWorkspaceDocumentInput): ProjectWorkspaceDocument {
  const activePathExists = paths.some((path) => path.path_id === active_path_id);

  return {
    schema_version: projectSchemaVersion,
    project_id,
    display_name,
    config: createProjectConfig(config),
    paths,
    active_path_id: activePathExists ? active_path_id : paths[0]?.path_id ?? null
  };
}

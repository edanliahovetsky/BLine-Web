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

export interface CreateProjectDocumentInput {
  project_id: string;
  display_name: string;
  path_file_name?: string | null;
  path: PathModel;
  config?: unknown;
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

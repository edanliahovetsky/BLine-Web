import type {
  AutoVelocityConstraintMetadata,
  ConstraintKey,
  HandoffRadiusSource,
  PathModel,
  RangedConstraintKey,
  RangedConstraintSource,
} from "../model/path";
import { createProjectConfig } from "../config/projectConfig";
import {
  projectSchemaVersion,
  type LinkedTarget,
  type LinkedTargetKind,
  type Project,
  type ProjectConfig,
  type ProjectPath,
  type ProjectPathGroup,
  type ProjectSchemaVersion,
} from "../model/project";

export { projectSchemaVersion };
export type {
  LinkedTarget,
  LinkedTargetKind,
  Project,
  ProjectConfig,
  ProjectSchemaVersion,
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ProjectDocument {
  schema_version: ProjectSchemaVersion;
  project_id: string;
  display_name: string;
  path_file_name: string | null;
  path: PathModel;
  config: ProjectConfig;
}

export type ProjectPathDocument = ProjectPath;
export type ProjectPathGroupDocument = ProjectPathGroup;

/** Legacy persistence shape retained only at the Slices 1–3 I/O seam. */
export interface ProjectWorkspaceDocument extends Project {
  active_path_id: string | null;
  active_path_group_id: string | null;
}

export interface SerializedRangedConstraint {
  value: number;
  start_ordinal: number;
  end_ordinal: number;
  source?: "auto_velocity";
}

export interface SerializedRangedConstraintMetadata {
  key: RangedConstraintKey;
  value: number;
  start_ordinal: number;
  end_ordinal: number;
  source: RangedConstraintSource;
  auto_velocity?: AutoVelocityConstraintMetadata | null;
}

export interface SerializedPathEditorMetadata {
  ranged_constraints?: SerializedRangedConstraintMetadata[];
  linked_targets?: SerializedLinkedPathElementTarget[];
  handoff_radius_sources?: SerializedHandoffRadiusSource[];
}

export interface SerializedLinkedPathElementTarget {
  element_index: number;
  target_id: string;
}

export interface SerializedHandoffRadiusSource {
  element_index: number;
  source: HandoffRadiusSource;
}

export type SerializedConstraintValue = number | SerializedRangedConstraint[];
export type SerializedConstraints = Partial<
  Record<ConstraintKey, SerializedConstraintValue>
>;

export interface SerializedTranslationTarget {
  type: "translation";
  x_meters: number;
  y_meters: number;
  intermediate_handoff_radius_meters?: number;
  handoff_radius_source?: "auto";
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
  handoff_radius_source?: "auto";
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
  editor_metadata?: SerializedPathEditorMetadata;
}

export interface SerializedProjectPathGroupDocument {
  group_id: string;
  display_name: string;
  path_ids: string[];
}

export interface SerializedLinkedTarget {
  target_id: string;
  display_name: string;
  kind: LinkedTargetKind;
  x_meters: number;
  y_meters: number;
  rotation_radians?: number | null;
  locked?: boolean;
}

export interface SerializedProjectWorkspaceDocument {
  schema_version: ProjectSchemaVersion;
  project_id: string;
  display_name: string;
  config: ProjectConfig;
  paths: SerializedProjectPathDocument[];
  active_path_id?: string | null;
  path_groups?: SerializedProjectPathGroupDocument[];
  active_path_group_id?: string | null;
  linked_targets?: SerializedLinkedTarget[];
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

export interface CreateProjectPathGroupDocumentInput {
  group_id: string;
  display_name: string;
  path_ids?: string[];
}

export interface CreateProjectWorkspaceDocumentInput {
  project_id: string;
  display_name: string;
  config?: unknown;
  paths?: ProjectPathDocument[];
  active_path_id?: string | null;
  path_groups?: ProjectPathGroupDocument[];
  active_path_group_id?: string | null;
  linked_targets?: LinkedTarget[];
}

export function createProjectDocument({
  project_id,
  display_name,
  path_file_name = null,
  path,
  config,
}: CreateProjectDocumentInput): ProjectDocument {
  return {
    schema_version: projectSchemaVersion,
    project_id,
    display_name,
    path_file_name,
    path,
    config: createProjectConfig(config),
  };
}

export function createProjectPathDocument({
  path_id,
  display_name,
  file_name,
  path,
}: CreateProjectPathDocumentInput): ProjectPathDocument {
  return {
    path_id,
    display_name,
    file_name,
    path,
  };
}

export function createProjectPathGroupDocument({
  group_id,
  display_name,
  path_ids = [],
}: CreateProjectPathGroupDocumentInput): ProjectPathGroupDocument {
  return {
    group_id,
    display_name,
    path_ids,
  };
}

export function createProjectWorkspaceDocument({
  project_id,
  display_name,
  config,
  paths = [],
  active_path_id = paths[0]?.path_id ?? null,
  path_groups = [],
  active_path_group_id = null,
  linked_targets = [],
}: CreateProjectWorkspaceDocumentInput): ProjectWorkspaceDocument {
  const activePathExists = paths.some(
    (path) => path.path_id === active_path_id,
  );
  const activeGroupExists = path_groups.some(
    (group) => group.group_id === active_path_group_id,
  );

  return {
    schema_version: projectSchemaVersion,
    project_id,
    display_name,
    config: createProjectConfig(config),
    paths,
    active_path_id: activePathExists
      ? active_path_id
      : (paths[0]?.path_id ?? null),
    path_groups,
    active_path_group_id: activeGroupExists ? active_path_group_id : null,
    linked_targets,
  };
}

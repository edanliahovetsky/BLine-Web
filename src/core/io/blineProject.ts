import { createProjectConfig } from "../config/projectConfig";
import type {
  ProjectConfig,
  ProjectDocument,
  ProjectWorkspaceDocument,
  SerializedPathDocument,
} from "./projectSchema";
import { createProjectDocument } from "./projectSchema";
import { serializePath } from "./projectSerde";
import {
  deserializeProjectWorkspaceDocument,
  ensureJsonFileName,
  projectDocumentToWorkspaceDocument,
  serializePathGroupsFile,
} from "./workspaceSerde";

export const blineProjectArchiveSchemaVersion = 1;

export interface SerializedProjectArchivePath {
  file_name: string;
  display_name?: string;
  path: SerializedPathDocument;
}

export interface SerializedProjectArchive {
  bline_project_schema_version: typeof blineProjectArchiveSchemaVersion;
  exported_at: string;
  config: ProjectConfig;
  paths: SerializedProjectArchivePath[];
  path_groups?: ReturnType<typeof serializePathGroupsFile>["groups"];
  field_assets?: SerializedProjectArchiveFieldAsset[];
}

export interface SerializedProjectArchiveFieldAsset {
  asset_id: string;
  file_name: string;
  mime_type: string;
  data_base64: string;
}

type ArchiveSource = ProjectWorkspaceDocument | readonly ProjectDocument[];

export type BLineRuntimeKinematicConstraints = Pick<
  ProjectConfig["kinematic_constraints"],
  | "default_max_velocity_meters_per_sec"
  | "default_max_acceleration_meters_per_sec2"
  | "default_max_velocity_deg_per_sec"
  | "default_max_acceleration_deg_per_sec2"
  | "default_end_translation_tolerance_meters"
  | "default_end_rotation_tolerance_deg"
  | "default_intermediate_handoff_radius_meters"
>;

export interface BLineRuntimeConfig {
  kinematic_constraints: BLineRuntimeKinematicConstraints;
}

export function serializeProjectConfig(config: unknown): ProjectConfig {
  return createProjectConfig(config);
}

export function serializeBLineRuntimeConfig(config: unknown): BLineRuntimeConfig {
  const canonical = createProjectConfig(config);
  const constraints = canonical.kinematic_constraints;

  return {
    kinematic_constraints: {
      default_max_velocity_meters_per_sec:
        constraints.default_max_velocity_meters_per_sec,
      default_max_acceleration_meters_per_sec2:
        constraints.default_max_acceleration_meters_per_sec2,
      default_max_velocity_deg_per_sec:
        constraints.default_max_velocity_deg_per_sec,
      default_max_acceleration_deg_per_sec2:
        constraints.default_max_acceleration_deg_per_sec2,
      default_end_translation_tolerance_meters:
        constraints.default_end_translation_tolerance_meters,
      default_end_rotation_tolerance_deg:
        constraints.default_end_rotation_tolerance_deg,
      default_intermediate_handoff_radius_meters:
        constraints.default_intermediate_handoff_radius_meters,
    },
  };
}

export function deserializeProjectConfig(input: unknown): ProjectConfig {
  return createProjectConfig(input);
}

export function createBLineProjectArchive(
  source: ArchiveSource,
  exportedAt: string,
  fieldAssets: SerializedProjectArchiveFieldAsset[] = [],
): SerializedProjectArchive {
  const workspace = workspaceFromArchiveSource(source);

  const archive: SerializedProjectArchive = {
    bline_project_schema_version: blineProjectArchiveSchemaVersion,
    exported_at: exportedAt,
    config: serializeProjectConfig(workspace.config),
    paths: workspace.paths.map((path, index) => ({
      file_name: ensureJsonFileName(path.file_name || `path-${index + 1}.json`),
      display_name: path.display_name,
      path: serializePath(path.path),
    })),
    path_groups: serializePathGroupsFile(workspace).groups,
  };

  if (fieldAssets.length > 0) {
    archive.field_assets = fieldAssets;
  }

  return archive;
}

export function serializeBLineProjectArchive(
  source: ArchiveSource,
  exportedAt: string,
  fieldAssets: SerializedProjectArchiveFieldAsset[] = [],
): Blob {
  return new Blob(
    [
      JSON.stringify(
        createBLineProjectArchive(source, exportedAt, fieldAssets),
        null,
        2,
      ),
    ],
    {
      type: "application/json",
    },
  );
}

export function fieldAssetsFromBLineProjectArchive(
  input: unknown,
): SerializedProjectArchiveFieldAsset[] {
  if (!isBLineProjectArchive(input) || !Array.isArray(input.field_assets)) {
    return [];
  }

  return input.field_assets.filter(isSerializedProjectArchiveFieldAsset);
}

export function deserializeBLineProjectArchive(
  input: unknown,
  options: {
    fallbackProjectId?: string;
    fallbackDisplayName?: string;
  } = {},
): ProjectWorkspaceDocument {
  if (!isBLineProjectArchive(input)) {
    throw new Error("Unsupported BLine project archive schema");
  }

  return deserializeProjectWorkspaceDocument(
    {
      schema_version: 1,
      project_id: options.fallbackProjectId ?? "imported-project",
      display_name: options.fallbackDisplayName ?? "Imported Project",
      config: input.config,
      paths: input.paths.map((entry, index) => ({
        path_id: entry.file_name || `path-${index + 1}`,
        display_name: entry.display_name,
        file_name: entry.file_name || `path-${index + 1}.json`,
        path: entry.path,
      })),
      active_path_id: input.paths[0]?.file_name ?? null,
      path_groups: input.path_groups,
    },
    options,
  );
}

export function deserializeBLineProjectArchiveAsProjects(
  input: unknown,
): ProjectDocument[] {
  const workspace = deserializeBLineProjectArchive(input);

  return workspace.paths.map((path) =>
    createProjectDocument({
      project_id: path.path_id,
      display_name: path.display_name,
      path_file_name: path.file_name,
      path: path.path,
      config: workspace.config,
    }),
  );
}

export function isBLineProjectArchive(
  input: unknown,
): input is SerializedProjectArchive {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const candidate = input as Partial<SerializedProjectArchive>;
  return (
    candidate.bline_project_schema_version ===
      blineProjectArchiveSchemaVersion && Array.isArray(candidate.paths)
  );
}

function isProjectDocumentArray(
  val: unknown,
): val is readonly ProjectDocument[] {
  return Array.isArray(val);
}

function isSerializedProjectArchiveFieldAsset(
  input: unknown,
): input is SerializedProjectArchiveFieldAsset {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }

  const candidate = input as Partial<SerializedProjectArchiveFieldAsset>;
  return (
    typeof candidate.asset_id === "string" &&
    typeof candidate.file_name === "string" &&
    typeof candidate.mime_type === "string" &&
    typeof candidate.data_base64 === "string"
  );
}

function workspaceFromArchiveSource(
  source: ArchiveSource,
): ProjectWorkspaceDocument {
  if (isProjectDocumentArray(source)) {
    const first = source[0];
    return first
      ? {
          ...projectDocumentToWorkspaceDocument(first),
          paths: source.map((project) => ({
            path_id: project.project_id,
            display_name: project.display_name,
            file_name: ensureJsonFileName(
              project.path_file_name ??
                project.display_name ??
                project.project_id,
            ),
            path: project.path,
          })),
          active_path_id: first.project_id,
        }
      : deserializeProjectWorkspaceDocument({
          schema_version: 1,
          project_id: "empty-project",
          display_name: "Empty Project",
          config: undefined,
          paths: [],
        });
  } else {
    return source;
  }
}

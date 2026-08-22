import { createProjectConfig } from "../config/projectConfig";
import type {
  LinkedTarget,
  ProjectConfig,
  SerializedPathEditorMetadata,
  SerializedPathDocument,
} from "./projectSchema";
import { getPathElementLinkedTargetId } from "../linkedTargets";
import { getHandoffRadiusSource, type PathModel } from "../model/path";
import type { Project } from "../model/project";
import { openProjectFromLegacyWorkspace } from "./legacyWorkspace";
import { serializePath } from "./projectSerde";
import {
  deserializeProjectWorkspaceDocument,
  ensureJsonFileName,
} from "./workspaceSerde";

export const blineProjectArchiveSchemaVersion = 1;

export interface SerializedProjectArchivePath {
  file_name: string;
  display_name?: string;
  path: SerializedPathDocument;
  editor_metadata?: SerializedPathEditorMetadata;
}

export interface SerializedProjectArchivePathGroup {
  group_id: string;
  display_name: string;
  path_file_names: string[];
}

export interface SerializedProjectArchive {
  bline_project_schema_version: typeof blineProjectArchiveSchemaVersion;
  exported_at: string;
  config: ProjectConfigWithoutField;
  paths: SerializedProjectArchivePath[];
  path_groups?: SerializedProjectArchivePathGroup[];
  linked_targets?: LinkedTarget[];
  field_assets?: SerializedProjectArchiveFieldAsset[];
}

export type ProjectConfigWithoutField = Omit<ProjectConfig, "gui"> & {
  gui: Omit<ProjectConfig["gui"], "field">;
};

export interface SerializedProjectArchiveFieldAsset {
  asset_id: string;
  file_name: string;
  mime_type: string;
  data_base64: string;
}

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

export function serializeBLineRuntimeConfig(
  config: unknown,
): BLineRuntimeConfig {
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
  project: Project,
  exportedAt: string,
): SerializedProjectArchive {
  const archive: SerializedProjectArchive = {
    bline_project_schema_version: blineProjectArchiveSchemaVersion,
    exported_at: exportedAt,
    config: projectConfigWithoutField(project.config),
    paths: project.paths.map((path, index) => ({
      file_name: ensureJsonFileName(path.file_name || `path-${index + 1}.json`),
      display_name: path.display_name,
      path: serializePath(path.path),
      editor_metadata: serializePathEditorMetadata(path.path),
    })),
    path_groups: project.path_groups.map((group) => ({
      group_id: group.group_id,
      display_name: group.display_name,
      path_file_names: group.path_ids.flatMap((pathId) => {
        const path = project.paths.find(
          (candidate) => candidate.path_id === pathId,
        );
        return path ? [ensureJsonFileName(path.file_name)] : [];
      }),
    })),
    linked_targets: project.linked_targets.map((target) => ({
      target_id: target.target_id,
      display_name: target.display_name,
      kind: target.kind,
      x_meters: Number(target.x_meters),
      y_meters: Number(target.y_meters),
      ...(target.kind === "waypoint"
        ? { rotation_radians: Number(target.rotation_radians ?? 0) }
        : {}),
      ...(target.locked ? { locked: true } : {}),
    })),
  };

  return archive;
}

export function serializeBLineProjectArchive(
  project: Project,
  exportedAt: string,
): Blob {
  return new Blob(
    [JSON.stringify(createBLineProjectArchive(project, exportedAt), null, 2)],
    {
      type: "application/json",
    },
  );
}

export function projectConfigWithoutField(
  config: ProjectConfig,
): ProjectConfigWithoutField {
  const canonical = serializeProjectConfig(config);
  const { field, ...gui } = canonical.gui;
  void field;
  return { ...canonical, gui };
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
): Project {
  if (!isBLineProjectArchive(input)) {
    throw new Error("Unsupported BLine project archive schema");
  }

  return openProjectFromLegacyWorkspace(
    deserializeProjectWorkspaceDocument(
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
          editor_metadata: entry.editor_metadata,
        })),
        active_path_id: input.paths[0]?.file_name ?? null,
        path_groups: input.path_groups,
        linked_targets: input.linked_targets,
      },
      options,
    ),
  ).project;
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

export function serializePathEditorMetadata(
  path: PathModel,
): SerializedPathEditorMetadata | undefined {
  const linkedTargets = path.path_elements.flatMap((element, index) => {
    const targetId = getPathElementLinkedTargetId(element);
    return targetId ? [{ element_index: index, target_id: targetId }] : [];
  });
  const handoffRadiusSources = path.path_elements.flatMap((element, index) => {
    const source = getHandoffRadiusSource(element);
    return source ? [{ element_index: index, source }] : [];
  });
  const rangedConstraints = path.ranged_constraints.flatMap((constraint) =>
    constraint.source === "auto_velocity"
      ? [
          {
            key: constraint.key,
            value: Number(constraint.value),
            start_ordinal: Math.trunc(constraint.start_ordinal),
            end_ordinal: Math.trunc(constraint.end_ordinal),
            source: constraint.source,
            ...(constraint.auto_velocity
              ? { auto_velocity: structuredClone(constraint.auto_velocity) }
              : {}),
          },
        ]
      : [],
  );

  if (
    rangedConstraints.length === 0 &&
    linkedTargets.length === 0 &&
    handoffRadiusSources.length === 0
  ) {
    return undefined;
  }

  return {
    ...(rangedConstraints.length > 0
      ? { ranged_constraints: rangedConstraints }
      : {}),
    ...(linkedTargets.length > 0 ? { linked_targets: linkedTargets } : {}),
    ...(handoffRadiusSources.length > 0
      ? { handoff_radius_sources: handoffRadiusSources }
      : {}),
  };
}

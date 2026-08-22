import {
  defaultAutoVelocityMergeToleranceMetersPerSec,
  projectConfigDefaultLookup,
} from "../config/projectConfig";
import {
  isRangedConstraintKey,
  setHandoffRadiusSource,
  type AutoVelocityConstraintMetadata,
  type HandoffRadiusSource,
  type PathModel,
  type RangedConstraint,
  type RangedConstraintSource,
} from "../model/path";
import {
  createPathGroupId,
  createWorkspaceId,
  normalizePathFileName,
  pathDisplayNameFromFileName,
} from "../model/projectIdentity";
import {
  normalizeLinkedTargets,
  setPathElementLinkedTargetId,
  syncLinkedTargetElementsInProject,
} from "../linkedTargets";
import {
  createProjectPathGroupDocument,
  createProjectPathDocument,
  createProjectWorkspaceDocument,
  type LinkedTarget,
  type ProjectConfig,
  type ProjectDocument,
  type ProjectPathGroupDocument,
  type ProjectPathDocument,
  type ProjectWorkspaceDocument,
  type SerializedHandoffRadiusSource,
  type SerializedLinkedTarget,
  type SerializedLinkedPathElementTarget,
  type SerializedProjectWorkspaceDocument,
  type SerializedRangedConstraintMetadata,
} from "./projectSchema";
import { serializePathEditorMetadata } from "./pathEditorMetadata";
import {
  deserializePath,
  deserializeProjectDocument,
  serializePath,
} from "./projectSerde";

export interface DeserializeWorkspaceOptions {
  fallbackProjectId?: string;
  fallbackDisplayName?: string;
}

/** Read-only legacy folder/archive group shape. */
export interface SerializedPathGroupFileEntry {
  group_id: string;
  display_name: string;
  path_file_names: string[];
}

/**
 * The former combined-workspace writer, retained as a lossless migration
 * projection for data written before canonical Project files replaced it.
 */
export function serializeProjectWorkspaceDocument(
  workspace: ProjectWorkspaceDocument,
): SerializedProjectWorkspaceDocument {
  const linkedTargets = workspace.linked_targets.map(serializeLinkedTarget);
  return {
    schema_version: workspace.schema_version,
    project_id: workspace.project_id,
    display_name: workspace.display_name,
    config: workspace.config,
    paths: workspace.paths.map((path) => ({
      path_id: path.path_id,
      display_name: path.display_name,
      file_name: normalizePathFileName(path.file_name),
      path: serializePath(path.path),
      editor_metadata: serializePathEditorMetadata(path.path),
    })),
    active_path_id: workspace.active_path_id,
    path_groups: workspace.path_groups.map((group) => ({
      group_id: group.group_id,
      display_name: group.display_name,
      path_ids: [...group.path_ids],
    })),
    active_path_group_id: workspace.active_path_group_id,
    ...(linkedTargets.length > 0 ? { linked_targets: linkedTargets } : {}),
  };
}

export function deserializeProjectWorkspaceDocument(
  input: unknown,
  options: DeserializeWorkspaceOptions = {},
): ProjectWorkspaceDocument {
  if (isWorkspaceLike(input)) {
    const projectId = stringOr(
      input.project_id,
      options.fallbackProjectId ?? createWorkspaceId(),
    );
    const displayName = stringOr(
      input.display_name,
      options.fallbackDisplayName ?? "Imported Project",
    );
    const config = readConfig(input.config);
    const defaultLookup = projectConfigDefaultLookup(config);
    const paths = input.paths.map((entry, index) =>
      deserializeProjectPathDocument(entry, index, defaultLookup),
    );
    const pathGroups = readWorkspacePathGroups(input, paths);

    return normalizeProjectWorkspaceDocument(
      createProjectWorkspaceDocument({
        project_id: projectId,
        display_name: displayName,
        config,
        paths,
        active_path_id:
          typeof input.active_path_id === "string"
            ? input.active_path_id
            : null,
        path_groups: pathGroups,
        active_path_group_id:
          typeof input.active_path_group_id === "string"
            ? input.active_path_group_id
            : null,
        linked_targets: readLinkedTargets(input.linked_targets),
      }),
    );
  }

  return projectDocumentToWorkspaceDocument(
    deserializeProjectDocument(input, {
      fallbackProjectId: options.fallbackProjectId,
      fallbackDisplayName: options.fallbackDisplayName,
    }),
  );
}

function deserializeProjectPathDocument(
  input: unknown,
  index = 0,
  defaultLookup?: Parameters<typeof deserializePath>[1],
): ProjectPathDocument {
  const object = isObject(input) ? input : {};
  const fileName = normalizePathFileName(
    stringOr(
      object.file_name ?? object.path_file_name,
      `path-${index + 1}.json`,
    ),
  );
  const displayName = stringOr(
    object.display_name,
    pathDisplayNameFromFileName(fileName),
  );
  const pathId = stringOr(object.path_id, pathIdFromFileName(fileName, index));

  return createProjectPathDocument({
    path_id: pathId,
    display_name: displayName,
    file_name: fileName,
    path: applyPathEditorMetadata(
      deserializePath(object.path ?? input, defaultLookup),
      object.editor_metadata,
    ),
  });
}

export function projectDocumentToWorkspaceDocument(
  project: ProjectDocument,
  options: DeserializeWorkspaceOptions = {},
): ProjectWorkspaceDocument {
  const fileName = normalizePathFileName(
    project.path_file_name ?? project.display_name ?? project.project_id,
  );
  const path = createProjectPathDocument({
    path_id: project.project_id || pathIdFromFileName(fileName, 0),
    display_name: project.display_name,
    file_name: fileName,
    path: structuredClone(project.path),
  });

  return createProjectWorkspaceDocument({
    project_id: options.fallbackProjectId ?? project.project_id,
    display_name: options.fallbackDisplayName ?? project.display_name,
    config: structuredClone(project.config),
    paths: [path],
    active_path_id: path.path_id,
    path_groups: [],
    active_path_group_id: null,
    linked_targets: [],
  });
}

function normalizeProjectWorkspaceDocument(
  workspace: ProjectWorkspaceDocument,
): ProjectWorkspaceDocument {
  const seen = new Set<string>();
  const pathIdRemap = new Map<string, string>();
  const paths = workspace.paths.map((path, index) => {
    const fallbackFileName = normalizePathFileName(
      path.file_name || path.display_name || `path-${index + 1}`,
    );
    const originalPathId = path.path_id;
    let pathId = path.path_id || pathIdFromFileName(fallbackFileName, index);
    if (seen.has(pathId)) {
      pathId = `${pathId}-${index + 1}`;
    }
    seen.add(pathId);
    if (originalPathId) {
      pathIdRemap.set(originalPathId, pathId);
    }

    return createProjectPathDocument({
      path_id: pathId,
      display_name:
        path.display_name || pathDisplayNameFromFileName(fallbackFileName),
      file_name: fallbackFileName,
      path: structuredClone(path.path),
    });
  });
  const pathGroups = normalizePathGroups(
    workspace.path_groups ?? [],
    paths,
    pathIdRemap,
  );
  const active_path_id = paths.some(
    (path) => path.path_id === workspace.active_path_id,
  )
    ? workspace.active_path_id
    : (paths[0]?.path_id ?? null);
  const active_path_group_id = pathGroups.some(
    (group) => group.group_id === workspace.active_path_group_id,
  )
    ? workspace.active_path_group_id
    : null;

  return syncLinkedTargetElementsInProject(
    createProjectWorkspaceDocument({
      project_id: workspace.project_id,
      display_name: workspace.display_name,
      config: workspace.config,
      paths,
      active_path_id,
      path_groups: pathGroups,
      active_path_group_id,
      linked_targets: normalizeLinkedTargets(workspace.linked_targets),
    }),
  );
}

function readWorkspacePathGroups(
  input: Record<string, unknown>,
  paths: readonly ProjectPathDocument[],
): ProjectPathGroupDocument[] {
  const directGroups =
    readPathGroupArray(input.path_groups).length > 0
      ? readPathGroupArray(input.path_groups)
      : readPathGroupArray(input.pathgroups).length > 0
        ? readPathGroupArray(input.pathgroups)
        : readPathGroupArray(input.pathGroups);

  if (directGroups.length > 0) {
    return deserializeProjectPathGroups(directGroups, paths);
  }

  const config = isObject(input.config) ? input.config : {};
  const legacyGroups =
    readPathGroupArray(config.path_groups).length > 0
      ? readPathGroupArray(config.path_groups)
      : readPathGroupArray(config.pathgroups).length > 0
        ? readPathGroupArray(config.pathgroups)
        : readPathGroupArray(config.gui);

  return deserializeProjectPathGroups(legacyGroups, paths);
}

function readPathGroupArray(input: unknown): unknown[] {
  if (Array.isArray(input)) {
    return input;
  }

  if (!isObject(input)) {
    return [];
  }

  if (Array.isArray(input.groups)) {
    return input.groups;
  }

  if (Array.isArray(input.path_groups)) {
    return input.path_groups;
  }

  if (Array.isArray(input.pathgroups)) {
    return input.pathgroups;
  }

  if (Array.isArray(input.pathGroups)) {
    return input.pathGroups;
  }

  return [];
}

function deserializeProjectPathGroups(
  input: readonly unknown[],
  paths: readonly ProjectPathDocument[],
  options: { preferFileNames?: boolean } = {},
): ProjectPathGroupDocument[] {
  const pathById = new Map(paths.map((path) => [path.path_id, path]));
  const pathByFileName = new Map(
    paths.map((path) => [
      normalizePathFileName(path.file_name).toLowerCase(),
      path,
    ]),
  );
  const groups = input.flatMap((entry, index) => {
    if (!isObject(entry)) {
      return [];
    }

    const groupId = stringOr(entry.group_id ?? entry.id, `group-${index + 1}`);
    const displayName = stringOr(
      entry.display_name ?? entry.name,
      `Path Group ${index + 1}`,
    );
    const rawPathRefs = readPathRefs(entry);
    const pathIds = uniqueStrings(
      rawPathRefs.flatMap((pathRef) => {
        const idMatch =
          !options.preferFileNames && pathById.get(pathRef)
            ? pathById.get(pathRef)
            : null;
        const fileMatch = pathByFileName.get(
          normalizePathFileName(pathRef).toLowerCase(),
        );
        const fallbackIdMatch = pathById.get(pathRef);
        const path = idMatch ?? fileMatch ?? fallbackIdMatch;
        return path ? [path.path_id] : [];
      }),
    );

    return [
      createProjectPathGroupDocument({
        group_id: groupId,
        display_name: displayName,
        path_ids: pathIds,
      }),
    ];
  });

  return normalizePathGroups(groups, paths);
}

function readPathRefs(entry: Record<string, unknown>): string[] {
  const candidates = [
    entry.path_ids,
    entry.path_file_names,
    entry.path_files,
    entry.paths,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.flatMap((value) =>
        typeof value === "string" && value.trim() ? [value.trim()] : [],
      );
    }
  }

  return [];
}

function normalizePathGroups(
  groups: readonly ProjectPathGroupDocument[],
  paths: readonly ProjectPathDocument[],
  pathIdRemap = new Map<string, string>(),
): ProjectPathGroupDocument[] {
  const pathIds = new Set(paths.map((path) => path.path_id));
  const seenGroupIds = new Set<string>();

  return groups.flatMap((group, index) => {
    const fallbackId = createPathGroupId();
    const rawGroupId =
      typeof group.group_id === "string" && group.group_id.trim()
        ? group.group_id.trim()
        : fallbackId;
    const groupId = seenGroupIds.has(rawGroupId)
      ? `${rawGroupId}-${index + 1}`
      : rawGroupId;
    seenGroupIds.add(groupId);

    const displayName =
      typeof group.display_name === "string" && group.display_name.trim()
        ? group.display_name.trim()
        : `Path Group ${index + 1}`;
    const path_ids = uniqueStrings(
      (group.path_ids ?? []).flatMap((pathId) => {
        const remapped = pathIdRemap.get(pathId) ?? pathId;
        return pathIds.has(remapped) ? [remapped] : [];
      }),
    );

    return [
      createProjectPathGroupDocument({
        group_id: groupId,
        display_name: displayName,
        path_ids,
      }),
    ];
  });
}

function readLinkedTargets(input: unknown): LinkedTarget[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return normalizeLinkedTargets(
    input.flatMap((entry, index) => {
      if (!isObject(entry)) {
        return [];
      }

      const targetId = String(entry.target_id ?? `target-${index + 1}`);
      const displayName = String(entry.display_name ?? "");
      const kind =
        entry.kind === "waypoint" || entry.kind === "pose"
          ? "waypoint"
          : "translation";
      const xMeters = finiteNumber(entry.x_meters);
      const yMeters = finiteNumber(entry.y_meters);
      if (!targetId.trim() || xMeters === null || yMeters === null) {
        return [];
      }

      return [
        {
          target_id: targetId,
          display_name: displayName,
          kind,
          x_meters: xMeters,
          y_meters: yMeters,
          rotation_radians:
            kind === "waypoint"
              ? (finiteNumber(entry.rotation_radians) ?? 0)
              : null,
          locked: entry.locked === true,
        },
      ];
    }),
  );
}

function serializeLinkedTarget(target: LinkedTarget): SerializedLinkedTarget {
  return target.kind === "waypoint"
    ? {
        target_id: target.target_id,
        display_name: target.display_name,
        kind: "waypoint",
        x_meters: Number(target.x_meters),
        y_meters: Number(target.y_meters),
        rotation_radians: Number(target.rotation_radians ?? 0),
        ...(target.locked ? { locked: true } : {}),
      }
    : {
        target_id: target.target_id,
        display_name: target.display_name,
        kind: "translation",
        x_meters: Number(target.x_meters),
        y_meters: Number(target.y_meters),
        ...(target.locked ? { locked: true } : {}),
      };
}

export function applyPathEditorMetadata(
  path: PathModel,
  input: unknown,
): PathModel {
  const rangedMetadata = readRangedConstraintMetadata(input);
  const linkedTargets = readLinkedPathElementTargets(input);
  const handoffRadiusSources = readHandoffRadiusSources(input);
  if (
    rangedMetadata.length === 0 &&
    linkedTargets.length === 0 &&
    handoffRadiusSources.length === 0
  ) {
    return path;
  }

  for (const link of linkedTargets) {
    const element = path.path_elements[link.element_index];
    if (!element) {
      continue;
    }
    path.path_elements[link.element_index] = setPathElementLinkedTargetId(
      element,
      link.target_id,
    );
  }

  for (const entry of handoffRadiusSources) {
    const element = path.path_elements[entry.element_index];
    if (!element) {
      continue;
    }
    path.path_elements[entry.element_index] = setHandoffRadiusSource(
      element,
      entry.source,
    );
  }

  const used = new Set<number>();
  for (const entry of rangedMetadata) {
    const exactIndex = path.ranged_constraints.findIndex(
      (constraint, index) =>
        !used.has(index) && sameMetadataTarget(constraint, entry, true),
    );
    const index =
      exactIndex >= 0
        ? exactIndex
        : path.ranged_constraints.findIndex(
            (constraint, candidateIndex) =>
              !used.has(candidateIndex) &&
              sameMetadataTarget(constraint, entry, false),
          );

    if (index < 0) {
      continue;
    }

    const source = normalizeRangedConstraintSource(entry.source);
    if (source === null) {
      continue;
    }

    const autoVelocity = normalizeAutoVelocityMetadata(entry.auto_velocity);
    path.ranged_constraints[index] = {
      ...path.ranged_constraints[index],
      source,
      auto_velocity: source === "auto_velocity" ? autoVelocity : null,
    };
    used.add(index);
  }

  return path;
}

function readLinkedPathElementTargets(
  input: unknown,
): SerializedLinkedPathElementTarget[] {
  if (!isObject(input) || !Array.isArray(input.linked_targets)) {
    return [];
  }

  return input.linked_targets.flatMap((entry) => {
    if (!isObject(entry)) {
      return [];
    }

    const elementIndex = finiteInteger(entry.element_index);
    const targetId = typeof entry.target_id === "string" ? entry.target_id : "";
    if (elementIndex === null || elementIndex < 0 || !targetId.trim()) {
      return [];
    }

    return [{ element_index: elementIndex, target_id: targetId }];
  });
}

function readHandoffRadiusSources(
  input: unknown,
): SerializedHandoffRadiusSource[] {
  if (!isObject(input) || !Array.isArray(input.handoff_radius_sources)) {
    return [];
  }

  return input.handoff_radius_sources.flatMap((entry) => {
    if (!isObject(entry)) {
      return [];
    }

    const elementIndex = finiteInteger(entry.element_index);
    const source = normalizeHandoffRadiusSource(entry.source);
    if (elementIndex === null || elementIndex < 0 || source === null) {
      return [];
    }

    return [{ element_index: elementIndex, source }];
  });
}

function readRangedConstraintMetadata(
  input: unknown,
): SerializedRangedConstraintMetadata[] {
  if (!isObject(input) || !Array.isArray(input.ranged_constraints)) {
    return [];
  }

  return input.ranged_constraints.flatMap((entry) => {
    if (!isObject(entry)) {
      return [];
    }

    const key = String(entry.key ?? "");
    const source = normalizeRangedConstraintSource(entry.source);
    const value = finiteNumber(entry.value);
    const start = finiteInteger(entry.start_ordinal);
    const end = finiteInteger(entry.end_ordinal);
    if (
      !isRangedConstraintKey(key) ||
      source === null ||
      value === null ||
      start === null ||
      end === null
    ) {
      return [];
    }

    return [
      {
        key,
        value,
        start_ordinal: start,
        end_ordinal: end,
        source,
        auto_velocity: normalizeAutoVelocityMetadata(entry.auto_velocity),
      },
    ];
  });
}

function sameMetadataTarget(
  constraint: RangedConstraint,
  metadata: SerializedRangedConstraintMetadata,
  includeValue: boolean,
): boolean {
  return (
    constraint.key === metadata.key &&
    Math.trunc(constraint.start_ordinal) ===
      Math.trunc(metadata.start_ordinal) &&
    Math.trunc(constraint.end_ordinal) === Math.trunc(metadata.end_ordinal) &&
    (!includeValue ||
      Math.abs(Number(constraint.value) - metadata.value) < 1e-9)
  );
}

function normalizeRangedConstraintSource(
  value: unknown,
): RangedConstraintSource | null {
  return value === "manual" || value === "auto_velocity" ? value : null;
}

function normalizeHandoffRadiusSource(
  value: unknown,
): HandoffRadiusSource | null {
  return value === "manual" || value === "auto" ? value : null;
}

function normalizeAutoVelocityMetadata(
  value: unknown,
): AutoVelocityConstraintMetadata | null {
  if (!isObject(value)) {
    return null;
  }

  const velocity = finiteNumber(value.velocity_safety_factor);
  const acceleration = finiteNumber(value.acceleration_safety_factor);
  const mergeTolerance = finiteNumber(value.merge_tolerance_meters_per_sec);
  const inputSignature =
    typeof value.input_signature === "string" ? value.input_signature : null;
  if (velocity === null || acceleration === null) {
    return null;
  }

  const metadata: AutoVelocityConstraintMetadata = {
    velocity_safety_factor: velocity,
    acceleration_safety_factor: acceleration,
    merge_tolerance_meters_per_sec:
      mergeTolerance ?? defaultAutoVelocityMergeToleranceMetersPerSec,
  };
  if (inputSignature) {
    metadata.input_signature = inputSignature;
  }
  return metadata;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function isWorkspaceLike(input: unknown): input is Record<string, unknown> & {
  paths: unknown[];
} {
  return isObject(input) && Array.isArray(input.paths);
}

function readConfig(input: unknown): ProjectConfig {
  return createProjectWorkspaceDocument({
    project_id: "config-reader",
    display_name: "Config Reader",
    config: input,
  }).config;
}

function pathIdFromFileName(fileName: string, index: number): string {
  const stem = normalizePathFileName(fileName).replace(/\.json$/i, "");
  return `${stem || "path"}-${index + 1}`;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

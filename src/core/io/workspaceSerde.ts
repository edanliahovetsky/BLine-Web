import {
  defaultAutoVelocityMergeToleranceMetersPerSec,
  projectConfigDefaultLookup,
} from "../config/projectConfig";
import {
  createPathModel,
  isRangedConstraintKey,
  type AutoVelocityConstraintMetadata,
  type PathModel,
  type RangedConstraint,
  type RangedConstraintSource,
} from "../model/path";
import {
  createProjectDocument,
  createProjectPathDocument,
  createProjectWorkspaceDocument,
  type ProjectConfig,
  type ProjectDocument,
  type ProjectPathDocument,
  type ProjectWorkspaceDocument,
  type SerializedProjectPathDocument,
  type SerializedPathEditorMetadata,
  type SerializedProjectWorkspaceDocument,
  type SerializedRangedConstraintMetadata,
} from "./projectSchema";
import {
  deserializePath,
  deserializeProjectDocument,
  serializePath,
} from "./projectSerde";

export interface DeserializeWorkspaceOptions {
  fallbackProjectId?: string;
  fallbackDisplayName?: string;
}

export interface ProjectWorkspaceArchive {
  schema_version: 1;
  project_id: string;
  display_name: string;
  config: ProjectConfig;
  paths: SerializedProjectPathDocument[];
  active_path_id?: string | null;
}

export function serializeProjectWorkspaceDocument(
  workspace: ProjectWorkspaceDocument,
): SerializedProjectWorkspaceDocument {
  return {
    schema_version: workspace.schema_version,
    project_id: workspace.project_id,
    display_name: workspace.display_name,
    config: workspace.config,
    paths: workspace.paths.map((path) => ({
      path_id: path.path_id,
      display_name: path.display_name,
      file_name: ensureJsonFileName(path.file_name),
      path: serializePath(path.path),
      editor_metadata: serializePathEditorMetadata(path.path),
    })),
    active_path_id: workspace.active_path_id,
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

export function deserializeProjectPathDocument(
  input: unknown,
  index = 0,
  defaultLookup?: Parameters<typeof deserializePath>[1],
): ProjectPathDocument {
  const object = isObject(input) ? input : {};
  const fileName = ensureJsonFileName(
    stringOr(
      object.file_name ?? object.path_file_name,
      `path-${index + 1}.json`,
    ),
  );
  const displayName = stringOr(
    object.display_name,
    displayNameFromFileName(fileName),
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
  const fileName = ensureJsonFileName(
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
  });
}

export function activePathFromWorkspace(
  workspace: ProjectWorkspaceDocument,
): ProjectPathDocument | null {
  return (
    workspace.paths.find((path) => path.path_id === workspace.active_path_id) ??
    workspace.paths[0] ??
    null
  );
}

export function activeProjectFromWorkspace(
  workspace: ProjectWorkspaceDocument | null,
): ProjectDocument | null {
  if (!workspace) {
    return null;
  }

  const activePath = activePathFromWorkspace(workspace);
  if (!activePath) {
    return null;
  }

  return createProjectDocument({
    project_id: activePath.path_id,
    display_name: activePath.display_name,
    path_file_name: activePath.file_name,
    path: structuredClone(activePath.path),
    config: structuredClone(workspace.config),
  });
}

export function replaceActiveProjectInWorkspace(
  workspace: ProjectWorkspaceDocument,
  project: ProjectDocument,
): ProjectWorkspaceDocument {
  const activePath = activePathFromWorkspace(workspace);
  if (!activePath) {
    return normalizeProjectWorkspaceDocument(workspace);
  }

  const nextPaths = workspace.paths.map((path) =>
    path.path_id === activePath.path_id
      ? {
          ...path,
          display_name: project.display_name,
          file_name: ensureJsonFileName(
            project.path_file_name ?? path.file_name,
          ),
          path: structuredClone(project.path),
        }
      : path,
  );

  return normalizeProjectWorkspaceDocument({
    ...workspace,
    config: structuredClone(project.config),
    paths: nextPaths,
  });
}

export function normalizeProjectWorkspaceDocument(
  workspace: ProjectWorkspaceDocument,
): ProjectWorkspaceDocument {
  const seen = new Set<string>();
  const paths = workspace.paths.map((path, index) => {
    const fallbackFileName = ensureJsonFileName(
      path.file_name || path.display_name || `path-${index + 1}`,
    );
    let pathId = path.path_id || pathIdFromFileName(fallbackFileName, index);
    if (seen.has(pathId)) {
      pathId = `${pathId}-${index + 1}`;
    }
    seen.add(pathId);

    return createProjectPathDocument({
      path_id: pathId,
      display_name:
        path.display_name || displayNameFromFileName(fallbackFileName),
      file_name: fallbackFileName,
      path: structuredClone(path.path),
    });
  });
  const active_path_id = paths.some(
    (path) => path.path_id === workspace.active_path_id,
  )
    ? workspace.active_path_id
    : (paths[0]?.path_id ?? null);

  return createProjectWorkspaceDocument({
    project_id: workspace.project_id,
    display_name: workspace.display_name,
    config: workspace.config,
    paths,
    active_path_id,
  });
}

export function ensureWorkspaceHasActivePath(
  workspace: ProjectWorkspaceDocument,
  input: Partial<Pick<ProjectPathDocument, "display_name" | "file_name">> = {},
): ProjectWorkspaceDocument {
  const normalized = normalizeProjectWorkspaceDocument(workspace);
  if (activePathFromWorkspace(normalized)) {
    return normalized;
  }

  const fileName = ensureJsonFileName(
    input.file_name ?? input.display_name ?? "new_path",
  );
  const path = createProjectPathDocument({
    path_id: createPathId(),
    display_name: input.display_name ?? displayNameFromFileName(fileName),
    file_name: fileName,
    path: createPathModel(),
  });

  return createProjectWorkspaceDocument({
    ...normalized,
    paths: [path],
    active_path_id: path.path_id,
  });
}

export function addPathToWorkspace(
  workspace: ProjectWorkspaceDocument,
  input: {
    display_name: string;
    file_name?: string;
    path?: ProjectPathDocument["path"];
    path_id?: string;
    makeActive?: boolean;
  },
): ProjectWorkspaceDocument {
  const fileName = uniquePathFileName(
    workspace.paths,
    ensureJsonFileName(input.file_name ?? input.display_name),
  );
  const path = createProjectPathDocument({
    path_id: input.path_id ?? createPathId(),
    display_name: input.display_name,
    file_name: fileName,
    path: structuredClone(input.path ?? createPathModel()),
  });

  return normalizeProjectWorkspaceDocument({
    ...workspace,
    paths: [...workspace.paths, path],
    active_path_id:
      input.makeActive === false ? workspace.active_path_id : path.path_id,
  });
}

export function renamePathInWorkspace(
  workspace: ProjectWorkspaceDocument,
  pathId: string,
  name: string,
): ProjectWorkspaceDocument {
  const nextFileName = uniquePathFileName(
    workspace.paths.filter((path) => path.path_id !== pathId),
    ensureJsonFileName(name),
  );

  return normalizeProjectWorkspaceDocument({
    ...workspace,
    paths: workspace.paths.map((path) =>
      path.path_id === pathId
        ? {
            ...path,
            display_name: name,
            file_name: nextFileName,
          }
        : path,
    ),
  });
}

export function duplicatePathInWorkspace(
  workspace: ProjectWorkspaceDocument,
  pathId: string,
  name: string,
): ProjectWorkspaceDocument {
  const source = workspace.paths.find((path) => path.path_id === pathId);
  if (!source) {
    return workspace;
  }

  return addPathToWorkspace(workspace, {
    display_name: name,
    file_name: ensureJsonFileName(name),
    path: source.path,
    makeActive: true,
  });
}

export function deletePathsFromWorkspace(
  workspace: ProjectWorkspaceDocument,
  pathIds: readonly string[],
): ProjectWorkspaceDocument {
  const deleted = new Set(pathIds);
  const paths = workspace.paths.filter((path) => !deleted.has(path.path_id));
  const active_path_id = deleted.has(workspace.active_path_id ?? "")
    ? (paths[0]?.path_id ?? null)
    : workspace.active_path_id;

  return ensureWorkspaceHasActivePath({
    ...workspace,
    paths,
    active_path_id,
  });
}

export function ensureJsonFileName(value: string): string {
  const cleaned =
    safeFileStem(value.replace(/\.json$/i, "")) || "untitled-path";
  return `${cleaned}.json`;
}

export function displayNameFromFileName(fileName: string): string {
  return fileName.replace(/\.json$/i, "").replace(/[-_]+/g, " ");
}

export function createWorkspaceId(): string {
  return `workspace-${randomId()}`;
}

export function createPathId(): string {
  return `path-${randomId()}`;
}

function deserializeProjectPathDocumentFromArchive(
  input: unknown,
  index: number,
  defaultLookup?: Parameters<typeof deserializePath>[1],
): ProjectPathDocument {
  return deserializeProjectPathDocument(input, index, defaultLookup);
}

function serializePathEditorMetadata(
  path: PathModel,
): SerializedPathEditorMetadata | undefined {
  const rangedConstraints = path.ranged_constraints.flatMap((constraint) => {
    const source = normalizeRangedConstraintSource(constraint.source);
    if (source === null || source === "manual") {
      return [];
    }

    const metadata: SerializedRangedConstraintMetadata = {
      key: constraint.key,
      value: Number(constraint.value),
      start_ordinal: Math.trunc(constraint.start_ordinal),
      end_ordinal: Math.trunc(constraint.end_ordinal),
      source,
    };
    const autoVelocity = normalizeAutoVelocityMetadata(
      constraint.auto_velocity,
    );
    if (autoVelocity) {
      metadata.auto_velocity = autoVelocity;
    }
    return [metadata];
  });

  return rangedConstraints.length === 0
    ? undefined
    : { ranged_constraints: rangedConstraints };
}

function applyPathEditorMetadata(path: PathModel, input: unknown): PathModel {
  const metadata = readPathEditorMetadata(input);
  if (metadata.length === 0) {
    return path;
  }

  const used = new Set<number>();
  for (const entry of metadata) {
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

function readPathEditorMetadata(
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

function uniquePathFileName(
  paths: readonly ProjectPathDocument[],
  requestedFileName: string,
): string {
  const existing = new Set(paths.map((path) => path.file_name.toLowerCase()));
  if (!existing.has(requestedFileName.toLowerCase())) {
    return requestedFileName;
  }

  const stem = requestedFileName.replace(/\.json$/i, "");
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem}-${index}.json`;
    if (!existing.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${stem}-${randomId()}.json`;
}

function pathIdFromFileName(fileName: string, index: number): string {
  return `${safeFileStem(fileName.replace(/\.json$/i, "")) || "path"}-${index + 1}`;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function safeFileStem(value: string): string {
  return (
    value
      .trim()
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/[^a-zA-Z0-9_.-]+/g, "_")
      .replace(/^_+|_+$/g, "") ?? ""
  );
}

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

export { deserializeProjectPathDocumentFromArchive };

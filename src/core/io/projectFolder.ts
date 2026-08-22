import type {
  LinkedTarget,
  ProjectConfig,
  ProjectWorkspaceDocument,
  SerializedPathEditorMetadata,
} from "./projectSchema";
import {
  deserializeProjectConfig,
  type ProjectConfigWithoutField,
} from "./blineProject";
import { serializePath } from "./projectSerde";
import {
  deserializeProjectFiles,
  serializeProjectFiles,
  type ProjectTextFile,
} from "./projectFiles";
import type { Project } from "../model/project";
import {
  createWorkspaceId,
  displayNameFromFileName,
  ensureJsonFileName,
  deserializeProjectWorkspaceDocument,
  serializeProjectWorkspaceDocument,
  type SerializedPathGroupFileEntry,
} from "./workspaceSerde";
import {
  assertJsonRepresented,
  normalizeLegacyLinkedTargetKinds,
} from "./legacyMigrationValidation";

export interface ProjectFolderExportFile {
  relativePath: string;
  blob: Blob;
}

export interface ProjectFolderExport {
  folderName: string;
  files: ProjectFolderExportFile[];
}

export interface ProjectFolderImportFile {
  name: string;
  webkitRelativePath?: string;
  text(): Promise<string>;
}

export interface DeserializeBLineProjectFolderOptions {
  requireLosslessMigration?: boolean;
}

export class ProjectFolderLosslessMigrationError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly rawText: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectFolderLosslessMigrationError";
  }
}

interface ImportRecord {
  file: ProjectFolderImportFile;
  rawPath: string;
  strippedPath: string;
  autosPath: string;
}

export const autosEditorStateSchemaVersion = 1;
export const autosEditorStatePath = ".bline-web/state.json";

type AutosEditorKinematicConstraints = Pick<
  ProjectConfig["kinematic_constraints"],
  | "default_auto_velocity_velocity_safety_factor"
  | "default_auto_velocity_acceleration_safety_factor"
  | "default_auto_velocity_merge_tolerance_meters_per_sec"
>;

export interface AutosEditorConfigState {
  gui: ProjectConfigWithoutField["gui"] & {
    field?: ProjectConfig["gui"]["field"];
  };
  kinematic_constraints: AutosEditorKinematicConstraints;
}

export interface AutosEditorPathState {
  display_name: string;
  editor_metadata?: SerializedPathEditorMetadata;
}

export interface AutosEditorFieldAssetState {
  file_name: string;
  mime_type: string;
}

interface LegacyFieldAssetMetadata {
  file_name: string | null;
  mime_type: string | null;
}

interface LegacyFieldAssetMetadataFile {
  assets: Record<string, LegacyFieldAssetMetadata>;
}

export interface AutosEditorStateFile {
  schema_version: typeof autosEditorStateSchemaVersion;
  editor_config: AutosEditorConfigState;
  active_path_file_name: string | null;
  active_path_group_id: string | null;
  path_groups: SerializedPathGroupFileEntry[];
  linked_targets: LinkedTarget[];
  paths: Record<string, AutosEditorPathState>;
  field_assets?: Record<string, AutosEditorFieldAssetState>;
}

export function serializeBLineProjectFolder(
  project: Project,
): ProjectFolderExport {
  return {
    folderName: "autos",
    files: serializeProjectFiles(project).map(({ relativePath, text }) => ({
      relativePath,
      blob: new Blob([text], { type: "application/json" }),
    })),
  };
}

export async function deserializeBLineProjectFolder(
  files: readonly ProjectFolderImportFile[],
  options: DeserializeBLineProjectFolderOptions = {},
): Promise<ProjectWorkspaceDocument> {
  const records = createImportRecords(files).filter((record) =>
    record.rawPath.toLowerCase().endsWith(".json"),
  );

  if (records.length === 0) {
    throw new Error("The selected folder does not contain any JSON files");
  }

  const configRecord = records.find(
    (record) => record.autosPath.toLowerCase() === "config.json",
  );
  const pathGroupsRecord = records.find(
    (record) => record.autosPath.toLowerCase() === "pathgroups.json",
  );
  const stateRecord = records.find(
    (record) => record.autosPath.toLowerCase() === autosEditorStatePath,
  );
  const projectRecord = records.find(
    (record) => record.autosPath.toLowerCase() === "project.json",
  );
  if (projectRecord) {
    const projectFiles = await Promise.all(
      records.flatMap((record) =>
        /^(config|project)\.json$/i.test(record.autosPath) ||
        /^paths\/[^/]+\.json$/i.test(record.autosPath)
          ? [
              record.file.text().then(
                (text): ProjectTextFile => ({
                  relativePath: record.autosPath,
                  text,
                }),
              ),
            ]
          : [],
      ),
    );
    const project = deserializeProjectFiles(projectFiles);
    return {
      ...project,
      active_path_id: project.paths[0]?.path_id ?? null,
      active_path_group_id: null,
    };
  }
  const legacyPathMetadataRecord = records.find(
    (record) =>
      record.autosPath.toLowerCase() === ".bline-web/path-metadata.json",
  );
  const legacyFieldAssetsRecord = records.find(
    (record) =>
      record.autosPath.toLowerCase() === ".bline-web/field-assets.json",
  );
  const rawEditorStateText = stateRecord
    ? await stateRecord.file.text()
    : undefined;
  const rawEditorState =
    rawEditorStateText !== undefined
      ? parseFolderJson(
          rawEditorStateText,
          autosEditorStatePath,
          options.requireLosslessMigration,
        )
      : undefined;
  const rawLegacyPathMetadataText = legacyPathMetadataRecord
    ? await legacyPathMetadataRecord.file.text()
    : undefined;
  const rawLegacyPathMetadata =
    rawLegacyPathMetadataText !== undefined
      ? parseFolderJson(
          rawLegacyPathMetadataText,
          ".bline-web/path-metadata.json",
          options.requireLosslessMigration,
        )
      : undefined;
  const rawLegacyFieldAssetsText = legacyFieldAssetsRecord
    ? await legacyFieldAssetsRecord.file.text()
    : undefined;
  const rawLegacyFieldAssets =
    rawLegacyFieldAssetsText !== undefined
      ? parseFolderJson(
          rawLegacyFieldAssetsText,
          ".bline-web/field-assets.json",
          options.requireLosslessMigration,
        )
      : undefined;
  const rawPathGroupsText = pathGroupsRecord
    ? await pathGroupsRecord.file.text()
    : undefined;
  const rawPathGroups =
    rawPathGroupsText !== undefined
      ? parseFolderJson(
          rawPathGroupsText,
          "pathgroups.json",
          options.requireLosslessMigration,
        )
      : undefined;
  const editorState = stateRecord ? readAutosEditorState(rawEditorState) : null;
  const legacyPathMetadata = legacyPathMetadataRecord
    ? readLegacyPathMetadata(rawLegacyPathMetadata)
    : {};
  const legacyFieldAssets = legacyFieldAssetsRecord
    ? readLegacyFieldAssets(rawLegacyFieldAssets)
    : { assets: {} };
  const rawConfigText = configRecord
    ? await configRecord.file.text()
    : undefined;
  const rawConfig =
    rawConfigText !== undefined
      ? parseFolderJson(
          rawConfigText,
          "config.json",
          options.requireLosslessMigration,
        )
      : undefined;
  const config = deserializeProjectConfig(
    mergeRuntimeAndEditorConfig(rawConfig, editorState),
  );
  const pathRecords = records
    .filter((record) => /^paths\/[^/]+\.json$/i.test(record.autosPath))
    .sort((a, b) => a.autosPath.localeCompare(b.autosPath));

  if (pathRecords.length === 0) {
    throw new Error("The selected folder must contain paths/*.json files");
  }

  const parsedPaths = await Promise.all(
    pathRecords.map(async (record) => {
      const rawText = await record.file.text();
      const parsed = parseFolderJson(
        rawText,
        record.autosPath,
        options.requireLosslessMigration,
      );
      const fileName = ensureJsonFileName(
        record.autosPath.split("/").at(-1) ?? record.file.name,
      );
      const pathObject =
        isObject(parsed) && "path" in parsed ? parsed.path : parsed;
      const statePath = statePathByFileName(editorState, fileName);
      const legacyMetadata = legacyPathMetadata[fileName];

      return {
        sourcePath: record.autosPath,
        rawText,
        parsed,
        input: {
          path_id: fileName,
          display_name:
            statePath?.display_name ?? displayNameFromFileName(fileName),
          file_name: fileName,
          path: pathObject,
          editor_metadata: statePath?.editor_metadata ?? legacyMetadata,
        },
      };
    }),
  );
  const paths = parsedPaths.map((path) => path.input);
  const activePathFileName = stringOrNull(editorState?.active_path_file_name);
  const activePathId =
    paths.find(
      (path) =>
        activePathFileName &&
        path.file_name.toLowerCase() ===
          ensureJsonFileName(activePathFileName).toLowerCase(),
    )?.path_id ??
    paths[0]?.path_id ??
    null;
  const editorStateHasPathGroups =
    isObject(rawEditorState) &&
    Object.prototype.hasOwnProperty.call(rawEditorState, "path_groups");
  const pathGroups = editorStateHasPathGroups
    ? (editorState?.path_groups ?? [])
    : pathGroupsRecord
      ? rawPathGroups
      : undefined;
  const workspaceInput = {
    project_id: createWorkspaceId(),
    display_name: inferDisplayName(records),
    config,
    paths,
    active_path_id: activePathId,
    path_groups: pathGroups,
    linked_targets: editorState?.linked_targets ?? [],
    active_path_group_id: stringOrNull(editorState?.active_path_group_id),
  };
  const workspace = deserializeProjectWorkspaceDocument(workspaceInput);
  if (options.requireLosslessMigration) {
    attestLosslessFolderMigration({
      workspace,
      displayName: workspace.display_name,
      rawConfig,
      rawConfigText,
      parsedPaths,
      editorState,
      legacyPathMetadata,
      rawEditorState,
      rawEditorStateText,
      rawPathGroups,
      rawPathGroupsText,
      rawLegacyPathMetadata,
      rawLegacyPathMetadataText,
      legacyFieldAssets,
      rawLegacyFieldAssets,
      rawLegacyFieldAssetsText,
    });
  }
  return workspace;
}

interface LosslessFolderMigrationInputs {
  workspace: ProjectWorkspaceDocument;
  displayName: string;
  rawConfig: unknown;
  rawConfigText?: string;
  parsedPaths: Array<{
    sourcePath: string;
    rawText: string;
    parsed: unknown;
    input: LegacyFolderPathInput;
  }>;
  editorState: AutosEditorStateFile | null;
  legacyPathMetadata: Record<string, SerializedPathEditorMetadata>;
  rawEditorState: unknown;
  rawEditorStateText?: string;
  rawPathGroups: unknown;
  rawPathGroupsText?: string;
  rawLegacyPathMetadata: unknown;
  rawLegacyPathMetadataText?: string;
  legacyFieldAssets: LegacyFieldAssetMetadataFile;
  rawLegacyFieldAssets: unknown;
  rawLegacyFieldAssetsText?: string;
}

interface LegacyFolderPathInput {
  path_id: string;
  display_name: string;
  file_name: string;
  path: unknown;
  editor_metadata?: SerializedPathEditorMetadata;
}

function attestLosslessFolderMigration({
  workspace,
  displayName,
  rawConfig,
  rawConfigText,
  parsedPaths,
  editorState,
  legacyPathMetadata,
  rawEditorState,
  rawEditorStateText,
  rawPathGroups,
  rawPathGroupsText,
  rawLegacyPathMetadata,
  rawLegacyPathMetadataText,
  legacyFieldAssets,
  rawLegacyFieldAssets,
  rawLegacyFieldAssetsText,
}: LosslessFolderMigrationInputs): void {
  const runtimePaths = parsedPaths.map(({ input }) => ({
    ...input,
    display_name: displayNameFromFileName(input.file_name),
    editor_metadata: undefined,
  }));
  const runtimeWorkspace = deserializeProjectionWorkspace({
    displayName,
    config: rawConfig,
    paths: runtimePaths,
  });
  assertMigrationProjection(
    "config.json",
    rawConfigText,
    rawConfig,
    runtimeWorkspace.config,
    "desktop runtime config",
  );

  for (const source of parsedPaths) {
    const path = runtimeWorkspace.paths.find(
      (candidate) => candidate.file_name === source.input.file_name,
    );
    if (!path) continue;
    const serializedPath = serializePath(path.path);
    assertMigrationProjection(
      source.sourcePath,
      source.rawText,
      source.parsed,
      isObject(source.parsed) && "path" in source.parsed
        ? { path: serializedPath }
        : serializedPath,
      "desktop runtime Path",
    );
  }

  const statePaths = parsedPaths.map(({ input }) => {
    const statePath = statePathByFileName(editorState, input.file_name);
    return {
      ...input,
      display_name:
        statePath?.display_name ?? displayNameFromFileName(input.file_name),
      editor_metadata: statePath?.editor_metadata,
    };
  });
  const stateActivePathId = pathIdForFileName(
    statePaths,
    editorState?.active_path_file_name,
  );
  const stateWorkspace = deserializeProjectionWorkspace({
    displayName,
    config: editorState?.editor_config,
    paths: statePaths,
    activePathId: stateActivePathId,
    pathGroups: editorState?.path_groups,
    linkedTargets: editorState?.linked_targets,
    activePathGroupId: editorState?.active_path_group_id,
  });
  assertMigrationProjection(
    autosEditorStatePath,
    rawEditorStateText,
    normalizeLegacyLinkedTargetKinds(rawEditorState),
    serializeAutosEditorState(stateWorkspace),
    "desktop editor state",
  );

  const pathGroupsWorkspace = deserializeProjectionWorkspace({
    displayName,
    config: rawConfig,
    paths: runtimePaths,
    pathGroups: rawPathGroups,
  });
  assertMigrationProjection(
    "pathgroups.json",
    rawPathGroupsText,
    rawPathGroups,
    serializePathGroupsFile(pathGroupsWorkspace),
    "desktop Path groups",
  );

  const legacyMetadataWorkspace = deserializeProjectionWorkspace({
    displayName,
    config: rawConfig,
    paths: parsedPaths.map(({ input }) => ({
      ...input,
      display_name: displayNameFromFileName(input.file_name),
      editor_metadata: legacyPathMetadata[input.file_name],
    })),
  });
  assertMigrationProjection(
    ".bline-web/path-metadata.json",
    rawLegacyPathMetadataText,
    rawLegacyPathMetadata,
    serializeLegacyPathMetadata(legacyMetadataWorkspace),
    "desktop Path metadata",
  );

  assertMigrationProjection(
    ".bline-web/field-assets.json",
    rawLegacyFieldAssetsText,
    rawLegacyFieldAssets,
    serializeLegacyFieldAssets(legacyFieldAssets),
    "desktop Field Background asset metadata",
  );
  attestLegacyFieldAssets(
    workspace,
    legacyFieldAssets,
    editorState?.field_assets ?? {},
    rawLegacyFieldAssets,
    rawLegacyFieldAssetsText,
  );
}

function deserializeProjectionWorkspace(input: {
  displayName: string;
  config: unknown;
  paths: LegacyFolderPathInput[];
  activePathId?: string | null;
  pathGroups?: unknown;
  linkedTargets?: unknown;
  activePathGroupId?: string | null;
}): ProjectWorkspaceDocument {
  return deserializeProjectWorkspaceDocument({
    project_id: "legacy-folder-projection",
    display_name: input.displayName,
    config: input.config,
    paths: input.paths,
    active_path_id: input.activePathId ?? input.paths[0]?.path_id ?? null,
    path_groups: input.pathGroups,
    linked_targets: input.linkedTargets,
    active_path_group_id: input.activePathGroupId ?? null,
  });
}

function pathIdForFileName(
  paths: readonly LegacyFolderPathInput[],
  fileName: unknown,
): string | null {
  const normalized = stringOrNull(fileName);
  return normalized
    ? (paths.find(
        (path) =>
          path.file_name.toLowerCase() ===
          ensureJsonFileName(normalized).toLowerCase(),
      )?.path_id ?? null)
    : null;
}

function assertMigrationProjection(
  sourcePath: string,
  rawText: string | undefined,
  source: unknown,
  projection: unknown,
  label: string,
): void {
  if (rawText === undefined) return;
  try {
    assertJsonRepresented(source, projection, label);
  } catch (error) {
    throw new ProjectFolderLosslessMigrationError(
      sourcePath,
      rawText,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function parseFolderJson(
  rawText: string,
  sourcePath: string,
  requireLosslessMigration = false,
): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch (error) {
    if (requireLosslessMigration) {
      throw new ProjectFolderLosslessMigrationError(
        sourcePath,
        rawText,
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  }
}

function serializeAutosEditorState(
  workspace: ProjectWorkspaceDocument,
): AutosEditorStateFile {
  const serialized = serializeProjectWorkspaceDocument(workspace);
  const activePath =
    workspace.paths.find((path) => path.path_id === workspace.active_path_id) ??
    workspace.paths[0] ??
    null;

  return {
    schema_version: autosEditorStateSchemaVersion,
    editor_config: {
      gui: structuredClone(workspace.config.gui),
      kinematic_constraints: {
        default_auto_velocity_velocity_safety_factor:
          workspace.config.kinematic_constraints
            .default_auto_velocity_velocity_safety_factor,
        default_auto_velocity_acceleration_safety_factor:
          workspace.config.kinematic_constraints
            .default_auto_velocity_acceleration_safety_factor,
        default_auto_velocity_merge_tolerance_meters_per_sec:
          workspace.config.kinematic_constraints
            .default_auto_velocity_merge_tolerance_meters_per_sec,
      },
    },
    active_path_file_name: activePath
      ? ensureJsonFileName(activePath.file_name)
      : null,
    active_path_group_id: workspace.active_path_group_id,
    path_groups: serializePathGroupEntries(workspace),
    linked_targets: structuredClone(workspace.linked_targets),
    paths: Object.fromEntries(
      serialized.paths.map((path) => [
        ensureJsonFileName(path.file_name),
        {
          display_name: path.display_name,
          editor_metadata: path.editor_metadata,
        },
      ]),
    ),
    field_assets: Object.fromEntries(
      workspace.config.gui.field.custom_fields.map((field) => [
        field.asset_id,
        { file_name: field.file_name, mime_type: field.mime_type },
      ]),
    ),
  };
}

function serializePathGroupsFile(workspace: ProjectWorkspaceDocument) {
  return { schema_version: 1, groups: serializePathGroupEntries(workspace) };
}

function serializePathGroupEntries(
  workspace: ProjectWorkspaceDocument,
): SerializedPathGroupFileEntry[] {
  const fileNameByPathId = new Map(
    workspace.paths.map((path) => [
      path.path_id,
      ensureJsonFileName(path.file_name),
    ]),
  );
  return workspace.path_groups.map((group) => ({
    group_id: group.group_id,
    display_name: group.display_name,
    path_file_names: group.path_ids.flatMap((pathId) => {
      const fileName = fileNameByPathId.get(pathId);
      return fileName ? [fileName] : [];
    }),
  }));
}

function serializeLegacyPathMetadata(workspace: ProjectWorkspaceDocument) {
  const serialized = serializeProjectWorkspaceDocument(workspace);
  return {
    paths: Object.fromEntries(
      serialized.paths.map((path) => [
        ensureJsonFileName(path.file_name),
        { editor_metadata: path.editor_metadata },
      ]),
    ),
  };
}

function serializeLegacyFieldAssets(
  metadata: LegacyFieldAssetMetadataFile,
): LegacyFieldAssetMetadataFile {
  return {
    assets: Object.fromEntries(
      Object.entries(metadata.assets).map(([assetId, asset]) => [
        assetId,
        {
          file_name: asset.file_name,
          mime_type: asset.mime_type,
        },
      ]),
    ),
  };
}

function attestLegacyFieldAssets(
  workspace: ProjectWorkspaceDocument,
  legacy: LegacyFieldAssetMetadataFile,
  editorStateAssets: Record<string, AutosEditorFieldAssetState>,
  rawInput: unknown,
  rawText: string | undefined,
): void {
  if (rawText === undefined) return;
  if (!isObject(rawInput) || !isObject(rawInput.assets)) {
    throw new ProjectFolderLosslessMigrationError(
      ".bline-web/field-assets.json",
      rawText,
      "desktop Field Background asset metadata must contain an assets object",
    );
  }

  const customFields = new Map(
    workspace.config.gui.field.custom_fields.map((field) => [
      field.asset_id,
      field,
    ]),
  );
  for (const [assetId, metadata] of Object.entries(legacy.assets)) {
    const field = customFields.get(assetId);
    if (!field) {
      throw new ProjectFolderLosslessMigrationError(
        ".bline-web/field-assets.json",
        rawText,
        `desktop Field Background asset metadata contains orphan asset ${JSON.stringify(assetId)}`,
      );
    }

    if (
      (metadata.file_name !== null && metadata.file_name !== field.file_name) ||
      (metadata.mime_type !== null && metadata.mime_type !== field.mime_type)
    ) {
      throw new ProjectFolderLosslessMigrationError(
        ".bline-web/field-assets.json",
        rawText,
        `desktop Field Background asset metadata conflicts with custom field ${JSON.stringify(assetId)}`,
      );
    }

    const editorAsset = editorStateAssets[assetId];
    if (
      editorAsset &&
      ((metadata.file_name !== null &&
        metadata.file_name !== editorAsset.file_name) ||
        (metadata.mime_type !== null &&
          metadata.mime_type !== editorAsset.mime_type))
    ) {
      throw new ProjectFolderLosslessMigrationError(
        ".bline-web/field-assets.json",
        rawText,
        `desktop Field Background asset metadata conflicts with ${autosEditorStatePath} for ${JSON.stringify(assetId)}`,
      );
    }
  }
}

function readAutosEditorState(input: unknown): AutosEditorStateFile | null {
  if (!isObject(input)) {
    return null;
  }

  const editorConfig = isObject(input.editor_config) ? input.editor_config : {};
  const constraints = isObject(editorConfig.kinematic_constraints)
    ? editorConfig.kinematic_constraints
    : {};

  return {
    schema_version: autosEditorStateSchemaVersion,
    editor_config: {
      gui: editorConfig.gui as ProjectConfig["gui"],
      kinematic_constraints: constraints as AutosEditorKinematicConstraints,
    },
    active_path_file_name: stringOrNull(input.active_path_file_name),
    active_path_group_id: stringOrNull(input.active_path_group_id),
    path_groups: Array.isArray(input.path_groups)
      ? (input.path_groups as SerializedPathGroupFileEntry[])
      : [],
    linked_targets: Array.isArray(input.linked_targets)
      ? (input.linked_targets as LinkedTarget[])
      : [],
    paths: isObject(input.paths)
      ? Object.fromEntries(
          Object.entries(input.paths).flatMap(([fileName, pathState]) => {
            if (!isObject(pathState)) {
              return [];
            }
            const displayName =
              typeof pathState.display_name === "string" &&
              pathState.display_name.trim()
                ? pathState.display_name
                : displayNameFromFileName(fileName);
            return [
              [
                ensureJsonFileName(fileName),
                {
                  display_name: displayName,
                  editor_metadata: isObject(pathState.editor_metadata)
                    ? (pathState.editor_metadata as SerializedPathEditorMetadata)
                    : undefined,
                },
              ],
            ];
          }),
        )
      : {},
    field_assets: isObject(input.field_assets)
      ? Object.fromEntries(
          Object.entries(input.field_assets).flatMap(([assetId, metadata]) => {
            if (!isObject(metadata)) {
              return [];
            }
            const fileName = String(metadata.file_name ?? assetId);
            const mimeType = String(metadata.mime_type ?? "");
            return [
              [
                assetId,
                {
                  file_name: fileName,
                  mime_type: mimeType,
                },
              ],
            ];
          }),
        )
      : {},
  };
}

function readLegacyPathMetadata(
  input: unknown,
): Record<string, SerializedPathEditorMetadata> {
  if (!isObject(input) || !isObject(input.paths)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input.paths).flatMap(([fileName, pathState]) => {
      if (!isObject(pathState) || !isObject(pathState.editor_metadata)) {
        return [];
      }

      return [
        [
          ensureJsonFileName(fileName),
          pathState.editor_metadata as SerializedPathEditorMetadata,
        ],
      ];
    }),
  );
}

function readLegacyFieldAssets(input: unknown): LegacyFieldAssetMetadataFile {
  if (!isObject(input) || !isObject(input.assets)) {
    return { assets: {} };
  }

  return {
    assets: Object.fromEntries(
      Object.entries(input.assets).flatMap(([assetId, metadata]) => {
        if (!isObject(metadata)) return [];
        const fileName = optionalString(metadata.file_name);
        const mimeType = optionalString(metadata.mime_type);
        if (fileName === undefined || mimeType === undefined) return [];
        return [
          [
            assetId,
            {
              file_name: fileName,
              mime_type: mimeType,
            },
          ],
        ];
      }),
    ),
  };
}

function mergeRuntimeAndEditorConfig(
  runtimeInput: unknown,
  editorState: AutosEditorStateFile | null,
): unknown {
  if (!editorState) {
    return runtimeInput;
  }

  const runtime = isObject(runtimeInput) ? runtimeInput : {};
  const runtimeConstraints = isObject(runtime.kinematic_constraints)
    ? runtime.kinematic_constraints
    : {};
  const editorConfig = editorState.editor_config;
  const editorConstraints = editorConfig.kinematic_constraints ?? {};

  return {
    ...runtime,
    gui: editorConfig.gui,
    kinematic_constraints: {
      ...editorConstraints,
      ...runtimeConstraints,
    },
  };
}

function statePathByFileName(
  state: AutosEditorStateFile | null,
  fileName: string,
): AutosEditorPathState | undefined {
  if (!state) {
    return undefined;
  }

  return state.paths[ensureJsonFileName(fileName)];
}

function stringOrNull(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input : null;
}

function optionalString(input: unknown): string | null | undefined {
  return input === null || input === undefined
    ? null
    : typeof input === "string"
      ? input
      : undefined;
}

function createImportRecords(
  files: readonly ProjectFolderImportFile[],
): ImportRecord[] {
  const rawPaths = files.map((file) => normalizeImportPath(file));
  const strippedPaths = stripCommonRoot(rawPaths);
  const selectedRoot = commonRootSegment(rawPaths);
  const selectedPathsFolder = selectedRoot?.toLowerCase() === "paths";

  return files.map((file, index) => {
    const rawPath = rawPaths[index] ?? file.name;
    const strippedPath = strippedPaths[index] ?? rawPath;

    return {
      file,
      rawPath,
      strippedPath,
      autosPath: normalizeAutosPath(strippedPath, selectedPathsFolder),
    };
  });
}

function normalizeImportPath(file: ProjectFolderImportFile): string {
  return (file.webkitRelativePath || file.name)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function stripCommonRoot(paths: readonly string[]): string[] {
  const commonRoot = commonRootSegment(paths);

  if (
    !commonRoot ||
    paths.some(
      (path) => !path.includes("/") || path.split("/")[0] !== commonRoot,
    )
  ) {
    return [...paths];
  }

  return paths.map((path) => path.split("/").slice(1).join("/") || path);
}

function commonRootSegment(paths: readonly string[]): string | null {
  const firstSegments = paths.map((path) => path.split("/")[0]).filter(Boolean);
  return firstSegments[0] ?? null;
}

function normalizeAutosPath(
  path: string,
  selectedPathsFolder: boolean,
): string {
  if (selectedPathsFolder) {
    return `paths/${path}`;
  }

  const parts = path.split("/").filter(Boolean);
  let autosIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.toLowerCase() === "autos") {
      autosIndex = index;
      break;
    }
  }

  return autosIndex >= 0
    ? parts.slice(autosIndex + 1).join("/")
    : parts.join("/");
}

function inferDisplayName(records: readonly ImportRecord[]): string {
  const firstPath = records[0]?.rawPath;
  const root = firstPath?.split("/").find(Boolean);

  return root ? displayNameFromFileName(root) : "Imported Autos";
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

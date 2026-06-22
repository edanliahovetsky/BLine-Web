import type {
  ProjectConfig,
  ProjectWorkspaceDocument,
  SerializedPathEditorMetadata,
} from "./projectSchema";
import {
  deserializeProjectConfig,
  serializeBLineRuntimeConfig,
} from "./blineProject";
import { stringifyBLineJson } from "./blineJson";
import { serializePath } from "./projectSerde";
import {
  createWorkspaceId,
  displayNameFromFileName,
  ensureJsonFileName,
  deserializeProjectWorkspaceDocument,
  serializePathGroupsFile,
  serializeProjectWorkspaceDocument,
  type SerializedPathGroupFileEntry,
} from "./workspaceSerde";

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

interface ImportRecord {
  file: ProjectFolderImportFile;
  rawPath: string;
  strippedPath: string;
  autosPath: string;
}

export const autosEditorStateSchemaVersion = 1;
export const autosEditorStatePath = ".bline-web/state.json";
export const autosFieldAssetsPath = ".bline-web/assets/fields";

type AutosEditorKinematicConstraints = Pick<
  ProjectConfig["kinematic_constraints"],
  | "default_auto_velocity_velocity_safety_factor"
  | "default_auto_velocity_acceleration_safety_factor"
  | "default_auto_velocity_merge_tolerance_meters_per_sec"
>;

export interface AutosEditorConfigState {
  gui: ProjectConfig["gui"];
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

export interface AutosEditorStateFile {
  schema_version: typeof autosEditorStateSchemaVersion;
  editor_config: AutosEditorConfigState;
  active_path_file_name: string | null;
  active_path_group_id: string | null;
  path_groups: SerializedPathGroupFileEntry[];
  paths: Record<string, AutosEditorPathState>;
  field_assets: Record<string, AutosEditorFieldAssetState>;
}

export function serializeBLineProjectFolder(
  workspace: ProjectWorkspaceDocument,
): ProjectFolderExport {
  return {
    folderName: "autos",
    files: [
      jsonFile("config.json", serializeBLineRuntimeConfig(workspace.config)),
      jsonFile(autosEditorStatePath, serializeAutosEditorState(workspace)),
      ...workspace.paths.map((path) =>
        jsonFile(
          `paths/${ensureJsonFileName(path.file_name)}`,
          serializePath(path.path),
        ),
      ),
    ],
  };
}

export function serializeAutosEditorState(
  workspace: ProjectWorkspaceDocument,
): AutosEditorStateFile {
  const serialized = serializeProjectWorkspaceDocument(workspace);
  const activePath =
    workspace.paths.find((path) => path.path_id === workspace.active_path_id) ??
    workspace.paths[0] ??
    null;
  const paths: Record<string, AutosEditorPathState> = {};
  for (const path of serialized.paths) {
    const fileName = ensureJsonFileName(path.file_name);
    paths[fileName] = {
      display_name: path.display_name,
      editor_metadata: path.editor_metadata,
    };
  }

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
    path_groups: serializePathGroupsFile(workspace).groups,
    paths,
    field_assets: Object.fromEntries(
      workspace.config.gui.field.custom_fields.map((field) => [
        field.asset_id,
        {
          file_name: field.file_name,
          mime_type: field.mime_type,
        },
      ]),
    ),
  };
}

export async function deserializeBLineProjectFolder(
  files: readonly ProjectFolderImportFile[],
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
  const legacyPathMetadataRecord = records.find(
    (record) =>
      record.autosPath.toLowerCase() === ".bline-web/path-metadata.json",
  );
  const editorState = stateRecord
    ? readAutosEditorState(JSON.parse(await stateRecord.file.text()))
    : null;
  const legacyPathMetadata = legacyPathMetadataRecord
    ? readLegacyPathMetadata(
        JSON.parse(await legacyPathMetadataRecord.file.text()),
      )
    : {};
  const rawConfig = configRecord
    ? (JSON.parse(await configRecord.file.text()) as unknown)
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

  const paths = await Promise.all(
    pathRecords.map(async (record) => {
      const parsed = JSON.parse(await record.file.text()) as unknown;
      const fileName = ensureJsonFileName(
        record.autosPath.split("/").at(-1) ?? record.file.name,
      );
      const pathObject =
        isObject(parsed) && "path" in parsed ? parsed.path : parsed;
      const statePath = statePathByFileName(editorState, fileName);
      const legacyMetadata = legacyPathMetadata[fileName];

      return {
        path_id: fileName,
        display_name:
          statePath?.display_name ?? displayNameFromFileName(fileName),
        file_name: fileName,
        path: pathObject,
        editor_metadata: statePath?.editor_metadata ?? legacyMetadata,
      };
    }),
  );
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
  const pathGroups =
    editorState && "path_groups" in editorState
      ? editorState.path_groups
      : pathGroupsRecord
        ? JSON.parse(await pathGroupsRecord.file.text())
        : undefined;

  return deserializeProjectWorkspaceDocument({
    project_id: createWorkspaceId(),
    display_name: inferDisplayName(records),
    config,
    paths,
    active_path_id: activePathId,
    path_groups: pathGroups,
    active_path_group_id: stringOrNull(editorState?.active_path_group_id),
  });
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

function jsonFile(
  relativePath: string,
  value: unknown,
): ProjectFolderExportFile {
  return {
    relativePath,
    blob: new Blob([stringifyBLineJson(value)], {
      type: "application/json",
    }),
  };
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

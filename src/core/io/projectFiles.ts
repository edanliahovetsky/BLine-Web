import { createProject, type Project } from "../model/project";
import { serializeBLineRuntimeConfig } from "./blineProject";
import { stringifyBLineJson } from "./blineJson";
import type {
  ProjectConfig,
  SerializedLinkedPathElementTarget,
  SerializedLinkedTarget,
} from "./projectSchema";
import {
  createPathId,
  createWorkspaceId,
  deserializeProjectWorkspaceDocument,
  displayNameFromFileName,
  ensureJsonFileName,
  serializeProjectWorkspaceDocument,
} from "./workspaceSerde";

export const projectFilesSchemaVersion = 1;

export interface ProjectTextFile {
  relativePath: string;
  text: string;
}

export interface DeserializeProjectFilesOptions {
  fallbackProjectId?: string;
  fallbackDisplayName?: string;
  fallbackPathId?: (fileName: string, index: number) => string;
}

type AutoGenerationDefaults = Pick<
  ProjectConfig["kinematic_constraints"],
  | "default_auto_velocity_velocity_safety_factor"
  | "default_auto_velocity_acceleration_safety_factor"
  | "default_auto_velocity_merge_tolerance_meters_per_sec"
>;

export interface SerializedProjectEditorConfig {
  gui: Pick<ProjectConfig["gui"], "robot" | "protrusions">;
  kinematic_constraints: AutoGenerationDefaults;
}

export interface SerializedProjectFilePath {
  path_id: string;
  display_name: string;
  file_name: string;
  linked_targets?: SerializedLinkedPathElementTarget[];
}

export interface SerializedProjectFilePathGroup {
  group_id: string;
  display_name: string;
  path_ids: string[];
}

export interface SerializedProjectFileMetadata {
  schema_version: typeof projectFilesSchemaVersion;
  project_id: string;
  display_name: string;
  editor_config: SerializedProjectEditorConfig;
  paths: SerializedProjectFilePath[];
  path_groups: SerializedProjectFilePathGroup[];
  linked_targets: SerializedLinkedTarget[];
}

export function serializeProjectFiles(project: Project): ProjectTextFile[] {
  const serialized = serializeProjectWorkspaceDocument({
    ...project,
    active_path_id: null,
    active_path_group_id: null,
  });
  const metadata = serializeProjectFileMetadata(project, serialized);

  return [
    textFile(
      "config.json",
      stringifyBLineJson(serializeBLineRuntimeConfig(project.config)),
    ),
    textFile("project.json", `${JSON.stringify(metadata, null, 2)}\n`),
    ...serialized.paths.map((path) =>
      textFile(
        `paths/${ensureJsonFileName(path.file_name)}`,
        stringifyBLineJson(path.path),
      ),
    ),
  ];
}

export function deserializeProjectFiles(
  files: readonly ProjectTextFile[],
  options: DeserializeProjectFilesOptions = {},
): Project {
  const fileIndex = new Map(
    files.map((file) => [normalizeRelativePath(file.relativePath), file.text]),
  );
  const runtimeConfig = parseJson(requiredText(fileIndex, "config.json"));
  const metadataText = fileIndex.get("project.json");

  return metadataText === undefined
    ? deserializeRuntimeOnlyProject(fileIndex, runtimeConfig, options)
    : deserializeMetadataProject(
        fileIndex,
        runtimeConfig,
        parseProjectFileMetadata(metadataText),
      );
}

function serializeProjectFileMetadata(
  project: Project,
  serialized: ReturnType<typeof serializeProjectWorkspaceDocument>,
): SerializedProjectFileMetadata {
  const config = project.config;

  return {
    schema_version: projectFilesSchemaVersion,
    project_id: project.project_id,
    display_name: project.display_name,
    editor_config: {
      gui: {
        robot: {
          length_meters: config.gui.robot.length_meters,
          width_meters: config.gui.robot.width_meters,
        },
        protrusions: {
          enabled: config.gui.protrusions.enabled,
          distance_meters: config.gui.protrusions.distance_meters,
          side: config.gui.protrusions.side,
          default_state: config.gui.protrusions.default_state,
          show_on_event_keys: [...config.gui.protrusions.show_on_event_keys],
          hide_on_event_keys: [...config.gui.protrusions.hide_on_event_keys],
        },
      },
      kinematic_constraints: {
        default_auto_velocity_velocity_safety_factor:
          config.kinematic_constraints
            .default_auto_velocity_velocity_safety_factor,
        default_auto_velocity_acceleration_safety_factor:
          config.kinematic_constraints
            .default_auto_velocity_acceleration_safety_factor,
        default_auto_velocity_merge_tolerance_meters_per_sec:
          config.kinematic_constraints
            .default_auto_velocity_merge_tolerance_meters_per_sec,
      },
    },
    paths: serialized.paths.map((path) => {
      const linkedTargets = path.editor_metadata?.linked_targets;
      return {
        path_id: path.path_id,
        display_name: path.display_name,
        file_name: ensureJsonFileName(path.file_name),
        ...(linkedTargets && linkedTargets.length > 0
          ? { linked_targets: linkedTargets }
          : {}),
      };
    }),
    path_groups: project.path_groups.map((group) => ({
      group_id: group.group_id,
      display_name: group.display_name,
      path_ids: [...group.path_ids],
    })),
    linked_targets: serialized.linked_targets ?? [],
  };
}

function deserializeMetadataProject(
  fileIndex: ReadonlyMap<string, string>,
  runtimeConfig: unknown,
  metadata: SerializedProjectFileMetadata,
): Project {
  const config = mergeRuntimeAndEditorConfig(
    runtimeConfig,
    metadata.editor_config,
  );
  const workspace = deserializeProjectWorkspaceDocument({
    schema_version: 1,
    project_id: metadata.project_id,
    display_name: metadata.display_name,
    config,
    paths: metadata.paths.map((path) => ({
      path_id: path.path_id,
      display_name: path.display_name,
      file_name: path.file_name,
      path: parseJson(
        requiredText(fileIndex, `paths/${ensureJsonFileName(path.file_name)}`),
      ),
      ...(path.linked_targets
        ? { editor_metadata: { linked_targets: path.linked_targets } }
        : {}),
    })),
    path_groups: metadata.path_groups,
    linked_targets: metadata.linked_targets,
  });

  // Construct only the durable Project; Workspace navigation stays outside it.
  return createProject({
    project_id: workspace.project_id,
    display_name: workspace.display_name,
    config: workspace.config,
    paths: workspace.paths,
    path_groups: workspace.path_groups,
    linked_targets: workspace.linked_targets,
  });
}

function deserializeRuntimeOnlyProject(
  fileIndex: ReadonlyMap<string, string>,
  runtimeConfig: unknown,
  options: DeserializeProjectFilesOptions,
): Project {
  const pathFiles = [...fileIndex.entries()]
    .filter(([relativePath]) => /^paths\/[^/]+\.json$/i.test(relativePath))
    .sort(([left], [right]) => compareText(left, right));

  if (pathFiles.length === 0) {
    throw new Error("The Project file set must contain paths/*.json files");
  }

  const workspace = deserializeProjectWorkspaceDocument({
    schema_version: 1,
    project_id: options.fallbackProjectId ?? createWorkspaceId(),
    display_name: options.fallbackDisplayName ?? "Imported Project",
    config: runtimeConfig,
    paths: pathFiles.map(([relativePath, text], index) => {
      const fileName = ensureJsonFileName(relativePath.slice("paths/".length));
      return {
        path_id: options.fallbackPathId?.(fileName, index) ?? createPathId(),
        display_name: displayNameFromFileName(fileName),
        file_name: fileName,
        path: parseJson(text),
      };
    }),
  });

  return createProject({
    project_id: workspace.project_id,
    display_name: workspace.display_name,
    config: workspace.config,
    paths: workspace.paths,
  });
}

function mergeRuntimeAndEditorConfig(
  runtimeConfig: unknown,
  editorConfig: SerializedProjectEditorConfig,
): unknown {
  const runtime = isObject(runtimeConfig) ? runtimeConfig : {};
  const runtimeConstraints = isObject(runtime.kinematic_constraints)
    ? runtime.kinematic_constraints
    : {};

  return {
    ...runtime,
    gui: editorConfig.gui,
    kinematic_constraints: {
      ...runtimeConstraints,
      ...editorConfig.kinematic_constraints,
    },
  };
}

function parseProjectFileMetadata(text: string): SerializedProjectFileMetadata {
  const input = parseJson(text);
  if (
    !isObject(input) ||
    input.schema_version !== projectFilesSchemaVersion ||
    typeof input.project_id !== "string" ||
    typeof input.display_name !== "string" ||
    !isObject(input.editor_config) ||
    !isObject(input.editor_config.gui) ||
    !isObject(input.editor_config.gui.robot) ||
    !isObject(input.editor_config.gui.protrusions) ||
    !isObject(input.editor_config.kinematic_constraints) ||
    !Array.isArray(input.paths) ||
    !input.paths.every(isProjectFilePath) ||
    !Array.isArray(input.path_groups) ||
    !Array.isArray(input.linked_targets)
  ) {
    throw new Error("Invalid project.json document");
  }

  return input as unknown as SerializedProjectFileMetadata;
}

function isProjectFilePath(input: unknown): boolean {
  return (
    isObject(input) &&
    typeof input.path_id === "string" &&
    typeof input.display_name === "string" &&
    typeof input.file_name === "string" &&
    (input.linked_targets === undefined || Array.isArray(input.linked_targets))
  );
}

function textFile(relativePath: string, text: string): ProjectTextFile {
  return { relativePath, text };
}

function requiredText(
  fileIndex: ReadonlyMap<string, string>,
  relativePath: string,
): string {
  const text = fileIndex.get(relativePath);
  if (text === undefined) {
    throw new Error(`The Project file set is missing ${relativePath}`);
  }
  return text;
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

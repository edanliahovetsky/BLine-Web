import {
  createProjectConfig,
  projectConfigDefaultLookup,
} from "../config/projectConfig";
import { createProject, type Project } from "../model/project";
import {
  isRangedConstraintKey,
  rangedConstraintKeys,
  type PathModel,
} from "../model/path";
import {
  isElementCompatibleWithLinkedTarget,
  syncLinkedTargetElementsInProject,
} from "../linkedTargets";
import {
  serializeBLineRuntimeConfig,
  serializePathEditorMetadata,
} from "./blineProject";
import { stringifyBLineJson } from "./blineJson";
import type {
  ProjectConfig,
  SerializedPathEditorMetadata,
  SerializedLinkedTarget,
} from "./projectSchema";
import { deserializePath, serializePath } from "./projectSerde";
import {
  createPathId,
  createWorkspaceId,
  applyPathEditorMetadata,
  displayNameFromFileName,
  ensureJsonFileName,
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

export interface ProjectFileDamage {
  sourcePath: string;
  message: string;
  rawText: string;
}

export interface OpenProjectFilesResult {
  project: Project;
  damage: ProjectFileDamage | null;
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
  editor_metadata?: SerializedPathEditorMetadata;
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
  const metadata = serializeProjectFileMetadata(project);

  return [
    textFile(
      "config.json",
      stringifyBLineJson(serializeBLineRuntimeConfig(project.config)),
    ),
    textFile("project.json", `${JSON.stringify(metadata, null, 2)}\n`),
    ...project.paths.map((path) =>
      textFile(
        `paths/${ensureJsonFileName(path.file_name)}`,
        stringifyBLineJson(serializePath(path.path)),
      ),
    ),
  ];
}

export function deserializeProjectFiles(
  files: readonly ProjectTextFile[],
  options: DeserializeProjectFilesOptions = {},
): Project {
  assertUniqueManagedProjectFilePaths(files);
  const fileIndex = new Map(
    files.map((file) => [normalizeRelativePath(file.relativePath), file.text]),
  );
  const runtimeConfig = parseJson(requiredText(fileIndex, "config.json"));
  const metadataText = fileIndex.get("project.json");

  return metadataText === undefined
    ? deserializeRuntimeOnlyProject(fileIndex, runtimeConfig, options)
    : deserializeMetadataProject(
        files,
        runtimeConfig,
        parseProjectFileMetadata(metadataText),
      );
}

export function openProjectFiles(
  files: readonly ProjectTextFile[],
  options: DeserializeProjectFilesOptions = {},
): OpenProjectFilesResult {
  const metadata = files.find(
    (file) => normalizeRelativePath(file.relativePath) === "project.json",
  );
  if (!metadata) {
    return { project: deserializeProjectFiles(files, options), damage: null };
  }

  try {
    return { project: deserializeProjectFiles(files, options), damage: null };
  } catch (error) {
    const runtimeFiles = files.filter(
      (file) => normalizeRelativePath(file.relativePath) !== "project.json",
    );
    return {
      project: deserializeDamagedRuntimeProject(runtimeFiles, options),
      damage: {
        sourcePath: "project.json",
        message: error instanceof Error ? error.message : String(error),
        rawText: metadata.text,
      },
    };
  }
}

function deserializeDamagedRuntimeProject(
  files: readonly ProjectTextFile[],
  options: DeserializeProjectFilesOptions,
): Project {
  const hasRuntimePath = files.some((file) =>
    /^paths\/[^/]+\.json$/i.test(normalizeRelativePath(file.relativePath)),
  );
  if (hasRuntimePath) {
    return deserializeProjectFiles(files, options);
  }

  const fileIndex = new Map(
    files.map((file) => [normalizeRelativePath(file.relativePath), file.text]),
  );
  return createProject({
    project_id: options.fallbackProjectId ?? createWorkspaceId(),
    display_name: options.fallbackDisplayName ?? "Imported Project",
    config: parseJson(requiredText(fileIndex, "config.json")),
  });
}

function serializeProjectFileMetadata(
  project: Project,
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
    paths: project.paths.map((path) => {
      const editorMetadata = canonicalizePathEditorMetadata(
        serializePathEditorMetadata(path.path),
      );
      return {
        path_id: path.path_id,
        display_name: path.display_name,
        file_name: ensureJsonFileName(path.file_name),
        ...(editorMetadata ? { editor_metadata: editorMetadata } : {}),
      };
    }),
    path_groups: project.path_groups.map((group) => ({
      group_id: group.group_id,
      display_name: group.display_name,
      path_ids: [...group.path_ids],
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
}

function canonicalizePathEditorMetadata(
  metadata: SerializedPathEditorMetadata | undefined,
): SerializedPathEditorMetadata | undefined {
  if (!metadata?.ranged_constraints) return metadata;
  return {
    ...metadata,
    ranged_constraints: [...metadata.ranged_constraints].sort(
      (left, right) =>
        rangedConstraintKeys.indexOf(left.key) -
        rangedConstraintKeys.indexOf(right.key),
    ),
  };
}

function deserializeMetadataProject(
  files: readonly ProjectTextFile[],
  runtimeConfig: unknown,
  metadata: SerializedProjectFileMetadata,
): Project {
  const runtimePathFiles = validateCanonicalProjectFileSet(files, metadata);
  const config = mergeRuntimeAndEditorConfig(
    runtimeConfig,
    metadata.editor_config,
  );
  const paths = metadata.paths.map((path) => {
    const runtimePath = deserializePath(
      parseJson(requiredText(runtimePathFiles, path.file_name.toLowerCase())),
      projectConfigDefaultLookup(config),
    );
    assertRangedMetadataTargetsAreDistinct(
      path.path_id,
      runtimePath,
      path.editor_metadata,
    );
    const model = applyPathEditorMetadata(runtimePath, path.editor_metadata);
    assertPathEditorMetadataIsLossless(
      path.path_id,
      model,
      path.editor_metadata,
    );
    return {
      path_id: path.path_id,
      display_name: path.display_name,
      file_name: path.file_name,
      path: model,
    };
  });
  const project = syncLinkedTargetElementsInProject(
    createProject({
      project_id: metadata.project_id,
      display_name: metadata.display_name,
      config,
      paths,
      path_groups: metadata.path_groups,
      linked_targets: metadata.linked_targets,
    }),
  );

  for (const [pathIndex, pathMetadata] of metadata.paths.entries()) {
    const pathElements = project.paths[pathIndex]?.path.path_elements ?? [];
    for (const link of pathMetadata.editor_metadata?.linked_targets ?? []) {
      const element = pathElements[link.element_index];
      const target = project.linked_targets.find(
        (candidate) => candidate.target_id === link.target_id,
      );
      if (!element) {
        throw new Error(
          `Path ${pathMetadata.path_id} links missing element ${link.element_index}`,
        );
      }
      if (!target || !isElementCompatibleWithLinkedTarget(element, target)) {
        throw new Error(
          `Path ${pathMetadata.path_id} has an incompatible linked target ${link.target_id}`,
        );
      }
    }
  }

  return project;
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

  const config = createProjectConfig(runtimeConfig);
  return createProject({
    project_id: options.fallbackProjectId ?? createWorkspaceId(),
    display_name: options.fallbackDisplayName ?? "Imported Project",
    config,
    paths: pathFiles.map(([relativePath, text], index) => {
      const fileName = ensureJsonFileName(relativePath.slice("paths/".length));
      return {
        path_id: options.fallbackPathId?.(fileName, index) ?? createPathId(),
        display_name: displayNameFromFileName(fileName),
        file_name: fileName,
        path: deserializePath(
          parseJson(text),
          projectConfigDefaultLookup(config),
        ),
      };
    }),
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
  if (!isProjectFileMetadata(input)) {
    throw new Error("Invalid project.json document or fields");
  }
  return input as unknown as SerializedProjectFileMetadata;
}

function isProjectFileMetadata(input: unknown): boolean {
  return (
    hasExactKeys(input, [
      "schema_version",
      "project_id",
      "display_name",
      "editor_config",
      "paths",
      "path_groups",
      "linked_targets",
    ]) &&
    input.schema_version === projectFilesSchemaVersion &&
    isNonEmptyString(input.project_id) &&
    isNonEmptyString(input.display_name) &&
    isEditorConfig(input.editor_config) &&
    Array.isArray(input.paths) &&
    input.paths.every(isProjectFilePath) &&
    Array.isArray(input.path_groups) &&
    input.path_groups.every(isPathGroup) &&
    Array.isArray(input.linked_targets) &&
    input.linked_targets.every(isLinkedTarget)
  );
}

function isEditorConfig(input: unknown): boolean {
  if (!hasExactKeys(input, ["gui", "kinematic_constraints"])) return false;
  const { gui, kinematic_constraints: constraints } = input;
  const constraintKeys = [
    "default_auto_velocity_velocity_safety_factor",
    "default_auto_velocity_acceleration_safety_factor",
    "default_auto_velocity_merge_tolerance_meters_per_sec",
  ] as const;
  return (
    hasExactKeys(gui, ["robot", "protrusions"]) &&
    hasExactKeys(gui.robot, ["length_meters", "width_meters"]) &&
    isNonNegativeNumber(gui.robot.length_meters) &&
    isNonNegativeNumber(gui.robot.width_meters) &&
    hasExactKeys(gui.protrusions, [
      "enabled",
      "distance_meters",
      "side",
      "default_state",
      "show_on_event_keys",
      "hide_on_event_keys",
    ]) &&
    typeof gui.protrusions.enabled === "boolean" &&
    isNonNegativeNumber(gui.protrusions.distance_meters) &&
    isOneOf(gui.protrusions.side, ["none", "left", "right", "front", "back"]) &&
    isOneOf(gui.protrusions.default_state, ["", "shown", "hidden"]) &&
    isStringList(gui.protrusions.show_on_event_keys) &&
    isStringList(gui.protrusions.hide_on_event_keys) &&
    hasExactKeys(constraints, constraintKeys) &&
    constraintKeys.every((key) => isNonNegativeNumber(constraints[key]))
  );
}

function isProjectFilePath(input: unknown): boolean {
  if (
    !isObject(input) ||
    !hasExactKeys(
      input,
      input.editor_metadata === undefined
        ? ["path_id", "display_name", "file_name"]
        : ["path_id", "display_name", "file_name", "editor_metadata"],
    ) ||
    !isNonEmptyString(input.path_id) ||
    !isNonEmptyString(input.display_name) ||
    !isNonEmptyString(input.file_name) ||
    input.file_name !== ensureJsonFileName(input.file_name)
  ) {
    return false;
  }
  return (
    input.editor_metadata === undefined ||
    isPathEditorMetadata(input.editor_metadata)
  );
}

function isPathEditorMetadata(input: unknown): boolean {
  if (!isObject(input)) return false;
  const allowed = [
    "ranged_constraints",
    "linked_targets",
    "handoff_radius_sources",
  ] as const;
  const present = allowed.filter((key) => input[key] !== undefined);
  if (present.length === 0 || !hasExactKeys(input, present)) return false;
  return (
    (input.ranged_constraints === undefined ||
      (Array.isArray(input.ranged_constraints) &&
        input.ranged_constraints.length > 0 &&
        input.ranged_constraints.every(isRangedConstraintMetadata))) &&
    (input.linked_targets === undefined ||
      (Array.isArray(input.linked_targets) &&
        input.linked_targets.length > 0 &&
        input.linked_targets.every(
          (link) =>
            hasExactKeys(link, ["element_index", "target_id"]) &&
            Number.isInteger(link.element_index) &&
            (link.element_index as number) >= 0 &&
            isNonEmptyString(link.target_id),
        ))) &&
    (input.handoff_radius_sources === undefined ||
      (Array.isArray(input.handoff_radius_sources) &&
        input.handoff_radius_sources.length > 0 &&
        input.handoff_radius_sources.every(
          (source) =>
            hasExactKeys(source, ["element_index", "source"]) &&
            Number.isInteger(source.element_index) &&
            (source.element_index as number) >= 0 &&
            isOneOf(source.source, ["manual", "auto"]),
        )))
  );
}

function isRangedConstraintMetadata(input: unknown): boolean {
  if (!isObject(input)) return false;
  const keys = ["key", "value", "start_ordinal", "end_ordinal", "source"];
  if (input.auto_velocity !== undefined) keys.push("auto_velocity");
  return (
    hasExactKeys(input, keys) &&
    isOneOf(input.key, [
      "max_velocity_meters_per_sec",
      "min_velocity_meters_per_sec",
      "max_acceleration_meters_per_sec2",
      "max_velocity_deg_per_sec",
      "min_velocity_deg_per_sec",
      "max_acceleration_deg_per_sec2",
    ]) &&
    isFiniteNumber(input.value) &&
    Number.isInteger(input.start_ordinal) &&
    Number.isInteger(input.end_ordinal) &&
    (input.start_ordinal as number) >= 0 &&
    (input.end_ordinal as number) >= 0 &&
    input.source === "auto_velocity" &&
    (input.auto_velocity === undefined ||
      isAutoVelocityMetadata(input.auto_velocity))
  );
}

function assertRangedMetadataTargetsAreDistinct(
  pathId: string,
  path: PathModel,
  metadata: SerializedPathEditorMetadata | undefined,
): void {
  const used = new Set<number>();
  for (const entry of metadata?.ranged_constraints ?? []) {
    if (!isRangedConstraintKey(entry.key)) {
      throw new Error(
        `Path ${pathId} has unsupported ranged metadata key ${entry.key}`,
      );
    }
    const matches = path.ranged_constraints.flatMap((constraint, index) =>
      !used.has(index) &&
      constraint.key === entry.key &&
      constraint.start_ordinal === entry.start_ordinal &&
      constraint.end_ordinal === entry.end_ordinal &&
      Math.abs(constraint.value - entry.value) < 1e-9
        ? [index]
        : [],
    );
    if (matches.length !== 1) {
      throw new Error(
        `Path ${pathId} ranged metadata does not identify one distinct runtime constraint`,
      );
    }
    used.add(matches[0]);
  }
}

function assertPathEditorMetadataIsLossless(
  pathId: string,
  path: PathModel,
  expected: SerializedPathEditorMetadata | undefined,
): void {
  const actual = serializePathEditorMetadata(path);
  if (!sameJsonValue(actual, expected)) {
    throw new Error(
      `Path ${pathId} editor metadata cannot be applied without loss`,
    );
  }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]))
    );
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && sameJsonValue(left[key], right[key]),
    )
  );
}

function isAutoVelocityMetadata(input: unknown): boolean {
  if (!isObject(input)) return false;
  const keys = ["velocity_safety_factor", "acceleration_safety_factor"];
  if (input.merge_tolerance_meters_per_sec !== undefined) {
    keys.push("merge_tolerance_meters_per_sec");
  }
  if (input.input_signature !== undefined) keys.push("input_signature");
  return (
    hasExactKeys(input, keys) &&
    isFiniteNumber(input.velocity_safety_factor) &&
    isFiniteNumber(input.acceleration_safety_factor) &&
    (input.merge_tolerance_meters_per_sec === undefined ||
      isFiniteNumber(input.merge_tolerance_meters_per_sec)) &&
    (input.input_signature === undefined ||
      typeof input.input_signature === "string")
  );
}

function isPathGroup(input: unknown): boolean {
  return (
    hasExactKeys(input, ["group_id", "display_name", "path_ids"]) &&
    isNonEmptyString(input.group_id) &&
    isNonEmptyString(input.display_name) &&
    isStringList(input.path_ids)
  );
}

function isLinkedTarget(input: unknown): boolean {
  if (!isObject(input) || !isOneOf(input.kind, ["translation", "waypoint"])) {
    return false;
  }
  const expectedKeys =
    input.kind === "waypoint"
      ? [
          "target_id",
          "display_name",
          "kind",
          "x_meters",
          "y_meters",
          "rotation_radians",
          "locked",
        ]
      : ["target_id", "display_name", "kind", "x_meters", "y_meters", "locked"];
  return (
    hasExactKeys(
      input,
      input.locked === undefined
        ? expectedKeys.filter((key) => key !== "locked")
        : expectedKeys,
    ) &&
    isNonEmptyString(input.target_id) &&
    isNonEmptyString(input.display_name) &&
    isFiniteNumber(input.x_meters) &&
    isFiniteNumber(input.y_meters) &&
    (input.kind !== "waypoint" || isFiniteNumber(input.rotation_radians)) &&
    (input.locked === undefined || input.locked === true)
  );
}

function validateCanonicalProjectFileSet(
  files: readonly ProjectTextFile[],
  metadata: SerializedProjectFileMetadata,
): ReadonlyMap<string, string> {
  assertUniqueCaseInsensitive(
    metadata.paths.map((path) => path.path_id),
    "path ID",
  );
  assertUniqueCaseInsensitive(
    metadata.paths.map((path) => path.file_name),
    "path file name",
  );
  assertUniqueCaseInsensitive(
    metadata.path_groups.map((group) => group.group_id),
    "path group ID",
  );
  assertUniqueCaseInsensitive(
    metadata.linked_targets.map((target) => target.target_id),
    "linked target ID",
  );

  const pathIds = new Set(metadata.paths.map((path) => path.path_id));
  const targetIds = new Set(
    metadata.linked_targets.map((target) => target.target_id),
  );
  for (const group of metadata.path_groups) {
    assertUniqueCaseInsensitive(
      group.path_ids,
      `path reference in ${group.group_id}`,
    );
    for (const pathId of group.path_ids) {
      if (!pathIds.has(pathId)) {
        throw new Error(
          `Path group ${group.group_id} references missing path ${pathId}`,
        );
      }
    }
  }
  for (const path of metadata.paths) {
    const linkedElements = path.editor_metadata?.linked_targets ?? [];
    assertUniqueCaseInsensitive(
      linkedElements.map((link) => String(link.element_index)),
      `linked element in ${path.path_id}`,
    );
    for (const link of linkedElements) {
      if (!targetIds.has(link.target_id)) {
        throw new Error(
          `Path ${path.path_id} references missing linked target ${link.target_id}`,
        );
      }
    }
    assertUniqueCaseInsensitive(
      (path.editor_metadata?.handoff_radius_sources ?? []).map((entry) =>
        String(entry.element_index),
      ),
      `handoff source element in ${path.path_id}`,
    );
  }

  const runtimeEntries = files
    .map(
      (file) => [normalizeRelativePath(file.relativePath), file.text] as const,
    )
    .filter(([relativePath]) => /^paths\/[^/]+\.json$/i.test(relativePath));
  const runtimeFiles = new Map<string, string>();
  for (const [relativePath, text] of runtimeEntries) {
    const fileName = relativePath.slice(relativePath.indexOf("/") + 1);
    const key = fileName.toLowerCase();
    runtimeFiles.set(key, text);
  }

  const expected = new Set(
    metadata.paths.map((path) => path.file_name.toLowerCase()),
  );
  for (const path of metadata.paths) {
    if (!runtimeFiles.has(path.file_name.toLowerCase())) {
      throw new Error(
        `The Project file set is missing paths/${path.file_name}`,
      );
    }
  }
  for (const key of runtimeFiles.keys()) {
    if (!expected.has(key)) {
      throw new Error(
        `Runtime path file paths/${key} is not listed in project.json`,
      );
    }
  }
  return runtimeFiles;
}

function hasExactKeys(
  input: unknown,
  allowedKeys: readonly string[],
): input is Record<string, unknown> {
  if (!isObject(input)) return false;
  const actual = Object.keys(input).sort();
  const expected = [...allowedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isNonEmptyString(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0;
}

function isFiniteNumber(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input);
}

function isNonNegativeNumber(input: unknown): input is number {
  return isFiniteNumber(input) && input >= 0;
}

function isStringList(input: unknown): input is string[] {
  return (
    Array.isArray(input) &&
    input.every((value) => isNonEmptyString(value) && value === value.trim()) &&
    new Set(input).size === input.length
  );
}

function isOneOf(input: unknown, values: readonly string[]): input is string {
  return typeof input === "string" && values.includes(input);
}

function assertUniqueCaseInsensitive(
  values: readonly string[],
  label: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate or case-colliding ${label}: ${value}`);
    }
    seen.add(key);
  }
}

function assertUniqueManagedProjectFilePaths(
  files: readonly ProjectTextFile[],
): void {
  const seen = new Set<string>();
  for (const file of files) {
    const relativePath = normalizeRelativePath(file.relativePath);
    const key = relativePath.toLowerCase();
    const managed =
      key === "config.json" ||
      key === "project.json" ||
      /^paths\/[^/]+\.json$/.test(key);
    if (!managed) continue;
    if (seen.has(key)) {
      throw new Error(
        `Duplicate or case-colliding managed Project file ${relativePath}`,
      );
    }
    seen.add(key);
  }
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

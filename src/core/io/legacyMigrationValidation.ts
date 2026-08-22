import { createProjectConfig } from "../config/projectConfig";
import { constraintKeys, isRangedConstraintKey } from "../model/path";
import { projectSchemaVersion } from "./projectSchema";

type JsonRecord = Record<string, unknown>;

/** Validates the older one-Path browser record before replacing its key. */
export function assertLegacyProjectDocument(input: unknown): void {
  const project = object(input, "Project document");
  exactKeys(
    project,
    [
      "schema_version",
      "project_id",
      "display_name",
      "path_file_name",
      "path",
      "config",
    ],
    "Project document",
  );
  schema(project.schema_version, "Project document");
  nonempty(project.project_id, "Project identity");
  nonempty(project.display_name, "Project display name");
  if (project.path_file_name !== null) {
    jsonFile(project.path_file_name, "Project Path file name");
  }
  losslessConfig(project.config, "Project config");
  path(project.path, String(project.project_id));
}

/** Strict validation used only before legacy source data can be deleted. */
export function assertLegacyProjectWorkspaceDocument(
  input: unknown,
): asserts input is JsonRecord & { paths: unknown[] } {
  const workspace = object(input, "Project workspace");
  exactKeys(
    workspace,
    [
      "schema_version",
      "project_id",
      "display_name",
      "config",
      "paths",
      "active_path_id",
      "path_groups",
      "pathgroups",
      "pathGroups",
      "active_path_group_id",
      "linked_targets",
    ],
    "Project workspace",
  );
  schema(workspace.schema_version, "Project workspace");
  nonempty(workspace.project_id, "Project identity");
  nonempty(workspace.display_name, "Project display name");
  losslessConfig(workspace.config, "Project config");

  const ids = new Set<string>();
  const files = new Set<string>();
  const paths = list(workspace.paths, "Project paths").map((value, index) => {
    const entry = object(value, `Project Path ${index + 1}`);
    exactKeys(
      entry,
      [
        "path_id",
        "display_name",
        "file_name",
        "path_file_name",
        "path",
        "editor_metadata",
      ],
      `Project Path ${index + 1}`,
    );
    const id = nonempty(entry.path_id, `Project Path ${index + 1} identity`);
    nonempty(entry.display_name, `Project Path ${id} display name`);
    const file = jsonFile(
      entry.file_name ?? entry.path_file_name,
      `Project Path ${id} file name`,
    );
    unique(ids, id, "Project Path identity");
    unique(files, file.toLowerCase(), "Project Path file name");
    return { entry, id, elements: path(entry.path, id) };
  });
  reference(workspace.active_path_id, ids, "active Path");

  const targets = linkedTargets(workspace.linked_targets);
  for (const entry of paths) {
    editorMetadata(
      entry.entry.editor_metadata,
      entry.id,
      entry.elements,
      targets,
    );
  }
  const groupSources = [
    workspace.path_groups,
    workspace.pathgroups,
    workspace.pathGroups,
  ].filter((value) => value !== undefined);
  if (groupSources.length > 1) {
    throw new Error("Legacy Project workspace has multiple Path Group fields");
  }
  const groupIds = pathGroups(groupSources[0], ids, files);
  reference(workspace.active_path_group_id, groupIds, "active Path Group");
}

export interface LegacyAutosSidecars {
  editorState?: unknown;
  pathGroups?: unknown;
  pathMetadata?: unknown;
  pathFileNames: readonly string[];
}

/** Validates sidecar fields that forgiving desktop decoding would otherwise drop. */
export function assertLegacyAutosSidecars({
  editorState,
  pathGroups: groupFileInput,
  pathMetadata,
  pathFileNames,
}: LegacyAutosSidecars): void {
  const files = new Set(pathFileNames.map(normalizedJsonName));
  if (editorState !== undefined) {
    const state = object(editorState, "editor state");
    exactKeys(
      state,
      [
        "schema_version",
        "editor_config",
        "active_path_file_name",
        "active_path_group_id",
        "path_groups",
        "linked_targets",
        "paths",
        "field_assets",
      ],
      "editor state",
    );
    schema(state.schema_version, "editor state");
    losslessConfig(state.editor_config, "editor_config");
    optionalReferenceFile(state.active_path_file_name, files, "active Path");
    const targets = linkedTargets(state.linked_targets);
    metadataMap(state.paths, files, targets, "editor state");
    const groups = pathGroups(state.path_groups, new Set(), files);
    reference(state.active_path_group_id, groups, "active Path Group");
    fieldAssets(state.field_assets);
  }
  if (groupFileInput !== undefined) {
    const groupFile = object(groupFileInput, "Path Groups file");
    exactKeys(groupFile, ["schema_version", "groups"], "Path Groups file");
    schema(groupFile.schema_version, "Path Groups file");
    pathGroups(groupFile.groups, new Set(), files);
  }
  if (pathMetadata !== undefined) {
    const metadata = object(pathMetadata, "Path metadata");
    exactKeys(metadata, ["paths"], "Path metadata");
    metadataMap(metadata.paths, files, undefined, "Path metadata", true);
  }
}

function metadataMap(
  input: unknown,
  files: ReadonlySet<string>,
  targets: ReadonlySet<string> | undefined,
  label: string,
  required = false,
): void {
  if (input === undefined && !required) return;
  const paths = object(input, `${label} paths metadata`);
  for (const [name, value] of Object.entries(paths)) {
    jsonFile(name, `${label} Path file name`);
    knownFile(name, files, label);
    const entry = object(value, `${label} for ${name}`);
    exactKeys(
      entry,
      ["display_name", "editor_metadata"],
      `${label} for ${name}`,
    );
    if (entry.display_name !== undefined) {
      nonempty(entry.display_name, `${label} display name for ${name}`);
    }
    if (required && entry.editor_metadata === undefined) {
      throw new Error(`Legacy ${label} for ${name} has no editor metadata`);
    }
    editorMetadata(entry.editor_metadata, name, Infinity, targets);
  }
}

function fieldAssets(input: unknown): void {
  if (input === undefined) return;
  for (const [id, value] of Object.entries(
    object(input, "field_assets metadata"),
  )) {
    nonempty(id, "Field Background identity");
    const asset = object(value, `Field Background ${id}`);
    exactKeys(asset, ["file_name", "mime_type"], `Field Background ${id}`);
    fileName(asset.file_name, `Field Background ${id} file name`);
    nonempty(asset.mime_type, `Field Background ${id} MIME type`);
  }
}

function path(input: unknown, pathId: string): number {
  const document = Array.isArray(input)
    ? null
    : object(input, `Project Path ${pathId}`);
  if (document) {
    exactKeys(
      document,
      ["path_elements", "constraints", "ranged_constraints"],
      `Project Path ${pathId}`,
    );
    if (
      document.ranged_constraints !== undefined &&
      (!Array.isArray(document.ranged_constraints) ||
        document.ranged_constraints.some(
          (entry) => !isObject(entry) || !rangedConstraint(entry),
        ))
    ) {
      throw new Error(
        `Legacy Project Path ${pathId} ranged constraints are malformed`,
      );
    }
  }
  const elements = Array.isArray(input) ? input : document?.path_elements;
  if (
    !Array.isArray(elements) ||
    elements.some((entry) => !pathElement(entry))
  ) {
    throw new Error(
      `Legacy Project Path ${pathId} contains a malformed path entry`,
    );
  }
  if (document?.constraints !== undefined) {
    constraints(
      object(document.constraints, `Project Path ${pathId} constraints`),
      pathId,
    );
  }
  return elements.length;
}

function pathElement(input: unknown): boolean {
  if (!isObject(input)) return false;
  if (input.type === "translation") {
    return (
      hasKeys(input, [
        "type",
        "x_meters",
        "y_meters",
        "intermediate_handoff_radius_meters",
        "handoff_radius_source",
      ]) &&
      finite(input.x_meters) &&
      finite(input.y_meters) &&
      optionalNullableFinite(input.intermediate_handoff_radius_meters) &&
      (input.handoff_radius_source === undefined ||
        input.handoff_radius_source === "auto")
    );
  }
  if (input.type === "rotation") {
    return rotation(input);
  }
  if (input.type === "event_trigger") {
    return (
      hasKeys(input, ["type", "t_ratio", "lib_key"]) &&
      optionalFinite(input.t_ratio) &&
      typeof input.lib_key === "string"
    );
  }
  if (
    input.type !== "waypoint" ||
    !hasKeys(input, ["type", "translation_target", "rotation_target"])
  )
    return false;
  const translation = input.translation_target;
  const rotationTarget = input.rotation_target;
  return (
    isObject(translation) &&
    hasKeys(translation, [
      "x_meters",
      "y_meters",
      "intermediate_handoff_radius_meters",
      "handoff_radius_source",
    ]) &&
    finite(translation.x_meters) &&
    finite(translation.y_meters) &&
    optionalNullableFinite(translation.intermediate_handoff_radius_meters) &&
    (translation.handoff_radius_source === undefined ||
      translation.handoff_radius_source === "auto") &&
    isObject(rotationTarget) &&
    rotation(rotationTarget, false)
  );
}

function rotation(input: JsonRecord, includeType = true): boolean {
  const allowed = [
    "rotation_radians",
    "t_ratio",
    "profiled_rotation",
    "x_meters",
    "y_meters",
  ];
  if (includeType) allowed.push("type");
  const positioned =
    input.x_meters !== undefined || input.y_meters !== undefined;
  return (
    hasKeys(input, allowed) &&
    finite(input.rotation_radians) &&
    optionalFinite(input.t_ratio) &&
    (input.profiled_rotation === undefined ||
      typeof input.profiled_rotation === "boolean") &&
    (!positioned || (finite(input.x_meters) && finite(input.y_meters)))
  );
}

function constraints(input: JsonRecord, pathId: string): void {
  for (const [rawKey, value] of Object.entries(input)) {
    const key = rawKey.replace(/^default_/, "");
    if (!(constraintKeys as readonly string[]).includes(key)) {
      throw new Error(
        `Legacy Project Path ${pathId} has unsupported constraint ${rawKey}`,
      );
    }
    const valid = Array.isArray(value)
      ? isRangedConstraintKey(key) &&
        value.every(
          (entry) =>
            isObject(entry) &&
            hasKeys(entry, [
              "value",
              "start_ordinal",
              "end_ordinal",
              "source",
            ]) &&
            finite(entry.value) &&
            ordinal(entry.start_ordinal) &&
            ordinal(entry.end_ordinal) &&
            (entry.source === undefined ||
              entry.source === "manual" ||
              entry.source === "auto_velocity"),
        )
      : value === null || finite(value);
    if (!valid)
      throw new Error(
        `Legacy Project Path ${pathId} constraint ${rawKey} is malformed`,
      );
  }
}

function editorMetadata(
  input: unknown,
  pathId: string,
  elementCount = Infinity,
  targets?: ReadonlySet<string>,
): void {
  if (input === undefined) return;
  const metadata = object(input, `Project Path ${pathId} editor metadata`);
  exactKeys(
    metadata,
    ["linked_targets", "handoff_radius_sources", "ranged_constraints"],
    `Project Path ${pathId} editor metadata`,
  );
  metadataEntries(
    metadata.linked_targets,
    pathId,
    "linked_targets",
    (entry) =>
      hasKeys(entry, ["element_index", "target_id"]) &&
      ordinal(entry.element_index, elementCount) &&
      isNonempty(entry.target_id) &&
      (targets === undefined || targets.has(entry.target_id)),
  );
  metadataEntries(
    metadata.handoff_radius_sources,
    pathId,
    "handoff_radius_sources",
    (entry) =>
      hasKeys(entry, ["element_index", "source"]) &&
      ordinal(entry.element_index, elementCount) &&
      (entry.source === "manual" || entry.source === "auto"),
  );
  metadataEntries(
    metadata.ranged_constraints,
    pathId,
    "ranged_constraints",
    rangedMetadata,
  );
}

function rangedMetadata(entry: JsonRecord): boolean {
  const auto = entry.auto_velocity;
  return (
    hasKeys(entry, [
      "key",
      "value",
      "start_ordinal",
      "end_ordinal",
      "source",
      "auto_velocity",
    ]) &&
    isRangedConstraintKey(String(entry.key ?? "")) &&
    finite(entry.value) &&
    ordinal(entry.start_ordinal) &&
    ordinal(entry.end_ordinal) &&
    (entry.source === "manual" || entry.source === "auto_velocity") &&
    (auto === undefined ||
      auto === null ||
      (isObject(auto) && autoMetadata(auto)))
  );
}

function rangedConstraint(entry: JsonRecord): boolean {
  return (
    hasKeys(entry, [
      "key",
      "value",
      "start_ordinal",
      "end_ordinal",
      "source",
      "auto_velocity",
    ]) &&
    isRangedConstraintKey(String(entry.key ?? "")) &&
    finite(entry.value) &&
    ordinal(entry.start_ordinal) &&
    ordinal(entry.end_ordinal) &&
    (entry.source === undefined ||
      entry.source === "manual" ||
      entry.source === "auto_velocity") &&
    (entry.auto_velocity === undefined ||
      entry.auto_velocity === null ||
      (isObject(entry.auto_velocity) && autoMetadata(entry.auto_velocity)))
  );
}

function autoMetadata(auto: JsonRecord): boolean {
  return (
    hasKeys(auto, [
      "velocity_safety_factor",
      "acceleration_safety_factor",
      "merge_tolerance_meters_per_sec",
      "input_signature",
    ]) &&
    finite(auto.velocity_safety_factor) &&
    finite(auto.acceleration_safety_factor) &&
    optionalFinite(auto.merge_tolerance_meters_per_sec) &&
    (auto.input_signature === undefined ||
      typeof auto.input_signature === "string")
  );
}

function metadataEntries(
  input: unknown,
  pathId: string,
  key: string,
  valid: (entry: JsonRecord) => boolean,
): void {
  if (input === undefined) return;
  if (
    !Array.isArray(input) ||
    input.some((entry) => !isObject(entry) || !valid(entry))
  ) {
    throw new Error(
      `Legacy Project Path ${pathId} editor metadata.${key} is malformed`,
    );
  }
}

function linkedTargets(input: unknown): Set<string> {
  if (input === undefined) return new Set();
  const ids = new Set<string>();
  list(input, "linked_targets metadata").forEach((value, index) => {
    const target = object(value, `linked target ${index + 1}`);
    exactKeys(
      target,
      [
        "target_id",
        "display_name",
        "kind",
        "x_meters",
        "y_meters",
        "rotation_radians",
        "locked",
      ],
      `linked target ${index + 1}`,
    );
    const id = nonempty(
      target.target_id,
      `linked target ${index + 1} identity`,
    );
    unique(ids, id, "linked target identity");
    const waypoint = target.kind === "waypoint" || target.kind === "pose";
    const kind =
      target.kind === "translation" || target.kind === "point" || waypoint;
    if (
      !kind ||
      typeof target.display_name !== "string" ||
      !finite(target.x_meters) ||
      !finite(target.y_meters) ||
      (waypoint && !finite(target.rotation_radians)) ||
      (!waypoint && target.rotation_radians !== undefined) ||
      (target.locked !== undefined && typeof target.locked !== "boolean")
    ) {
      throw new Error(`Legacy linked target ${id} is malformed`);
    }
  });
  return ids;
}

function pathGroups(
  input: unknown,
  ids: ReadonlySet<string>,
  files: ReadonlySet<string>,
): Set<string> {
  if (input === undefined) return new Set();
  const values = Array.isArray(input)
    ? input
    : list(
        object(input, "Path Groups metadata").groups,
        "Path Groups metadata",
      );
  const groupIds = new Set<string>();
  values.forEach((value, index) => {
    const group = object(value, `Path Group ${index + 1}`);
    exactKeys(
      group,
      [
        "group_id",
        "id",
        "display_name",
        "name",
        "path_ids",
        "path_file_names",
        "path_files",
        "paths",
      ],
      `Path Group ${index + 1}`,
    );
    const id = nonempty(
      group.group_id ?? group.id,
      `Path Group ${index + 1} identity`,
    );
    unique(groupIds, id, "Path Group identity");
    if (group.display_name !== undefined || group.name !== undefined)
      nonempty(
        group.display_name ?? group.name,
        `Path Group ${id} display name`,
      );
    const sources = [
      group.path_ids,
      group.path_file_names,
      group.path_files,
      group.paths,
    ].filter((entry) => entry !== undefined);
    if (sources.length !== 1)
      throw new Error(`Legacy Path Group ${id} must have one Path list`);
    for (const value of list(sources[0], `Path Group ${id} references`)) {
      const ref = nonempty(value, `Path Group ${id} Path reference`);
      if (!ids.has(ref) && !files.has(normalizedJsonName(ref))) {
        throw new Error(
          `Legacy Path Group ${id} references missing Path ${ref}`,
        );
      }
    }
  });
  return groupIds;
}

function losslessConfig(input: unknown, label: string): void {
  if (input === undefined) return;
  const config = object(input, label);
  if (!jsonSubset(config, createProjectConfig(config))) {
    throw new Error(`Legacy ${label} contains unsupported or malformed data`);
  }
}

function jsonSubset(input: unknown, normalized: unknown): boolean {
  if (Object.is(input, normalized)) return true;
  if (Array.isArray(input) || Array.isArray(normalized)) {
    return (
      Array.isArray(input) &&
      Array.isArray(normalized) &&
      input.length === normalized.length &&
      input.every((value, index) => jsonSubset(value, normalized[index]))
    );
  }
  if (!isObject(input) || !isObject(normalized)) return false;
  return Object.entries(input).every(
    ([key, value]) => key in normalized && jsonSubset(value, normalized[key]),
  );
}

function schema(value: unknown, label: string): void {
  if (value !== undefined && value !== projectSchemaVersion) {
    throw new Error(
      `Unsupported legacy ${label} schema version: ${String(value)}`,
    );
  }
}

function object(value: unknown, label: string): JsonRecord {
  if (!isObject(value)) throw new Error(`Legacy ${label} must be an object`);
  return value;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value))
    throw new Error(`Legacy ${label} must be an array`);
  return value;
}

function exactKeys(
  input: JsonRecord,
  allowed: readonly string[],
  label: string,
): void {
  const unsupported = Object.keys(input).find((key) => !allowed.includes(key));
  if (unsupported)
    throw new Error(`Legacy ${label} has unsupported field ${unsupported}`);
}

function hasKeys(input: JsonRecord, allowed: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}

function nonempty(value: unknown, label: string): string {
  if (!isNonempty(value))
    throw new Error(`Legacy ${label} must be a non-empty string`);
  return value.trim();
}

function fileName(value: unknown, label: string): string {
  const name = nonempty(value, label);
  if (name.includes("/") || name.includes("\\"))
    throw new Error(`Legacy ${label} must be a valid file name`);
  return name;
}

function jsonFile(value: unknown, label: string): string {
  const name = fileName(value, label);
  if (!/\.json$/i.test(name))
    throw new Error(`Legacy ${label} must be a JSON file name`);
  return name;
}

function knownFile(
  value: string,
  files: ReadonlySet<string>,
  label: string,
): void {
  if (!files.has(normalizedJsonName(value)))
    throw new Error(`Legacy ${label} references missing Path file ${value}`);
}

function optionalReferenceFile(
  value: unknown,
  files: ReadonlySet<string>,
  label: string,
): void {
  if (value === undefined || value === null) return;
  knownFile(nonempty(value, `${label} file reference`), files, label);
}

function reference(
  value: unknown,
  ids: ReadonlySet<string>,
  label: string,
): void {
  if (
    value !== undefined &&
    value !== null &&
    (!isNonempty(value) || !ids.has(value))
  ) {
    throw new Error(`Legacy ${label} reference is invalid: ${String(value)}`);
  }
}

function unique(values: Set<string>, value: string, label: string): void {
  if (values.has(value)) throw new Error(`Duplicate legacy ${label}: ${value}`);
  values.add(value);
}

function normalizedJsonName(value: string): string {
  return `${value.replace(/\.json$/i, "")}.json`.toLowerCase();
}

function isNonempty(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalFinite(value: unknown): boolean {
  return value === undefined || finite(value);
}

function optionalNullableFinite(value: unknown): boolean {
  return value === undefined || value === null || finite(value);
}

function ordinal(value: unknown, limit = Infinity): boolean {
  return (
    finite(value) && Number.isInteger(value) && value >= 0 && value < limit
  );
}

function isObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

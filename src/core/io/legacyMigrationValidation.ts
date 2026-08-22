import type { Project } from "../model/project";
import type {
  ProjectDocument,
  ProjectWorkspaceDocument,
  SerializedProjectDocument,
  SerializedProjectWorkspaceDocument,
} from "./projectSchema";
import { deserializeProjectFiles, serializeProjectFiles } from "./projectFiles";
import {
  deserializeProjectDocument,
  serializeProjectDocument,
} from "./projectSerde";
import {
  deserializeProjectWorkspaceDocument,
  serializeProjectWorkspaceDocument,
} from "./workspaceSerde";

export interface LegacyProjectDocumentInspection {
  project: ProjectDocument;
  projection: SerializedProjectDocument;
}

export interface LegacyProjectWorkspaceInspection {
  project: ProjectWorkspaceDocument;
  projection: SerializedProjectWorkspaceDocument;
}

/** Decode an old one-Path record and prove the former writer represents it. */
export function inspectLegacyProjectDocument(
  input: unknown,
): LegacyProjectDocumentInspection {
  const project = deserializeProjectDocument(input);
  const projection = serializeProjectDocument(project);
  assertJsonRepresented(input, projection, "Project document");
  assertCanonicalProjectRoundTrip(
    deserializeProjectWorkspaceDocument(projection),
  );
  return { project, projection };
}

/** Browser migration compatibility wrapper. */
export function assertLegacyProjectDocument(input: unknown): void {
  inspectLegacyProjectDocument(input);
}

/** Decode a combined workspace and prove the genuine former writer represents it. */
export function inspectLegacyProjectWorkspaceDocument(
  input: unknown,
): LegacyProjectWorkspaceInspection {
  const project = deserializeProjectWorkspaceDocument(input);
  const projection = serializeProjectWorkspaceDocument(project);
  assertJsonRepresented(
    normalizeLegacyLinkedTargetKinds(input),
    projection,
    "Project workspace",
  );
  assertCanonicalProjectRoundTrip(project);
  return { project, projection };
}

/** Browser and folder migration compatibility wrapper. */
export function assertLegacyProjectWorkspaceDocument(
  input: unknown,
): asserts input is Record<string, unknown> & { paths: unknown[] } {
  inspectLegacyProjectWorkspaceDocument(input);
}

/**
 * Prove that a decoder/writer projection represents every JSON detail in its
 * source. Objects may gain decoder defaults, but every source field must remain
 * equal. Arrays preserve order and multiplicity.
 */
export function assertJsonRepresented(
  source: unknown,
  projection: unknown,
  label: string,
): void {
  const mismatch = findJsonMismatch(toJson(source), toJson(projection), "$");
  if (mismatch) {
    throw new Error(
      `Legacy ${label} is not losslessly represented: ${mismatch}`,
    );
  }
}

/** Prove canonical Project files survive decode and reserialization unchanged. */
export function assertCanonicalProjectRoundTrip(project: Project): void {
  const files = serializeProjectFiles(project);
  const restored = deserializeProjectFiles(files);
  assertJsonRepresented(
    projectFileJson(files),
    projectFileJson(serializeProjectFiles(restored)),
    "canonical Project files",
  );
}

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };

function toJson(input: unknown): JsonValue {
  const text = JSON.stringify(input);
  if (text === undefined) {
    throw new Error("Legacy migration data is not JSON serializable");
  }
  return JSON.parse(text) as JsonValue;
}

function projectFileJson(
  files: ReturnType<typeof serializeProjectFiles>,
): Array<{ relativePath: string; json: unknown }> {
  return files.map((file) => ({
    relativePath: file.relativePath,
    json: JSON.parse(file.text) as unknown,
  }));
}

export function normalizeLegacyLinkedTargetKinds(input: unknown): unknown {
  if (!isUnknownObject(input) || !Array.isArray(input.linked_targets)) {
    return input;
  }

  return {
    ...input,
    linked_targets: input.linked_targets.map((target) => {
      if (!isUnknownObject(target)) return target;
      if (target.kind === "point") return { ...target, kind: "translation" };
      if (target.kind === "pose") return { ...target, kind: "waypoint" };
      return target;
    }),
  };
}

function findJsonMismatch(
  source: JsonValue,
  projection: JsonValue,
  path: string,
): string | null {
  if (Array.isArray(source)) {
    if (!Array.isArray(projection)) {
      return `${path} changed from an array to ${describeJson(projection)}`;
    }
    if (source.length !== projection.length) {
      return `${path} has ${source.length} entries, but the projection has ${projection.length}`;
    }
    for (let index = 0; index < source.length; index += 1) {
      const mismatch = findJsonMismatch(
        source[index] as JsonValue,
        projection[index] as JsonValue,
        `${path}[${index}]`,
      );
      if (mismatch) return mismatch;
    }
    return null;
  }

  if (isJsonObject(source)) {
    if (!isJsonObject(projection)) {
      return `${path} changed from an object to ${describeJson(projection)}`;
    }
    for (const [key, value] of Object.entries(source)) {
      if (!Object.prototype.hasOwnProperty.call(projection, key)) {
        return `${path} loses field ${key}`;
      }
      const mismatch = findJsonMismatch(
        value,
        projection[key] as JsonValue,
        `${path}.${key}`,
      );
      if (mismatch) return mismatch;
    }
    return null;
  }

  return Object.is(source, projection)
    ? null
    : `${path} changes ${JSON.stringify(source)} to ${JSON.stringify(projection)}`;
}

function describeJson(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (isJsonObject(value)) return "an object";
  return typeof value;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { JsonObject, JsonValue } from "./projectSchema";
import { projectSchemaVersion } from "./projectSchema";

export interface LegacyPathProjectDefaults {
  project_id: string;
  display_name: string;
  path_file_name?: string | null;
}

export interface MigrationResult {
  document: JsonObject;
  applied_migrations: string[];
}

export function migrateProjectDocument(
  input: unknown,
  defaults: LegacyPathProjectDefaults,
): MigrationResult {
  if (isObject(input) && input.schema_version === projectSchemaVersion) {
    return {
      document: input,
      applied_migrations: [],
    };
  }

  if (isNativePathDocument(input)) {
    return {
      document: {
        schema_version: projectSchemaVersion,
        project_id: defaults.project_id,
        display_name: defaults.display_name,
        path_file_name: defaults.path_file_name ?? null,
        path: input,
        config: {},
      },
      applied_migrations: ["legacy-path-document-to-v1-project"],
    };
  }

  throw new Error("Unsupported project document schema");
}

function isNativePathDocument(
  input: unknown,
): input is JsonObject | JsonValue[] {
  return (
    Array.isArray(input) ||
    (isObject(input) && Array.isArray(input.path_elements))
  );
}

function isObject(input: unknown): input is JsonObject {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

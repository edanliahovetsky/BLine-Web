import { createProjectConfig } from "../../../src/core/config/projectConfig";
import {
  createPathModel,
  createTranslationTarget,
} from "../../../src/core/model/path";
import { createProjectPathDocument } from "../../../src/core/io/projectSchema";
import { createProjectWorkspaceDocument } from "../../../src/core/io/projectSchema";
import type {
  ProjectImportResult,
  ProjectImportRollback,
} from "../../../src/platform/projectIo";
import { tauriCapabilities } from "../../../src/env/capabilities";
import { initializeUserData } from "../../../src/userData";
import { migrateImportedLegacyFieldBackgrounds } from "../../../src/userData/legacyFieldMigration";
import type { UserData } from "../../../src/userData/model";

export function exampleWorkspace(
  project_id: string,
  display_name: string,
  pathNames: string[],
) {
  const paths = pathNames.map((name, index) =>
    createProjectPathDocument({
      path_id: `path-${index + 1}`,
      display_name: name,
      file_name: `${name}.json`,
      path: createPathModel({
        path_elements: [
          createTranslationTarget({
            x_meters: index + 1,
            y_meters: index + 2,
          }),
        ],
      }),
    }),
  );

  return createProjectWorkspaceDocument({
    project_id,
    display_name,
    paths,
    active_path_id: paths[0]?.path_id ?? null,
  });
}

export function legacyField(id: string, assetId: string) {
  return {
    id,
    name: id,
    asset_id: assetId,
    file_name: assetId,
    mime_type: "image/png",
    size_bytes: 3,
    created_at: "2026-08-22T13:00:00.000Z",
    geometry: {
      length_meters: 12,
      width_meters: 6,
      coordinate_offset_meters: 0,
    },
  };
}

export function legacyFieldArchive() {
  const field = legacyField("legacy-field", "legacy.png");
  return {
    bline_project_schema_version: 1,
    exported_at: "2026-08-22T13:00:00.000Z",
    config: createProjectConfig({
      gui: {
        field: {
          selected_field_id: field.id,
          custom_fields: [field],
        },
      },
    }),
    paths: [],
    field_assets: [
      {
        asset_id: field.asset_id,
        file_name: field.file_name,
        mime_type: field.mime_type,
        data_base64: "AQID",
      },
    ],
  };
}

export function projectArchiveFile(archive: unknown): File {
  return {
    name: "legacy.bline-project.json",
    type: "application/json",
    text: async () => JSON.stringify(archive),
  } as File;
}

export async function migrateImportedFields(
  pending: ProjectImportResult,
): Promise<ProjectImportRollback> {
  const migration = await migrateImportedLegacyFieldBackgrounds({
    projectId: pending.project.project_id,
    selectedFieldId: pending.legacySelectedFieldId,
    entries: pending.legacyFieldBackgrounds,
  });
  if (migration.errors[0]) {
    await migration.rollback();
    throw migration.errors[0];
  }
  return migration;
}

export async function initializeImportUserData(): Promise<{
  assets: Map<string, number[]>;
}> {
  let persisted: UserData | null = null;
  let revision = 0;
  const assets = new Map<string, number[]>();
  await initializeUserData(tauriCapabilities, {
    tauriInvoke: async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      if (command === "storage_read_user_data") {
        return (
          persisted === null
            ? null
            : { revision, data: structuredClone(persisted) }
        ) as T;
      }
      if (command === "storage_compare_and_swap_user_data") {
        if (args?.expectedRevision !== revision && persisted) {
          return {
            status: "conflict",
            document: { revision, data: structuredClone(persisted) },
          } as T;
        }
        persisted = structuredClone(args?.data as UserData);
        revision += 1;
        return { status: "written", revision } as T;
      }
      if (command === "storage_write_user_field_asset") {
        assets.set(String(args?.entryId), [...(args?.bytes as number[])]);
        return undefined as T;
      }
      if (command === "storage_read_user_field_asset") {
        return (assets.get(String(args?.entryId)) ?? null) as T;
      }
      if (command === "storage_delete_user_field_asset") {
        assets.delete(String(args?.entryId));
        return undefined as T;
      }
      throw new Error(`Unexpected User Data command: ${command}`);
    },
  });
  return { assets };
}

export function noOpImportRollback(): ProjectImportRollback {
  return { rollback: async () => {} };
}

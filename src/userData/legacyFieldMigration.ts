import {
  builtInFieldDefinitions,
  type CustomFieldImage,
} from "../core/field/fieldConfig";
import type { Project } from "../core/model/project";
import type {
  ImportedLegacyFieldBackground,
  ProjectIoService,
} from "../platform/projectIo";
import {
  findVerifiedLegacyFieldBackground,
  listFieldBackgrounds,
  migrateLegacyFieldBackgroundFromBytes,
  migrateLegacyFieldBackgroundFromBytesWithOwnership,
  rememberSelectedFieldBackground,
  rollbackImportedFieldBackgrounds,
  selectedFieldBackgroundForProject,
  verifyUserDataPersistence,
} from ".";

export interface LegacyFieldMigrationResult {
  errors: Error[];
}

export interface ImportedLegacyFieldMigrationResult extends LegacyFieldMigrationResult {
  rollback(): Promise<void>;
}

export interface ImportedLegacyFieldMigrationInput {
  projectId: string;
  selectedFieldId: string | null;
  entries: readonly ImportedLegacyFieldBackground[];
}

/**
 * Moves Field Backgrounds already decoded from an imported archive or folder
 * directly into User Data. Identity includes the legacy field ID and exact image
 * content: calibrations remain distinct, retries are idempotent, and a later import
 * with replacement bytes cannot collide with an earlier global entry.
 */
export async function migrateImportedLegacyFieldBackgrounds({
  projectId,
  selectedFieldId,
  entries,
}: ImportedLegacyFieldMigrationInput): Promise<ImportedLegacyFieldMigrationResult> {
  const preMigrationFieldIds = new Set(
    listFieldBackgrounds().map((entry) => entry.id),
  );
  const priorSelection = selectedFieldBackgroundForProject(projectId);
  const createdEntryIds = new Set<string>();
  const migratedIds = new Map<string, string>();
  const errors: Error[] = [];
  let ownedSelection: string | undefined;

  for (const { field, bytes } of entries) {
    try {
      const migration =
        await migrateLegacyFieldBackgroundFromBytesWithOwnership(
          {
            name: field.name,
            fileName: field.file_name,
            mimeType: field.mime_type || "image/png",
            bytes,
            geometry: field.geometry,
          },
          await importedLegacyFieldKey(projectId, field, bytes),
        );
      const { entry } = migration;
      migratedIds.set(field.id, entry.id);
      if (migration.created && !preMigrationFieldIds.has(entry.id)) {
        createdEntryIds.add(entry.id);
      }
    } catch (error) {
      errors.push(toError(error));
    }
  }

  const migratedSelection = selectedFieldId
    ? migratedIds.get(selectedFieldId)
    : undefined;
  if (selectedFieldId) {
    if (!migratedSelection && !isBuiltInSelection(selectedFieldId)) {
      errors.push(
        new Error(
          `Selected legacy Field Background is missing: ${selectedFieldId}`,
        ),
      );
    } else {
      ownedSelection = migratedSelection ?? selectedFieldId;
      rememberSelectedFieldBackground(projectId, ownedSelection);
    }
  }

  try {
    await verifyUserDataPersistence();
  } catch (error) {
    errors.push(toError(error));
  }

  let rollbackComplete = false;
  let rollbackInProgress: Promise<void> | null = null;
  return {
    errors,
    rollback() {
      if (rollbackComplete) {
        return Promise.resolve();
      }
      rollbackInProgress ??= rollbackImportedFieldBackgrounds(
        [...createdEntryIds],
        projectId,
        ownedSelection,
        priorSelection,
      ).then(
        () => {
          rollbackComplete = true;
        },
        (error: unknown) => {
          rollbackInProgress = null;
          throw error;
        },
      );
      return rollbackInProgress;
    },
  };
}

async function importedLegacyFieldKey(
  projectId: string,
  field: CustomFieldImage,
  bytes: Uint8Array,
): Promise<string> {
  const metadata = new TextEncoder().encode(
    JSON.stringify({
      projectId,
      field: {
        id: field.id,
        name: field.name,
        fileName: field.file_name,
        mimeType: field.mime_type,
        geometry: field.geometry,
      },
    }),
  );
  const digestInput = new Uint8Array(
    4 + metadata.byteLength + bytes.byteLength,
  );
  new DataView(digestInput.buffer).setUint32(0, metadata.byteLength);
  digestInput.set(metadata, 4);
  digestInput.set(bytes, 4 + metadata.byteLength);
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", digestInput),
  );
  return `imported-v2:${[...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Copies Project-scoped legacy images into global User Data before removing
 * their old bytes. Metadata remains readable through the Slice 3 legacy seam.
 */
export async function migrateLegacyProjectFieldBackgrounds(
  project: Project,
  projectIo: ProjectIoService,
  sourceStorageId = project.project_id,
): Promise<LegacyFieldMigrationResult> {
  const legacy = project.config.gui.field;
  const migratedIds = new Map<string, string>();
  const errors: Error[] = [];
  const fieldsByAsset = groupFieldsByAsset(legacy.custom_fields);
  const migratedAssets: CustomFieldImage[] = [];

  for (const fields of fieldsByAsset.values()) {
    const source = fields[0];
    if (!source) {
      continue;
    }
    try {
      const blob = await projectIo.readLegacyFieldImageAsset(
        sourceStorageId,
        source,
      );
      if (!blob) {
        for (const field of fields) {
          const entry = await findVerifiedLegacyFieldBackground(
            `${project.project_id}\0${field.id}`,
          );
          if (!entry) {
            throw new Error(
              `Legacy Field Background image is missing: ${source.name}`,
            );
          }
          migratedIds.set(field.id, entry.id);
        }
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      for (const field of fields) {
        const entry = await migrateLegacyFieldBackgroundFromBytes(
          {
            name: field.name,
            fileName: field.file_name,
            mimeType: field.mime_type || blob.type || "image/png",
            bytes,
            geometry: field.geometry,
          },
          `${project.project_id}\0${field.id}`,
        );
        migratedIds.set(field.id, entry.id);
      }
      migratedAssets.push(source);
    } catch (error) {
      errors.push(toError(error));
    }
  }

  if (
    shouldAdoptLegacySelection(project.project_id, legacy.selected_field_id)
  ) {
    const selectedId = migratedIds.get(legacy.selected_field_id);
    if (selectedId || isBuiltInSelection(legacy.selected_field_id)) {
      rememberSelectedFieldBackground(
        project.project_id,
        selectedId ?? legacy.selected_field_id,
      );
    }
  }

  try {
    await verifyUserDataPersistence();
  } catch (error) {
    errors.push(toError(error));
    return { errors };
  }

  for (const field of migratedAssets) {
    try {
      await projectIo.deleteLegacyFieldImageAsset(sourceStorageId, field);
    } catch (error) {
      errors.push(toError(error));
    }
  }

  return { errors };
}

function isBuiltInSelection(fieldId: string): boolean {
  return builtInFieldDefinitions.some((field) => field.id === fieldId);
}

function shouldAdoptLegacySelection(
  projectId: string,
  legacySelectedFieldId: string,
): boolean {
  const current = selectedFieldBackgroundForProject(projectId);
  if (current === null) {
    return true;
  }
  if (
    isBuiltInSelection(current) ||
    listFieldBackgrounds().some((entry) => entry.id === current)
  ) {
    return false;
  }
  return current === legacySelectedFieldId;
}

function groupFieldsByAsset(
  fields: readonly CustomFieldImage[],
): Map<string, CustomFieldImage[]> {
  const groups = new Map<string, CustomFieldImage[]>();
  for (const field of fields) {
    const group = groups.get(field.asset_id) ?? [];
    group.push(field);
    groups.set(field.asset_id, group);
  }
  return groups;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

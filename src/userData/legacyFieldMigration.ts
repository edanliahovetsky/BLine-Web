import {
  builtInFieldDefinitions,
  type CustomFieldImage,
} from "../core/field/fieldConfig";
import type { Project } from "../core/model/project";
import type { ProjectIoService } from "../platform/projectIo";
import {
  flushUserData,
  migrateLegacyFieldBackgroundFromBytes,
  rememberSelectedFieldBackground,
  selectedFieldBackgroundForProject,
  verifyUserDataPersistence,
} from ".";

export interface LegacyFieldMigrationResult {
  errors: Error[];
}

/**
 * Copies Project-scoped legacy images into global User Data before removing
 * their old bytes. Metadata remains readable through the Slice 3 legacy seam.
 */
export async function migrateLegacyProjectFieldBackgrounds(
  project: Project,
  projectIo: ProjectIoService,
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
        project.project_id,
        source,
      );
      if (!blob) {
        throw new Error(
          `Legacy Field Background image is missing: ${source.name}`,
        );
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

  if (selectedFieldBackgroundForProject(project.project_id) === null) {
    const selectedId = migratedIds.get(legacy.selected_field_id);
    if (selectedId || isBuiltInSelection(legacy.selected_field_id)) {
      rememberSelectedFieldBackground(
        project.project_id,
        selectedId ?? legacy.selected_field_id,
      );
    }
  }

  await flushUserData();
  try {
    await verifyUserDataPersistence();
  } catch (error) {
    errors.push(toError(error));
    return { errors };
  }

  for (const field of migratedAssets) {
    try {
      await projectIo.deleteLegacyFieldImageAsset(project.project_id, field);
    } catch (error) {
      errors.push(toError(error));
    }
  }

  return { errors };
}

function isBuiltInSelection(fieldId: string): boolean {
  return builtInFieldDefinitions.some((field) => field.id === fieldId);
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

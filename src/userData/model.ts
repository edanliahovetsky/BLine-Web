import {
  normalizeFieldCoordinateGeometry,
  type FieldBackgroundEntry,
  type FieldGeometry,
} from "../core/field/fieldConfig";

export type { FieldBackgroundEntry } from "../core/field/fieldConfig";

export const USER_DATA_SCHEMA_VERSION = 2 as const;

export interface EditorLayoutPreferences {
  inspector_tab: "elements" | "constraints";
  inspector_width: number;
  show_ghost_paths: boolean;
}

export interface ProjectViewPreferences {
  active_path_id?: string;
  selected_field_background_id?: string;
}

export interface UserData {
  schema_version: typeof USER_DATA_SCHEMA_VERSION;
  editor_layout: EditorLayoutPreferences;
  completed_tour_ids: string[];
  automatic_generation: { keep_in_sync: boolean };
  project_views: Record<string, ProjectViewPreferences>;
  field_backgrounds: FieldBackgroundEntry[];
}

export interface LegacyUserDataStorage {
  getItem(key: string): string | null;
}

export const defaultUserData: UserData = {
  schema_version: USER_DATA_SCHEMA_VERSION,
  editor_layout: {
    inspector_tab: "elements",
    inspector_width: 340,
    show_ghost_paths: true,
  },
  completed_tour_ids: [],
  automatic_generation: { keep_in_sync: true },
  project_views: {},
  field_backgrounds: [],
};

export class UnsupportedUserDataVersionError extends Error {
  constructor(readonly version: number) {
    super(
      `User Data schema ${version} is newer than ${USER_DATA_SCHEMA_VERSION}; an explicit migration is required`,
    );
    this.name = "UnsupportedUserDataVersionError";
  }
}

export class InvalidUserDataRecordError extends Error {
  constructor() {
    super("User Data has an invalid current-schema record");
    this.name = "InvalidUserDataRecordError";
  }
}

export function migrateUserData(
  persisted: unknown,
  legacyStorage?: LegacyUserDataStorage,
): UserData {
  const root = objectValue(persisted);
  const persistedVersion = root?.schema_version ?? root?.schemaVersion;
  if (
    typeof persistedVersion === "number" &&
    persistedVersion > USER_DATA_SCHEMA_VERSION
  ) {
    throw new UnsupportedUserDataVersionError(persistedVersion);
  }
  if (
    persistedVersion === USER_DATA_SCHEMA_VERSION &&
    !isCurrentUserDataRecord(root)
  ) {
    throw new InvalidUserDataRecordError();
  }

  const legacyEditor = objectValue(
    readLegacyJson(legacyStorage, "bline-web:editor-user-data:v1"),
  );
  const legacyLayout = objectValue(
    readLegacyJson(legacyStorage, "bline-web:ui-preferences:v1"),
  );
  const legacyTours = readLegacyJson(legacyStorage, "bline-web:tours:v1");
  const legacyAutoSync = readLegacyString(
    legacyStorage,
    "bline.autoVelocity.autoSync",
  );
  const persistedLayout = objectValue(root?.editor_layout);
  const automaticGeneration = objectValue(root?.automatic_generation);

  return {
    schema_version: USER_DATA_SCHEMA_VERSION,
    editor_layout: {
      inspector_tab:
        inspectorTab(
          persistedLayout?.inspector_tab ?? persistedLayout?.inspectorTab,
        ) ??
        inspectorTab(legacyLayout?.inspectorTab) ??
        defaultUserData.editor_layout.inspector_tab,
      inspector_width:
        inspectorWidth(
          persistedLayout?.inspector_width ?? persistedLayout?.inspectorWidth,
        ) ??
        inspectorWidth(legacyLayout?.inspectorWidth) ??
        defaultUserData.editor_layout.inspector_width,
      show_ghost_paths:
        booleanValue(
          persistedLayout?.show_ghost_paths ?? persistedLayout?.showGhostPaths,
        ) ??
        booleanValue(legacyLayout?.showGhostPaths) ??
        defaultUserData.editor_layout.show_ghost_paths,
    },
    completed_tour_ids: preferStringArray(
      root?.completed_tour_ids,
      legacyTours,
    ),
    automatic_generation: {
      keep_in_sync:
        booleanValue(automaticGeneration?.keep_in_sync) ??
        (legacyAutoSync === null ? true : legacyAutoSync !== "off"),
    },
    project_views: projectViews(
      root?.project_views,
      legacyEditor?.activePathByProjectId,
    ),
    field_backgrounds: fieldBackgroundEntries(root?.field_backgrounds),
  };
}

export function cloneUserData(data: UserData): UserData {
  return structuredClone(data);
}

export function isUserDataRecord(value: unknown): boolean {
  return objectValue(value) !== null;
}

function isCurrentUserDataRecord(
  root: Record<string, unknown> | null,
): boolean {
  if (!root) {
    return false;
  }
  const layout = objectValue(root.editor_layout);
  const automaticGeneration = objectValue(root.automatic_generation);
  const completedTourIds = root.completed_tour_ids;
  const views = objectValue(root.project_views);
  const fields = root.field_backgrounds;
  if (
    !layout ||
    !inspectorTab(layout.inspector_tab) ||
    inspectorWidth(layout.inspector_width) !== layout.inspector_width ||
    typeof layout.show_ghost_paths !== "boolean" ||
    !automaticGeneration ||
    typeof automaticGeneration.keep_in_sync !== "boolean" ||
    !Array.isArray(completedTourIds) ||
    completedTourIds.some((id) => !nonEmptyString(id)) ||
    new Set(completedTourIds).size !== completedTourIds.length ||
    !views ||
    !validCurrentProjectViews(views) ||
    !Array.isArray(fields)
  ) {
    return false;
  }

  const fieldIds = new Set<string>();
  for (const field of fields) {
    const normalized = normalizeFieldBackgroundEntry(field);
    if (!normalized || fieldIds.has(normalized.id)) {
      return false;
    }
    fieldIds.add(normalized.id);
  }
  return true;
}

function validCurrentProjectViews(views: Record<string, unknown>): boolean {
  return Object.entries(views).every(([projectId, value]) => {
    const view = objectValue(value);
    if (!nonEmptyString(projectId) || !view) {
      return false;
    }
    const activePathId = view.active_path_id;
    const selectedFieldId = view.selected_field_background_id;
    return (
      (activePathId === undefined || nonEmptyString(activePathId)) &&
      (selectedFieldId === undefined || nonEmptyString(selectedFieldId)) &&
      (activePathId !== undefined || selectedFieldId !== undefined)
    );
  });
}

export function isSafeFieldBackgroundId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

function fieldBackgroundEntries(value: unknown): FieldBackgroundEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  return value.flatMap((candidate) => {
    const entry = normalizeFieldBackgroundEntry(candidate);
    if (!entry || seenIds.has(entry.id)) {
      return [];
    }
    seenIds.add(entry.id);
    return [entry];
  });
}

function normalizeFieldBackgroundEntry(
  value: unknown,
): FieldBackgroundEntry | null {
  const entry = objectValue(value);
  const id = stringValue(entry?.id);
  const name = stringValue(entry?.name);
  const fileName = stringValue(entry?.file_name);
  const mimeType = stringValue(entry?.mime_type);
  const sizeBytes = nonNegativeInteger(entry?.size_bytes);
  const createdAt = stringValue(entry?.created_at);
  const geometry = fieldGeometry(entry?.geometry);
  if (
    !id ||
    !isSafeFieldBackgroundId(id) ||
    !name ||
    !fileName ||
    !mimeType ||
    sizeBytes === undefined ||
    !createdAt ||
    !geometry
  ) {
    return null;
  }
  return {
    id,
    name,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    created_at: createdAt,
    geometry,
  };
}

function fieldGeometry(value: unknown): FieldGeometry | null {
  const geometry = objectValue(value);
  const lengthMeters = positiveFiniteNumber(geometry?.length_meters);
  const widthMeters = positiveFiniteNumber(geometry?.width_meters);
  const coordinateOffsetMeters = finiteNumber(
    geometry?.coordinate_offset_meters,
  );
  const coordinateOffsetX = optionalFiniteNumber(
    geometry?.coordinate_offset_x_meters,
  );
  const coordinateOffsetY = optionalFiniteNumber(
    geometry?.coordinate_offset_y_meters,
  );
  if (
    lengthMeters === undefined ||
    widthMeters === undefined ||
    coordinateOffsetMeters === undefined ||
    coordinateOffsetX === null ||
    coordinateOffsetY === null
  ) {
    return null;
  }
  return normalizeFieldCoordinateGeometry({
    length_meters: lengthMeters,
    width_meters: widthMeters,
    coordinate_offset_meters: coordinateOffsetMeters,
    ...(coordinateOffsetX === undefined
      ? {}
      : { coordinate_offset_x_meters: coordinateOffsetX }),
    ...(coordinateOffsetY === undefined
      ? {}
      : { coordinate_offset_y_meters: coordinateOffsetY }),
  });
}

function projectViews(
  value: unknown,
  legacyActivePaths: unknown,
): Record<string, ProjectViewPreferences> {
  const views = objectValue(value) ?? {};
  const activePaths = objectValue(legacyActivePaths) ?? {};
  const projectIds = new Set([
    ...Object.keys(activePaths),
    ...Object.keys(views),
  ]);
  const normalized: Record<string, ProjectViewPreferences> = {};

  for (const projectId of projectIds) {
    if (!nonEmptyString(projectId)) {
      continue;
    }
    const view = objectValue(views[projectId]);
    const activePathId =
      stringValue(view?.active_path_id ?? view?.activePathId) ??
      stringValue(activePaths[projectId]);
    const selectedFieldBackgroundId = stringValue(
      view?.selected_field_background_id ??
        view?.selectedFieldBackgroundId ??
        view?.selected_field_id,
    );
    const normalizedView: ProjectViewPreferences = {};
    if (activePathId) {
      normalizedView.active_path_id = activePathId;
    }
    if (selectedFieldBackgroundId) {
      normalizedView.selected_field_background_id = selectedFieldBackgroundId;
    }
    if (activePathId || selectedFieldBackgroundId) {
      normalized[projectId] = normalizedView;
    }
  }

  return normalized;
}

function readLegacyJson(
  storage: LegacyUserDataStorage | undefined,
  key: string,
): unknown {
  const raw = readLegacyString(storage, key);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function readLegacyString(
  storage: LegacyUserDataStorage | undefined,
  key: string,
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringValue(value: unknown): string | undefined {
  return nonEmptyString(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function positiveFiniteNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined | null {
  return value === undefined ? undefined : (finiteNumber(value) ?? null);
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function inspectorTab(
  value: unknown,
): EditorLayoutPreferences["inspector_tab"] | undefined {
  return value === "elements" || value === "constraints" ? value : undefined;
}

function inspectorWidth(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(560, Math.max(280, Math.round(value)))
    : undefined;
}

function preferStringArray(primary: unknown, fallback: unknown): string[] {
  return Array.isArray(primary)
    ? stringArray(primary)
    : Array.isArray(fallback)
      ? stringArray(fallback)
      : [];
}

function stringArray(value: unknown[]): string[] {
  return [...new Set(value.filter(nonEmptyString))];
}

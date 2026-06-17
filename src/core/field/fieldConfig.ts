export type BuiltInFieldId =
  | "frc2024-crescendo"
  | "frc2025-reefscape"
  | "frc2026-rebuilt"
  | "blank-grid";

export type FieldImageKind = "image" | "grid";

export interface FieldGeometry {
  length_meters: number;
  width_meters: number;
  coordinate_offset_meters: number;
}

export interface BuiltInFieldDefinition {
  id: BuiltInFieldId;
  label: string;
  kind: FieldImageKind;
  geometry: FieldGeometry;
  image_src?: string;
  attribution?: string;
}

export interface CustomFieldImage {
  id: string;
  name: string;
  asset_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  geometry: FieldGeometry;
}

export interface ProjectFieldConfig {
  selected_field_id: string;
  custom_fields: CustomFieldImage[];
}

export interface ResolvedFieldDefinition {
  id: string;
  label: string;
  kind: FieldImageKind;
  geometry: FieldGeometry;
  image_src?: string;
  custom?: CustomFieldImage;
  attribution?: string;
}

export const defaultFieldGeometry: FieldGeometry = {
  length_meters: 17.54,
  width_meters: 9.07,
  coordinate_offset_meters: 0.5,
};

export const blankGridFieldGeometry: FieldGeometry = {
  length_meters: 17.5,
  width_meters: 9,
  coordinate_offset_meters: 0.5,
};

export const defaultFieldId: BuiltInFieldId = "frc2026-rebuilt";

export const builtInFieldDefinitions: readonly BuiltInFieldDefinition[] = [
  {
    id: "frc2024-crescendo",
    label: "Crescendo 2024",
    kind: "image",
    geometry: {
      length_meters: 16.54051,
      width_meters: 8.2093,
      coordinate_offset_meters: 0,
    },
    image_src: "/assets/fields/field24.png",
    attribution: "PathPlanner field24.png",
  },
  {
    id: "frc2025-reefscape",
    label: "Reefscape 2025",
    kind: "image",
    geometry: {
      length_meters: 17.55,
      width_meters: 8.05,
      coordinate_offset_meters: 0,
    },
    image_src: "/assets/fields/field25.png",
    attribution: "PathPlanner field25.png",
  },
  {
    id: "frc2026-rebuilt",
    label: "REBUILT 2026",
    kind: "image",
    geometry: defaultFieldGeometry,
    image_src: "/assets/fields/field26.png",
    attribution: "PathPlanner field26.png",
  },
  {
    id: "blank-grid",
    label: "Blank Meter Grid",
    kind: "grid",
    geometry: blankGridFieldGeometry,
  },
];

export const defaultProjectFieldConfig: ProjectFieldConfig = {
  selected_field_id: defaultFieldId,
  custom_fields: [],
};

export function createProjectFieldConfig(input?: unknown): ProjectFieldConfig {
  const config: ProjectFieldConfig = {
    selected_field_id: defaultProjectFieldConfig.selected_field_id,
    custom_fields: [],
  };

  if (!isRecord(input)) {
    return config;
  }

  const selected = stringValue(
    input.selected_field_id ?? input.selectedFieldId,
    config.selected_field_id,
  );
  if (selected) {
    config.selected_field_id = selected;
  }

  const customFields = Array.isArray(input.custom_fields)
    ? input.custom_fields
    : Array.isArray(input.customFields)
      ? input.customFields
      : [];
  config.custom_fields = customFields
    .map(normalizeCustomField)
    .filter((field): field is CustomFieldImage => field !== null);

  if (!hasFieldDefinition(config, config.selected_field_id)) {
    config.selected_field_id = defaultFieldId;
  }

  return config;
}

export function resolveFieldDefinition(
  config: ProjectFieldConfig | null | undefined,
): ResolvedFieldDefinition {
  const normalized = config ?? defaultProjectFieldConfig;
  const builtIn = builtInFieldDefinitions.find(
    (field) => field.id === normalized.selected_field_id,
  );
  if (builtIn) {
    return {
      id: builtIn.id,
      label: builtIn.label,
      kind: builtIn.kind,
      geometry: cloneGeometry(builtIn.geometry),
      image_src: builtIn.image_src,
      attribution: builtIn.attribution,
    };
  }

  const custom = normalized.custom_fields.find(
    (field) => field.id === normalized.selected_field_id,
  );
  if (custom) {
    return {
      id: custom.id,
      label: custom.name,
      kind: "image",
      geometry: cloneGeometry(custom.geometry),
      custom,
    };
  }

  return resolveFieldDefinition(defaultProjectFieldConfig);
}

export function fieldGeometryFromConfig(
  config: ProjectFieldConfig | null | undefined,
): FieldGeometry {
  return resolveFieldDefinition(config).geometry;
}

export function createCustomFieldImage(input: {
  id: string;
  name: string;
  assetId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  geometry?: Partial<FieldGeometry>;
}): CustomFieldImage {
  return {
    id: input.id,
    name: input.name.trim() || "Custom Field",
    asset_id: input.assetId,
    file_name: input.fileName,
    mime_type: input.mimeType,
    size_bytes: Math.max(0, Math.trunc(input.sizeBytes)),
    created_at: input.createdAt,
    geometry: normalizeGeometry(input.geometry, defaultFieldGeometry),
  };
}

function normalizeCustomField(input: unknown): CustomFieldImage | null {
  if (!isRecord(input)) {
    return null;
  }

  const id = stringValue(input.id, "");
  const assetId = stringValue(input.asset_id ?? input.assetId, "");
  if (!id || !assetId) {
    return null;
  }

  return {
    id,
    name: stringValue(input.name, "Custom Field"),
    asset_id: assetId,
    file_name: stringValue(input.file_name ?? input.fileName, "field.png"),
    mime_type: stringValue(input.mime_type ?? input.mimeType, "image/png"),
    size_bytes: nonNegativeInteger(input.size_bytes ?? input.sizeBytes, 0),
    created_at: stringValue(input.created_at ?? input.createdAt, ""),
    geometry: normalizeGeometry(input.geometry, defaultFieldGeometry),
  };
}

function normalizeGeometry(
  input: unknown,
  fallback: FieldGeometry,
): FieldGeometry {
  const source = isRecord(input) ? input : {};
  return {
    length_meters: positiveNumber(source.length_meters, fallback.length_meters),
    width_meters: positiveNumber(source.width_meters, fallback.width_meters),
    coordinate_offset_meters: nonNegativeNumber(
      source.coordinate_offset_meters,
      fallback.coordinate_offset_meters,
    ),
  };
}

function cloneGeometry(geometry: FieldGeometry): FieldGeometry {
  return { ...geometry };
}

function hasFieldDefinition(
  config: ProjectFieldConfig,
  fieldId: string,
): boolean {
  return (
    builtInFieldDefinitions.some((field) => field.id === fieldId) ||
    config.custom_fields.some((field) => field.id === fieldId)
  );
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return Math.trunc(nonNegativeNumber(value, fallback));
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

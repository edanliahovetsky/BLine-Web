export type BuiltInFieldId =
  | "frc2022-rapid-react"
  | "frc2023-charged-up"
  | "frc2024-crescendo"
  | "frc2025-reefscape"
  | "frc2025-reefscape-annotated"
  | "frc2026-rebuilt"
  | "blank-grid";

export type FieldImageKind = "image" | "grid";

export interface FieldGeometry {
  length_meters: number;
  width_meters: number;
  /** PathPlanner's uniform marginMeters value for fields that use one. */
  coordinate_offset_meters: number;
  coordinate_offset_x_meters?: number;
  coordinate_offset_y_meters?: number;
}

export interface FieldCoordinatePoint {
  x_meters: number;
  y_meters: number;
}

export interface FieldCoordinateBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface PathPlannerFieldCalibration {
  image_width_px: number;
  image_height_px: number;
  pixels_per_meter: number;
  margin_meters: number;
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

/** A user-owned Field Background. Image bytes are stored separately by ID. */
export interface FieldBackgroundEntry {
  id: string;
  name: string;
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
  user_entry?: FieldBackgroundEntry;
  attribution?: string;
}

const rapidReactCalibration: PathPlannerFieldCalibration = {
  image_width_px: 3240,
  image_height_px: 1620,
  pixels_per_meter: 196.85,
  margin_meters: 0,
};

const chargedUpCalibration: PathPlannerFieldCalibration = {
  image_width_px: 3256,
  image_height_px: 1578,
  pixels_per_meter: 196.85,
  margin_meters: 0,
};

const crescendoCalibration: PathPlannerFieldCalibration = {
  image_width_px: 3256,
  image_height_px: 1616,
  pixels_per_meter: 196.85,
  margin_meters: 0,
};

const reefscapeCalibration: PathPlannerFieldCalibration = {
  image_width_px: 3510,
  image_height_px: 1610,
  pixels_per_meter: 200,
  margin_meters: 0,
};

const rebuiltCalibration: PathPlannerFieldCalibration = {
  image_width_px: 3508,
  image_height_px: 1814,
  pixels_per_meter: 200,
  margin_meters: 0.5,
};

export const defaultFieldGeometry: FieldGeometry =
  pathPlannerGeometry(rebuiltCalibration);

export const blankGridFieldGeometry: FieldGeometry = {
  length_meters: 18,
  width_meters: 9,
  coordinate_offset_meters: 0,
  coordinate_offset_x_meters: 0,
  coordinate_offset_y_meters: 0,
};

export const defaultFieldId: BuiltInFieldId = "frc2026-rebuilt";

export const builtInFieldDefinitions: readonly BuiltInFieldDefinition[] = [
  {
    id: "frc2022-rapid-react",
    label: "Rapid React 2022",
    kind: "image",
    geometry: pathPlannerGeometry(rapidReactCalibration),
    image_src: "/assets/fields/field22.png",
    attribution: "PathPlanner field22.png",
  },
  {
    id: "frc2023-charged-up",
    label: "Charged Up 2023",
    kind: "image",
    geometry: pathPlannerGeometry(chargedUpCalibration),
    image_src: "/assets/fields/field23.png",
    attribution: "PathPlanner field23.png",
  },
  {
    id: "frc2024-crescendo",
    label: "Crescendo 2024",
    kind: "image",
    geometry: pathPlannerGeometry(crescendoCalibration),
    image_src: "/assets/fields/field24.png",
    attribution: "PathPlanner field24.png",
  },
  {
    id: "frc2025-reefscape",
    label: "Reefscape 2025",
    kind: "image",
    geometry: pathPlannerGeometry(reefscapeCalibration),
    image_src: "/assets/fields/field25.png",
    attribution: "PathPlanner field25.png",
  },
  {
    id: "frc2025-reefscape-annotated",
    label: "Reefscape 2025 (Annotated)",
    kind: "image",
    geometry: pathPlannerGeometry(reefscapeCalibration),
    image_src: "/assets/fields/field25-annotated.png",
    attribution: "PathPlanner field25-annotated.png",
  },
  {
    id: "frc2026-rebuilt",
    label: "REBUILT 2026",
    kind: "image",
    geometry: pathPlannerGeometry(rebuiltCalibration),
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

export function resolveUserFieldDefinition(
  selectedFieldId: string | null | undefined,
  fieldBackgrounds: readonly FieldBackgroundEntry[],
): ResolvedFieldDefinition {
  const builtIn = builtInFieldDefinitions.find(
    (field) => field.id === selectedFieldId,
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

  const entry = fieldBackgrounds.find((field) => field.id === selectedFieldId);
  if (entry) {
    return {
      id: entry.id,
      label: entry.name,
      kind: "image",
      geometry: cloneGeometry(entry.geometry),
      user_entry: entry,
    };
  }

  return resolveUserFieldDefinition(defaultFieldId, fieldBackgrounds);
}

export function fieldCoordinateOffsetXMeters(field: FieldGeometry): number {
  return field.coordinate_offset_x_meters ?? field.coordinate_offset_meters;
}

export function fieldCoordinateOffsetYMeters(field: FieldGeometry): number {
  return field.coordinate_offset_y_meters ?? field.coordinate_offset_meters;
}

export const minimumFieldCoordinateSpanMeters = 0.01;

export function fieldCoordinateOffsetMaximumMeters(
  imageDimensionMeters: number,
): number {
  return Math.max(
    0,
    (imageDimensionMeters - minimumFieldCoordinateSpanMeters) / 2,
  );
}

/** Keep every calibrated coordinate axis positive after image padding. */
export function normalizeFieldCoordinateGeometry(
  field: FieldGeometry,
): FieldGeometry {
  const maximumX = fieldCoordinateOffsetMaximumMeters(field.length_meters);
  const maximumY = fieldCoordinateOffsetMaximumMeters(field.width_meters);
  const offsetX = clamp(fieldCoordinateOffsetXMeters(field), 0, maximumX);
  const offsetY = clamp(fieldCoordinateOffsetYMeters(field), 0, maximumY);
  return {
    ...field,
    coordinate_offset_meters: clamp(
      field.coordinate_offset_meters,
      0,
      Math.min(maximumX, maximumY),
    ),
    coordinate_offset_x_meters: offsetX,
    coordinate_offset_y_meters: offsetY,
  };
}

export function fieldCoordinateLengthMeters(field: FieldGeometry): number {
  return Math.max(
    0,
    field.length_meters - fieldCoordinateOffsetXMeters(field) * 2,
  );
}

export function fieldCoordinateWidthMeters(field: FieldGeometry): number {
  return Math.max(
    0,
    field.width_meters - fieldCoordinateOffsetYMeters(field) * 2,
  );
}

export function fieldCoordinateBounds(
  field: FieldGeometry,
): FieldCoordinateBounds {
  return {
    minX: 0,
    maxX: fieldCoordinateLengthMeters(field),
    minY: 0,
    maxY: fieldCoordinateWidthMeters(field),
  };
}

export function isPointWithinFieldCoordinates(
  point: FieldCoordinatePoint,
  field: FieldGeometry,
): boolean {
  const bounds = fieldCoordinateBounds(field);
  return (
    Number.isFinite(point.x_meters) &&
    Number.isFinite(point.y_meters) &&
    point.x_meters >= bounds.minX &&
    point.x_meters <= bounds.maxX &&
    point.y_meters >= bounds.minY &&
    point.y_meters <= bounds.maxY
  );
}

export function clampPointToFieldCoordinates<T extends FieldCoordinatePoint>(
  point: T,
  field: FieldGeometry,
): T {
  const bounds = fieldCoordinateBounds(field);
  return {
    ...point,
    x_meters: clamp(point.x_meters, bounds.minX, bounds.maxX),
    y_meters: clamp(point.y_meters, bounds.minY, bounds.maxY),
  };
}

/**
 * Keep an existing out-of-bounds value editable without allowing it to move
 * farther out or cross the field into overflow on the opposite edge.
 */
export function coordinateEditBounds(
  currentValue: number,
  coordinateMaximum: number,
): { min: number; max: number } {
  return {
    min: Math.min(0, currentValue),
    max: Math.max(coordinateMaximum, currentValue),
  };
}

export function movePointWithinFieldCoordinates<T extends FieldCoordinatePoint>(
  point: T,
  dxMeters: number,
  dyMeters: number,
  field: FieldGeometry,
): T {
  const bounds = fieldCoordinateBounds(field);
  const xEditBounds = coordinateEditBounds(point.x_meters, bounds.maxX);
  const yEditBounds = coordinateEditBounds(point.y_meters, bounds.maxY);
  return {
    ...point,
    x_meters: clamp(
      point.x_meters + dxMeters,
      xEditBounds.min,
      xEditBounds.max,
    ),
    y_meters: clamp(
      point.y_meters + dyMeters,
      yEditBounds.min,
      yEditBounds.max,
    ),
  };
}

export function createPathPlannerFieldGeometry(input: {
  imageWidthPx: number;
  imageHeightPx: number;
  pixelsPerMeter: number;
  marginMeters?: number;
}): FieldGeometry {
  return pathPlannerGeometry({
    image_width_px: input.imageWidthPx,
    image_height_px: input.imageHeightPx,
    pixels_per_meter: input.pixelsPerMeter,
    margin_meters: input.marginMeters ?? 0,
  });
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
  const uniformOffset = nonNegativeNumber(
    source.coordinate_offset_meters,
    fallback.coordinate_offset_meters,
  );
  const fallbackX = fieldCoordinateOffsetXMeters(fallback);
  const fallbackY = fieldCoordinateOffsetYMeters(fallback);
  const offsetX = nonNegativeNumber(
    source.coordinate_offset_x_meters,
    source.coordinate_offset_meters === undefined ? fallbackX : uniformOffset,
  );
  const offsetY = nonNegativeNumber(
    source.coordinate_offset_y_meters,
    source.coordinate_offset_meters === undefined ? fallbackY : uniformOffset,
  );

  return normalizeFieldCoordinateGeometry({
    length_meters: positiveNumber(source.length_meters, fallback.length_meters),
    width_meters: positiveNumber(source.width_meters, fallback.width_meters),
    coordinate_offset_meters: uniformOffset,
    coordinate_offset_x_meters: offsetX,
    coordinate_offset_y_meters: offsetY,
  });
}

function cloneGeometry(geometry: FieldGeometry): FieldGeometry {
  return { ...geometry };
}

function pathPlannerGeometry(
  calibration: PathPlannerFieldCalibration,
): FieldGeometry {
  const margin = calibration.margin_meters;
  return {
    length_meters: calibration.image_width_px / calibration.pixels_per_meter,
    width_meters: calibration.image_height_px / calibration.pixels_per_meter,
    coordinate_offset_meters: margin,
    coordinate_offset_x_meters: margin,
    coordinate_offset_y_meters: margin,
  };
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

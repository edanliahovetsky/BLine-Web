import type { DriveDirection, PathModel } from "./path";

/** Preview preferences are editor metadata, never robot execution instructions. */
export interface PathPreview {
  start_pose?: {
    x_meters: number;
    y_meters: number;
    rotation_radians: number;
  };
}

export function hasAuthoredStart(path: {
  path_elements: readonly { type: string }[];
}): boolean {
  return (
    path.path_elements.length > 1 &&
    (path.path_elements[0].type === "translation" ||
      path.path_elements[0].type === "waypoint")
  );
}

export function previewStartPose(path: { preview?: PathPreview }) {
  return (
    path.preview?.start_pose ?? {
      x_meters: 0,
      y_meters: 0,
      rotation_radians: 0,
    }
  );
}

/** Accepted only while reading older editor metadata. Never stored in PathModel. */
export interface LegacyPathPreview extends PathPreview {
  tank_direction?: DriveDirection;
}

export function parseTankDriveDirection(
  value: unknown,
  context: string,
): DriveDirection {
  if (value === "forward" || value === "backward") return value;
  throw new Error(
    `${context}: expected "forward" or "backward", received ${JSON.stringify(value)}`,
  );
}

/** Retain only editor-owned fields when writing or comparing migrated metadata. */
export function privatePathPreview(
  preview: PathPreview | undefined,
): PathPreview | undefined {
  return preview?.start_pose
    ? { start_pose: structuredClone(preview.start_pose) }
    : undefined;
}

export function applyPreviewMetadata(
  path: PathModel,
  value: unknown,
  context = "Path",
): void {
  if (!isPathPreview(value, context)) return;
  if (
    path.tank_drive_direction === undefined &&
    value.tank_direction !== undefined
  ) {
    path.tank_drive_direction = value.tank_direction;
  }
  const preview = privatePathPreview(value);
  if (preview) path.preview = preview;
}

export function isPathPreview(
  value: unknown,
  context = "Path",
): value is LegacyPathPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    !keys.length ||
    keys.some((key) => key !== "tank_direction" && key !== "start_pose")
  )
    return false;
  if ("tank_direction" in input) {
    parseTankDriveDirection(
      input.tank_direction,
      `${context}.preview.tank_direction`,
    );
  }
  if (input.start_pose !== undefined) {
    if (
      !input.start_pose ||
      typeof input.start_pose !== "object" ||
      Array.isArray(input.start_pose)
    )
      return false;
    const pose = input.start_pose as Record<string, unknown>;
    const components = ["x_meters", "y_meters", "rotation_radians"];
    if (
      Object.keys(pose).length !== components.length ||
      !components.every(
        (key) => typeof pose[key] === "number" && Number.isFinite(pose[key]),
      )
    )
      return false;
  }
  return true;
}

/** Preview preferences are editor metadata, never robot execution instructions. */
export interface PathPreview {
  tank_direction?: "forward" | "backward";
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

export function isPathPreview(value: unknown): value is PathPreview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    !keys.length ||
    keys.some((key) => key !== "tank_direction" && key !== "start_pose")
  )
    return false;
  if (
    input.tank_direction !== undefined &&
    input.tank_direction !== "forward" &&
    input.tank_direction !== "backward"
  )
    return false;
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

import type { HandoffMode, PathModel, PathElement } from "./path";

/** Omission represents inheritance. Unknown values must not silently change path behavior. */
export function parseHandoffMode(value: unknown): HandoffMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "radius" || value === "progress") return value;
  throw new Error("Handoff mode must be radius or progress");
}

export function resolveHandoffMode(
  path: PathModel,
  target: PathElement | undefined,
  projectDefault: HandoffMode = "radius",
): HandoffMode {
  const translation =
    target?.type === "waypoint"
      ? target.translation_target
      : target?.type === "translation"
        ? target
        : undefined;
  return translation?.handoff_mode ?? path.handoff_mode ?? projectDefault;
}

/** Distance and projected progress are in metres; final targets use completion tolerances instead. */
export function handoffReached(
  mode: HandoffMode,
  distance: number,
  projectedDistance: number,
  segmentLength: number,
  handoffDistance: number,
): boolean {
  if (segmentLength < 1e-9) return true;
  if (distance <= handoffDistance) return true;
  return (
    mode === "progress" &&
    projectedDistance >= Math.max(0, segmentLength - handoffDistance)
  );
}

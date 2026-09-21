import type { HandoffMode, PathModel, TranslationTarget } from "./path";

/** Omission represents inheritance. Unknown values must not silently change path behavior. */
export function parseHandoffMode(value: unknown): HandoffMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "radius" || value === "progress") return value;
  throw new Error("Handoff mode must be radius or progress");
}

export function resolveHandoffMode(
  path: PathModel,
  target: TranslationTarget,
  projectDefault: HandoffMode = "radius",
): HandoffMode {
  return target.handoff_mode ?? path.handoff_mode ?? projectDefault;
}

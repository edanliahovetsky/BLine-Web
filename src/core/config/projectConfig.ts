import {
  createProjectFieldConfig,
  defaultProjectFieldConfig,
  type ProjectFieldConfig,
} from "../field/fieldConfig";

export type ProtrusionSide = "none" | "left" | "right" | "front" | "back";
export type ProtrusionState = "" | "shown" | "hidden";

export const defaultAutoVelocityVelocitySafetyFactor = 1;
export const defaultAutoVelocityAccelerationSafetyFactor = 1;
export const defaultAutoVelocityMergeToleranceMetersPerSec = 0.3;

export interface CanonicalProjectConfig {
  gui: {
    robot: {
      length_meters: number;
      width_meters: number;
    };
    protrusions: {
      enabled: boolean;
      distance_meters: number;
      side: ProtrusionSide;
      default_state: ProtrusionState;
      show_on_event_keys: string[];
      hide_on_event_keys: string[];
    };
    field: ProjectFieldConfig;
  };
  kinematic_constraints: {
    default_max_velocity_meters_per_sec: number;
    default_max_acceleration_meters_per_sec2: number;
    default_intermediate_handoff_radius_meters: number;
    default_max_velocity_deg_per_sec: number;
    default_max_acceleration_deg_per_sec2: number;
    default_end_translation_tolerance_meters: number;
    default_end_rotation_tolerance_deg: number;
    default_auto_velocity_velocity_safety_factor: number;
    default_auto_velocity_acceleration_safety_factor: number;
    default_auto_velocity_merge_tolerance_meters_per_sec: number;
  };
}

const defaultConfig: CanonicalProjectConfig = {
  gui: {
    robot: {
      length_meters: 0.8,
      width_meters: 0.8,
    },
    protrusions: {
      enabled: false,
      distance_meters: 0,
      side: "none",
      default_state: "",
      show_on_event_keys: [],
      hide_on_event_keys: [],
    },
    field: defaultProjectFieldConfig,
  },
  kinematic_constraints: {
    default_max_velocity_meters_per_sec: 4.5,
    default_max_acceleration_meters_per_sec2: 12,
    default_intermediate_handoff_radius_meters: 0.45,
    default_max_velocity_deg_per_sec: 720,
    default_max_acceleration_deg_per_sec2: 1500,
    default_end_translation_tolerance_meters: 0.03,
    default_end_rotation_tolerance_deg: 2,
    default_auto_velocity_velocity_safety_factor:
      defaultAutoVelocityVelocitySafetyFactor,
    default_auto_velocity_acceleration_safety_factor:
      defaultAutoVelocityAccelerationSafetyFactor,
    default_auto_velocity_merge_tolerance_meters_per_sec:
      defaultAutoVelocityMergeToleranceMetersPerSec,
  },
};

export function createProjectConfig(input?: unknown): CanonicalProjectConfig {
  const config = structuredClone(defaultConfig);
  if (isRecord(input)) {
    updateProjectConfig(config, input);
  }
  return config;
}

export function getDefaultOptionalConfigValue(
  config: unknown,
  key: string,
): number | null {
  const canonical = createProjectConfig(config);
  const constraints = canonical.kinematic_constraints;
  const defaultKey = `default_${key}` as keyof typeof constraints;

  if (defaultKey in constraints) {
    return constraints[defaultKey];
  }

  if (key in constraints) {
    return constraints[key as keyof typeof constraints];
  }

  return null;
}

export function projectConfigDefaultLookup(
  config: unknown,
): (key: string) => number | null {
  return (key: string) => getDefaultOptionalConfigValue(config, key);
}

function updateProjectConfig(
  config: CanonicalProjectConfig,
  input: Record<string, unknown>,
): void {
  const robotLength = lookupAny(input, [
    ["robot_length_meters"],
    ["gui", "robot", "length_meters"],
  ]);
  if (robotLength.found) {
    config.gui.robot.length_meters = nonNegativeNumber(
      robotLength.value,
      config.gui.robot.length_meters,
    );
  }

  const robotWidth = lookupAny(input, [
    ["robot_width_meters"],
    ["gui", "robot", "width_meters"],
  ]);
  if (robotWidth.found) {
    config.gui.robot.width_meters = nonNegativeNumber(
      robotWidth.value,
      config.gui.robot.width_meters,
    );
  }

  const enabled = lookupAny(input, [
    ["protrusion_enabled"],
    ["gui", "protrusions", "enabled"],
  ]);
  if (enabled.found) {
    config.gui.protrusions.enabled = coerceBoolean(
      enabled.value,
      config.gui.protrusions.enabled,
    );
  }

  const distance = lookupAny(input, [
    ["protrusion_distance_meters"],
    ["gui", "protrusions", "distance_meters"],
  ]);
  if (distance.found) {
    config.gui.protrusions.distance_meters = nonNegativeNumber(
      distance.value,
      config.gui.protrusions.distance_meters,
    );
  }

  const side = lookupAny(input, [
    ["protrusion_side"],
    ["gui", "protrusions", "side"],
  ]);
  if (side.found) {
    config.gui.protrusions.side = normalizeProtrusionSide(
      side.value,
      config.gui.protrusions.side,
    );
  }

  const defaultState = lookupAny(input, [
    ["protrusion_default_state"],
    ["gui", "protrusions", "default_state"],
  ]);
  if (defaultState.found) {
    config.gui.protrusions.default_state = normalizeProtrusionState(
      defaultState.value,
      config.gui.protrusions.default_state,
    );
  }

  const eventOverrides = lookupAny(input, [
    ["gui", "protrusions", "event_state_overrides"],
  ]);
  if (eventOverrides.found && isRecord(eventOverrides.value)) {
    const showKeys: string[] = [];
    const hideKeys: string[] = [];
    for (const [rawKey, rawState] of Object.entries(eventOverrides.value)) {
      const key = rawKey.trim();
      if (!key) {
        continue;
      }
      const state = normalizeProtrusionState(rawState, "");
      if (state === "shown") {
        showKeys.push(key);
      } else if (state === "hidden") {
        hideKeys.push(key);
      }
    }
    config.gui.protrusions.show_on_event_keys = normalizeKeyList(showKeys);
    config.gui.protrusions.hide_on_event_keys = normalizeKeyList(hideKeys);
  }

  const showKeys = lookupAny(input, [
    ["protrusion_show_on_event_keys"],
    ["gui", "protrusions", "show_on_event_keys"],
  ]);
  if (showKeys.found) {
    config.gui.protrusions.show_on_event_keys = normalizeKeyList(
      showKeys.value,
    );
  }

  const hideKeys = lookupAny(input, [
    ["protrusion_hide_on_event_keys"],
    ["gui", "protrusions", "hide_on_event_keys"],
  ]);
  if (hideKeys.found) {
    config.gui.protrusions.hide_on_event_keys = normalizeKeyList(
      hideKeys.value,
    );
  }

  const legacyPresent = legacyProtrusionKeys.some((key) => key in input);
  const newProtrusionPresent =
    enabled.found ||
    distance.found ||
    side.found ||
    defaultState.found ||
    showKeys.found ||
    hideKeys.found ||
    lookupPath(input, ["gui", "protrusions"]).found;
  if (legacyPresent && !newProtrusionPresent) {
    const legacy = legacyProtrusionConversion(input);
    config.gui.protrusions.enabled = legacy.enabled;
    config.gui.protrusions.distance_meters = legacy.distance;
    config.gui.protrusions.side = legacy.side;
    config.gui.protrusions.default_state = legacy.enabled ? "shown" : "";
    config.gui.protrusions.show_on_event_keys = [];
    config.gui.protrusions.hide_on_event_keys = [];
  }

  const field = lookupAny(input, [["gui", "field"], ["field"]]);
  if (field.found) {
    config.gui.field = createProjectFieldConfig(field.value);
  }

  const defaultNumericKeys = Object.keys(config.kinematic_constraints) as Array<
    keyof CanonicalProjectConfig["kinematic_constraints"]
  >;
  for (const key of defaultNumericKeys) {
    const value = lookupAny(input, [[key], ["kinematic_constraints", key]]);
    if (value.found) {
      config.kinematic_constraints[key] = nonNegativeNumber(
        value.value,
        config.kinematic_constraints[key],
      );
    }
  }

  config.gui.protrusions.side = normalizeProtrusionSide(
    config.gui.protrusions.side,
    "none",
  );
  config.gui.protrusions.default_state = config.gui.protrusions.enabled
    ? normalizeProtrusionState(config.gui.protrusions.default_state, "")
    : "";
  config.gui.protrusions.show_on_event_keys = normalizeKeyList(
    config.gui.protrusions.show_on_event_keys,
  );
  config.gui.protrusions.hide_on_event_keys = normalizeKeyList(
    config.gui.protrusions.hide_on_event_keys,
  );
}

const legacyProtrusionKeys = [
  "robot_protrusion_front_meters",
  "robot_protrusion_back_meters",
  "robot_protrusion_left_meters",
  "robot_protrusion_right_meters",
] as const;

function legacyProtrusionConversion(input: Record<string, unknown>): {
  enabled: boolean;
  distance: number;
  side: ProtrusionSide;
} {
  const values: Record<Exclude<ProtrusionSide, "none">, number> = {
    front: nonNegativeNumber(input.robot_protrusion_front_meters, 0),
    back: nonNegativeNumber(input.robot_protrusion_back_meters, 0),
    left: nonNegativeNumber(input.robot_protrusion_left_meters, 0),
    right: nonNegativeNumber(input.robot_protrusion_right_meters, 0),
  };
  const priority: Array<Exclude<ProtrusionSide, "none">> = [
    "front",
    "back",
    "left",
    "right",
  ];

  if (!Object.values(values).some((value) => value > 0)) {
    return { enabled: false, distance: 0, side: "none" };
  }

  let bestSide = priority[0];
  for (const side of priority) {
    const current = values[side];
    const best = values[bestSide];
    if (
      current > best ||
      (current === best && priority.indexOf(side) < priority.indexOf(bestSide))
    ) {
      bestSide = side;
    }
  }

  return {
    enabled: true,
    distance: values[bestSide],
    side: bestSide,
  };
}

function lookupAny(
  input: Record<string, unknown>,
  paths: string[][],
): { found: boolean; value: unknown } {
  for (const path of paths) {
    const result = lookupPath(input, path);
    if (result.found) {
      return result;
    }
  }
  return { found: false, value: undefined };
}

function lookupPath(
  input: Record<string, unknown>,
  path: string[],
): { found: boolean; value: unknown } {
  let current: unknown = input;
  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return { found: false, value: undefined };
    }
    current = current[key];
  }
  return { found: true, value: current };
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : Number(fallback);
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Boolean(value);
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function normalizeProtrusionSide(
  value: unknown,
  fallback: ProtrusionSide,
): ProtrusionSide {
  const normalized = String(value).trim().toLowerCase();
  return normalized === "none" ||
    normalized === "left" ||
    normalized === "right" ||
    normalized === "front" ||
    normalized === "back"
    ? normalized
    : fallback;
}

function normalizeProtrusionState(
  value: unknown,
  fallback: ProtrusionState,
): ProtrusionState {
  const normalized = String(value).trim().toLowerCase();
  if (["shown", "show", "visible", "on", "true", "1"].includes(normalized)) {
    return "shown";
  }
  if (
    ["hidden", "hide", "invisible", "off", "false", "0"].includes(normalized)
  ) {
    return "hidden";
  }
  if (normalized === "" || normalized === "none") {
    return "";
  }
  return fallback;
}

function normalizeKeyList(value: unknown): string[] {
  const rawItems =
    value === null || value === undefined
      ? []
      : typeof value === "string"
        ? value.replace(/\n/g, ",").split(",")
        : Array.isArray(value)
          ? value.map(String)
          : [String(value)];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawItem of rawItems) {
    const key = rawItem.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }

  return normalized;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

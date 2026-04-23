import {
  countAnchorElements,
  countRotationEventElements,
  createConstraints,
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  isRangedConstraintKey,
  isRotationConstraintKey,
  isTranslationConstraintKey,
  rangedConstraintKeys,
  type ConstraintKey,
  type PathElement,
  type PathModel,
  type RangedConstraint,
  type RotationTarget
} from "../model/path";
import {
  type JsonObject,
  type ProjectConfig,
  type ProjectDocument,
  type SerializedConstraints,
  type SerializedPathDocument,
  type SerializedPathElement,
  type SerializedProjectDocument,
  createProjectDocument
} from "./projectSchema";
import { migrateProjectDocument } from "./migrations";

export type DefaultLookup = (key: string) => number | null | undefined;

const scalarConstraintKeys: readonly ConstraintKey[] = [
  "max_velocity_meters_per_sec",
  "max_acceleration_meters_per_sec2",
  "end_translation_tolerance_meters",
  "max_velocity_deg_per_sec",
  "max_acceleration_deg_per_sec2",
  "end_rotation_tolerance_deg"
];

export function serializePath(path: PathModel): SerializedPathDocument {
  const pathElements: SerializedPathElement[] = [];

  for (const element of path.path_elements) {
    if (element.type === "translation") {
      const entry = {
        type: "translation" as const,
        x_meters: Number(element.x_meters),
        y_meters: Number(element.y_meters)
      };

      pathElements.push(
        element.intermediate_handoff_radius_meters === null
          ? entry
          : {
              ...entry,
              intermediate_handoff_radius_meters: Number(
                element.intermediate_handoff_radius_meters
              )
            }
      );
      continue;
    }

    if (element.type === "rotation") {
      pathElements.push({
        type: "rotation",
        rotation_radians: Number(element.rotation_radians),
        t_ratio: Number(element.t_ratio),
        profiled_rotation: Boolean(element.profiled_rotation)
      });
      continue;
    }

    if (element.type === "event_trigger") {
      pathElements.push({
        type: "event_trigger",
        t_ratio: Number(element.t_ratio),
        lib_key: String(element.lib_key)
      });
      continue;
    }

    const translationData = {
      x_meters: Number(element.translation_target.x_meters),
      y_meters: Number(element.translation_target.y_meters)
    };

    pathElements.push({
      type: "waypoint",
      translation_target:
        element.translation_target.intermediate_handoff_radius_meters === null
          ? translationData
          : {
              ...translationData,
              intermediate_handoff_radius_meters: Number(
                element.translation_target.intermediate_handoff_radius_meters
              )
            },
      rotation_target: {
        rotation_radians: Number(element.rotation_target.rotation_radians),
        profiled_rotation: Boolean(element.rotation_target.profiled_rotation)
      }
    });
  }

  const constraints = serializeConstraints(path);

  return Object.keys(constraints).length === 0
    ? { path_elements: pathElements }
    : { path_elements: pathElements, constraints };
}

export function deserializePath(
  input: unknown,
  defaultLookup?: DefaultLookup
): PathModel {
  const { items, rangedBlock, constraints } = readPathInput(input);
  const path = createPathModel({ constraints });

  for (const item of items) {
    if (!isObject(item)) {
      continue;
    }

    try {
      const type = stringValue(item.type);

      if (type === "translation") {
        path.path_elements.push(
          createTranslationTarget({
            x_meters: numberValue(item.x_meters, 0),
            y_meters: numberValue(item.y_meters, 0),
            intermediate_handoff_radius_meters: handoffDefault(
              item.intermediate_handoff_radius_meters,
              defaultLookup
            )
          })
        );
        continue;
      }

      if (type === "rotation") {
        const rotation = createRotationTarget({
          rotation_radians: numberValue(item.rotation_radians, 0),
          t_ratio:
            item.t_ratio === undefined ? 0 : numberValue(item.t_ratio, 0),
          profiled_rotation: booleanValue(item.profiled_rotation, true)
        });

        if (item.t_ratio === undefined) {
          const legacyPosition = legacyPositionFrom(item);
          if (legacyPosition) {
            rotation.legacy_position = legacyPosition;
          }
        }

        path.path_elements.push(rotation);
        continue;
      }

      if (type === "event_trigger") {
        path.path_elements.push(
          createEventTrigger({
            t_ratio:
              item.t_ratio === undefined ? 0 : numberValue(item.t_ratio, 0),
            lib_key: String(item.lib_key ?? "")
          })
        );
        continue;
      }

      if (type === "waypoint") {
        const translationData = isObject(item.translation_target)
          ? item.translation_target
          : {};
        const rotationData = isObject(item.rotation_target)
          ? item.rotation_target
          : {};

        const rotation = createRotationTarget({
          rotation_radians: numberValue(rotationData.rotation_radians, 0),
          t_ratio:
            rotationData.t_ratio === undefined
              ? 0
              : numberValue(rotationData.t_ratio, 0),
          profiled_rotation: booleanValue(rotationData.profiled_rotation, true)
        });

        if (rotationData.t_ratio === undefined) {
          const legacyPosition = legacyPositionFrom(rotationData);
          if (legacyPosition) {
            rotation.legacy_position = legacyPosition;
          }
        }

        path.path_elements.push(
          createWaypoint({
            translation_target: createTranslationTarget({
              x_meters: numberValue(translationData.x_meters, 0),
              y_meters: numberValue(translationData.y_meters, 0),
              intermediate_handoff_radius_meters: handoffDefault(
                translationData.intermediate_handoff_radius_meters,
                defaultLookup
              )
            }),
            rotation_target: rotation
          })
        );
      }
    } catch {
      continue;
    }
  }

  convertLegacyPositions(path);
  loadRangedConstraints(path, rangedBlock);

  return path;
}

export interface DeserializeProjectOptions {
  defaultLookup?: DefaultLookup;
  fallbackProjectId?: string;
  fallbackDisplayName?: string;
}

export function serializeProjectDocument(
  project: ProjectDocument
): SerializedProjectDocument {
  return {
    schema_version: project.schema_version,
    project_id: project.project_id,
    display_name: project.display_name,
    path: serializePath(project.path),
    config: project.config
  };
}

export function deserializeProjectDocument(
  input: unknown,
  options: DeserializeProjectOptions = {}
): ProjectDocument {
  const migration = migrateProjectDocument(input, {
    project_id: options.fallbackProjectId ?? "imported-project",
    display_name: options.fallbackDisplayName ?? "Imported Project"
  });
  const document = migration.document;

  if (!isObject(document.path) && !Array.isArray(document.path)) {
    throw new Error("Project document is missing a path object");
  }

  return createProjectDocument({
    project_id: String(document.project_id),
    display_name: String(document.display_name),
    path: deserializePath(document.path, options.defaultLookup),
    config: readProjectConfig(document.config)
  });
}

function serializeConstraints(path: PathModel): SerializedConstraints {
  const constraints: SerializedConstraints = {};
  const rangedKeys = new Set(
    path.ranged_constraints
      .filter((constraint) => isRangedConstraintKey(constraint.key))
      .map((constraint) => constraint.key)
  );

  for (const key of scalarConstraintKeys) {
    if (rangedKeys.has(key)) {
      continue;
    }

    const value = path.constraints[key];
    if (value !== null) {
      constraints[key] = Number(value);
    }
  }

  for (const key of rangedConstraintKeys) {
    const values = path.ranged_constraints
      .filter((constraint) => constraint.key === key)
      .map((constraint) => ({
        value: Number(constraint.value),
        start_ordinal: Math.max(Math.trunc(constraint.start_ordinal) - 1, 0),
        end_ordinal: Math.max(Math.trunc(constraint.end_ordinal) - 1, 0)
      }));

    if (values.length > 0) {
      constraints[key] = values;
    }
  }

  return constraints;
}

function readPathInput(input: unknown): {
  items: unknown[];
  rangedBlock: unknown;
  constraints: ReturnType<typeof createConstraints>;
} {
  if (Array.isArray(input)) {
    return { items: input, rangedBlock: [], constraints: createConstraints() };
  }

  if (!isObject(input)) {
    return { items: [], rangedBlock: [], constraints: createConstraints() };
  }

  const constraintsBlock = isObject(input.constraints) ? input.constraints : {};
  const rangedBlock: JsonObject[] = [];

  for (const [key, value] of Object.entries(constraintsBlock)) {
    if (!Array.isArray(value)) {
      continue;
    }

    for (const entry of value) {
      if (isObject(entry)) {
        rangedBlock.push({ ...entry, key });
      }
    }
  }

  return {
    items: Array.isArray(input.path_elements) ? input.path_elements : [],
    rangedBlock,
    constraints: readConstraints(constraintsBlock)
  };
}

function readConstraints(input: JsonObject) {
  const constraints = createConstraints();

  for (const key of scalarConstraintKeys) {
    if (key in input) {
      constraints[key] = optionalNumber(input[key]);
      continue;
    }

    const legacyKey = `default_${key}`;
    if (legacyKey in input) {
      constraints[key] = optionalNumber(input[legacyKey]);
    }
  }

  return constraints;
}

function loadRangedConstraints(path: PathModel, rangedBlock: unknown): void {
  const normalized = normalizeRangedBlock(rangedBlock);
  const anchorCount = countAnchorElements(path.path_elements);
  const rotationEventCount = countRotationEventElements(path.path_elements);

  for (const entry of normalized) {
    const key = String(entry.key ?? "");
    if (!isRangedConstraintKey(key)) {
      continue;
    }

    const value = optionalNumber(entry.value);
    if (value === null) {
      continue;
    }

    let start = integerValue(entry.start_ordinal, 0);
    let end = integerValue(entry.end_ordinal, 0);
    const domainSize = isTranslationConstraintKey(key)
      ? anchorCount
      : rotationEventCount;

    if (
      domainSize > 0 &&
      start >= 0 &&
      start <= domainSize - 1 &&
      end >= 0 &&
      end <= domainSize - 1
    ) {
      start += 1;
      end += 1;
    } else if (start === 0 || end === 0) {
      start += 1;
      end += 1;
    }

    path.ranged_constraints.push({
      key,
      value,
      start_ordinal: start,
      end_ordinal: end
    });
  }

  repairLoadedRangedConstraints(path);
}

function normalizeRangedBlock(rangedBlock: unknown): JsonObject[] {
  if (Array.isArray(rangedBlock)) {
    return rangedBlock.filter(isObject);
  }

  if (!isObject(rangedBlock)) {
    return [];
  }

  const normalized: JsonObject[] = [];
  for (const [key, entries] of Object.entries(rangedBlock)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      if (isObject(entry)) {
        normalized.push({ ...entry, key });
      }
    }
  }

  return normalized;
}

function repairLoadedRangedConstraints(path: PathModel): void {
  const anchorCount = countAnchorElements(path.path_elements);
  const rotationEventCount = countRotationEventElements(path.path_elements);
  const occupiedByKey = new Map<string, Set<number>>();
  const repaired: RangedConstraint[] = [];

  for (const constraint of path.ranged_constraints) {
    const domainSize = isTranslationConstraintKey(constraint.key)
      ? anchorCount
      : isRotationConstraintKey(constraint.key)
        ? rotationEventCount
        : null;

    if (domainSize === null) {
      repaired.push(constraint);
      continue;
    }

    if (domainSize <= 0) {
      continue;
    }

    let start = Math.max(1, Math.min(Math.trunc(constraint.start_ordinal), domainSize));
    let end = Math.max(1, Math.min(Math.trunc(constraint.end_ordinal), domainSize));

    if (end < start) {
      [start, end] = [end, start];
    }

    const covered = occupiedByKey.get(constraint.key) ?? new Set<number>();
    occupiedByKey.set(constraint.key, covered);

    let bestRun: readonly [number, number] | null = null;
    let runStart: number | null = null;

    for (let ordinal = start; ordinal <= end; ordinal += 1) {
      if (covered.has(ordinal)) {
        if (runStart !== null) {
          bestRun = chooseLongerRun(bestRun, [runStart, ordinal - 1]);
          runStart = null;
        }
        continue;
      }

      if (runStart === null) {
        runStart = ordinal;
      }
    }

    if (runStart !== null) {
      bestRun = chooseLongerRun(bestRun, [runStart, end]);
    }

    if (bestRun === null) {
      continue;
    }

    const [repairedStart, repairedEnd] = bestRun;
    for (let ordinal = repairedStart; ordinal <= repairedEnd; ordinal += 1) {
      covered.add(ordinal);
    }

    repaired.push({
      ...constraint,
      start_ordinal: repairedStart,
      end_ordinal: repairedEnd
    });
  }

  path.ranged_constraints = repaired;
}

function chooseLongerRun(
  current: readonly [number, number] | null,
  candidate: readonly [number, number]
): readonly [number, number] {
  if (current === null) {
    return candidate;
  }

  return candidate[1] - candidate[0] > current[1] - current[0]
    ? candidate
    : current;
}

function convertLegacyPositions(path: PathModel): void {
  path.path_elements.forEach((element, index) => {
    const rotation = rotationTargetForLegacyConversion(element);
    if (
      rotation === null ||
      rotation.legacy_position === null ||
      rotation.legacy_converted
    ) {
      return;
    }

    const previous = findNeighbor(path.path_elements, index, true);
    const next = findNeighbor(path.path_elements, index, false);

    if (previous === null || next === null) {
      rotation.t_ratio = 0;
    } else {
      const [rx, ry] = rotation.legacy_position;
      const [ax, ay] = previous;
      const [bx, by] = next;
      const dx = bx - ax;
      const dy = by - ay;
      const denominator = dx * dx + dy * dy;
      rotation.t_ratio =
        denominator <= 0 ? 0 : clamp(((rx - ax) * dx + (ry - ay) * dy) / denominator);
    }

    rotation.legacy_position = null;
    rotation.legacy_converted = true;
  });
}

function rotationTargetForLegacyConversion(element: PathElement): RotationTarget | null {
  if (element.type === "rotation") {
    return element;
  }

  if (element.type === "waypoint") {
    return element.rotation_target;
  }

  return null;
}

function findNeighbor(
  elements: readonly PathElement[],
  startIndex: number,
  reverse: boolean
): readonly [number, number] | null {
  const nextIndex = reverse
    ? (index: number) => index - 1
    : (index: number) => index + 1;
  const inBounds = reverse
    ? (index: number) => index >= 0
    : (index: number) => index < elements.length;

  for (let index = nextIndex(startIndex); inBounds(index); index = nextIndex(index)) {
    const element = elements[index];
    if (element.type === "translation") {
      return [element.x_meters, element.y_meters];
    }
    if (element.type === "waypoint") {
      return [
        element.translation_target.x_meters,
        element.translation_target.y_meters
      ];
    }
  }

  return null;
}

function handoffDefault(value: unknown, defaultLookup?: DefaultLookup): number | null {
  const option = optionalNumber(value);
  if (option !== null) {
    return option;
  }

  return defaultLookup?.("intermediate_handoff_radius_meters") ?? null;
}

function legacyPositionFrom(input: JsonObject): readonly [number, number] | null {
  const x = optionalNumber(input.x_meters);
  const y = optionalNumber(input.y_meters);
  return x === null || y === null ? null : [x, y];
}

function readProjectConfig(input: unknown): ProjectConfig {
  return isObject(input) ? input : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function booleanValue(value: unknown, defaultValue: boolean): boolean {
  return value === undefined ? defaultValue : Boolean(value);
}

function numberValue(value: unknown, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = optionalNumber(value);
  if (parsed === null) {
    throw new Error("Expected numeric value");
  }

  return parsed;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: unknown, defaultValue: number): number {
  const parsed = optionalNumber(value);
  return parsed === null ? defaultValue : Math.trunc(parsed);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isObject(input: unknown): input is JsonObject {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

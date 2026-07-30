import {
  getHandoffRadiusSource,
  isAnchorElement,
  isTranslationTarget,
  isWaypoint,
  setHandoffRadiusSource,
  type PathElement,
  type PathModel,
} from "../model/path";
import { cornerGeometry, seedRadius, type BendPoint } from "./cornerBend";

export interface AutoSeedHandoffResult {
  path: PathModel;
  seededElementIndexes: number[];
}

/**
 * Seeds handoff radii for corners nobody has tuned: interior anchors whose
 * radius is unset or already auto-tagged. Manual and untagged-but-set radii are
 * locked. Neighboring handoffs are deliberately not repaired geometrically:
 * each radius ends its incoming segment, so adjacent radii do not consume two
 * ends of the same fillet. Their interaction belongs to trace-based validation.
 */
export function seedHandoffRadii(path: PathModel): AutoSeedHandoffResult {
  const anchors = anchorPoints(path.path_elements);
  if (anchors.length < 3) {
    return { path, seededElementIndexes: [] };
  }

  const points: BendPoint[] = anchors.map((anchor) => ({
    x: anchor.x,
    y: anchor.y,
  }));
  const radii: (number | null)[] = anchors.map(() => null);
  const seedableOrdinals: number[] = [];

  for (let ordinal = 1; ordinal < anchors.length - 1; ordinal += 1) {
    const element = path.path_elements[anchors[ordinal].elementIndex];
    if (isSeedable(element)) {
      const geometry = cornerGeometry(points, ordinal);
      const seeded = geometry ? seedRadius(geometry) : null;
      if (seeded !== null) {
        radii[ordinal] = seeded;
        seedableOrdinals.push(ordinal);
      }
    } else {
      radii[ordinal] = storedRadius(element);
    }
  }

  if (seedableOrdinals.length === 0) {
    return { path, seededElementIndexes: [] };
  }

  const seededElementIndexes: number[] = [];
  const elements = [...path.path_elements];
  for (const ordinal of seedableOrdinals) {
    const value = radii[ordinal];
    if (value === null) {
      continue;
    }

    const elementIndex = anchors[ordinal].elementIndex;
    const withRadius = withHandoffRadius(
      elements[elementIndex],
      Math.round(value * 1000) / 1000,
    );
    elements[elementIndex] = setHandoffRadiusSource(withRadius, "auto");
    seededElementIndexes.push(elementIndex);
  }

  return {
    path: { ...path, path_elements: elements },
    seededElementIndexes,
  };
}

export function seedableHandoffElementIndexes(
  elements: readonly PathElement[],
): number[] {
  const anchors = anchorPoints(elements);
  const indexes: number[] = [];
  for (let ordinal = 1; ordinal < anchors.length - 1; ordinal += 1) {
    if (isSeedable(elements[anchors[ordinal].elementIndex])) {
      indexes.push(anchors[ordinal].elementIndex);
    }
  }
  return indexes;
}

function isSeedable(element: PathElement | undefined): boolean {
  if (!element || !isAnchorElement(element)) {
    return false;
  }

  return (
    getHandoffRadiusSource(element) === "auto" || storedRadius(element) === null
  );
}

function storedRadius(element: PathElement | undefined): number | null {
  const raw =
    element && isTranslationTarget(element)
      ? element.intermediate_handoff_radius_meters
      : element && isWaypoint(element)
        ? element.translation_target.intermediate_handoff_radius_meters
        : null;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : null;
}

function withHandoffRadius(
  element: PathElement,
  radiusMeters: number,
): PathElement {
  if (isTranslationTarget(element)) {
    return { ...element, intermediate_handoff_radius_meters: radiusMeters };
  }

  if (isWaypoint(element)) {
    return {
      ...element,
      translation_target: {
        ...element.translation_target,
        intermediate_handoff_radius_meters: radiusMeters,
      },
    };
  }

  return element;
}

function anchorPoints(
  elements: readonly PathElement[],
): Array<{ elementIndex: number; x: number; y: number }> {
  return elements.flatMap((element, elementIndex) => {
    if (isTranslationTarget(element)) {
      return [{ elementIndex, x: element.x_meters, y: element.y_meters }];
    }
    if (isWaypoint(element)) {
      return [
        {
          elementIndex,
          x: element.translation_target.x_meters,
          y: element.translation_target.y_meters,
        },
      ];
    }
    return [];
  });
}

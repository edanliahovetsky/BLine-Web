import {
  isRotationConstraintKey,
  isTranslationConstraintKey,
  type PathElement,
  type RangedConstraint
} from "../core/model/path";

export function domainIndexesForConstraint(
  elements: readonly PathElement[],
  constraint: Pick<RangedConstraint, "key">
): number[] {
  return elements.flatMap((element, index) => {
    if (
      isTranslationConstraintKey(constraint.key) &&
      (element.type === "translation" || element.type === "waypoint")
    ) {
      return [index];
    }

    if (
      isRotationConstraintKey(constraint.key) &&
      (element.type === "rotation" ||
        element.type === "waypoint" ||
        element.type === "event_trigger")
    ) {
      return [index];
    }

    return [];
  });
}

export function coveredDomainIndexesForConstraint(
  elements: readonly PathElement[],
  constraint: RangedConstraint
): number[] {
  const domain = domainIndexesForConstraint(elements, constraint);
  if (domain.length === 0) {
    return [];
  }

  const [start, end] = normalizedRange(constraint, domain.length);
  return domain.slice(start - 1, end);
}

export function pathIndexesForConstraintRange(
  elements: readonly PathElement[],
  constraint: RangedConstraint
): number[] {
  const domain = domainIndexesForConstraint(elements, constraint);
  if (domain.length === 0) {
    return [];
  }

  const [start, end] = normalizedRange(constraint, domain.length);
  const startDomainIndex = start === 1 ? 0 : start - 2;
  const endDomainIndex = end - 1;
  const startGlobalIndex = domain[startDomainIndex];
  const endGlobalIndex = domain[endDomainIndex];

  if (startGlobalIndex === undefined || endGlobalIndex === undefined) {
    return [];
  }

  const lower = Math.min(startGlobalIndex, endGlobalIndex);
  const upper = Math.max(startGlobalIndex, endGlobalIndex);
  return elements.flatMap((_element, index) =>
    index >= lower && index <= upper ? [index] : []
  );
}

export function firstDomainIndexForConstraintRange(
  elements: readonly PathElement[],
  constraint: RangedConstraint
): number | null {
  const startOrdinal = Number.isFinite(constraint.start_ordinal)
    ? Math.trunc(constraint.start_ordinal)
    : 1;
  if (startOrdinal > 1) {
    return null;
  }

  const domain = domainIndexesForConstraint(elements, constraint);
  return domain[0] ?? null;
}

function normalizedRange(
  constraint: Pick<RangedConstraint, "start_ordinal" | "end_ordinal">,
  total: number
): readonly [number, number] {
  const start = clampOrdinal(constraint.start_ordinal, total);
  const end = clampOrdinal(constraint.end_ordinal, total);
  return start <= end ? [start, end] : [end, start];
}

function clampOrdinal(value: number, total: number): number {
  const ordinal = Number.isFinite(value) ? Math.trunc(value) : 1;
  return Math.max(1, Math.min(ordinal, Math.max(1, total)));
}

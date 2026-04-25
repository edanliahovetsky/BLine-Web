import {
  isRotationConstraintKey,
  isTranslationConstraintKey,
  type PathElement,
  type PathModel,
  type RangedConstraint,
  type RangedConstraintKey
} from "../model/path";

export function appendRangedConstraintInstance(
  constraints: RangedConstraint[],
  key: RangedConstraintKey,
  value: number,
  total: number
): RangedConstraint | null {
  const normalizedTotal = Math.max(0, Math.trunc(total));
  if (normalizedTotal <= 0) {
    return null;
  }

  const occupied = new Set<number>();
  for (const constraint of constraintsForKey(constraints, key)) {
    const [start, end] = normalizedBounds(constraint, normalizedTotal);
    for (let ordinal = start; ordinal <= end; ordinal += 1) {
      occupied.add(ordinal);
    }
  }

  for (let ordinal = 1; ordinal <= normalizedTotal; ordinal += 1) {
    if (!occupied.has(ordinal)) {
      const constraint: RangedConstraint = {
        key,
        value,
        start_ordinal: ordinal,
        end_ordinal: ordinal
      };
      constraints.push(constraint);
      return constraint;
    }
  }

  let largestConstraint: RangedConstraint | null = null;
  let largestLength = 0;
  for (const constraint of constraintsForKey(constraints, key)) {
    const [start, end] = normalizedBounds(constraint, normalizedTotal);
    const length = end - start + 1;
    if (length > largestLength) {
      largestConstraint = constraint;
      largestLength = length;
    }
  }

  if (largestConstraint === null || largestLength < 2) {
    return null;
  }

  return splitRangedConstraintInstance(constraints, largestConstraint, value);
}

export function splitRangedConstraintInstance(
  constraints: RangedConstraint[],
  constraint: RangedConstraint,
  value = constraint.value
): RangedConstraint | null {
  const start = Math.min(
    Math.trunc(constraint.start_ordinal),
    Math.trunc(constraint.end_ordinal)
  );
  const end = Math.max(
    Math.trunc(constraint.start_ordinal),
    Math.trunc(constraint.end_ordinal)
  );

  if (end <= start) {
    return null;
  }

  const midpoint = Math.floor((start + end) / 2);
  constraint.start_ordinal = start;
  constraint.end_ordinal = midpoint;

  const newConstraint: RangedConstraint = {
    key: constraint.key,
    value,
    start_ordinal: midpoint + 1,
    end_ordinal: end
  };

  const index = constraints.indexOf(constraint);
  if (index === -1) {
    constraints.push(newConstraint);
  } else {
    constraints.splice(index + 1, 0, newConstraint);
  }

  return newConstraint;
}

export function remapRangedConstraints(
  path: PathModel,
  oldElements: readonly PathElement[]
): void {
  const nextElements = path.path_elements;
  const surviving: RangedConstraint[] = [];

  for (const constraint of path.ranged_constraints) {
    const oldDomain = domainForKey(constraint.key, oldElements);
    const newDomain = domainForKey(constraint.key, nextElements);

    if (newDomain.length === 0) {
      continue;
    }

    const newElementToOrdinal = new Map<PathElement, number>();
    newDomain.forEach((element, index) => {
      newElementToOrdinal.set(element, index + 1);
    });

    const oldStart = Math.min(
      Math.trunc(constraint.start_ordinal),
      Math.trunc(constraint.end_ordinal)
    );
    const oldEnd = Math.max(
      Math.trunc(constraint.start_ordinal),
      Math.trunc(constraint.end_ordinal)
    );
    const survivingOrdinals: number[] = [];

    for (let ordinal = oldStart; ordinal <= oldEnd; ordinal += 1) {
      const element = oldDomain[ordinal - 1];
      const nextOrdinal =
        element === undefined ? undefined : newElementToOrdinal.get(element);
      if (nextOrdinal !== undefined) {
        survivingOrdinals.push(nextOrdinal);
      }
    }

    if (survivingOrdinals.length === 0) {
      continue;
    }

    survivingOrdinals.sort((a, b) => a - b);
    surviving.push({
      ...constraint,
      start_ordinal: survivingOrdinals[0],
      end_ordinal: survivingOrdinals[survivingOrdinals.length - 1]
    });
  }

  path.ranged_constraints = surviving;
}

export function translationDomain(
  elements: readonly PathElement[]
): PathElement[] {
  return elements.filter(
    (element) => element.type === "translation" || element.type === "waypoint"
  );
}

export function rotationDomain(elements: readonly PathElement[]): PathElement[] {
  return elements.filter(
    (element) =>
      element.type === "rotation" ||
      element.type === "waypoint" ||
      element.type === "event_trigger"
  );
}

export function domainForKey(
  key: RangedConstraintKey,
  elements: readonly PathElement[]
): PathElement[] {
  if (isTranslationConstraintKey(key)) {
    return translationDomain(elements);
  }

  if (isRotationConstraintKey(key)) {
    return rotationDomain(elements);
  }

  return [];
}

function constraintsForKey(
  constraints: readonly RangedConstraint[],
  key: RangedConstraintKey
): RangedConstraint[] {
  return constraints.filter((constraint) => constraint.key === key);
}

function normalizedBounds(
  constraint: RangedConstraint,
  total: number
): readonly [number, number] {
  const start = Math.max(
    1,
    Math.min(Math.trunc(constraint.start_ordinal), total)
  );
  const end = Math.max(1, Math.min(Math.trunc(constraint.end_ordinal), total));
  return start <= end ? [start, end] : [end, start];
}

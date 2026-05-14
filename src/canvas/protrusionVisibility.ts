import {
  createProjectConfig,
  type CanonicalProjectConfig,
} from "../core/config/projectConfig";
import {
  isAnchorElement,
  isEventTrigger,
  isRotationTarget,
  isWaypoint,
  type PathElement,
} from "../core/model/path";
import {
  getElementPositionMeters,
  type PointMeters,
  type PositionOverrides,
} from "./geometry";

interface AnchorProgress {
  index: number;
  position: PointMeters;
}

interface ProtrusionTrigger {
  sMeters: number;
  pathIndex: number;
  visible: boolean;
}

export function buildElementProtrusionVisibilityByIndex(
  elements: readonly PathElement[],
  rawConfig: unknown,
  positionOverrides: PositionOverrides = emptyPositionOverrides,
): Map<number, boolean> {
  const visibilityByIndex = new Map<number, boolean>();
  const protrusions = createProjectConfig(rawConfig).gui.protrusions;
  const geometry = buildAnchorProgressGeometry(elements, positionOverrides);

  for (const [index, element] of elements.entries()) {
    if (isWaypoint(element) || isRotationTarget(element)) {
      visibilityByIndex.set(index, false);
    }
  }

  if (!protrusions.enabled || visibilityByIndex.size === 0) {
    return visibilityByIndex;
  }

  const schedule = buildProtrusionTriggerSchedule(
    elements,
    protrusions,
    geometry.anchorSByPathIndex,
  );

  for (const index of visibilityByIndex.keys()) {
    const sMeters = elementProgressMeters(
      elements,
      index,
      geometry.anchorSByPathIndex,
    );
    visibilityByIndex.set(
      index,
      sMeters === null
        ? protrusions.default_state === "shown"
        : protrusionVisibleAtS(
            sMeters,
            protrusions.default_state === "shown",
            schedule,
          ),
    );
  }

  return visibilityByIndex;
}

function buildAnchorProgressGeometry(
  elements: readonly PathElement[],
  positionOverrides: PositionOverrides,
): {
  anchors: AnchorProgress[];
  anchorSByPathIndex: ReadonlyMap<number, number>;
} {
  const anchors: AnchorProgress[] = [];
  for (const [index, element] of elements.entries()) {
    if (!isAnchorElement(element)) {
      continue;
    }

    const position = getElementPositionMeters(
      elements,
      index,
      positionOverrides,
    );
    if (position) {
      anchors.push({ index, position });
    }
  }

  const anchorSByPathIndex = new Map<number, number>();
  if (anchors.length === 0) {
    return { anchors, anchorSByPathIndex };
  }

  anchorSByPathIndex.set(anchors[0].index, 0);
  let cumulative = 0;
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const current = anchors[index];
    const next = anchors[index + 1];
    anchorSByPathIndex.set(current.index, cumulative);
    cumulative += distanceMeters(current.position, next.position);
    anchorSByPathIndex.set(next.index, cumulative);
  }

  return { anchors, anchorSByPathIndex };
}

function buildProtrusionTriggerSchedule(
  elements: readonly PathElement[],
  protrusions: CanonicalProjectConfig["gui"]["protrusions"],
  anchorSByPathIndex: ReadonlyMap<number, number>,
): ProtrusionTrigger[] {
  const showKeys = new Set(protrusions.show_on_event_keys);
  const hideKeys = new Set(protrusions.hide_on_event_keys);
  if (showKeys.size === 0 && hideKeys.size === 0) {
    return [];
  }

  const schedule: ProtrusionTrigger[] = [];
  for (const [pathIndex, element] of elements.entries()) {
    if (!isEventTrigger(element)) {
      continue;
    }

    const key = element.lib_key.trim();
    const visible = showKeys.has(key) ? true : hideKeys.has(key) ? false : null;
    if (!key || visible === null) {
      continue;
    }

    const sMeters = elementProgressMeters(
      elements,
      pathIndex,
      anchorSByPathIndex,
    );
    if (sMeters === null) {
      continue;
    }

    schedule.push({ sMeters, pathIndex, visible });
  }

  return schedule.sort(
    (a, b) => a.sMeters - b.sMeters || a.pathIndex - b.pathIndex,
  );
}

function protrusionVisibleAtS(
  sMeters: number,
  defaultVisible: boolean,
  schedule: readonly ProtrusionTrigger[],
): boolean {
  let visible = defaultVisible;
  for (const trigger of schedule) {
    if (sMeters + 1e-6 >= trigger.sMeters) {
      visible = trigger.visible;
    } else {
      break;
    }
  }
  return visible;
}

function elementProgressMeters(
  elements: readonly PathElement[],
  index: number,
  anchorSByPathIndex: ReadonlyMap<number, number>,
): number | null {
  const element = elements[index];
  if (!element) {
    return null;
  }

  if (isWaypoint(element)) {
    return anchorSByPathIndex.get(index) ?? null;
  }

  if (isRotationTarget(element) || isEventTrigger(element)) {
    const bracket = neighborAnchorIndexes(elements, index);
    if (!bracket) {
      return null;
    }

    const s0 = anchorSByPathIndex.get(bracket.previous);
    const s1 = anchorSByPathIndex.get(bracket.next);
    if (s0 === undefined || s1 === undefined) {
      return null;
    }

    return s0 + clamp01(element.t_ratio) * Math.max(0, s1 - s0);
  }

  return null;
}

function neighborAnchorIndexes(
  elements: readonly PathElement[],
  index: number,
): { previous: number; next: number } | null {
  let previous: number | null = null;
  let next: number | null = null;

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (isAnchorElement(elements[cursor])) {
      previous = cursor;
      break;
    }
  }

  for (let cursor = index + 1; cursor < elements.length; cursor += 1) {
    if (isAnchorElement(elements[cursor])) {
      next = cursor;
      break;
    }
  }

  return previous === null || next === null ? null : { previous, next };
}

function distanceMeters(a: PointMeters, b: PointMeters): number {
  return Math.hypot(b.x_meters - a.x_meters, b.y_meters - a.y_meters);
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

const emptyPositionOverrides = new Map<number, PointMeters>();

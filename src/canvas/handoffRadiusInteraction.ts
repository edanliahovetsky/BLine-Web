import {
  cornerGeometry,
  feasibleRadiusRange,
  type BendPoint,
  type FeasibleRadiusRange,
} from "../core/bend/cornerBend";
import {
  anchorHandoffRadii,
  type AnchorRadiusState,
} from "../core/model/handoffRadii";
import type { HandoffRadiusSource, PathElement } from "../core/model/path";
import {
  anchorNodeExclusionRadiusPx,
  getAnchorPositions,
  modelToStagePoint,
  type FieldViewport,
  type PointMeters,
  type PositionOverrides,
  type StagePoint,
} from "./geometry";

/**
 * One interior anchor's handoff ring: the circle the canvas draws and the band
 * a drag grabs. Endpoints take no ring — their radius has no runtime effect.
 */
export interface HandoffRing {
  elementIndex: number;
  /** Position among the anchors, 1-based, matching the Constraints tab chips. */
  ordinal: number;
  anchorPosition: PointMeters;
  /** Persisted value before any live drag preview. */
  storedRadiusMeters: number | null;
  /** What the follower would use: the stored radius, or the config default. */
  radiusMeters: number;
  source: HandoffRadiusSource | null;
  state: AnchorRadiusState;
  /** What the corner's legs can honor, or null where nothing can be dragged. */
  range: FeasibleRadiusRange | null;
}

/** The annulus around an anchor where a pointer grabs its ring edge. */
export interface HandoffRingGrabBand {
  innerPx: number;
  outerPx: number;
}

export function handoffRingsForPath(
  elements: readonly PathElement[],
  defaultRadiusMeters: number,
  overrides: PositionOverrides = emptyOverrides,
): HandoffRing[] {
  const anchors = getAnchorPositions(elements, overrides);
  const points: BendPoint[] = anchors.map((anchor) => ({
    x: anchor.position.x_meters,
    y: anchor.position.y_meters,
  }));

  return anchorHandoffRadii(elements, defaultRadiusMeters).flatMap((radius) => {
    if (radius.inert) {
      return [];
    }

    const ordinalIndex = radius.ordinal - 1;
    const anchor = anchors[ordinalIndex];
    if (!anchor || anchor.index !== radius.elementIndex) {
      return [];
    }

    return [
      {
        elementIndex: radius.elementIndex,
        ordinal: radius.ordinal,
        anchorPosition: anchor.position,
        storedRadiusMeters: radius.valueMeters,
        radiusMeters: radius.effectiveValueMeters,
        source: radius.source,
        state: radius.state,
        range: feasibleRadiusRange(cornerGeometry(points, ordinalIndex)),
      },
    ];
  });
}

/** Ring radius on screen, floored so a tiny radius stays visible and grabbable. */
export function handoffRingRadiusPx(
  radiusMeters: number,
  metersToPixels: number,
): number {
  return Math.max(minHandoffRingRadiusPx, radiusMeters * metersToPixels);
}

/**
 * The grabbable band around a ring: a narrow ring-edge window, pushed clear of
 * the ring the anchor node claims for itself, and widened to stay usable when
 * the view is zoomed far out. Null where the node leaves no room at all.
 */
export function handoffRingGrabBand(
  ringRadiusPx: number,
  exclusionRadiusPx: number,
): HandoffRingGrabBand | null {
  const innerPx = Math.max(exclusionRadiusPx, ringRadiusPx - ringGrabBandPx);
  const outerPx = Math.max(
    ringRadiusPx + ringGrabBandPx,
    innerPx + minRingGrabBandPx,
  );

  return outerPx > innerPx ? { innerPx, outerPx } : null;
}

/**
 * The ring whose edge is under the pointer, nearest edge first. Anchor nodes are
 * hit-tested inside their own exclusion ring, so a ring grab never shadows a
 * node grab.
 */
export function hitTestHandoffRing(
  rings: readonly HandoffRing[],
  viewport: FieldViewport,
  pointer: StagePoint,
): HandoffRing | null {
  const exclusionRadiusPx = anchorNodeExclusionRadiusPx(viewport);
  let best: HandoffRing | null = null;
  let bestOffsetPx = Number.POSITIVE_INFINITY;

  for (const ring of rings) {
    // A corner the follower cannot round has no radius to drag toward.
    if (!ring.range) {
      continue;
    }

    const center = modelToStagePoint(ring.anchorPosition, viewport);
    const distancePx = Math.hypot(pointer.x - center.x, pointer.y - center.y);
    const ringRadiusPx = handoffRingRadiusPx(ring.radiusMeters, viewport.scale);
    const band = handoffRingGrabBand(ringRadiusPx, exclusionRadiusPx);
    if (!band || distancePx < band.innerPx || distancePx > band.outerPx) {
      continue;
    }

    const offsetPx = Math.abs(distancePx - ringRadiusPx);
    if (offsetPx < bestOffsetPx) {
      best = ring;
      bestOffsetPx = offsetPx;
    }
  }

  return best;
}

/**
 * The radius the ring would take with its edge under the pointer: the pointer's
 * distance from the anchor, clamped to what the corner's legs can honor.
 */
export function handoffRadiusForPointer(
  ring: HandoffRing,
  pointerMeters: PointMeters,
): number | null {
  if (!ring.range) {
    return null;
  }

  const distanceMeters = Math.hypot(
    pointerMeters.x_meters - ring.anchorPosition.x_meters,
    pointerMeters.y_meters - ring.anchorPosition.y_meters,
  );
  return Math.min(
    ring.range.maxMeters,
    Math.max(ring.range.minMeters, distanceMeters),
  );
}

const emptyOverrides = new Map<number, PointMeters>();
const minHandoffRingRadiusPx = 8;
const ringGrabBandPx = 10;
const minRingGrabBandPx = 22;

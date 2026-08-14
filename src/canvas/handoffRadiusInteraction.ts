import {
  anchorHandoffRadii,
  type AnchorRadiusState,
} from "../core/model/handoffRadii";
import type { PathElement } from "../core/model/path";
import {
  getAnchorPositions,
  type PointMeters,
  type PositionOverrides,
} from "./geometry";

/**
 * One interior anchor's rendered handoff ring. Endpoints take no ring because
 * their radius has no runtime effect.
 */
export interface HandoffRing {
  elementIndex: number;
  /** Position among the anchors, 1-based, matching the Constraints tab chips. */
  ordinal: number;
  anchorPosition: PointMeters;
  /** What the follower would use: the stored radius, or the config default. */
  radiusMeters: number;
  state: AnchorRadiusState;
}

export function handoffRingsForPath(
  elements: readonly PathElement[],
  defaultRadiusMeters: number,
  overrides: PositionOverrides = emptyOverrides,
): HandoffRing[] {
  const anchors = getAnchorPositions(elements, overrides);

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
        radiusMeters: radius.effectiveValueMeters,
        state: radius.state,
      },
    ];
  });
}

/** Ring radius on screen, floored so a tiny radius stays visible. */
export function handoffRingRadiusPx(
  radiusMeters: number,
  metersToPixels: number,
): number {
  return Math.max(minHandoffRingRadiusPx, radiusMeters * metersToPixels);
}

const emptyOverrides = new Map<number, PointMeters>();
const minHandoffRingRadiusPx = 8;

import {
  getDefaultOptionalConfigValue,
  type CanonicalProjectConfig,
} from "../config/projectConfig";
import {
  getHandoffRadiusSource,
  isAnchorElement,
  isTranslationTarget,
  isWaypoint,
  type HandoffRadiusSource,
  type PathElement,
} from "./path";

/** What owns an anchor's handoff radius, as every surface presents it. */
export type AnchorRadiusState = "auto" | "manual" | "unset";

/**
 * One anchor's handoff radius as the editor presents it — on the Constraints
 * tab's chips and on the canvas rings alike. Pure so the ordinal numbering, the
 * endpoint inertness and the auto/manual classification are testable without a
 * rendered card or a canvas.
 */
export interface AnchorHandoffRadius {
  elementIndex: number;
  /** Position among the anchors, 1-based; non-anchor elements take no slot. */
  ordinal: number;
  valueMeters: number | null;
  /** What the follower would use: the stored radius, or the config default. */
  effectiveValueMeters: number;
  source: HandoffRadiusSource | null;
  state: AnchorRadiusState;
  /**
   * Endpoints carry a radius with no runtime effect: a segment hands off at its
   * target anchor, so the first anchor is never a target and the last one
   * finishes by tolerance rather than by a handoff.
   */
  inert: boolean;
}

export function anchorHandoffRadii(
  elements: readonly PathElement[],
  defaultRadiusMeters: number,
): AnchorHandoffRadius[] {
  const anchors = elements.flatMap((element, elementIndex) =>
    isAnchorElement(element) ? [{ element, elementIndex }] : [],
  );

  return anchors.map(({ element, elementIndex }, position) => {
    const valueMeters = storedHandoffRadiusMeters(element);
    const source = getHandoffRadiusSource(element);

    return {
      elementIndex,
      ordinal: position + 1,
      valueMeters,
      effectiveValueMeters: valueMeters ?? defaultRadiusMeters,
      source,
      // An untagged value is somebody's choice the optimizer must not take
      // over, so it reads as pinned exactly like an explicit manual tag.
      state:
        valueMeters === null ? "unset" : source === "auto" ? "auto" : "manual",
      inert: position === 0 || position === anchors.length - 1,
    };
  });
}

export function storedHandoffRadiusMeters(element: PathElement): number | null {
  const raw = isTranslationTarget(element)
    ? element.intermediate_handoff_radius_meters
    : isWaypoint(element)
      ? element.translation_target.intermediate_handoff_radius_meters
      : null;
  // The follower falls back to the default for anything not positive, so an
  // unusable stored value reads as unset here too.
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : null;
}

/** The radius an anchor with nothing stored drives at. */
export function defaultHandoffRadiusMeters(
  config: CanonicalProjectConfig,
): number {
  return (
    getDefaultOptionalConfigValue(
      config,
      "intermediate_handoff_radius_meters",
    ) ?? fallbackHandoffRadiusMeters
  );
}

const fallbackHandoffRadiusMeters = 0.45;

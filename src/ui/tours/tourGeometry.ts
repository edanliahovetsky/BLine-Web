export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const spotlightPadding = 6;

export function paddedViewportRect(
  box: Pick<DOMRect, "top" | "left" | "right" | "bottom">,
  viewportWidth: number,
  viewportHeight: number,
): TourRect | null {
  const top = clampTo(box.top - spotlightPadding, viewportHeight);
  const left = clampTo(box.left - spotlightPadding, viewportWidth);
  const right = clampTo(box.right + spotlightPadding, viewportWidth);
  const bottom = clampTo(box.bottom + spotlightPadding, viewportHeight);

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    top,
    left,
    width: right - left,
    height: bottom - top,
  };
}

function clampTo(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

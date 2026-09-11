export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const spotlightPadding = 6;

/** Match the part of a control that is actually visible in a scrolling panel. */
export function visibleTourRect(element: HTMLElement): TourRect | null {
  if (!element.checkVisibility({ visibilityProperty: true })) return null;
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const visible = {
    top: box.top,
    left: box.left,
    right: box.right,
    bottom: box.bottom,
  };
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    const clip = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      visible.left = Math.max(visible.left, clip.left);
      visible.right = Math.min(visible.right, clip.right);
    }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
      visible.top = Math.max(visible.top, clip.top);
      visible.bottom = Math.min(visible.bottom, clip.bottom);
    }
  }
  if (visible.right <= visible.left || visible.bottom <= visible.top)
    return null;
  return paddedViewportRect(visible, window.innerWidth, window.innerHeight);
}

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

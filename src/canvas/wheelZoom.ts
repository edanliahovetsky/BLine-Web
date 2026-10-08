/** Smallest per-event step, preserving the established trackpad feel. */
const minimumStep = 1.03;
/**
 * Largest per-event step: one mouse notch, so fast trackpad flicks (which
 * also report large deltas) stay controllable.
 */
const maximumStep = 1.1;
/** A standard 100px mouse-wheel notch zooms by about 10%. */
const stepPerPixel = Math.log(1.1) / 100;
const lineHeightPx = 16;

/**
 * Zoom multiplier for one wheel event. Small trackpad deltas keep the fixed
 * minimum step; larger mouse-wheel deltas scale proportionally so a notch
 * covers useful distance instead of three percent.
 */
export function wheelZoomFactor(event: {
  deltaY: number;
  deltaMode?: number;
}): number {
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) {
    return 1;
  }
  const pixels =
    Math.abs(event.deltaY) *
    (event.deltaMode === 1 ? lineHeightPx : event.deltaMode === 2 ? 800 : 1);
  const step = Math.min(
    maximumStep,
    Math.max(minimumStep, Math.exp(pixels * stepPerPixel)),
  );
  return event.deltaY > 0 ? 1 / step : step;
}

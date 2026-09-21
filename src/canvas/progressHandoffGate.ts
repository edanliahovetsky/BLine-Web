import type { StagePoint } from "./geometry";

export interface ProgressHandoffGate {
  center: StagePoint;
  lengthPx: number;
  dashes: { start: StagePoint; end: StagePoint }[];
}

/** Display-only geometry: endpoints never constrain lateral handoff behavior. */
export function progressHandoffGate(
  start: StagePoint,
  end: StagePoint,
  handoffDistanceMeters: number,
  pixelsPerMeter: number,
): ProgressHandoffGate | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const segmentLengthPx = Math.hypot(dx, dy);
  // A coincident segment has no normal. The follower handles its immediate handoff.
  if (segmentLengthPx < 1e-9) return null;
  const progress = Math.max(
    0,
    1 - (Math.max(0, handoffDistanceMeters) * pixelsPerMeter) / segmentLengthPx,
  );
  const center = { x: start.x + dx * progress, y: start.y + dy * progress };
  const lengthPx = Math.max(30, 1.2 * pixelsPerMeter);
  const normal = { x: -dy / segmentLengthPx, y: dx / segmentLengthPx };
  const point = (fraction: number): StagePoint => ({
    x: center.x + normal.x * lengthPx * fraction,
    y: center.y + normal.y * lengthPx * fraction,
  });
  // Six symmetric strokes, with five 1/10-length gaps. Explicit segments keep
  // the two 1/20-length outer dashes intact at every zoom (no repeating pattern).
  const intervals = [
    [-0.5, -0.45],
    [-0.35, -0.25],
    [-0.15, -0.05],
    [0.05, 0.15],
    [0.25, 0.35],
    [0.45, 0.5],
  ];
  return {
    center,
    lengthPx,
    dashes: intervals.map(([from, to]) => ({
      start: point(from),
      end: point(to),
    })),
  };
}

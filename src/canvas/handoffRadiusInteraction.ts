/** Ring radius on screen, floored so a tiny radius stays visible. */
export function handoffRingRadiusPx(
  radiusMeters: number,
  metersToPixels: number,
): number {
  return Math.max(minHandoffRingRadiusPx, radiusMeters * metersToPixels);
}

const minHandoffRingRadiusPx = 8;

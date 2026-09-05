type State = readonly [angle: number, velocity: number];
export interface ProfileHeadingSample {
  timeS: number;
  angle: number;
}

/**
 * Convex reachable states for a prescribed heading progression. Each step has
 * constant acceleration within the supplied limits. Clipping to the heading
 * tolerance preserves angle/velocity correlation, which separate min/max
 * ranges lose. The generator validates again at smaller timesteps.
 */
export function profiledRotationReachability(
  samples: readonly ProfileHeadingSample[],
  distance: number,
  initialVelocity: readonly [number, number],
  velocity: number,
  acceleration: number,
  tolerance: number,
  stop: boolean,
): { velocities: readonly [number, number] | null; violation: number } {
  let states: State[] = [
    [0, initialVelocity[0]],
    [0, initialVelocity[1]],
  ];
  let previousTime = 0;
  for (const sample of samples) {
    const dt = sample.timeS - previousTime;
    if (dt <= 1e-9) continue;
    const advanced = states.flatMap(([angle, omega]) =>
      [-acceleration, acceleration].map(
        (a) =>
          [angle + omega * dt + (a * dt * dt) / 2, omega + a * dt] as const,
      ),
    );
    states = hull(advanced);
    states = clip(states, 1, 0, false);
    states = clip(states, 1, velocity, true);
    // The target tube permits numerical smoothing of acceleration changes,
    // but never an overshoot/reversal to consume spare time.
    const low = Math.max(0, sample.angle - tolerance);
    const high = Math.min(distance, sample.angle + tolerance);
    const gap =
      states.length === 0
        ? tolerance
        : Math.max(
            0,
            low - Math.max(...states.map((state) => state[0])),
            Math.min(...states.map((state) => state[0])) - high,
          );
    states = clip(clip(states, 0, low, false), 0, high, true);
    if (states.length === 0)
      return { velocities: null, violation: Math.max(1e-6, gap / tolerance) };
    previousTime = sample.timeS;
  }
  states = clip(clip(states, 0, distance, false), 0, distance, true);
  if (stop) states = clip(clip(states, 1, 0, false), 1, 0, true);
  return {
    velocities:
      states.length === 0
        ? null
        : [
            Math.min(...states.map((state) => state[1])),
            Math.max(...states.map((state) => state[1])),
          ],
    violation: states.length === 0 ? 1 : 0,
  };
}

function hull(points: State[]): State[] {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a: State, b: State, c: State) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const lower: State[] = [],
    upper: State[] = [];
  for (const point of points) {
    while (
      lower.length >= 2 &&
      cross(lower.at(-2)!, lower.at(-1)!, point) <= 1e-14
    )
      lower.pop();
    lower.push(point);
  }
  for (const point of [...points].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper.at(-2)!, upper.at(-1)!, point) <= 1e-14
    )
      upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function clip(
  points: State[],
  coordinate: 0 | 1,
  bound: number,
  below: boolean,
): State[] {
  if (points.length === 0) return [];
  const result: State[] = [];
  const inside = (point: State) =>
    below
      ? point[coordinate] <= bound + 1e-10
      : point[coordinate] >= bound - 1e-10;
  let previous = points.at(-1)!;
  for (const point of points) {
    if (inside(point) !== inside(previous)) {
      const fraction =
        (bound - previous[coordinate]) /
        (point[coordinate] - previous[coordinate]);
      result.push([
        previous[0] + fraction * (point[0] - previous[0]),
        previous[1] + fraction * (point[1] - previous[1]),
      ]);
    }
    if (inside(point)) result.push(point);
    previous = point;
  }
  return result;
}

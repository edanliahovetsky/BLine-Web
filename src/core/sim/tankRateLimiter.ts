/** Chassis-only differential-drive limiting, matching BLine's TankRateLimiter. */
export interface TankVelocity {
  forward: number;
  omega: number;
}
export interface TankLimits {
  acceleration: number;
  angularAcceleration: number;
  speed: number;
  omega: number;
}
interface Candidate extends TankVelocity {
  turnError: number;
  speedError: number;
}
const epsilon = 1e-9;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

export function limitTankVelocity(
  current: TankVelocity,
  requested: TankVelocity,
  limits: TankLimits,
  dt: number,
  direction: "forward" | "backward",
): TankVelocity {
  if (!(dt > 0) || !Number.isFinite(dt)) return current;
  const reachable = {
    ...limits,
    acceleration: Math.max(
      limits.acceleration,
      Math.abs(current.forward * current.omega),
    ),
    speed: Math.max(limits.speed, Math.abs(current.forward)),
    omega: Math.max(limits.omega, Math.abs(current.omega)),
  };
  let forwardRequest = clamp(requested.forward, -limits.speed, limits.speed);
  const turnRequest = clamp(requested.omega, -limits.omega, limits.omega);
  // A tighter requested turn requires a lower speed. Without this request,
  // saturation at |v*omega|=A can strand the follower in a constant-radius orbit.
  if (Math.abs(turnRequest) > epsilon)
    forwardRequest =
      Math.sign(forwardRequest) *
      Math.min(
        Math.abs(forwardRequest),
        limits.acceleration / Math.abs(turnRequest),
      );
  const a = clamp(
    (forwardRequest - current.forward) / dt,
    -limits.acceleration,
    limits.acceleration,
  );
  const magnitude = Math.hypot(a, current.forward * turnRequest);
  const scale =
    magnitude > limits.acceleration ? limits.acceleration / magnitude : 1;
  const targetForward = current.forward + scale * a * dt;
  const targetOmega = scale * turnRequest;
  const low = Math.max(
    -reachable.omega,
    current.omega - limits.angularAcceleration * dt,
  );
  const high = Math.min(
    reachable.omega,
    current.omega + limits.angularAcceleration * dt,
  );
  let best: Candidate | null = null;
  const consider = (omega: number) => {
    const interval = accelerationInterval(current, omega, reachable, dt);
    if (!interval) return;
    let lo = current.forward + interval[0] * dt;
    let hi = current.forward + interval[1] * dt;
    if (direction === "forward")
      lo = Math.max(lo, Math.min(0, current.forward));
    else hi = Math.min(hi, Math.max(0, current.forward));
    if (lo > hi + epsilon) return;
    if (lo > hi) lo = hi = (lo + hi) / 2;
    const forward = clamp(targetForward, lo, hi);
    const turnError = Math.abs(omega - targetOmega);
    const speedError = Math.abs(forward - targetForward);
    if (
      !best ||
      turnError < best.turnError - epsilon ||
      (Math.abs(turnError - best.turnError) <= epsilon &&
        speedError < best.speedError)
    )
      best = { forward, omega, turnError, speedError };
  };
  // If the nearest angular rate is feasible, no sampled rate can improve it.
  // This is the common straight/unsaturated case; avoid searching it again.
  const winner = (): Candidate | null => best;
  consider(clamp(targetOmega, low, high));
  const direct = winner();
  if (direct) return { forward: direct.forward, omega: direct.omega };
  consider(current.omega);
  if (low <= 0 && high >= 0) consider(0);
  let spacing = (high - low) / 32;
  for (let i = 0; i <= 32; i++) consider(low + spacing * i);
  for (let refinement = 0; refinement < 8; refinement++) {
    const selected = winner();
    if (!selected) break;
    const centre = selected.omega;
    spacing /= 2;
    consider(Math.max(low, centre - spacing));
    consider(Math.min(high, centre + spacing));
  }
  const selected = winner();
  if (!selected) throw new Error("No finite tank velocity transition");
  return { forward: selected.forward, omega: selected.omega };
}

function accelerationInterval(
  current: TankVelocity,
  omega: number,
  limits: TankLimits,
  dt: number,
): [number, number] | null {
  const alpha = (omega - current.omega) / dt;
  let low = Math.max(
    -limits.acceleration,
    (-limits.speed - current.forward) / dt,
  );
  let high = Math.min(
    limits.acceleration,
    (limits.speed - current.forward) / dt,
  );
  for (const t of [0, dt]) {
    const w = current.omega + alpha * t;
    const qa = 1 + w * w * t * t;
    const qb = 2 * w * w * current.forward * t;
    const qc = (w * current.forward) ** 2 - limits.acceleration ** 2;
    const discriminant = qb * qb - 4 * qa * qc;
    if (discriminant < -epsilon) return null;
    const root = Math.sqrt(Math.max(0, discriminant));
    low = Math.max(low, (-qb - root) / (2 * qa));
    high = Math.min(high, (-qb + root) / (2 * qa));
  }
  if (low > high + epsilon) return null;
  if (low > high) low = high = (low + high) / 2;
  const peak = (a: number) => peakAcceleration(current, a, alpha, dt);
  const inside = (a: number) => peak(a) <= limits.acceleration + 1e-10;
  let anchor = (low + high) / 2;
  if (inside(low)) anchor = low;
  else if (inside(high)) anchor = high;
  else if (!inside(anchor)) {
    let l = low,
      h = high;
    for (let i = 0; i < 40; i++) {
      const x = l + (h - l) / 3,
        y = h - (h - l) / 3;
      if (peak(x) < peak(y)) h = y;
      else l = x;
    }
    anchor = (l + h) / 2;
    if (!inside(anchor)) return null;
  }
  if (!inside(low)) {
    let l = low,
      h = anchor;
    for (let i = 0; i < 40; i++) {
      const mid = (l + h) / 2;
      if (inside(mid)) h = mid;
      else l = mid;
    }
    low = h;
  }
  if (!inside(high)) {
    let l = anchor,
      h = high;
    for (let i = 0; i < 40; i++) {
      const mid = (l + h) / 2;
      if (inside(mid)) l = mid;
      else h = mid;
    }
    high = l;
  }
  return [low, high];
}

function peakAcceleration(
  current: TankVelocity,
  a: number,
  alpha: number,
  dt: number,
) {
  let lateral = Math.max(
    Math.abs(current.forward * current.omega),
    Math.abs((current.forward + a * dt) * (current.omega + alpha * dt)),
  );
  const quadratic = a * alpha;
  if (Math.abs(quadratic) > 1e-15) {
    const t = -(a * current.omega + alpha * current.forward) / (2 * quadratic);
    if (t > 0 && t < dt)
      lateral = Math.max(
        lateral,
        Math.abs((current.forward + a * t) * (current.omega + alpha * t)),
      );
  }
  return Math.hypot(a, lateral);
}

/**
 * Joint chassis-velocity limiting, matching BLine's TankRateLimiter.
 * Guidance stays PID-free in the editor. The limiter chooses the closest next
 * velocity vector with full-step acceleration bounds, not a turn-first score.
 * It does not reduce the speed request to accommodate a requested turn.
 * This local objective can hold a saturated corner instead of steering away
 * temporarily to make room for braking; no hidden policy changes that request.
 */
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
interface Candidate {
  forward: number;
  omega: number;
  error: number;
  turnError: number;
}
const angularIntervals = 16;
const refinements = 3;
const intervalIterations = 40;
// Inner speed-bound uncertainty, not a score deadband or a constraint allowance.
const speedPrecision = 0.005;
const stepPrecisionFraction = 0.05;
const feasibilityEpsilon = 1e-10;
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
  // Lowered limits cannot instantly remove motion. Allow its current excess
  // while preventing any larger speed or cornering excess.
  const reachable: TankLimits = {
    acceleration: Math.max(
      limits.acceleration,
      Math.abs(current.forward * current.omega),
    ),
    angularAcceleration: limits.angularAcceleration,
    speed: Math.max(limits.speed, Math.abs(current.forward)),
    omega: Math.max(limits.omega, Math.abs(current.omega)),
  };
  const requestedForward = clamp(
    requested.forward,
    direction === "forward" ? 0 : -limits.speed,
    direction === "forward" ? limits.speed : 0,
  );
  const requestedOmega = clamp(requested.omega, -limits.omega, limits.omega);
  // Only the independent forward acceleration bound prepares the request.
  // Coupled acceleration is enforced on candidates, never by rescaling it.
  const targetForward =
    current.forward +
    clamp(
      requestedForward - current.forward,
      -limits.acceleration * dt,
      limits.acceleration * dt,
    );
  const targetAngle = ((current.omega + requestedOmega) * dt) / 2;
  const targetX = targetForward * Math.cos(targetAngle);
  const targetY = targetForward * Math.sin(targetAngle);
  const low = Math.max(
    -reachable.omega,
    current.omega - limits.angularAcceleration * dt,
  );
  const high = Math.min(
    reachable.omega,
    current.omega + limits.angularAcceleration * dt,
  );
  // A stationary pivot has no translational vector error to optimize.
  if (current.forward === 0 && targetForward === 0) {
    return { forward: 0, omega: clamp(requestedOmega, low, high) };
  }
  if (
    requestedOmega >= low &&
    requestedOmega <= high &&
    inside(
      current,
      (targetForward - current.forward) / dt,
      (requestedOmega - current.omega) / dt,
      dt,
      reachable.acceleration,
    )
  ) {
    return { forward: targetForward, omega: requestedOmega };
  }

  // Holding the initial state is feasible under the recovery envelope.
  let best = score(current, current, requestedOmega, targetX, targetY, dt);
  const samples: (Candidate | null)[] = new Array(angularIntervals + 4).fill(
    null,
  );
  let first: Candidate | null = null;
  const spacing = (high - low) / angularIntervals;
  for (let i = 0; i <= angularIntervals + 3; i++) {
    let omega: number;
    if (i <= angularIntervals) omega = low + spacing * i;
    else if (i === angularIntervals + 1)
      omega = clamp(requestedOmega, low, high);
    else if (i === angularIntervals + 2) omega = current.omega;
    else if (low <= 0 && high >= 0) omega = 0;
    else continue;
    const sample = candidate(
      current,
      omega,
      requestedOmega,
      targetX,
      targetY,
      reachable,
      dt,
      direction,
    );
    if (sample) {
      samples[i] = sample;
      first = first === null ? sample : better(first, sample);
      best = better(best, sample);
    }
  }
  // Refine two neighborhoods, without assuming a globally unimodal angular
  // objective. At most 20 seeds + 12 refinements are evaluated.
  // Two linear scans select the same neighborhoods without sorting or a
  // growable list. Preserve joint score ordering, including exact ties.
  first ??= best;
  let second: Candidate | null = null;
  for (const sample of samples) {
    if (sample && Math.abs(sample.omega - first.omega) > spacing) {
      second = second === null ? sample : better(second, sample);
    }
  }
  for (let neighborhood = 0; neighborhood < 2; neighborhood++) {
    const seed = neighborhood === 0 ? first : second;
    if (!seed) continue;
    let local = seed;
    let step = spacing;
    for (let refinement = 0; refinement < refinements; refinement++) {
      step /= 2;
      const centre = local.omega;
      local = better(
        local,
        candidate(
          current,
          Math.max(low, centre - step),
          requestedOmega,
          targetX,
          targetY,
          reachable,
          dt,
          direction,
        ),
      );
      local = better(
        local,
        candidate(
          current,
          Math.min(high, centre + step),
          requestedOmega,
          targetX,
          targetY,
          reachable,
          dt,
          direction,
        ),
      );
    }
    best = better(best, local);
  }
  return { forward: best.forward, omega: best.omega };
}

function candidate(
  current: TankVelocity,
  omega: number,
  requestedOmega: number,
  targetX: number,
  targetY: number,
  limits: TankLimits,
  dt: number,
  direction: "forward" | "backward",
): Candidate | null {
  const alpha = (omega - current.omega) / dt;
  const minSpeed =
    direction === "forward" ? Math.min(0, current.forward) : -limits.speed;
  const maxSpeed =
    direction === "backward" ? Math.max(0, current.forward) : limits.speed;
  // At t=0 the remaining budget bounds a regardless of angular acceleration.
  const initialBudget = Math.sqrt(
    Math.max(
      0,
      limits.acceleration * limits.acceleration -
        (current.forward * current.omega) ** 2,
    ),
  );
  let low = Math.max(-initialBudget, (minSpeed - current.forward) / dt);
  let high = Math.min(initialBudget, (maxSpeed - current.forward) / dt);
  // At t=dt the budget is a quadratic in forward acceleration a.
  const qa = 1 + omega * omega * dt * dt;
  const discriminant =
    limits.acceleration * limits.acceleration * qa -
    current.forward * current.forward * omega * omega;
  if (discriminant < 0) return null;
  const centre = (-current.forward * omega * omega * dt) / qa;
  const radius = Math.sqrt(discriminant) / qa;
  low = Math.max(low, centre - radius);
  high = Math.min(high, centre + radius);
  if (low > high) return null;

  const angle = ((current.omega + omega) * dt) / 2;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const projectedSpeed = targetX * cosine + targetY * sine;
  let acceleration = clamp((projectedSpeed - current.forward) / dt, low, high);
  if (!inside(current, acceleration, alpha, dt, limits.acceleration)) {
    // Endpoint bounds can miss an interior peak. The full-step peak is convex
    // in a. Find a feasible anchor, then the boundary toward the projection.
    // Zero acceleration need not be feasible for this omega.
    let anchor = (low + high) / 2;
    if (inside(current, low, alpha, dt, limits.acceleration)) anchor = low;
    else if (inside(current, high, alpha, dt, limits.acceleration))
      anchor = high;
    else if (!inside(current, anchor, alpha, dt, limits.acceleration)) {
      let left = low,
        right = high;
      for (let i = 0; i < intervalIterations; i++) {
        const x = left + (right - left) / 3,
          y = right - (right - left) / 3;
        if (
          peakAcceleration(current, x, alpha, dt) <
          peakAcceleration(current, y, alpha, dt)
        )
          right = y;
        else left = x;
      }
      anchor = (left + right) / 2;
      if (!inside(current, anchor, alpha, dt, limits.acceleration)) return null;
    }
    let feasible = anchor,
      infeasible = acceleration;
    const precision = Math.min(
      speedPrecision / dt,
      stepPrecisionFraction * limits.acceleration,
    );
    for (
      let i = 0;
      i < intervalIterations && Math.abs(feasible - infeasible) > precision;
      i++
    ) {
      const midpoint = (feasible + infeasible) / 2;
      if (inside(current, midpoint, alpha, dt, limits.acceleration))
        feasible = midpoint;
      else infeasible = midpoint;
    }
    acceleration = feasible;
  }
  const forward = current.forward + acceleration * dt;
  if (
    !inside(
      current,
      (forward - current.forward) / dt,
      alpha,
      dt,
      limits.acceleration,
    )
  )
    return null;
  return scoreVector(
    forward,
    omega,
    requestedOmega,
    targetX,
    targetY,
    cosine,
    sine,
  );
}

function score(
  current: TankVelocity,
  next: TankVelocity,
  requestedOmega: number,
  targetX: number,
  targetY: number,
  dt: number,
): Candidate {
  const angle = ((current.omega + next.omega) * dt) / 2;
  return scoreVector(
    next.forward,
    next.omega,
    requestedOmega,
    targetX,
    targetY,
    Math.cos(angle),
    Math.sin(angle),
  );
}

function scoreVector(
  forward: number,
  omega: number,
  requestedOmega: number,
  targetX: number,
  targetY: number,
  cosine: number,
  sine: number,
): Candidate {
  const dx = forward * cosine - targetX;
  const dy = forward * sine - targetY;
  return {
    forward,
    omega,
    error: dx * dx + dy * dy,
    turnError: Math.abs(omega - requestedOmega),
  };
}

function better(left: Candidate, right: Candidate | null): Candidate {
  if (!right) return left;
  // Only exact vector-score ties use heading preference. Near-zero motion must
  // not silently switch back to a turn-priority controller.
  return right.error < left.error ||
    (right.error === left.error && right.turnError < left.turnError)
    ? right
    : left;
}

function inside(
  current: TankVelocity,
  a: number,
  alpha: number,
  dt: number,
  maximum: number,
) {
  const lateral = peakLateralAcceleration(current, a, alpha, dt);
  const bound = maximum + feasibilityEpsilon;
  const squaredBound = bound * bound;
  // Avoid a square root per feasibility check, retaining overflow handling.
  return Number.isFinite(squaredBound)
    ? a * a + lateral * lateral <= squaredBound
    : Math.hypot(a, lateral) <= bound;
}

/** Exact maximum over linear speed/turn-rate ramps, including the interior extremum. */
function peakAcceleration(
  current: TankVelocity,
  a: number,
  alpha: number,
  dt: number,
) {
  return Math.hypot(a, peakLateralAcceleration(current, a, alpha, dt));
}

function peakLateralAcceleration(
  current: TankVelocity,
  a: number,
  alpha: number,
  dt: number,
): number {
  let lateral = Math.max(
    Math.abs(current.forward * current.omega),
    Math.abs((current.forward + a * dt) * (current.omega + alpha * dt)),
  );
  const quadratic = a * alpha;
  if (quadratic !== 0) {
    const t = -(a * current.omega + alpha * current.forward) / (2 * quadratic);
    if (t > 0 && t < dt)
      lateral = Math.max(
        lateral,
        Math.abs((current.forward + a * t) * (current.omega + alpha * t)),
      );
  }
  return lateral;
}

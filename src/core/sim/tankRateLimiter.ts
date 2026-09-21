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
const epsilon = 1e-9;
// Acceleration uncertainty in m/s², also capped at 1% for gentle limits.
const accelerationPrecision = 0.02;
const maxBisections = 16;
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
  // Recover continuously if a new limit is below the existing motion.
  const acceleration = Math.max(
    limits.acceleration,
    Math.abs(current.forward * current.omega),
  );
  const speed = Math.max(limits.speed, Math.abs(current.forward));
  const turnRate = Math.max(limits.omega, Math.abs(current.omega));
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
    -turnRate,
    current.omega - limits.angularAcceleration * dt,
  );
  const high = Math.min(
    turnRate,
    current.omega + limits.angularAcceleration * dt,
  );
  const omega = clamp(targetOmega, low, high);
  let forward = clamp(targetForward, -speed, speed);
  // Existing opposite-direction motion may brake; it may not grow.
  if (direction === "forward")
    forward = Math.max(forward, Math.min(0, current.forward));
  else forward = Math.min(forward, Math.max(0, current.forward));
  const alpha = (omega - current.omega) / dt;
  const requestedAcceleration = (forward - current.forward) / dt;

  // Preparation ensures |v0 * targetOmega| <= A. Slewing toward that rate
  // keeps a=0 feasible under the recovery envelope for the whole step.
  // This already minimizes turn error; no angular search is needed.
  if (!inside(current, requestedAcceleration, alpha, dt, acceleration)) {
    if (!inside(current, 0, alpha, dt, acceleration))
      throw new Error("No finite tank velocity transition");
    // At fixed omega(t), the full-step feasible accelerations form an interval
    // containing zero. Bisect toward the request, retaining the feasible end.
    // No candidate objects, temporary arrays or per-call closures are needed.
    let feasible = 0;
    let infeasible = 1;
    const precision = Math.min(
      accelerationPrecision,
      0.01 * limits.acceleration,
    );
    for (
      let i = 0;
      i < maxBisections &&
      Math.abs(requestedAcceleration) * (infeasible - feasible) > precision;
      i++
    ) {
      const fraction = (feasible + infeasible) / 2;
      if (
        inside(
          current,
          requestedAcceleration * fraction,
          alpha,
          dt,
          acceleration,
        )
      )
        feasible = fraction;
      else infeasible = fraction;
    }
    forward = current.forward + requestedAcceleration * feasible * dt;
  }
  return { forward, omega };
}

function inside(
  current: TankVelocity,
  a: number,
  alpha: number,
  dt: number,
  maximum: number,
) {
  return peakAcceleration(current, a, alpha, dt) <= maximum + 1e-10;
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

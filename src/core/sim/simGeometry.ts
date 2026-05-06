import type { ChassisSpeeds } from "./types";

export function wrapAngleRadians(theta: number): number {
  let wrapped = theta;
  while (wrapped > Math.PI) {
    wrapped -= 2 * Math.PI;
  }
  while (wrapped < -Math.PI) {
    wrapped += 2 * Math.PI;
  }
  return wrapped;
}

export function shortestAngularDistance(
  target: number,
  current: number,
): number {
  return wrapAngleRadians(target - current);
}

export function hypot2(x: number, y: number): number {
  return Math.hypot(x, y);
}

export function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

export function limitAcceleration(
  desired: ChassisSpeeds,
  last: ChassisSpeeds,
  dt: number,
  maxTransAccelMps2: number,
  maxAngularAccelRadps2: number,
): ChassisSpeeds {
  if (dt <= 0) {
    return last;
  }

  const dvx = desired.vx_mps - last.vx_mps;
  const dvy = desired.vy_mps - last.vy_mps;
  const desiredAcceleration = hypot2(dvx, dvy) / dt;
  const obtainableAcceleration = Math.max(
    0,
    Math.min(desiredAcceleration, maxTransAccelMps2),
  );
  const theta = Math.abs(dvx) + Math.abs(dvy) > 0 ? Math.atan2(dvy, dvx) : 0;
  const desiredAlpha = (desired.omega_radps - last.omega_radps) / dt;
  const obtainableAlpha = Math.max(
    -maxAngularAccelRadps2,
    Math.min(desiredAlpha, maxAngularAccelRadps2),
  );

  return {
    vx_mps: last.vx_mps + Math.cos(theta) * obtainableAcceleration * dt,
    vy_mps: last.vy_mps + Math.sin(theta) * obtainableAcceleration * dt,
    omega_radps: last.omega_radps + obtainableAlpha * dt,
  };
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

export function radiansToDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

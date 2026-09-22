import { describe, expect, it } from "vitest";
import {
  limitTankVelocity,
  type TankVelocity,
} from "../../../../src/core/sim/tankRateLimiter";

const limits = {
  acceleration: 2,
  angularAcceleration: 4,
  speed: 3.5,
  omega: 2.5,
};

describe("joint tank limiting", () => {
  it.each(["forward", "backward"] as const)(
    "trades turn error for a better %s velocity vector without corner-speed preprocessing",
    (direction) => {
      const sign = direction === "forward" ? 1 : -1;
      const current = { forward: sign, omega: 0.9 };
      const next = limitTankVelocity(
        current,
        { forward: sign * 2, omega: 1 },
        limits,
        0.02,
        direction,
      );
      // Independently solve the endpoint acceleration boundary for the closest
      // reachable turn rate. Its ramp grows in both speed and turn rate.
      const w = 0.98,
        qa = 1 + w * w * 0.02 * 0.02;
      const a = (-w * w * 0.02 + Math.sqrt(4 * qa - w * w)) / qa;
      const turnFirst = { forward: sign * (1 + a * 0.02), omega: w };
      const error = (velocity: TankVelocity) => {
        const angle = (current.omega + velocity.omega) * 0.01;
        const targetAngle = (current.omega + 1) * 0.01;
        return (
          (velocity.forward * Math.cos(angle) -
            sign * 1.04 * Math.cos(targetAngle)) **
            2 +
          (velocity.forward * Math.sin(angle) -
            sign * 1.04 * Math.sin(targetAngle)) **
            2
        );
      };
      expect(Math.abs(next.omega - 1)).toBeGreaterThan(Math.abs(w - 1));
      expect(error(next)).toBeLessThan(0.8 * error(turnFirst));
      for (let sample = 0; sample <= 100; sample++) {
        const f = sample / 100;
        expect(
          Math.hypot(
            (next.forward - current.forward) / 0.02,
            (current.forward + (next.forward - current.forward) * f) *
              (current.omega + (next.omega - current.omega) * f),
          ),
        ).toBeLessThanOrEqual(2 + 1e-8);
      }

      // The one-step objective has no implicit request to leave a saturated
      // corner just to free braking capacity for a subsequent step.
      const saturated = { forward: sign * 2, omega: 1 };
      expect(
        limitTankVelocity(
          saturated,
          { forward: sign * 2, omega: 2 },
          limits,
          0.02,
          direction,
        ),
      ).toEqual(saturated);
    },
  );

  it("accepts feasible near-zero motion and slews stationary pivots", () => {
    const request = { forward: 1e-10, omega: 0.95 };
    expect(
      limitTankVelocity(
        { forward: 1e-10, omega: 0.9 },
        request,
        limits,
        0.02,
        "forward",
      ),
    ).toEqual(request);
    expect(
      limitTankVelocity(
        { forward: 0, omega: 0 },
        { forward: 0, omega: 2 },
        limits,
        0.02,
        "forward",
      ),
    ).toEqual({ forward: 0, omega: 0.08 });
  });
});

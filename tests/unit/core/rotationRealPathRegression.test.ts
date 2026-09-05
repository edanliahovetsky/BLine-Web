import { describe, expect, it } from "vitest";
import {
  createPathModel,
  createTranslationTarget as translation,
  createRotationTarget as rotation,
  createWaypoint as waypoint,
  createEventTrigger as event,
  setHandoffRadiusSource,
  getHandoffRadiusSource,
  type PathModel,
  type PathElement,
} from "../../../src/core/model/path";
import { solveJointAutoConstraints } from "../../../src/core/constraints/autoVelocityConstraints";
import { refreshAutoVelocityConstraints } from "../../../src/core/constraints/autoVelocityApply";
import { simulatePathWithTrace } from "../../../src/core/sim";
import { evaluateRotationFeasibility } from "../../../src/core/sim/rotationFeasibility";

// Reconstructed from the editor values on a reported five-anchor return path.
// The saved 0.05 m radii and [1.40, 0.63, 1.41, 0.63] m/s leg caps took 30.62 s
// in the editor (30.64 s with the displayed coordinates rounded to 0.01 m).
const config = {
  default_max_velocity_meters_per_sec: 4.5,
  default_max_acceleration_meters_per_sec2: 12,
  default_max_velocity_deg_per_sec: 720,
  default_max_acceleration_deg_per_sec2: 1500,
  default_intermediate_handoff_radius_meters: 0.45,
};
const options = {
  velocitySafetyFactor: 0.9,
  accelerationSafetyFactor: 0.8,
  mergeToleranceMps: 0.3,
};
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const draft = createPathModel({
  path_elements: [
    waypoint({
      translation_target: translation({
        x_meters: 10.41,
        y_meters: 6.65,
        intermediate_handoff_radius_meters: 0.4,
      }),
      rotation_target: rotation({ rotation_radians: rad(45) }),
    }),
    setHandoffRadiusSource(
      translation({
        x_meters: 13.37,
        y_meters: 5.6,
        intermediate_handoff_radius_meters: 0.05,
      }),
      "auto",
    ),
    rotation({ rotation_radians: rad(45), t_ratio: 0 }),
    setHandoffRadiusSource(
      translation({
        x_meters: 3.17,
        y_meters: 4.1,
        intermediate_handoff_radius_meters: 0.05,
      }),
      "auto",
    ),
    event({ t_ratio: 0.5, lib_key: "event" }),
    setHandoffRadiusSource(
      waypoint({
        translation_target: translation({
          x_meters: 10.39,
          y_meters: 2.92,
          intermediate_handoff_radius_meters: 0.05,
        }),
        rotation_target: rotation({ rotation_radians: rad(-88.6) }),
      }),
      "auto",
    ),
    waypoint({
      translation_target: translation({
        x_meters: 7.56,
        y_meters: 5.89,
        intermediate_handoff_radius_meters: 0.45,
      }),
      rotation_target: rotation({ rotation_radians: rad(45) }),
    }),
  ],
});

function authoredElements(path: PathModel): PathElement[] {
  return path.path_elements.map((element) =>
    getHandoffRadiusSource(element) !== "auto"
      ? element
      : element.type === "translation"
        ? { ...element, intermediate_handoff_radius_meters: null }
        : element.type === "waypoint"
          ? {
              ...element,
              translation_target: {
                ...element.translation_target,
                intermediate_handoff_radius_meters: null,
              },
            }
          : element,
  );
}

describe("observed five-anchor return path", () => {
  it.each([true, false])(
    "keeps realistic completion time with profiled=%s",
    (profiled) => {
      const path: PathModel = {
        ...draft,
        path_elements: draft.path_elements.map((element) =>
          element.type === "rotation"
            ? { ...element, profiled_rotation: profiled }
            : element.type === "waypoint"
              ? {
                  ...element,
                  rotation_target: {
                    ...element.rotation_target,
                    profiled_rotation: profiled,
                  },
                }
              : element,
        ),
      };
      const generated = solveJointAutoConstraints(path, config, options);
      expect(generated.status).toBe("valid");
      expect(generated.profile.diagnostics.totalTimeS).toBeLessThan(7);
      expect(
        generated.profile.corners.every(
          (corner) => corner.handoffDistanceMeters > 0.3,
        ),
      ).toBe(true);
      expect(
        generated.profile.segmentCaps
          .filter((cap) => cap.targetOrdinal > 1)
          .every((cap) => cap.value >= 2.5),
      ).toBe(true);
      expect(
        generated.profile.diagnostics.handoffs.every(
          (handoff) => handoff.passed,
        ),
      ).toBe(true);
      expect(generated.stats.stabilityValidationPassed).toBe(true);
      expect(authoredElements(generated.path)).toEqual(authoredElements(path));

      const saved = refreshAutoVelocityConstraints(generated.path, config, {
        whenPresentOnly: false,
        settings: options,
      });
      for (const dt of [0.02, 0.01, 0.005]) {
        const sim = simulatePathWithTrace(saved, config, { dt_s: dt });
        expect(sim.total_time_s).toBeLessThan(7);
        expect(
          evaluateRotationFeasibility(saved, config, sim.trace).every(
            (target) => target.passed,
          ),
        ).toBe(true);
        const final = sim.trace.at(-1)!;
        expect(
          Math.hypot(final.x_m - 7.56, final.y_m - 5.89),
        ).toBeLessThanOrEqual(0.001);
      }
    },
    10000,
  );
});

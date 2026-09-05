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

// Captured from an export of the reported five-anchor return path.
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
const draft = createPathModel({
  path_elements: [
    waypoint({
      translation_target: translation({
        x_meters: 10.40998,
        y_meters: 6.64816,
        intermediate_handoff_radius_meters: 0.4,
      }),
      rotation_target: rotation({ rotation_radians: 0.7854 }),
    }),
    setHandoffRadiusSource(
      translation({
        x_meters: 13.37203,
        y_meters: 5.60358,
        intermediate_handoff_radius_meters: 0.05,
      }),
      "auto",
    ),
    rotation({ rotation_radians: 0.7854, t_ratio: 0 }),
    setHandoffRadiusSource(
      translation({
        x_meters: 3.16981,
        y_meters: 4.10071,
        intermediate_handoff_radius_meters: 0.05,
      }),
      "auto",
    ),
    event({ t_ratio: 0.5, lib_key: "event" }),
    setHandoffRadiusSource(
      waypoint({
        translation_target: translation({
          x_meters: 10.39126,
          y_meters: 2.92278,
          intermediate_handoff_radius_meters: 0.05,
        }),
        rotation_target: rotation({ rotation_radians: -1.54634 }),
      }),
      "auto",
    ),
    waypoint({
      translation_target: translation({
        x_meters: 7.56004,
        y_meters: 5.89164,
        intermediate_handoff_radius_meters: 0.45,
      }),
      rotation_target: rotation({ rotation_radians: 0.7854 }),
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
  it.each([
    { profiled: true, rounded: false },
    { profiled: false, rounded: false },
    { profiled: true, rounded: true },
    { profiled: false, rounded: true },
  ])(
    "keeps realistic completion time with profiled=$profiled, rounded=$rounded",
    ({ profiled, rounded }) => {
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
      if (rounded) {
        path.path_elements = path.path_elements.map((element) => {
          const target =
            element.type === "waypoint"
              ? element.translation_target
              : element.type === "translation"
                ? element
                : null;
          if (!target) return element;
          const position = {
            ...target,
            x_meters: Math.round(target.x_meters * 100) / 100,
            y_meters: Math.round(target.y_meters * 100) / 100,
          };
          return element.type === "waypoint"
            ? { ...element, translation_target: position }
            : position;
        });
      }
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
          Math.hypot(
            final.x_m - (rounded ? 7.56 : 7.56004),
            final.y_m - (rounded ? 5.89 : 5.89164),
          ),
        ).toBeLessThanOrEqual(0.001);
      }
    },
    10000,
  );
});

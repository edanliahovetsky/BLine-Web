import { describe, expect, it } from "vitest";
import {
  autoVelocityRefreshRequest,
  refreshAutoVelocityConstraints,
} from "../../../src/core/constraints/autoVelocityApply";
import {
  createPathModel,
  createTranslationTarget,
  setHandoffRadiusSource,
  type PathModel,
} from "../../../src/core/model/path";

const config = {
  kinematic_constraints: {
    default_max_velocity_meters_per_sec: 5,
    default_max_acceleration_meters_per_sec2: 4,
    default_intermediate_handoff_radius_meters: 0.25,
    default_max_velocity_deg_per_sec: 720,
    default_max_acceleration_deg_per_sec2: 1500,
    default_end_translation_tolerance_meters: 0.03,
    default_end_rotation_tolerance_deg: 2,
  },
};

describe("refreshAutoVelocityConstraints", () => {
  it("stamps the inputs it solved from", () => {
    const generated = generate(examplePath());
    const stamped = generated.ranged_constraints.filter(
      (constraint) => constraint.source === "auto_velocity",
    );

    expect(stamped.length).toBeGreaterThan(0);
    for (const constraint of stamped) {
      expect(constraint.auto_velocity?.input_signature).toBeTruthy();
    }
    // Without the stamp the caps would read as stale the instant they landed.
    expect(autoVelocityRefreshRequest(generated, config)?.stale).toBe(false);
  });
});

describe("autoVelocityRefreshRequest", () => {
  it("returns nothing when no optimizer output was generated", () => {
    expect(autoVelocityRefreshRequest(examplePath(), config)).toBeNull();
  });

  it("requests synchronization for generated radii without generated caps", () => {
    const path = examplePath();
    path.path_elements[1] = setHandoffRadiusSource(
      path.path_elements[1],
      "auto",
    );

    const request = autoVelocityRefreshRequest(path, config);

    expect(request?.hasGeneratedVelocityCaps).toBe(false);
    expect(request?.stale).toBe(true);
  });

  it("reports staleness once the path moves", () => {
    const generated = generate(examplePath());
    const moved: PathModel = {
      ...generated,
      path_elements: generated.path_elements.map((element, index) =>
        index === 1 ? { ...element, x_meters: 3.4 } : element,
      ),
    };

    expect(autoVelocityRefreshRequest(moved, config)?.stale).toBe(true);
    expect(autoVelocityRefreshRequest(generate(moved), config)?.stale).toBe(
      false,
    );
  });

  it("ignores a manual cap that was never generated", () => {
    const manual: PathModel = {
      ...examplePath(),
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec",
          value: 2,
          start_ordinal: 2,
          end_ordinal: 2,
        },
      ],
    };

    expect(autoVelocityRefreshRequest(manual, config)).toBeNull();
  });
});

function generate(path: PathModel): PathModel {
  return refreshAutoVelocityConstraints(path, config, {
    whenPresentOnly: false,
  });
}

function examplePath(): PathModel {
  return createPathModel({
    path_elements: [
      createTranslationTarget({ x_meters: 0, y_meters: 0 }),
      createTranslationTarget({
        x_meters: 2.4,
        y_meters: 0.6,
        intermediate_handoff_radius_meters: 0.35,
      }),
      createTranslationTarget({
        x_meters: 4.1,
        y_meters: -0.4,
        intermediate_handoff_radius_meters: 0.3,
      }),
      createTranslationTarget({ x_meters: 6, y_meters: 0.5 }),
    ],
  });
}

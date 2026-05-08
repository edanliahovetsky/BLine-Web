import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deserializePath,
  deserializeProjectDocument,
  serializePath,
  serializeProjectDocument,
} from "../src/core/io/projectSerde";
import { simulatePath } from "../src/core/sim";

describe("Phase 2 parity harness", () => {
  it("keeps the legacy full-mix project fixture stable through v1 serde", () => {
    const project = deserializeProjectDocument(
      readJson("../tests/fixtures/project-io/legacy-full-mix.json"),
    );
    const serialized = serializeProjectDocument(project);
    const roundTrip = deserializeProjectDocument(serialized);

    expect(roundTrip).toMatchObject({
      schema_version: 1,
      project_id: "fixture-full-mix",
      display_name: "Fixture Full Mix",
      path_file_name: "full_mix.json",
      config: {
        gui: {
          robot: {
            length_meters: 0.82,
            width_meters: 0.98,
          },
          protrusions: {
            enabled: true,
            distance_meters: 0.3,
            side: "front",
          },
        },
      },
    });
    expect(roundTrip.path.path_elements).toHaveLength(4);
    expect(roundTrip.path.ranged_constraints).toEqual(
      project.path.ranged_constraints,
    );
  });

  it("keeps desktop path constraint ordinals stable through native path serde", () => {
    const project = deserializeProjectDocument(
      readJson("../tests/fixtures/project-io/legacy-full-mix.json"),
    );
    const serializedPath = serializePath(project.path);
    const roundTripPath = deserializePath(
      serializedPath,
      () =>
        project.config.kinematic_constraints
          .default_intermediate_handoff_radius_meters,
    );

    expect(roundTripPath.ranged_constraints).toEqual(
      project.path.ranged_constraints,
    );
    expect(serializedPath.constraints).toMatchObject({
      max_velocity_meters_per_sec: [
        { value: 1.25, start_ordinal: 0, end_ordinal: 1 },
      ],
      max_velocity_deg_per_sec: [
        { value: 90, start_ordinal: 0, end_ordinal: 1 },
      ],
    });
  });

  it("keeps the dense PySide simulation fixture numerically stable", () => {
    const path = deserializePath(
      readJson("../tests/fixtures/simulation/top_sweep_short_depo.json"),
    );
    const result = simulatePath(
      path,
      {
        default_max_velocity_meters_per_sec: 4.5,
        default_max_acceleration_meters_per_sec2: 12,
        default_intermediate_handoff_radius_meters: 0.25,
        default_max_velocity_deg_per_sec: 600,
        default_max_acceleration_deg_per_sec2: 2000,
      },
      { dt_s: 0.02 },
    );

    expect(result.total_time_s).toBeCloseTo(18.54, 2);
    expect(result.trail_points).toHaveLength(928);
    expectPose(result.poses_by_time.get(0), [3.376893, 5.590979, 0], 6);
    expectPose(
      result.poses_by_time.get(9.26),
      [1.743742, 4.971691, 1.366353],
      6,
    );
    expectPose(result.poses_by_time.get(18.54), [6.020539, 5.353239, 0], 6);
  });
});

function readJson(path: string): unknown {
  return JSON.parse(
    readFileSync(new URL(path, import.meta.url), "utf8"),
  ) as unknown;
}

function expectPose(
  pose: readonly [number, number, number] | undefined,
  expected: readonly [number, number, number],
  precision: number,
) {
  expect(pose).toBeDefined();
  expect(pose?.[0]).toBeCloseTo(expected[0], precision);
  expect(pose?.[1]).toBeCloseTo(expected[1], precision);
  expect(pose?.[2]).toBeCloseTo(expected[2], precision);
}

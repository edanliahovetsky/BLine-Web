import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createConstraints,
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  type RangedConstraint
} from "../../../src/core/model/path";
import { createProjectDocument } from "../../../src/core/io/projectSchema";
import {
  deserializePath,
  deserializeProjectDocument,
  serializePath,
  serializeProjectDocument
} from "../../../src/core/io/projectSerde";

describe("project path serde", () => {
  it("serializes and deserializes the native BLine path shape", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createRotationTarget({ rotation_radians: 0.5, t_ratio: 0.5 }),
        createTranslationTarget({ x_meters: 2, y_meters: 1 })
      ]
    });

    const data = serializePath(path);
    const restored = deserializePath(data, (key) =>
      key === "intermediate_handoff_radius_meters" ? 0.1 : null
    );

    expect(restored.path_elements).toHaveLength(path.path_elements.length);
    expect(serializePath(restored).path_elements[0]).toMatchObject({
      type: "translation",
      x_meters: 0,
      y_meters: 0
    });
  });

  it("ignores event triggers in the rotation ranged-constraint domain", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        { type: "event_trigger", t_ratio: 0.25, lib_key: "A" },
        { type: "rotation", rotation_radians: 0.5, t_ratio: 0.5 },
        { type: "translation", x_meters: 1, y_meters: 1 }
      ],
      constraints: {
        max_velocity_deg_per_sec: [
          { value: 90, start_ordinal: 0, end_ordinal: 0 }
        ]
      }
    });

    expect(restored.path_elements[1]).toMatchObject({ type: "event_trigger" });
    expect(restored.path_elements[2]).toMatchObject({ type: "rotation" });
    expect(restored.ranged_constraints).toEqual([
      {
        key: "max_velocity_deg_per_sec",
        value: 90,
        start_ordinal: 1,
        end_ordinal: 1
      }
    ]);
  });

  it("repairs overlapping translation ranges from older files", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        { type: "translation", x_meters: 1, y_meters: 0 },
        { type: "translation", x_meters: 2, y_meters: 0 }
      ],
      constraints: {
        max_velocity_meters_per_sec: [
          { value: 2, start_ordinal: 0, end_ordinal: 0 },
          { value: 2, start_ordinal: 0, end_ordinal: 1 },
          { value: 4, start_ordinal: 2, end_ordinal: 2 }
        ]
      }
    });

    expect(restored.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 1
      },
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 2,
        end_ordinal: 2
      },
      {
        key: "max_velocity_meters_per_sec",
        value: 4,
        start_ordinal: 3,
        end_ordinal: 3
      }
    ]);
  });

  it("drops fully covered overlapping ranged constraints", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        { type: "translation", x_meters: 1, y_meters: 0 }
      ],
      constraints: {
        max_velocity_meters_per_sec: [
          { value: 2, start_ordinal: 0, end_ordinal: 1 },
          { value: 3, start_ordinal: 0, end_ordinal: 0 }
        ]
      }
    });

    expect(restored.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 2
      }
    ]);
  });

  it("serializes scalar and ranged constraints using the desktop file format", () => {
    const ranged: RangedConstraint = {
      key: "max_velocity_meters_per_sec",
      value: 2.5,
      start_ordinal: 1,
      end_ordinal: 2
    };
    const path = createPathModel({
      constraints: createConstraints({
        max_velocity_meters_per_sec: 4,
        end_translation_tolerance_meters: 0.05
      }),
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createWaypoint({
          translation_target: createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          rotation_target: createRotationTarget({ rotation_radians: 1.25 })
        }),
        createEventTrigger({ t_ratio: 0.25, lib_key: "marker" })
      ],
      ranged_constraints: [ranged]
    });

    expect(serializePath(path)).toEqual({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        {
          type: "waypoint",
          translation_target: { x_meters: 1, y_meters: 1 },
          rotation_target: { rotation_radians: 1.25, profiled_rotation: true }
        },
        { type: "event_trigger", t_ratio: 0.25, lib_key: "marker" }
      ],
      constraints: {
        end_translation_tolerance_meters: 0.05,
        max_velocity_meters_per_sec: [
          { value: 2.5, start_ordinal: 0, end_ordinal: 1 }
        ]
      }
    });
  });

  it("serializes all ranged constraint domains with zero-based ordinals", () => {
    const path = createPathModel({
      constraints: createConstraints({
        max_velocity_meters_per_sec: 4,
        max_acceleration_meters_per_sec2: 8,
        max_velocity_deg_per_sec: 720,
        max_acceleration_deg_per_sec2: 1500
      }),
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createWaypoint({
          translation_target: createTranslationTarget({ x_meters: 1, y_meters: 0 }),
          rotation_target: createRotationTarget({ rotation_radians: 0.5 })
        }),
        createEventTrigger({ t_ratio: 0.5, lib_key: "shoot" }),
        createRotationTarget({ t_ratio: 0.75, rotation_radians: 1 })
      ],
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec",
          value: 2,
          start_ordinal: 1,
          end_ordinal: 2
        },
        {
          key: "max_acceleration_meters_per_sec2",
          value: 6,
          start_ordinal: 2,
          end_ordinal: 2
        },
        {
          key: "max_velocity_deg_per_sec",
          value: 90,
          start_ordinal: 1,
          end_ordinal: 2
        },
        {
          key: "max_acceleration_deg_per_sec2",
          value: 180,
          start_ordinal: 2,
          end_ordinal: 2
        }
      ]
    });

    expect(serializePath(path).constraints).toEqual({
      max_velocity_meters_per_sec: [
        { value: 2, start_ordinal: 0, end_ordinal: 1 }
      ],
      max_acceleration_meters_per_sec2: [
        { value: 6, start_ordinal: 1, end_ordinal: 1 }
      ],
      max_velocity_deg_per_sec: [
        { value: 90, start_ordinal: 0, end_ordinal: 1 }
      ],
      max_acceleration_deg_per_sec2: [
        { value: 180, start_ordinal: 1, end_ordinal: 1 }
      ]
    });
  });

  it("reads legacy default scalar constraint keys", () => {
    const restored = deserializePath({
      path_elements: [{ type: "translation", x_meters: 0, y_meters: 0 }],
      constraints: {
        default_max_velocity_meters_per_sec: 3,
        default_end_translation_tolerance_meters: 0.04
      }
    });

    expect(restored.constraints).toMatchObject({
      max_velocity_meters_per_sec: 3,
      end_translation_tolerance_meters: 0.04
    });
  });

  it("uses waypoints in translation and rotation ranged-constraint domains", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        {
          type: "waypoint",
          translation_target: { x_meters: 1, y_meters: 0 },
          rotation_target: { rotation_radians: 0.25 }
        },
        { type: "event_trigger", t_ratio: 0.3, lib_key: "event" }
      ],
      constraints: {
        max_velocity_meters_per_sec: [
          { value: 2, start_ordinal: 1, end_ordinal: 1 }
        ],
        max_velocity_deg_per_sec: [
          { value: 90, start_ordinal: 0, end_ordinal: 0 }
        ]
      }
    });

    expect(restored.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 2,
        end_ordinal: 2
      },
      {
        key: "max_velocity_deg_per_sec",
        value: 90,
        start_ordinal: 1,
        end_ordinal: 1
      }
    ]);
  });

  it("clamps and swaps reversed out-of-bounds ranged constraints", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        { type: "translation", x_meters: 1, y_meters: 0 }
      ],
      constraints: {
        max_velocity_meters_per_sec: [
          { value: 2, start_ordinal: 9, end_ordinal: -1 }
        ]
      }
    });

    expect(restored.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 2
      }
    ]);
  });

  it("converts legacy rotation coordinates into segment-relative t-ratio", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        { type: "rotation", rotation_radians: 1, x_meters: 5, y_meters: 0 },
        { type: "translation", x_meters: 10, y_meters: 0 }
      ]
    });

    expect(restored.path_elements[1]).toMatchObject({
      type: "rotation",
      t_ratio: 0.5,
      legacy_position: null,
      legacy_converted: true
    });
  });

  it("converts waypoint legacy rotation coordinates into segment-relative t-ratio", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        {
          type: "waypoint",
          translation_target: { x_meters: 5, y_meters: 0 },
          rotation_target: {
            rotation_radians: 1,
            x_meters: 5,
            y_meters: 0
          }
        },
        { type: "translation", x_meters: 10, y_meters: 0 }
      ]
    });

    expect(restored.path_elements[1]).toMatchObject({
      type: "waypoint",
      rotation_target: {
        t_ratio: 0.5,
        legacy_position: null,
        legacy_converted: true
      }
    });
  });
});

describe("project document serde", () => {
  it("serializes and deserializes a versioned project document", () => {
    const project = createProjectDocument({
      project_id: "project-1",
      display_name: "Example",
      path: createPathModel({
        path_elements: [createTranslationTarget({ x_meters: 1, y_meters: 2 })]
      }),
      config: { robot_length_meters: 0.7 }
    });

    const serialized = serializeProjectDocument(project);
    const restored = deserializeProjectDocument(serialized);

    expect(serialized.schema_version).toBe(1);
    expect(restored).toMatchObject({
      schema_version: 1,
      project_id: "project-1",
      display_name: "Example",
      config: {
        gui: {
          robot: {
            length_meters: 0.7,
            width_meters: 0.5
          }
        }
      }
    });
    expect(restored.path.path_elements[0]).toMatchObject({
      type: "translation",
      x_meters: 1,
      y_meters: 2
    });
  });

  it("uses project config defaults while deserializing paths", () => {
    const restored = deserializeProjectDocument({
      schema_version: 1,
      project_id: "project-1",
      display_name: "Example",
      path_file_name: "middle_depo.json",
      config: {
        kinematic_constraints: {
          default_intermediate_handoff_radius_meters: 0.44
        }
      },
      path: {
        path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }]
      }
    });

    expect(restored.path_file_name).toBe("middle_depo.json");
    expect(restored.path.path_elements[0]).toMatchObject({
      type: "translation",
      intermediate_handoff_radius_meters: 0.44
    });
  });

  it("deserializes the fixture-backed legacy full mix project", () => {
    const restored = deserializeProjectDocument(
      readFixture("legacy-full-mix.json")
    );

    expect(restored).toMatchObject({
      project_id: "fixture-full-mix",
      display_name: "Fixture Full Mix",
      path_file_name: "full_mix.json",
      config: {
        gui: {
          robot: {
            length_meters: 0.82,
            width_meters: 0.98
          },
          protrusions: {
            enabled: true,
            distance_meters: 0.3,
            side: "front",
            default_state: "shown"
          }
        },
        kinematic_constraints: {
          default_intermediate_handoff_radius_meters: 0.45,
          default_max_velocity_meters_per_sec: 3.5
        }
      }
    });
    expect(restored.path.path_elements[0]).toMatchObject({
      type: "translation",
      intermediate_handoff_radius_meters: 0.45
    });
    expect(restored.path.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 1.25,
        start_ordinal: 1,
        end_ordinal: 2
      },
      {
        key: "max_velocity_deg_per_sec",
        value: 90,
        start_ordinal: 1,
        end_ordinal: 2
      }
    ]);
  });

  it("wraps a native legacy path document in the v1 project schema", () => {
    const restored = deserializeProjectDocument(
      {
        path_elements: [{ type: "translation", x_meters: 4, y_meters: 5 }]
      },
      {
        fallbackProjectId: "legacy-id",
        fallbackDisplayName: "Legacy",
        fallbackPathFileName: "legacy-path.json"
      }
    );

    expect(restored).toMatchObject({
      schema_version: 1,
      project_id: "legacy-id",
      display_name: "Legacy",
      path_file_name: "legacy-path.json"
    });
    expect(restored.path.path_elements[0]).toMatchObject({
      type: "translation",
      x_meters: 4,
      y_meters: 5
    });
  });
});

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/project-io/${name}`, import.meta.url), "utf8")
  ) as unknown;
}

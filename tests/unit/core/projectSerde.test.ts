import { describe, expect, it } from "vitest";
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

  it("counts event triggers in the rotation ranged-constraint domain", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        { type: "event_trigger", t_ratio: 0.25, lib_key: "A" },
        { type: "rotation", rotation_radians: 0.5, t_ratio: 0.5 },
        { type: "translation", x_meters: 1, y_meters: 1 }
      ],
      constraints: {
        max_velocity_deg_per_sec: [
          { value: 90, start_ordinal: 1, end_ordinal: 1 }
        ]
      }
    });

    expect(restored.path_elements[1]).toMatchObject({ type: "event_trigger" });
    expect(restored.path_elements[2]).toMatchObject({ type: "rotation" });
    expect(restored.ranged_constraints).toEqual([
      {
        key: "max_velocity_deg_per_sec",
        value: 90,
        start_ordinal: 2,
        end_ordinal: 2
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
});

describe("project document serde", () => {
  it("serializes and deserializes a versioned project document", () => {
    const project = createProjectDocument({
      project_id: "project-1",
      display_name: "Example",
      path: createPathModel({
        path_elements: [createTranslationTarget({ x_meters: 1, y_meters: 2 })]
      }),
      config: { team: "test" }
    });

    const serialized = serializeProjectDocument(project);
    const restored = deserializeProjectDocument(serialized);

    expect(serialized.schema_version).toBe(1);
    expect(restored).toMatchObject({
      schema_version: 1,
      project_id: "project-1",
      display_name: "Example",
      config: { team: "test" }
    });
    expect(restored.path.path_elements[0]).toMatchObject({
      type: "translation",
      x_meters: 1,
      y_meters: 2
    });
  });

  it("wraps a native legacy path document in the v1 project schema", () => {
    const restored = deserializeProjectDocument(
      {
        path_elements: [{ type: "translation", x_meters: 4, y_meters: 5 }]
      },
      {
        fallbackProjectId: "legacy-id",
        fallbackDisplayName: "Legacy"
      }
    );

    expect(restored).toMatchObject({
      schema_version: 1,
      project_id: "legacy-id",
      display_name: "Legacy"
    });
    expect(restored.path.path_elements[0]).toMatchObject({
      type: "translation",
      x_meters: 4,
      y_meters: 5
    });
  });
});

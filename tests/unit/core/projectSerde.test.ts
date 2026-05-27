import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  createConstraints,
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  type RangedConstraint,
} from "../../../src/core/model/path";
import { createProjectDocument } from "../../../src/core/io/projectSchema";
import {
  deserializePath,
  deserializeProjectDocument,
  serializePath,
  serializeProjectDocument,
} from "../../../src/core/io/projectSerde";
import {
  activeProjectFromWorkspace,
  addPathsToGroupInWorkspace,
  createPathGroupInWorkspace,
  deletePathGroupFromWorkspace,
  deletePathsFromWorkspace,
  deserializeProjectWorkspaceDocument,
  projectDocumentToWorkspaceDocument,
  removePathsFromGroupInWorkspace,
  serializeProjectWorkspaceDocument,
} from "../../../src/core/io/workspaceSerde";
import {
  createBLineProjectArchive,
  deserializeBLineProjectArchive,
  deserializeProjectConfig,
  serializeProjectConfig,
} from "../../../src/core/io/blineProject";
import { stringifyBLineJson } from "../../../src/core/io/blineJson";
import {
  deserializeBLineProjectFolder,
  serializeBLineProjectFolder,
} from "../../../src/core/io/projectFolder";

describe("project path serde", () => {
  it("serializes and deserializes the native BLine path shape", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createRotationTarget({ rotation_radians: 0.5, t_ratio: 0.5 }),
        createTranslationTarget({ x_meters: 2, y_meters: 1 }),
      ],
    });

    const data = serializePath(path);
    const restored = deserializePath(data, (key) =>
      key === "intermediate_handoff_radius_meters" ? 0.1 : null,
    );

    expect(restored.path_elements).toHaveLength(path.path_elements.length);
    expect(serializePath(restored).path_elements[0]).toMatchObject({
      type: "translation",
      x_meters: 0,
      y_meters: 0,
    });
  });

  it("ignores event triggers in the rotation ranged-constraint domain", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        { type: "event_trigger", t_ratio: 0.25, lib_key: "A" },
        { type: "rotation", rotation_radians: 0.5, t_ratio: 0.5 },
        { type: "translation", x_meters: 1, y_meters: 1 },
      ],
      constraints: {
        max_velocity_deg_per_sec: [
          { value: 90, start_ordinal: 0, end_ordinal: 0 },
        ],
      },
    });

    expect(restored.path_elements[1]).toMatchObject({ type: "event_trigger" });
    expect(restored.path_elements[2]).toMatchObject({ type: "rotation" });
    expect(restored.ranged_constraints).toEqual([
      {
        key: "max_velocity_deg_per_sec",
        value: 90,
        start_ordinal: 1,
        end_ordinal: 1,
      },
    ]);
  });

  it("repairs overlapping translation ranges from older files", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        { type: "translation", x_meters: 1, y_meters: 0 },
        { type: "translation", x_meters: 2, y_meters: 0 },
      ],
      constraints: {
        max_velocity_meters_per_sec: [
          { value: 2, start_ordinal: 0, end_ordinal: 0 },
          { value: 2, start_ordinal: 0, end_ordinal: 1 },
          { value: 4, start_ordinal: 2, end_ordinal: 2 },
        ],
      },
    });

    expect(restored.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 1,
      },
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 2,
        end_ordinal: 2,
      },
      {
        key: "max_velocity_meters_per_sec",
        value: 4,
        start_ordinal: 3,
        end_ordinal: 3,
      },
    ]);
  });

  it("drops fully covered overlapping ranged constraints", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        { type: "translation", x_meters: 1, y_meters: 0 },
      ],
      constraints: {
        max_velocity_meters_per_sec: [
          { value: 2, start_ordinal: 0, end_ordinal: 1 },
          { value: 3, start_ordinal: 0, end_ordinal: 0 },
        ],
      },
    });

    expect(restored.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 2,
      },
    ]);
  });

  it("serializes scalar and ranged constraints using the desktop file format", () => {
    const ranged: RangedConstraint = {
      key: "max_velocity_meters_per_sec",
      value: 2.5,
      start_ordinal: 1,
      end_ordinal: 2,
    };
    const path = createPathModel({
      constraints: createConstraints({
        max_velocity_meters_per_sec: 4,
        end_translation_tolerance_meters: 0.05,
      }),
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 1,
            y_meters: 1,
          }),
          rotation_target: createRotationTarget({ rotation_radians: 1.25 }),
        }),
        createEventTrigger({ t_ratio: 0.25, lib_key: "marker" }),
      ],
      ranged_constraints: [ranged],
    });

    expect(serializePath(path)).toEqual({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        {
          type: "waypoint",
          translation_target: { x_meters: 1, y_meters: 1 },
          rotation_target: { rotation_radians: 1.25, profiled_rotation: true },
        },
        { type: "event_trigger", t_ratio: 0.25, lib_key: "marker" },
      ],
      constraints: {
        end_translation_tolerance_meters: 0.05,
        max_velocity_meters_per_sec: [
          { value: 2.5, start_ordinal: 0, end_ordinal: 1 },
        ],
      },
    });
  });

  it("serializes native BLine path JSON in PySide key order", () => {
    const path = createPathModel({
      constraints: createConstraints({
        max_velocity_meters_per_sec: 4,
        end_translation_tolerance_meters: 0.05,
      }),
      path_elements: [
        createTranslationTarget({
          x_meters: 0,
          y_meters: 0,
          intermediate_handoff_radius_meters: 0.15,
        }),
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 1,
            y_meters: 1,
            intermediate_handoff_radius_meters: 0.2,
          }),
          rotation_target: createRotationTarget({ rotation_radians: 1.25 }),
        }),
        createEventTrigger({ t_ratio: 0.25, lib_key: "marker" }),
      ],
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec",
          value: 2.5,
          start_ordinal: 1,
          end_ordinal: 2,
        },
      ],
    });

    expectSubstringsInOrder(stringifyBLineJson(serializePath(path)), [
      '"path_elements"',
      '"type": "translation"',
      '"x_meters": 0.0',
      '"y_meters": 0.0',
      '"intermediate_handoff_radius_meters": 0.15',
      '"type": "waypoint"',
      '"translation_target"',
      '"x_meters": 1.0',
      '"y_meters": 1.0',
      '"intermediate_handoff_radius_meters": 0.2',
      '"rotation_target"',
      '"rotation_radians": 1.25',
      '"profiled_rotation": true',
      '"type": "event_trigger"',
      '"t_ratio": 0.25',
      '"lib_key": "marker"',
      '"constraints"',
      '"end_translation_tolerance_meters": 0.05',
      '"max_velocity_meters_per_sec"',
      '"value": 2.5',
      '"start_ordinal": 0',
      '"end_ordinal": 1',
    ]);
  });

  it("rounds native BLine path JSON numbers to five decimal places", () => {
    const encoded = stringifyBLineJson({
      path_elements: [
        {
          type: "waypoint",
          translation_target: {
            x_meters: 6.830235379219491,
            y_meters: 0.22000000000000003,
            intermediate_handoff_radius_meters: 0.15000000000000002,
          },
          rotation_target: {
            rotation_radians: 3.141592653589793,
            profiled_rotation: true,
          },
        },
        {
          type: "event_trigger",
          t_ratio: 0.303547298130239,
          lib_key: "shoot",
        },
      ],
      constraints: {
        max_velocity_meters_per_sec: [
          {
            value: 2.0000049,
            start_ordinal: 0,
            end_ordinal: 1,
          },
        ],
        max_acceleration_meters_per_sec2: 12.0000004,
      },
    });

    expectSubstringsInOrder(encoded, [
      '"x_meters": 6.83024',
      '"y_meters": 0.22',
      '"intermediate_handoff_radius_meters": 0.15',
      '"rotation_radians": 3.14159',
      '"t_ratio": 0.30355',
      '"value": 2.0',
      '"start_ordinal": 0',
      '"end_ordinal": 1',
      '"max_acceleration_meters_per_sec2": 12.0',
    ]);
  });

  it("serializes all ranged constraint domains with zero-based ordinals", () => {
    const path = createPathModel({
      constraints: createConstraints({
        max_velocity_meters_per_sec: 4,
        min_velocity_meters_per_sec: 0.4,
        max_acceleration_meters_per_sec2: 8,
        max_velocity_deg_per_sec: 720,
        min_velocity_deg_per_sec: 45,
        max_acceleration_deg_per_sec2: 1500,
      }),
      path_elements: [
        createTranslationTarget({ x_meters: 0, y_meters: 0 }),
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 1,
            y_meters: 0,
          }),
          rotation_target: createRotationTarget({ rotation_radians: 0.5 }),
        }),
        createEventTrigger({ t_ratio: 0.5, lib_key: "shoot" }),
        createRotationTarget({ t_ratio: 0.75, rotation_radians: 1 }),
      ],
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec",
          value: 2,
          start_ordinal: 1,
          end_ordinal: 2,
        },
        {
          key: "min_velocity_meters_per_sec",
          value: 0.6,
          start_ordinal: 2,
          end_ordinal: 2,
        },
        {
          key: "max_acceleration_meters_per_sec2",
          value: 6,
          start_ordinal: 2,
          end_ordinal: 2,
        },
        {
          key: "max_velocity_deg_per_sec",
          value: 90,
          start_ordinal: 1,
          end_ordinal: 2,
        },
        {
          key: "min_velocity_deg_per_sec",
          value: 55,
          start_ordinal: 1,
          end_ordinal: 1,
        },
        {
          key: "max_acceleration_deg_per_sec2",
          value: 180,
          start_ordinal: 2,
          end_ordinal: 2,
        },
      ],
    });

    expect(serializePath(path).constraints).toEqual({
      max_velocity_meters_per_sec: [
        { value: 2, start_ordinal: 0, end_ordinal: 1 },
      ],
      min_velocity_meters_per_sec: [
        { value: 0.6, start_ordinal: 1, end_ordinal: 1 },
      ],
      max_acceleration_meters_per_sec2: [
        { value: 6, start_ordinal: 1, end_ordinal: 1 },
      ],
      max_velocity_deg_per_sec: [
        { value: 90, start_ordinal: 0, end_ordinal: 1 },
      ],
      min_velocity_deg_per_sec: [
        { value: 55, start_ordinal: 0, end_ordinal: 0 },
      ],
      max_acceleration_deg_per_sec2: [
        { value: 180, start_ordinal: 1, end_ordinal: 1 },
      ],
    });
  });

  it("serializes scalar motion constraints as full-domain BLine-Lib ranges", () => {
    const path = createPathModel({
      constraints: createConstraints({
        max_velocity_meters_per_sec: 3.2,
        min_velocity_meters_per_sec: 0.5,
        max_acceleration_meters_per_sec2: 6.4,
        max_velocity_deg_per_sec: 540,
        min_velocity_deg_per_sec: 60,
        max_acceleration_deg_per_sec2: 1200,
        end_translation_tolerance_meters: 0.04,
      }),
      path_elements: [
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 0,
            y_meters: 0,
          }),
          rotation_target: createRotationTarget({ rotation_radians: 0 }),
        }),
        createTranslationTarget({ x_meters: 1, y_meters: 0 }),
        createRotationTarget({ t_ratio: 0.5, rotation_radians: 1 }),
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 2,
            y_meters: 0,
          }),
          rotation_target: createRotationTarget({ rotation_radians: 2 }),
        }),
      ],
    });

    expect(serializePath(path).constraints).toEqual({
      max_velocity_meters_per_sec: [
        { value: 3.2, start_ordinal: 0, end_ordinal: 2 },
      ],
      min_velocity_meters_per_sec: [
        { value: 0.5, start_ordinal: 0, end_ordinal: 2 },
      ],
      max_acceleration_meters_per_sec2: [
        { value: 6.4, start_ordinal: 0, end_ordinal: 2 },
      ],
      end_translation_tolerance_meters: 0.04,
      max_velocity_deg_per_sec: [
        { value: 540, start_ordinal: 0, end_ordinal: 2 },
      ],
      min_velocity_deg_per_sec: [
        { value: 60, start_ordinal: 0, end_ordinal: 2 },
      ],
      max_acceleration_deg_per_sec2: [
        { value: 1200, start_ordinal: 0, end_ordinal: 2 },
      ],
    });
  });

  it("reads legacy default scalar constraint keys", () => {
    const restored = deserializePath({
      path_elements: [{ type: "translation", x_meters: 0, y_meters: 0 }],
      constraints: {
        default_max_velocity_meters_per_sec: 3,
        default_end_translation_tolerance_meters: 0.04,
      },
    });

    expect(restored.constraints).toMatchObject({
      max_velocity_meters_per_sec: 3,
      end_translation_tolerance_meters: 0.04,
    });
  });

  it("uses waypoints in translation and rotation ranged-constraint domains", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        {
          type: "waypoint",
          translation_target: { x_meters: 1, y_meters: 0 },
          rotation_target: { rotation_radians: 0.25 },
        },
        { type: "event_trigger", t_ratio: 0.3, lib_key: "event" },
      ],
      constraints: {
        max_velocity_meters_per_sec: [
          { value: 2, start_ordinal: 1, end_ordinal: 1 },
        ],
        min_velocity_meters_per_sec: [
          { value: 0.7, start_ordinal: 0, end_ordinal: 0 },
        ],
        max_velocity_deg_per_sec: [
          { value: 90, start_ordinal: 0, end_ordinal: 0 },
        ],
        min_velocity_deg_per_sec: [
          { value: 45, start_ordinal: 0, end_ordinal: 0 },
        ],
      },
    });

    expect(restored.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 2,
        end_ordinal: 2,
      },
      {
        key: "min_velocity_meters_per_sec",
        value: 0.7,
        start_ordinal: 1,
        end_ordinal: 1,
      },
      {
        key: "max_velocity_deg_per_sec",
        value: 90,
        start_ordinal: 1,
        end_ordinal: 1,
      },
      {
        key: "min_velocity_deg_per_sec",
        value: 45,
        start_ordinal: 1,
        end_ordinal: 1,
      },
    ]);
  });

  it("clamps and swaps reversed out-of-bounds ranged constraints", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        { type: "translation", x_meters: 1, y_meters: 0 },
      ],
      constraints: {
        max_velocity_meters_per_sec: [
          { value: 2, start_ordinal: 9, end_ordinal: -1 },
        ],
      },
    });

    expect(restored.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 2,
      },
    ]);
  });

  it("converts legacy rotation coordinates into segment-relative t-ratio", () => {
    const restored = deserializePath({
      path_elements: [
        { type: "translation", x_meters: 0, y_meters: 0 },
        { type: "rotation", rotation_radians: 1, x_meters: 5, y_meters: 0 },
        { type: "translation", x_meters: 10, y_meters: 0 },
      ],
    });

    expect(restored.path_elements[1]).toMatchObject({
      type: "rotation",
      t_ratio: 0.5,
      legacy_position: null,
      legacy_converted: true,
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
            y_meters: 0,
          },
        },
        { type: "translation", x_meters: 10, y_meters: 0 },
      ],
    });

    expect(restored.path_elements[1]).toMatchObject({
      type: "waypoint",
      rotation_target: {
        t_ratio: 0.5,
        legacy_position: null,
        legacy_converted: true,
      },
    });
  });
});

function textImportFile(webkitRelativePath: string, value: unknown) {
  return {
    name: webkitRelativePath.split("/").at(-1) ?? "file.json",
    webkitRelativePath,
    text: async () => JSON.stringify(value),
  };
}

describe("project document serde", () => {
  it("serializes and deserializes a versioned project document", () => {
    const project = createProjectDocument({
      project_id: "project-1",
      display_name: "Example",
      path: createPathModel({
        path_elements: [createTranslationTarget({ x_meters: 1, y_meters: 2 })],
      }),
      config: { robot_length_meters: 0.7 },
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
            width_meters: 0.8,
          },
        },
      },
    });
    expect(restored.path.path_elements[0]).toMatchObject({
      type: "translation",
      x_meters: 1,
      y_meters: 2,
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
          default_intermediate_handoff_radius_meters: 0.44,
        },
      },
      path: {
        path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }],
      },
    });

    expect(restored.path_file_name).toBe("middle_depo.json");
    expect(restored.path.path_elements[0]).toMatchObject({
      type: "translation",
      intermediate_handoff_radius_meters: 0.44,
    });
  });

  it("deserializes the fixture-backed legacy full mix project", () => {
    const restored = deserializeProjectDocument(
      readFixture("legacy-full-mix.json"),
    );

    expect(restored).toMatchObject({
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
            default_state: "shown",
          },
        },
        kinematic_constraints: {
          default_intermediate_handoff_radius_meters: 0.45,
          default_max_velocity_meters_per_sec: 3.5,
        },
      },
    });
    expect(restored.path.path_elements[0]).toMatchObject({
      type: "translation",
      intermediate_handoff_radius_meters: 0.45,
    });
    expect(restored.path.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 1.25,
        start_ordinal: 1,
        end_ordinal: 2,
      },
      {
        key: "max_velocity_deg_per_sec",
        value: 90,
        start_ordinal: 1,
        end_ordinal: 2,
      },
    ]);
  });

  it("wraps a native legacy path document in the v1 project schema", () => {
    const restored = deserializeProjectDocument(
      {
        path_elements: [{ type: "translation", x_meters: 4, y_meters: 5 }],
      },
      {
        fallbackProjectId: "legacy-id",
        fallbackDisplayName: "Legacy",
        fallbackPathFileName: "legacy-path.json",
      },
    );

    expect(restored).toMatchObject({
      schema_version: 1,
      project_id: "legacy-id",
      display_name: "Legacy",
      path_file_name: "legacy-path.json",
    });
    expect(restored.path.path_elements[0]).toMatchObject({
      type: "translation",
      x_meters: 4,
      y_meters: 5,
    });
  });

  it("serializes config JSON in the BLine-Lib-compatible global config shape", () => {
    const config = serializeProjectConfig({
      robot_length_meters: 0.7,
      default_max_velocity_meters_per_sec: 5.2,
    });

    expect(config).toMatchObject({
      gui: {
        robot: {
          length_meters: 0.7,
        },
      },
      kinematic_constraints: {
        default_max_velocity_meters_per_sec: 5.2,
      },
    });
    expect(deserializeProjectConfig(config)).toEqual(config);
  });

  it("round-trips a BLine project archive with config and native paths", () => {
    const project = createProjectDocument({
      project_id: "project-1",
      display_name: "Top Sweep",
      path_file_name: "top_sweep.json",
      path: createPathModel({
        path_elements: [createTranslationTarget({ x_meters: 1, y_meters: 2 })],
      }),
      config: {
        kinematic_constraints: {
          default_intermediate_handoff_radius_meters: 0.42,
        },
      },
    });

    const archive = createBLineProjectArchive(
      [project],
      "2026-04-26T12:00:00.000Z",
    );
    const restored = deserializeBLineProjectArchive(archive);

    expect(archive).toMatchObject({
      bline_project_schema_version: 1,
      config: {
        kinematic_constraints: {
          default_intermediate_handoff_radius_meters: 0.42,
        },
      },
      paths: [
        {
          file_name: "top_sweep.json",
          path: {
            path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }],
          },
        },
      ],
    });
    expect(restored.paths[0]).toMatchObject({
      path_id: "top_sweep.json",
      display_name: "Top Sweep",
      file_name: "top_sweep.json",
    });
    expect(restored.paths[0].path.path_elements[0]).toMatchObject({
      type: "translation",
      intermediate_handoff_radius_meters: 0.42,
    });
  });

  it("round-trips an expanded autos folder with config.json and paths/*.json", async () => {
    const workspace = deserializeProjectWorkspaceDocument({
      schema_version: 1,
      project_id: "workspace-1",
      display_name: "Robot Autos",
      config: {
        kinematic_constraints: {
          default_intermediate_handoff_radius_meters: 0.35,
        },
      },
      paths: [
        {
          path_id: "top",
          display_name: "Top Sweep",
          file_name: "top_sweep.json",
          path: {
            path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }],
          },
        },
        {
          path_id: "bottom",
          display_name: "Bottom Sweep",
          file_name: "bottom_sweep.json",
          path: {
            path_elements: [{ type: "translation", x_meters: 3, y_meters: 4 }],
          },
        },
      ],
      active_path_id: "top",
      path_groups: [
        {
          group_id: "score",
          display_name: "Score Autos",
          path_ids: ["top", "bottom"],
        },
      ],
      active_path_group_id: "score",
    });

    const folder = serializeBLineProjectFolder(workspace);
    const pathGroupsFile = folder.files.find(
      (file) => file.relativePath === "pathgroups.json",
    );
    const restored = await deserializeBLineProjectFolder(
      folder.files.map((file) => ({
        name: file.relativePath.split("/").at(-1) ?? file.relativePath,
        webkitRelativePath: `autos/${file.relativePath}`,
        text: () => file.blob.text(),
      })),
    );

    expect(folder.files.map((file) => file.relativePath)).toEqual([
      "config.json",
      "pathgroups.json",
      "paths/top_sweep.json",
      "paths/bottom_sweep.json",
    ]);
    expect(pathGroupsFile).toBeDefined();
    await expect(pathGroupsFile!.blob.text().then(JSON.parse)).resolves.toEqual(
      {
        schema_version: 1,
        groups: [
          {
            group_id: "score",
            display_name: "Score Autos",
            path_file_names: ["top_sweep.json", "bottom_sweep.json"],
          },
        ],
      },
    );
    expect(restored.display_name).toBe("autos");
    expect(restored.paths.map((path) => path.file_name)).toEqual([
      "bottom_sweep.json",
      "top_sweep.json",
    ]);
    expect(restored.path_groups).toEqual([
      {
        group_id: "score",
        display_name: "Score Autos",
        path_ids: ["top_sweep.json", "bottom_sweep.json"],
      },
    ]);
    expect(restored.active_path_group_id).toBeNull();
    expect(restored.paths[0].path.path_elements[0]).toMatchObject({
      type: "translation",
      intermediate_handoff_radius_meters: 0.35,
    });
  });

  it("imports an FRC project root folder and preserves config plus ranged constraints", async () => {
    const restored = await deserializeBLineProjectFolder([
      textImportFile("2026-robot-code/src/main/deploy/autos/config.json", {
        gui: {
          robot: {
            length_meters: 0.8255,
            width_meters: 0.9779,
          },
          protrusions: {
            enabled: true,
            distance_meters: 0.3,
            side: "front",
            default_state: "hidden",
            show_on_event_keys: ["intake", "deploy"],
            hide_on_event_keys: [],
          },
        },
        kinematic_constraints: {
          default_max_velocity_meters_per_sec: 4.5,
          default_max_acceleration_meters_per_sec2: 12,
          default_intermediate_handoff_radius_meters: 0.25,
          default_max_velocity_deg_per_sec: 600,
          default_max_acceleration_deg_per_sec2: 2000,
          default_end_translation_tolerance_meters: 0.03,
          default_end_rotation_tolerance_deg: 2,
        },
      }),
      textImportFile(
        "2026-robot-code/src/main/deploy/autos/paths/top_sweep_short.json",
        {
          path_elements: [
            { type: "translation", x_meters: 1, y_meters: 2 },
            { type: "translation", x_meters: 3, y_meters: 4 },
            { type: "translation", x_meters: 5, y_meters: 6 },
          ],
          constraints: {
            max_velocity_meters_per_sec: [
              { value: 2, start_ordinal: 0, end_ordinal: 1 },
              { value: 2.7, start_ordinal: 2, end_ordinal: 2 },
            ],
          },
        },
      ),
    ]);

    expect(restored.display_name).toBe("2026 robot code");
    expect(restored.config.gui.robot.length_meters).toBe(0.8255);
    expect(restored.config.gui.protrusions).toMatchObject({
      enabled: true,
      distance_meters: 0.3,
      side: "front",
      default_state: "hidden",
      show_on_event_keys: ["intake", "deploy"],
    });
    expect(restored.config.kinematic_constraints).toMatchObject({
      default_max_acceleration_meters_per_sec2: 12,
      default_intermediate_handoff_radius_meters: 0.25,
      default_max_velocity_deg_per_sec: 600,
    });
    expect(restored.paths[0].path.path_elements[0]).toMatchObject({
      type: "translation",
      intermediate_handoff_radius_meters: 0.25,
    });
    expect(restored.paths[0].path.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 2,
      },
      {
        key: "max_velocity_meters_per_sec",
        value: 2.7,
        start_ordinal: 3,
        end_ordinal: 3,
      },
    ]);
  });

  it("imports a selected paths folder as an autos paths directory", async () => {
    const restored = await deserializeBLineProjectFolder([
      textImportFile("paths/new-path.json", {
        path_elements: [{ type: "translation", x_meters: 2, y_meters: 3 }],
      }),
      textImportFile("paths/phase-1-canvas-draft.json", {
        path_elements: [{ type: "translation", x_meters: 4, y_meters: 5 }],
      }),
    ]);

    expect(restored.paths.map((path) => path.file_name)).toEqual([
      "new-path.json",
      "phase-1-canvas-draft.json",
    ]);
    expect(restored.active_path_id).toBe("new-path.json");
    expect(restored.paths[0].path.path_elements[0]).toMatchObject({
      type: "translation",
      x_meters: 2,
      y_meters: 3,
    });
  });

  it.skipIf(!process.env.BLINE_ROBOT_CODE_FIXTURE_DIR)(
    "imports the local 2026 robot-code autos fixture",
    async () => {
      const root = process.env.BLINE_ROBOT_CODE_FIXTURE_DIR;
      if (!root) {
        throw new Error("BLINE_ROBOT_CODE_FIXTURE_DIR is not set");
      }

      const files = recursiveJsonFiles(root).map((filePath) => ({
        name: filePath.split("/").at(-1) ?? "file.json",
        webkitRelativePath: `2026-robot-code/${relative(root, filePath).replace(/\\/g, "/")}`,
        text: async () => readFileSync(filePath, "utf8"),
      }));
      const restored = await deserializeBLineProjectFolder(files);
      const constrainedPath = restored.paths.find(
        (path) => path.path.ranged_constraints.length > 0,
      );

      expect(restored.config.gui.robot.length_meters).toBe(0.8255);
      expect(restored.config.gui.protrusions).toMatchObject({
        enabled: true,
        side: "front",
        default_state: "hidden",
      });
      expect(restored.config.kinematic_constraints).toMatchObject({
        default_max_acceleration_meters_per_sec2: 12,
        default_intermediate_handoff_radius_meters: 0.25,
        default_max_velocity_deg_per_sec: 600,
      });
      expect(restored.paths.length).toBeGreaterThan(10);
      expect(constrainedPath?.path.ranged_constraints.length).toBeGreaterThan(
        0,
      );
    },
  );

  it("migrates one-path project documents into workspace documents", () => {
    const project = createProjectDocument({
      project_id: "project-1",
      display_name: "Top Sweep",
      path_file_name: "top_sweep.json",
      path: createPathModel({
        path_elements: [createTranslationTarget({ x_meters: 1, y_meters: 2 })],
      }),
    });

    const workspace = projectDocumentToWorkspaceDocument(project);
    const serialized = serializeProjectWorkspaceDocument(workspace);
    const restored = deserializeProjectWorkspaceDocument(serialized);
    const activeProject = activeProjectFromWorkspace(restored);

    expect(restored).toMatchObject({
      schema_version: 1,
      project_id: "project-1",
      display_name: "Top Sweep",
      active_path_id: "project-1",
    });
    expect(restored.paths).toHaveLength(1);
    expect(activeProject).toMatchObject({
      project_id: "project-1",
      display_name: "Top Sweep",
      path_file_name: "top_sweep.json",
    });
  });

  it("normalizes path groups and keeps groups independent from root paths", () => {
    const workspace = deserializeProjectWorkspaceDocument({
      schema_version: 1,
      project_id: "workspace-1",
      display_name: "Robot Autos",
      config: undefined,
      paths: [
        {
          path_id: "top",
          display_name: "Top",
          file_name: "top.json",
          path: { path_elements: [] },
        },
        {
          path_id: "bottom",
          display_name: "Bottom",
          file_name: "bottom.json",
          path: { path_elements: [] },
        },
      ],
      active_path_id: "top",
      path_groups: [
        {
          group_id: "score",
          display_name: "Score",
          path_ids: ["top", "top", "missing"],
        },
        {
          group_id: "avoid",
          display_name: "Avoid",
          path_ids: ["top"],
        },
      ],
      active_path_group_id: "score",
    });

    expect(workspace.path_groups).toEqual([
      { group_id: "score", display_name: "Score", path_ids: ["top"] },
      { group_id: "avoid", display_name: "Avoid", path_ids: ["top"] },
    ]);
    expect(workspace.active_path_group_id).toBe("score");

    const withBottom = addPathsToGroupInWorkspace(workspace, "score", [
      "bottom",
    ]);
    expect(withBottom.path_groups[0]?.path_ids).toEqual(["top", "bottom"]);

    const withoutTop = removePathsFromGroupInWorkspace(withBottom, "score", [
      "top",
    ]);
    expect(withoutTop.path_groups[0]?.path_ids).toEqual(["bottom"]);
    expect(withoutTop.active_path_id).toBe("bottom");

    const withDeletedPath = deletePathsFromWorkspace(withBottom, ["bottom"]);
    expect(withDeletedPath.path_groups[0]?.path_ids).toEqual(["top"]);
    expect(withDeletedPath.paths.map((path) => path.path_id)).toEqual(["top"]);

    const keepPaths = deletePathGroupFromWorkspace(withBottom, "score");
    expect(keepPaths.path_groups.map((group) => group.group_id)).toEqual([
      "avoid",
    ]);
    expect(keepPaths.paths.map((path) => path.path_id)).toEqual([
      "top",
      "bottom",
    ]);

    const deleteMembers = deletePathGroupFromWorkspace(withBottom, "score", {
      deleteMemberPaths: true,
    });
    expect(deleteMembers.path_groups).toHaveLength(0);
    expect(deleteMembers.paths).toHaveLength(1);
  });

  it("creates a path group with the requested initial membership", () => {
    const workspace = deserializeProjectWorkspaceDocument({
      schema_version: 1,
      project_id: "workspace-1",
      display_name: "Robot Autos",
      config: undefined,
      paths: [
        {
          path_id: "top",
          display_name: "Top",
          file_name: "top.json",
          path: { path_elements: [] },
        },
      ],
      active_path_id: "top",
    });

    const grouped = createPathGroupInWorkspace(workspace, {
      display_name: "Score",
      group_id: "score",
      path_ids: ["top"],
    });

    expect(grouped.active_path_group_id).toBe("score");
    expect(grouped.path_groups).toEqual([
      { group_id: "score", display_name: "Score", path_ids: ["top"] },
    ]);
  });

  it("keeps auto velocity ownership in workspace metadata but out of BLine path JSON", () => {
    const autoConstraint: RangedConstraint = {
      key: "max_velocity_meters_per_sec",
      value: 1.25,
      start_ordinal: 2,
      end_ordinal: 2,
      source: "auto_velocity",
      auto_velocity: {
        velocity_safety_factor: 0.9,
        acceleration_safety_factor: 0.8,
        merge_tolerance_meters_per_sec: 0.3,
      },
    };
    const project = createProjectDocument({
      project_id: "project-1",
      display_name: "Auto Path",
      path_file_name: "auto_path.json",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 0, y_meters: 0 }),
          createTranslationTarget({ x_meters: 1, y_meters: 0 }),
        ],
        ranged_constraints: [autoConstraint],
      }),
    });

    expect(serializePath(project.path).constraints).toEqual({
      max_velocity_meters_per_sec: [
        {
          value: 1.25,
          start_ordinal: 1,
          end_ordinal: 1,
        },
      ],
    });

    const serialized = serializeProjectWorkspaceDocument(
      projectDocumentToWorkspaceDocument(project),
    );
    expect(serialized.paths[0]?.editor_metadata).toEqual({
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec",
          value: 1.25,
          start_ordinal: 2,
          end_ordinal: 2,
          source: "auto_velocity",
          auto_velocity: {
            velocity_safety_factor: 0.9,
            acceleration_safety_factor: 0.8,
            merge_tolerance_meters_per_sec: 0.3,
          },
        },
      ],
    });

    const restored = deserializeProjectWorkspaceDocument(serialized);
    expect(restored.paths[0]?.path.ranged_constraints[0]).toMatchObject({
      source: "auto_velocity",
      auto_velocity: {
        velocity_safety_factor: 0.9,
        acceleration_safety_factor: 0.8,
        merge_tolerance_meters_per_sec: 0.3,
      },
    });
  });
});

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../fixtures/project-io/${name}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

function recursiveJsonFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const entryPath = join(directory, entry);
      const stats = statSync(entryPath);
      if (stats.isDirectory()) {
        visit(entryPath);
      } else if (entryPath.endsWith(".json")) {
        files.push(entryPath);
      }
    }
  };
  visit(root);
  return files.sort();
}

function expectSubstringsInOrder(
  source: string,
  substrings: readonly string[],
): void {
  let cursor = 0;
  for (const substring of substrings) {
    const offset = source.slice(cursor).indexOf(substring);
    expect(
      offset,
      `missing ${substring} after byte ${cursor}`,
    ).toBeGreaterThanOrEqual(0);
    cursor += offset + substring.length;
  }
}

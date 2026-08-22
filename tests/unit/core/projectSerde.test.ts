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
import { createProject } from "../../../src/core/model/project";
import {
  deserializePath,
  deserializeProjectDocument,
  serializePath,
  serializeProjectDocument,
} from "../../../src/core/io/projectSerde";
import {
  deserializeProjectWorkspaceDocument,
  projectDocumentToWorkspaceDocument,
  serializeProjectWorkspaceDocument,
} from "../../../src/core/io/workspaceSerde";
import {
  assertCanonicalProjectRoundTrip,
  assertLegacyProjectWorkspaceDocument,
} from "../../../src/core/io/legacyMigrationValidation";
import {
  deserializeProjectFiles,
  serializeProjectFiles,
} from "../../../src/core/io/projectFiles";
import {
  createBLineProjectArchive,
  deserializeBLineProjectArchive,
  deserializeProjectConfig,
  serializeBLineRuntimeConfig,
  serializeProjectConfig,
} from "../../../src/core/io/blineProject";
import { stringifyBLineJson } from "../../../src/core/io/blineJson";
import {
  deserializeBLineProjectFolder,
  ProjectFolderLosslessMigrationError,
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
  it("proves combined-workspace migration through its genuine former writer", () => {
    const workspace = {
      ...createProject({
        project_id: "project-1",
        display_name: "Robot Autos",
        paths: [
          {
            path_id: "top",
            display_name: "Top",
            file_name: "top.json",
            path: createPathModel({
              path_elements: [
                createTranslationTarget({
                  x_meters: 1,
                  y_meters: 2,
                  intermediate_handoff_radius_meters: 0.45,
                }),
              ],
            }),
          },
        ],
        linked_targets: [
          {
            target_id: "point-1",
            display_name: "Target A",
            kind: "translation",
            x_meters: 1,
            y_meters: 2,
          },
          {
            target_id: "pose-1",
            display_name: "Target B",
            kind: "waypoint",
            x_meters: 3,
            y_meters: 4,
            rotation_radians: 0.5,
          },
        ],
      }),
      active_path_id: "top",
      active_path_group_id: null,
    };
    const valid = serializeProjectWorkspaceDocument(workspace);
    const legacyGeneratedConstraint = {
      ...valid,
      paths: valid.paths.map((path) =>
        path.path_id === "top"
          ? {
              ...path,
              path: {
                ...path.path,
                constraints: {
                  ...path.path.constraints,
                  max_velocity_meters_per_sec: [
                    { value: 1.4, start_ordinal: 0, end_ordinal: 0 },
                  ],
                },
              },
              editor_metadata: {
                ...(path.editor_metadata ?? {}),
                ranged_constraints: [
                  {
                    key: "max_velocity_meters_per_sec" as const,
                    value: 1.4,
                    start_ordinal: 1,
                    end_ordinal: 1,
                    source: "auto_velocity" as const,
                    auto_velocity: {
                      velocity_safety_factor: 0.8,
                      acceleration_safety_factor: 0.7,
                      merge_tolerance_meters_per_sec: 0.2,
                      input_signature: "legacy-signature",
                    },
                  },
                ],
              },
            }
          : path,
      ),
    };

    expect(() => assertLegacyProjectWorkspaceDocument(valid)).not.toThrow();
    expect(() =>
      assertLegacyProjectWorkspaceDocument(legacyGeneratedConstraint),
    ).not.toThrow();
    expect(() =>
      assertLegacyProjectWorkspaceDocument({
        ...valid,
        future_setting: true,
      }),
    ).toThrow(/loses field future_setting/);

    const [path] = valid.paths;
    expect(() =>
      assertLegacyProjectWorkspaceDocument({
        ...valid,
        paths: [
          {
            ...path,
            editor_metadata: {
              linked_targets: [
                { element_index: 0, target_id: "point-1" },
                { element_index: 0, target_id: "point-1" },
              ],
            },
          },
        ],
      }),
    ).toThrow(/has 2 entries, but the projection has 1/);

    expect(() =>
      assertLegacyProjectWorkspaceDocument({
        ...valid,
        linked_targets: valid.linked_targets?.map((target) => ({
          ...target,
          kind: target.kind === "translation" ? "point" : "pose",
        })),
      }),
    ).not.toThrow();
    expect(() =>
      assertLegacyProjectWorkspaceDocument({
        ...valid,
        linked_targets: valid.linked_targets?.map((target, index) => ({
          ...target,
          kind: target.kind === "translation" ? "point" : "pose",
          display_name: index === 0 ? "Linked Point 1" : target.display_name,
        })),
      }),
    ).toThrow(/display_name changes "Linked Point 1"/);

    expect(() => assertCanonicalProjectRoundTrip(workspace)).not.toThrow();
  });

  it("blocks destructive folder migration when runtime JSON has unknown fields", async () => {
    const config = {
      kinematic_constraints: {
        default_max_velocity_meters_per_sec: 4.5,
      },
      future_runtime_setting: true,
    };
    const path = {
      path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }],
    };

    await expect(
      deserializeBLineProjectFolder(
        [
          textImportFile("autos/config.json", config),
          textImportFile("autos/paths/auto.json", path),
          textImportFile("autos/pathgroups.json", {
            schema_version: 1,
            groups: [],
          }),
        ],
        { requireLosslessMigration: true },
      ),
    ).rejects.toMatchObject({
      name: "ProjectFolderLosslessMigrationError",
      sourcePath: "config.json",
      rawText: JSON.stringify(config),
    } satisfies Partial<ProjectFolderLosslessMigrationError>);

    const futurePath = { ...path, future_path_setting: true };
    await expect(
      deserializeBLineProjectFolder(
        [
          textImportFile("autos/paths/auto.json", futurePath),
          textImportFile("autos/pathgroups.json", {
            schema_version: 1,
            groups: [],
          }),
        ],
        { requireLosslessMigration: true },
      ),
    ).rejects.toMatchObject({
      name: "ProjectFolderLosslessMigrationError",
      sourcePath: "paths/auto.json",
      rawText: JSON.stringify(futurePath),
    } satisfies Partial<ProjectFolderLosslessMigrationError>);

    await expect(
      deserializeBLineProjectFolder(
        [
          {
            name: "config.json",
            webkitRelativePath: "autos/config.json",
            text: async () => "{not-json",
          },
          textImportFile("autos/paths/auto.json", path),
          textImportFile("autos/pathgroups.json", {
            schema_version: 1,
            groups: [],
          }),
        ],
        { requireLosslessMigration: true },
      ),
    ).rejects.toMatchObject({
      name: "ProjectFolderLosslessMigrationError",
      sourcePath: "config.json",
      rawText: "{not-json",
    } satisfies Partial<ProjectFolderLosslessMigrationError>);
  });

  it.each([false, true])(
    "rejects case-colliding normalized Path names before %s folder migration",
    async (requireLosslessMigration) => {
      const path = {
        path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }],
      };

      await expect(
        deserializeBLineProjectFolder(
          [
            textImportFile("autos/paths/Foo.json", path),
            textImportFile("autos/paths/foo.json", path),
          ],
          { requireLosslessMigration },
        ),
      ).rejects.toThrow(
        /duplicate or case-colliding normalized Path file names\/IDs: (Foo\.json and foo\.json|foo\.json and Foo\.json)/,
      );
    },
  );

  it("uses pathgroups.json when editor state omits path_groups", async () => {
    const restored = await deserializeBLineProjectFolder(
      [
        textImportFile("autos/paths/auto.json", {
          path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }],
        }),
        textImportFile("autos/.bline-web/state.json", {
          schema_version: 1,
          editor_config: { gui: {}, kinematic_constraints: {} },
          active_path_file_name: "auto.json",
          active_path_group_id: null,
          linked_targets: [],
          paths: {},
        }),
        textImportFile("autos/pathgroups.json", {
          schema_version: 1,
          groups: [
            {
              group_id: "group-1",
              display_name: "Group",
              path_file_names: ["auto.json"],
            },
          ],
        }),
      ],
      { requireLosslessMigration: true },
    );

    expect(restored.path_groups).toEqual([
      {
        group_id: "group-1",
        display_name: "Group",
        path_ids: ["auto.json"],
      },
    ]);
  });

  it("attests the historical Field Background asset sidecar before destructive migration", async () => {
    const legacyField = {
      selected_field_id: "legacy-field",
      custom_fields: [
        {
          id: "legacy-field",
          name: "Legacy Field",
          asset_id: "legacy-asset",
          file_name: "legacy.png",
          mime_type: "image/png",
          size_bytes: 3,
          created_at: "2026-04-23T15:40:00.000Z",
          geometry: {
            length_meters: 16.54,
            width_meters: 8.21,
            coordinate_offset_meters: 0,
            coordinate_offset_x_meters: 0,
            coordinate_offset_y_meters: 0,
          },
        },
      ],
    };
    const state = {
      schema_version: 1,
      editor_config: {
        gui: { field: legacyField },
        kinematic_constraints: {},
      },
      active_path_file_name: "auto.json",
      active_path_group_id: null,
      path_groups: [],
      linked_targets: [],
      paths: {},
      field_assets: {
        "legacy-asset": {
          file_name: "legacy.png",
          mime_type: "image/png",
        },
      },
    };
    const fieldAssets = {
      assets: {
        "legacy-asset": {
          file_name: "legacy.png",
          mime_type: "image/png",
        },
      },
    };
    const files = [
      textImportFile("autos/paths/auto.json", {
        path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }],
      }),
      textImportFile("autos/.bline-web/state.json", state),
      textImportFile("autos/.bline-web/field-assets.json", fieldAssets),
    ];

    const restored = await deserializeBLineProjectFolder(files, {
      requireLosslessMigration: true,
    });
    expect(restored.config.gui.field).toEqual(legacyField);

    await expect(
      deserializeBLineProjectFolder(
        [
          files[0]!,
          files[1]!,
          textImportFile("autos/.bline-web/field-assets.json", {
            assets: {
              "legacy-asset": { file_name: null, mime_type: null },
            },
          }),
        ],
        { requireLosslessMigration: true },
      ),
    ).resolves.toMatchObject({ config: { gui: { field: legacyField } } });

    const unsupported = {
      assets: {
        "legacy-asset": {
          ...fieldAssets.assets["legacy-asset"],
          future_metadata: true,
        },
      },
    };
    await expect(
      deserializeBLineProjectFolder(
        [
          files[0]!,
          files[1]!,
          textImportFile("autos/.bline-web/field-assets.json", unsupported),
        ],
        { requireLosslessMigration: true },
      ),
    ).rejects.toMatchObject({
      name: "ProjectFolderLosslessMigrationError",
      sourcePath: ".bline-web/field-assets.json",
      rawText: JSON.stringify(unsupported),
    } satisfies Partial<ProjectFolderLosslessMigrationError>);

    await expect(
      deserializeBLineProjectFolder(
        [
          files[0]!,
          files[1]!,
          textImportFile("autos/.bline-web/field-assets.json", {}),
        ],
        { requireLosslessMigration: true },
      ),
    ).rejects.toMatchObject({
      name: "ProjectFolderLosslessMigrationError",
      sourcePath: ".bline-web/field-assets.json",
      rawText: "{}",
    } satisfies Partial<ProjectFolderLosslessMigrationError>);

    await expect(
      deserializeBLineProjectFolder(
        [
          files[0]!,
          files[1]!,
          {
            name: "field-assets.json",
            webkitRelativePath: "autos/.bline-web/field-assets.json",
            text: async () => "",
          },
        ],
        { requireLosslessMigration: true },
      ),
    ).rejects.toMatchObject({
      name: "ProjectFolderLosslessMigrationError",
      sourcePath: ".bline-web/field-assets.json",
      rawText: "",
    } satisfies Partial<ProjectFolderLosslessMigrationError>);
  });

  it("accepts valid lower-priority desktop sidecars independently", async () => {
    const restored = await deserializeBLineProjectFolder(
      [
        textImportFile("autos/config.json", {
          kinematic_constraints: {
            default_auto_velocity_velocity_safety_factor: 0.8,
          },
        }),
        textImportFile("autos/paths/auto.json", {
          path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }],
        }),
        textImportFile("autos/.bline-web/state.json", {
          schema_version: 1,
          editor_config: {
            gui: {},
            kinematic_constraints: {
              default_auto_velocity_velocity_safety_factor: 0.6,
            },
          },
          active_path_file_name: "auto.json",
          active_path_group_id: null,
          path_groups: [],
          linked_targets: [],
          paths: {},
        }),
        textImportFile("autos/pathgroups.json", {
          schema_version: 1,
          groups: [
            {
              group_id: "stale-group",
              display_name: "Stale Group",
              path_file_names: ["auto.json"],
            },
          ],
        }),
      ],
      { requireLosslessMigration: true },
    );

    expect(restored.path_groups).toEqual([]);
    expect(
      restored.config.kinematic_constraints
        .default_auto_velocity_velocity_safety_factor,
    ).toBe(0.8);
  });

  it("blocks structurally empty legacy sidecars before destructive migration", async () => {
    const runtimePath = textImportFile("autos/paths/auto.json", {
      path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }],
    });
    for (const sourcePath of [
      ".bline-web/state.json",
      "pathgroups.json",
      ".bline-web/path-metadata.json",
    ]) {
      await expect(
        deserializeBLineProjectFolder(
          [runtimePath, textImportFile(`autos/${sourcePath}`, {})],
          { requireLosslessMigration: true },
        ),
      ).rejects.toMatchObject({
        name: "ProjectFolderLosslessMigrationError",
        sourcePath,
        rawText: "{}",
      } satisfies Partial<ProjectFolderLosslessMigrationError>);
    }
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

  it("serializes runtime config JSON in the BLine-Lib-compatible global config shape", () => {
    const config = serializeBLineRuntimeConfig({
      robot_length_meters: 0.7,
      default_max_velocity_meters_per_sec: 5.2,
      kinematic_constraints: {
        default_auto_velocity_velocity_safety_factor: 0.4,
      },
    });

    expect(config).toEqual({
      kinematic_constraints: {
        default_max_velocity_meters_per_sec: 5.2,
        default_max_acceleration_meters_per_sec2: 12,
        default_max_velocity_deg_per_sec: 720,
        default_max_acceleration_deg_per_sec2: 1500,
        default_end_translation_tolerance_meters: 0.03,
        default_end_rotation_tolerance_deg: 2,
        default_intermediate_handoff_radius_meters: 0.45,
      },
    });
    expect(JSON.stringify(config)).not.toContain("gui");
    expect(JSON.stringify(config)).not.toContain("auto_velocity");
    expect(
      deserializeProjectConfig(config).kinematic_constraints,
    ).toMatchObject(config.kinematic_constraints);
  });

  it("keeps project archive config editor-rich", () => {
    const config = serializeProjectConfig({
      robot_length_meters: 0.7,
      default_max_velocity_meters_per_sec: 5.2,
    });

    expect(config.gui.robot.length_meters).toBe(0.7);
    expect(
      config.kinematic_constraints.default_max_velocity_meters_per_sec,
    ).toBe(5.2);
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
      createProject({
        project_id: project.project_id,
        display_name: project.display_name,
        config: project.config,
        paths: [
          {
            path_id: project.project_id,
            display_name: project.display_name,
            file_name: project.path_file_name ?? "top_sweep.json",
            path: project.path,
          },
        ],
      }),
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

  it("round-trips an expanded autos folder with clean runtime files and visible Project metadata", async () => {
    const workspace = deserializeProjectWorkspaceDocument({
      schema_version: 1,
      project_id: "workspace-1",
      display_name: "Robot Autos",
      config: {
        gui: {
          robot: {
            length_meters: 0.75,
          },
        },
        kinematic_constraints: {
          default_intermediate_handoff_radius_meters: 0.35,
          default_auto_velocity_velocity_safety_factor: 0.65,
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
    const configFile = folder.files.find(
      (file) => file.relativePath === "config.json",
    );
    const projectFile = folder.files.find(
      (file) => file.relativePath === "project.json",
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
      "project.json",
      "paths/top_sweep.json",
      "paths/bottom_sweep.json",
    ]);
    expect(configFile).toBeDefined();
    expect(projectFile).toBeDefined();
    await expect(configFile!.blob.text().then(JSON.parse)).resolves.toEqual({
      kinematic_constraints: {
        default_max_velocity_meters_per_sec: 4.5,
        default_max_acceleration_meters_per_sec2: 12,
        default_max_velocity_deg_per_sec: 720,
        default_max_acceleration_deg_per_sec2: 1500,
        default_end_translation_tolerance_meters: 0.03,
        default_end_rotation_tolerance_deg: 2,
        default_intermediate_handoff_radius_meters: 0.35,
      },
    });
    const metadata = JSON.parse(await projectFile!.blob.text());
    expect(metadata).toMatchObject({
      schema_version: 1,
      project_id: "workspace-1",
      display_name: "Robot Autos",
      path_groups: [
        {
          group_id: "score",
          display_name: "Score Autos",
          path_ids: ["top", "bottom"],
        },
      ],
    });
    expect(metadata).not.toHaveProperty("field_assets");
    expect(metadata).not.toHaveProperty("editor_config.gui.field");
    expect(metadata).not.toHaveProperty("active_path_id");
    expect(metadata.editor_config.gui.robot.length_meters).toBe(0.75);
    expect(metadata.editor_config.kinematic_constraints).toEqual({
      default_auto_velocity_velocity_safety_factor: 0.65,
      default_auto_velocity_acceleration_safety_factor: 1,
      default_auto_velocity_merge_tolerance_meters_per_sec: 0.3,
    });
    expect(metadata.paths).toEqual([
      {
        path_id: "top",
        display_name: "Top Sweep",
        file_name: "top_sweep.json",
      },
      {
        path_id: "bottom",
        display_name: "Bottom Sweep",
        file_name: "bottom_sweep.json",
      },
    ]);
    expect(restored.display_name).toBe("Robot Autos");
    expect(restored.paths.map((path) => path.file_name)).toEqual([
      "top_sweep.json",
      "bottom_sweep.json",
    ]);
    expect(restored.paths.map((path) => path.display_name)).toEqual([
      "Top Sweep",
      "Bottom Sweep",
    ]);
    expect(restored.active_path_id).toBe("top");
    expect(restored.path_groups).toEqual([
      {
        group_id: "score",
        display_name: "Score Autos",
        path_ids: ["top", "bottom"],
      },
    ]);
    expect(restored.active_path_group_id).toBeNull();
    expect(restored.config.gui.robot.length_meters).toBe(0.75);
    expect(
      restored.config.kinematic_constraints
        .default_auto_velocity_velocity_safety_factor,
    ).toBe(0.65);
    expect(restored.paths[0].path.path_elements[0]).toMatchObject({
      type: "translation",
      intermediate_handoff_radius_meters: 0.35,
    });
  });

  it("imports legacy autos folder state and re-exports visible Project metadata", async () => {
    const restored = await deserializeBLineProjectFolder([
      textImportFile("autos/config.json", {
        gui: {
          robot: {
            length_meters: 0.71,
            width_meters: 0.92,
          },
        },
        kinematic_constraints: {
          default_max_velocity_meters_per_sec: 5.1,
          default_max_acceleration_meters_per_sec2: 10.5,
          default_intermediate_handoff_radius_meters: 0.28,
          default_max_velocity_deg_per_sec: 650,
          default_max_acceleration_deg_per_sec2: 1700,
          default_end_translation_tolerance_meters: 0.04,
          default_end_rotation_tolerance_deg: 3,
          default_auto_velocity_velocity_safety_factor: 0.72,
        },
      }),
      textImportFile("autos/pathgroups.json", {
        schema_version: 1,
        groups: [
          {
            group_id: "legacy",
            display_name: "Legacy Group",
            path_file_names: ["auto.json"],
          },
        ],
      }),
      textImportFile("autos/.bline-web/path-metadata.json", {
        paths: {
          "auto.json": {
            editor_metadata: {
              ranged_constraints: [
                {
                  key: "max_velocity_meters_per_sec",
                  value: 2.2,
                  start_ordinal: 1,
                  end_ordinal: 2,
                  source: "auto_velocity",
                  auto_velocity: {
                    velocity_safety_factor: 0.7,
                    acceleration_safety_factor: 0.6,
                    merge_tolerance_meters_per_sec: 0.2,
                  },
                },
              ],
            },
          },
        },
      }),
      textImportFile("autos/paths/auto.json", {
        path: {
          path_elements: [
            { type: "translation", x_meters: 1, y_meters: 2 },
            { type: "translation", x_meters: 3, y_meters: 4 },
          ],
          constraints: {
            max_velocity_meters_per_sec: [
              { value: 2.2, start_ordinal: 0, end_ordinal: 1 },
            ],
          },
        },
      }),
    ]);

    expect(restored.config.gui.robot).toMatchObject({
      length_meters: 0.71,
      width_meters: 0.92,
    });
    expect(restored.path_groups).toEqual([
      {
        group_id: "legacy",
        display_name: "Legacy Group",
        path_ids: ["auto.json"],
      },
    ]);
    expect(restored.paths[0].path.ranged_constraints[0]).toMatchObject({
      key: "max_velocity_meters_per_sec",
      value: 2.2,
      start_ordinal: 1,
      end_ordinal: 2,
      source: "auto_velocity",
      auto_velocity: {
        velocity_safety_factor: 0.7,
        acceleration_safety_factor: 0.6,
        merge_tolerance_meters_per_sec: 0.2,
      },
    });

    const exported = serializeBLineProjectFolder(restored);
    const names = exported.files.map((file) => file.relativePath);
    expect(names).toContain("config.json");
    expect(names).toContain("project.json");
    expect(names).toContain("paths/auto.json");
    expect(names).not.toContain("pathgroups.json");
    expect(names).not.toContain(".bline-web/path-metadata.json");

    const configFile = exported.files.find(
      (file) => file.relativePath === "config.json",
    );
    const projectFile = exported.files.find(
      (file) => file.relativePath === "project.json",
    );
    const exportedConfig = JSON.parse(await configFile!.blob.text());
    const exportedProject = JSON.parse(await projectFile!.blob.text());
    expect(JSON.stringify(exportedConfig)).not.toContain("gui");
    expect(exportedConfig.kinematic_constraints).toEqual({
      default_max_velocity_meters_per_sec: 5.1,
      default_max_acceleration_meters_per_sec2: 10.5,
      default_max_velocity_deg_per_sec: 650,
      default_max_acceleration_deg_per_sec2: 1700,
      default_end_translation_tolerance_meters: 0.04,
      default_end_rotation_tolerance_deg: 3,
      default_intermediate_handoff_radius_meters: 0.28,
    });
    expect(exportedProject.path_groups).toEqual([
      {
        group_id: "legacy",
        display_name: "Legacy Group",
        path_ids: ["auto.json"],
      },
    ]);
    expect(exportedProject).not.toHaveProperty("active_path_id");
    expect(names).not.toEqual(
      expect.arrayContaining([expect.stringContaining(".bline-web")]),
    );
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

    const restored = deserializeProjectWorkspaceDocument(
      serializeProjectDocument(project),
    );

    expect(restored).toMatchObject({
      schema_version: 1,
      project_id: "project-1",
      display_name: "Top Sweep",
      active_path_id: "project-1",
    });
    expect(restored.paths).toHaveLength(1);
    expect(restored.paths[0]).toMatchObject({
      path_id: "project-1",
      display_name: "Top Sweep",
      file_name: "top_sweep.json",
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
  });

  it("stores only automatic handoff ownership beside its runtime target", () => {
    const project = createProjectDocument({
      project_id: "project-1",
      display_name: "Bent Path",
      path_file_name: "bent_path.json",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 0, y_meters: 0 }),
          createTranslationTarget({
            x_meters: 1,
            y_meters: 0,
            intermediate_handoff_radius_meters: 0.4,
            handoff_radius_source: "auto",
          }),
          createWaypoint({
            translation_target: createTranslationTarget({
              x_meters: 2,
              y_meters: 1,
              intermediate_handoff_radius_meters: 0.3,
              handoff_radius_source: "manual",
            }),
          }),
          createTranslationTarget({ x_meters: 3, y_meters: 1 }),
        ],
      }),
    });

    const serializedPath = serializePath(project.path);
    expect(serializedPath.path_elements[1]).toEqual({
      type: "translation",
      x_meters: 1,
      y_meters: 0,
      intermediate_handoff_radius_meters: 0.4,
      handoff_radius_source: "auto",
    });
    expect(serializedPath.path_elements[2]).not.toHaveProperty(
      "translation_target.handoff_radius_source",
    );
    expect(stringifyBLineJson(serializedPath)).toContain(
      '"handoff_radius_source": "auto"',
    );
    expect(deserializePath(serializedPath).path_elements[1]).toMatchObject({
      handoff_radius_source: "auto",
    });

    const files = serializeProjectFiles(
      projectDocumentToWorkspaceDocument(project),
    );
    const serialized = JSON.parse(
      files.find((file) => file.relativePath === "project.json")?.text ??
        "null",
    ) as { paths: Array<{ editor_metadata?: Record<string, unknown> }> };
    expect(serialized.paths[0]?.editor_metadata).toBeUndefined();

    const restored = deserializeProjectFiles(files);
    const elements = restored.paths[0]?.path.path_elements ?? [];
    expect(elements[1]).toMatchObject({ handoff_radius_source: "auto" });
    expect(elements[2]).not.toHaveProperty(
      "translation_target.handoff_radius_source",
    );
    expect("handoff_radius_source" in elements[0]).toBe(false);
    expect("handoff_radius_source" in elements[3]).toBe(false);
  });

  it("stores only generated-constraint ownership beside its runtime value", () => {
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
        input_signature: "signature-1",
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
          source: "auto_velocity",
        },
      ],
    });
    expect(
      deserializePath(serializePath(project.path)).ranged_constraints[0],
    ).toMatchObject({
      source: "auto_velocity",
      auto_velocity: null,
    });

    const files = serializeProjectFiles(
      projectDocumentToWorkspaceDocument(project),
    );
    const serialized = JSON.parse(
      files.find((file) => file.relativePath === "project.json")?.text ??
        "null",
    ) as { paths: Array<{ editor_metadata?: Record<string, unknown> }> };
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
            input_signature: "signature-1",
          },
        },
      ],
    });

    const restored = deserializeProjectFiles(files);
    expect(restored.paths[0]?.path.ranged_constraints[0]).toMatchObject({
      source: "auto_velocity",
      auto_velocity: {
        velocity_safety_factor: 0.9,
        acceleration_safety_factor: 0.8,
        merge_tolerance_meters_per_sec: 0.3,
        input_signature: "signature-1",
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

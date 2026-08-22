import { describe, expect, it } from "vitest";
import {
  deserializeProjectFiles,
  openProjectFiles,
  serializeProjectFiles,
  type ProjectTextFile,
} from "../../../src/core/io/projectFiles";
import { createProject } from "../../../src/core/model/project";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  type RangedConstraint,
} from "../../../src/core/model/path";
import {
  getPathElementLinkedTargetId,
  setPathElementLinkedTargetId,
} from "../../../src/core/linkedTargets";

describe("Project file-set codec", () => {
  it("round-trips durable Project data while preserving meaningful order", () => {
    const linkedElement = setPathElementLinkedTargetId(
      createTranslationTarget({
        x_meters: 5,
        y_meters: 6,
        intermediate_handoff_radius_meters: 0.45,
      }),
      "target-z",
    );
    const project = createProject({
      project_id: "project-stable-id",
      display_name: "Competition Autos",
      config: {
        gui: {
          robot: { length_meters: 0.91, width_meters: 0.83 },
          protrusions: {
            enabled: true,
            distance_meters: 0.24,
            side: "front",
            default_state: "shown",
            show_on_event_keys: ["intake", "score"],
            hide_on_event_keys: ["stow"],
          },
        },
        kinematic_constraints: {
          default_max_velocity_meters_per_sec: 5.1,
          default_auto_velocity_velocity_safety_factor: 0.75,
          default_auto_velocity_acceleration_safety_factor: 0.65,
          default_auto_velocity_merge_tolerance_meters_per_sec: 0.22,
        },
      },
      paths: [
        {
          path_id: "path-z",
          display_name: "Zeta Auto",
          file_name: "zeta.json",
          path: createPathModel({ path_elements: [linkedElement] }),
        },
        {
          path_id: "path-a",
          display_name: "Alpha Auto",
          file_name: "alpha.json",
          path: createPathModel(),
        },
      ],
      path_groups: [
        {
          group_id: "group-z",
          display_name: "Zeta Group",
          path_ids: ["path-z", "path-a"],
        },
        {
          group_id: "group-a",
          display_name: "Alpha Group",
          path_ids: ["path-a"],
        },
      ],
      linked_targets: [
        {
          target_id: "target-z",
          display_name: "Zeta Target",
          kind: "translation",
          x_meters: 5,
          y_meters: 6,
        },
        {
          target_id: "target-a",
          display_name: "Alpha Target",
          kind: "waypoint",
          x_meters: 1,
          y_meters: 2,
          rotation_radians: 0.3,
          locked: true,
        },
      ],
    });

    const files = serializeProjectFiles(project);
    const restored = deserializeProjectFiles(files);

    expect(restored.project_id).toBe(project.project_id);
    expect(restored.display_name).toBe(project.display_name);
    expect(restored.paths.map((path) => path.path_id)).toEqual([
      "path-z",
      "path-a",
    ]);
    expect(restored.path_groups).toEqual(project.path_groups);
    expect(restored.linked_targets.map((target) => target.target_id)).toEqual([
      "target-z",
      "target-a",
    ]);
    expect(
      getPathElementLinkedTargetId(restored.paths[0]?.path.path_elements[0]),
    ).toBe("target-z");
    expect(restored.config).toMatchObject({
      gui: {
        robot: { length_meters: 0.91, width_meters: 0.83 },
        protrusions: {
          enabled: true,
          distance_meters: 0.24,
          side: "front",
          default_state: "shown",
        },
      },
      kinematic_constraints: {
        default_max_velocity_meters_per_sec: 5.1,
        default_auto_velocity_velocity_safety_factor: 0.75,
        default_auto_velocity_acceleration_safety_factor: 0.65,
        default_auto_velocity_merge_tolerance_meters_per_sec: 0.22,
      },
    });
    expect(serializeProjectFiles(restored)).toEqual(files);
  });

  it("writes only the project.json whitelist", () => {
    const project = createProject({
      project_id: "project-1",
      display_name: "Robot Autos",
      config: {
        gui: {
          field: { selected_field_id: "frc2025-reefscape" },
        },
      },
      paths: [
        {
          path_id: "path-1",
          display_name: "Auto",
          file_name: "auto.json",
          path: createPathModel({
            path_elements: [
              setPathElementLinkedTargetId(
                createTranslationTarget({ x_meters: 1, y_meters: 2 }),
                "target-1",
              ),
            ],
          }),
        },
      ],
      linked_targets: [
        {
          target_id: "target-1",
          display_name: "Pickup",
          kind: "translation",
          x_meters: 1,
          y_meters: 2,
        },
      ],
    });
    const projectWithSessionData = {
      ...project,
      active_path_id: "path-1",
      active_path_group_id: "group-1",
      undo_history: ["private-session-state"],
      storage_location: "/Users/example/autos",
    };

    const files = serializeProjectFiles(projectWithSessionData);
    const configText = requiredFile(files, "config.json").text;
    const projectText = requiredFile(files, "project.json").text;
    const pathText = requiredFile(files, "paths/auto.json").text;
    const metadata = JSON.parse(projectText) as Record<string, unknown>;
    const editorConfig = metadata.editor_config as {
      gui: Record<string, unknown>;
      kinematic_constraints: Record<string, unknown>;
    };

    expect(Object.keys(metadata)).toEqual([
      "schema_version",
      "project_id",
      "display_name",
      "editor_config",
      "paths",
      "path_groups",
      "linked_targets",
    ]);
    expect(Object.keys(editorConfig.gui)).toEqual(["robot", "protrusions"]);
    expect(Object.keys(editorConfig.kinematic_constraints)).toEqual([
      "default_auto_velocity_velocity_safety_factor",
      "default_auto_velocity_acceleration_safety_factor",
      "default_auto_velocity_merge_tolerance_meters_per_sec",
    ]);
    expect(projectText).not.toContain("selected_field_id");
    expect(projectText).not.toContain("custom_fields");
    expect(projectText).not.toContain("active_path");
    expect(projectText).not.toContain("undo_history");
    expect(projectText).not.toContain("storage_location");
    expect(configText).not.toContain("gui");
    expect(configText).not.toContain("auto_velocity");
    expect(pathText).not.toContain("linked_target");
    expect(projectText).not.toContain("path_elements");
    expect(projectText).toContain('"linked_targets"');
  });

  it("reconstructs runtime-only files with supplied or generated stable IDs without writing", () => {
    const source = createProject({
      project_id: "discarded-source-id",
      display_name: "Source",
      paths: [
        {
          path_id: "discarded-z",
          display_name: "Z",
          file_name: "zeta.json",
          path: createPathModel(),
        },
        {
          path_id: "discarded-a",
          display_name: "A",
          file_name: "alpha.json",
          path: createPathModel(),
        },
      ],
    });
    const runtimeFiles = serializeProjectFiles(source).filter(
      (file) => file.relativePath !== "project.json",
    );
    const before = structuredClone(runtimeFiles);

    const supplied = deserializeProjectFiles(runtimeFiles, {
      fallbackProjectId: "generated-project-id",
      fallbackDisplayName: "Recovered Autos",
      fallbackPathId: (fileName) => `generated-${fileName}`,
    });

    expect(supplied).toMatchObject({
      project_id: "generated-project-id",
      display_name: "Recovered Autos",
      path_groups: [],
      linked_targets: [],
    });
    expect(
      supplied.paths.map((path) => [path.path_id, path.file_name]),
    ).toEqual([
      ["generated-alpha.json", "alpha.json"],
      ["generated-zeta.json", "zeta.json"],
    ]);
    expect(runtimeFiles).toEqual(before);
    expect(
      runtimeFiles.some((file) => file.relativePath === "project.json"),
    ).toBe(false);

    const generated = deserializeProjectFiles(runtimeFiles);
    expect(generated.project_id).toMatch(/^workspace-/);
    expect(generated.paths.every((path) => /^path-/.test(path.path_id))).toBe(
      true,
    );
  });

  it("produces deterministic ordered text with BLine runtime precision", () => {
    const project = createProject({
      project_id: "project-deterministic",
      display_name: "Deterministic",
      config: {
        kinematic_constraints: {
          default_max_velocity_meters_per_sec: 1.234565,
        },
      },
      paths: [
        {
          path_id: "path-b",
          display_name: "B",
          file_name: "b.json",
          path: createPathModel({
            path_elements: [
              createTranslationTarget({
                x_meters: 1.234565,
                y_meters: -1.234565,
              }),
            ],
          }),
        },
        {
          path_id: "path-a",
          display_name: "A",
          file_name: "a.json",
          path: createPathModel(),
        },
      ],
    });

    const first = serializeProjectFiles(project);
    const second = serializeProjectFiles(structuredClone(project));

    expect(second).toEqual(first);
    expect(first.map((file) => file.relativePath)).toEqual([
      "config.json",
      "project.json",
      "paths/b.json",
      "paths/a.json",
    ]);
    expect(requiredFile(first, "config.json").text).toContain("1.23457");
    expect(requiredFile(first, "paths/b.json").text).toContain(
      '"x_meters": 1.23457',
    );
    expect(requiredFile(first, "paths/b.json").text).toContain(
      '"y_meters": -1.23457',
    );
    expect(requiredFile(first, "project.json").text).toMatch(
      /^\{\n  "schema_version": 1,\n  "project_id": "project-deterministic",/,
    );
  });

  it("opens runtime content without rewriting malformed Project metadata", () => {
    const files = serializeProjectFiles(
      createProject({
        project_id: "project-damaged",
        display_name: "Damaged",
        paths: [
          {
            path_id: "path-1",
            display_name: "Auto",
            file_name: "auto.json",
            path: createPathModel(),
          },
        ],
      }),
    ).map((file) =>
      file.relativePath === "project.json"
        ? { ...file, text: "{<<<<<<< HEAD\n" }
        : file,
    );

    const opened = openProjectFiles(files, {
      fallbackProjectId: "recovered-project",
      fallbackDisplayName: "Recovered",
      fallbackPathId: () => "recovered-path",
    });

    expect(opened.project).toMatchObject({
      project_id: "recovered-project",
      display_name: "Recovered",
      paths: [{ path_id: "recovered-path", file_name: "auto.json" }],
    });
    expect(opened.damage).toEqual({
      sourcePath: "project.json",
      message: expect.any(String),
      rawText: "{<<<<<<< HEAD\n",
    });
    expect(
      files.find((file) => file.relativePath === "project.json")?.text,
    ).toBe("{<<<<<<< HEAD\n");
  });

  it("treats an unlisted runtime path as damaged metadata", () => {
    const files = canonicalFiles();
    const rawProject = requiredFile(files, "project.json").text;
    const extraPath = {
      relativePath: "paths/extra.json",
      text: requiredFile(files, "paths/auto.json").text,
    };

    const opened = openProjectFiles([...files, extraPath], {
      fallbackProjectId: "recovered-project",
      fallbackDisplayName: "Recovered",
      fallbackPathId: (fileName) => `recovered-${fileName}`,
    });

    expect(opened.damage).toMatchObject({
      sourcePath: "project.json",
      message: expect.stringContaining("not listed"),
      rawText: rawProject,
    });
    expect(opened.project.paths.map((path) => path.file_name)).toEqual([
      "auto.json",
      "extra.json",
    ]);
  });

  it("rejects missing and case-colliding runtime path files", () => {
    const files = canonicalFiles();
    const withoutPath = files.filter(
      (file) => file.relativePath !== "paths/auto.json",
    );
    expect(openProjectFiles(withoutPath).damage?.message).toContain(
      "missing paths/auto.json",
    );

    const duplicate = {
      relativePath: "paths/AUTO.json",
      text: requiredFile(files, "paths/auto.json").text,
    };
    expect(openProjectFiles([...files, duplicate]).damage?.message).toContain(
      "case-colliding runtime path file",
    );
  });

  it("strictly validates the canonical project.json whitelist", () => {
    const cases: Array<(metadata: Record<string, unknown>) => void> = [
      (metadata) => {
        metadata.active_path_id = "path-1";
      },
      (metadata) => {
        const editorConfig = metadata.editor_config as Record<string, unknown>;
        editorConfig.selected_field_id = "frc2025-reefscape";
      },
      (metadata) => {
        const paths = metadata.paths as Array<Record<string, unknown>>;
        paths[0]!.file_name = "../auto.json";
      },
      (metadata) => {
        const targets = metadata.linked_targets as Array<
          Record<string, unknown>
        >;
        targets[0]!.x_meters = "1";
      },
    ];

    for (const mutate of cases) {
      const files = canonicalFiles({ withLinkedTarget: true });
      const metadata = JSON.parse(
        requiredFile(files, "project.json").text,
      ) as Record<string, unknown>;
      mutate(metadata);
      const rawText = `${JSON.stringify(metadata, null, 2)}\n`;
      const damagedFiles = replaceProjectMetadata(files, rawText);

      expect(openProjectFiles(damagedFiles).damage).toMatchObject({
        sourcePath: "project.json",
        rawText,
      });
    }
  });

  it("rejects duplicate identities and dangling references", () => {
    const cases: Array<(metadata: Record<string, unknown>) => void> = [
      (metadata) => {
        const paths = metadata.paths as Array<Record<string, unknown>>;
        paths.push({
          path_id: "PATH-1",
          display_name: "Duplicate",
          file_name: "duplicate.json",
        });
      },
      (metadata) => {
        const groups = metadata.path_groups as Array<Record<string, unknown>>;
        groups.push({
          group_id: "group-1",
          display_name: "Bad Group",
          path_ids: ["missing-path"],
        });
      },
      (metadata) => {
        const paths = metadata.paths as Array<Record<string, unknown>>;
        paths[0]!.linked_targets = [
          { element_index: 0, target_id: "missing-target" },
        ];
      },
    ];

    for (const mutate of cases) {
      const files = canonicalFiles();
      const metadata = JSON.parse(
        requiredFile(files, "project.json").text,
      ) as Record<string, unknown>;
      mutate(metadata);
      const opened = openProjectFiles(
        replaceProjectMetadata(files, `${JSON.stringify(metadata, null, 2)}\n`),
      );
      expect(opened.damage?.sourcePath).toBe("project.json");
    }
  });

  it("round-trips every accepted editor metadata entry", () => {
    const files = editorMetadataFiles();
    const metadata = JSON.parse(requiredFile(files, "project.json").text) as {
      paths: Array<{
        editor_metadata: {
          ranged_constraints: Array<{ key: string }>;
        };
      }>;
    };
    const restored = deserializeProjectFiles(files);

    expect(
      metadata.paths[0]!.editor_metadata.ranged_constraints.map(
        (constraint) => constraint.key,
      ),
    ).toEqual([
      "max_velocity_meters_per_sec",
      "max_velocity_meters_per_sec",
      "max_velocity_deg_per_sec",
    ]);
    expect(serializeProjectFiles(restored)).toEqual(files);
  });

  it("rejects editor metadata that cannot be applied losslessly", () => {
    const cases: Array<{
      label: string;
      mutate: (editorMetadata: Record<string, unknown>) => void;
    }> = [
      {
        label: "out-of-range handoff element",
        mutate: (editorMetadata) => {
          editorMetadata.handoff_radius_sources = [
            { element_index: 99, source: "auto" },
          ];
        },
      },
      {
        label: "incompatible handoff element",
        mutate: (editorMetadata) => {
          editorMetadata.handoff_radius_sources = [
            { element_index: 2, source: "auto" },
          ];
        },
      },
      {
        label: "unmatched ranged constraint",
        mutate: (editorMetadata) => {
          const ranged = editorMetadata.ranged_constraints as Array<
            Record<string, unknown>
          >;
          ranged[0]!.start_ordinal = 99;
          ranged[0]!.end_ordinal = 99;
        },
      },
      {
        label: "duplicate ranged constraint target",
        mutate: (editorMetadata) => {
          const ranged = editorMetadata.ranged_constraints as Array<
            Record<string, unknown>
          >;
          ranged[1] = structuredClone(ranged[0]!);
        },
      },
      {
        label: "unsupported terminal-tolerance metadata",
        mutate: (editorMetadata) => {
          const ranged = editorMetadata.ranged_constraints as Array<
            Record<string, unknown>
          >;
          ranged[0]!.key = "end_translation_tolerance_meters";
        },
      },
      {
        label: "manual ownership that canonical serialization omits",
        mutate: (editorMetadata) => {
          const ranged = editorMetadata.ranged_constraints as Array<
            Record<string, unknown>
          >;
          ranged[0]!.source = "manual";
          delete ranged[0]!.auto_velocity;
        },
      },
      {
        label: "metadata order that canonical serialization cannot retain",
        mutate: (editorMetadata) => {
          const ranged = editorMetadata.ranged_constraints as unknown[];
          editorMetadata.ranged_constraints = [...ranged].reverse();
        },
      },
    ];

    for (const { label, mutate } of cases) {
      const files = editorMetadataFiles();
      const metadata = JSON.parse(requiredFile(files, "project.json").text) as {
        paths: Array<{ editor_metadata: Record<string, unknown> }>;
      };
      mutate(metadata.paths[0]!.editor_metadata);
      const opened = openProjectFiles(
        replaceProjectMetadata(files, `${JSON.stringify(metadata, null, 2)}\n`),
      );

      expect(opened.damage?.sourcePath, label).toBe("project.json");
    }
  });
});

function editorMetadataFiles(): ProjectTextFile[] {
  const rangedConstraints: RangedConstraint[] = [
    {
      key: "max_velocity_deg_per_sec",
      value: 3.5,
      start_ordinal: 1,
      end_ordinal: 1,
      source: "auto_velocity",
      auto_velocity: {
        velocity_safety_factor: 0.85,
        acceleration_safety_factor: 0.75,
        merge_tolerance_meters_per_sec: 0.15,
      },
    },
    {
      key: "max_velocity_meters_per_sec",
      value: 1.5,
      start_ordinal: 1,
      end_ordinal: 1,
      source: "auto_velocity",
      auto_velocity: {
        velocity_safety_factor: 0.8,
        acceleration_safety_factor: 0.7,
        merge_tolerance_meters_per_sec: 0.2,
      },
    },
    {
      key: "max_velocity_meters_per_sec",
      value: 2.5,
      start_ordinal: 2,
      end_ordinal: 2,
      source: "auto_velocity",
      auto_velocity: {
        velocity_safety_factor: 0.9,
        acceleration_safety_factor: 0.6,
        merge_tolerance_meters_per_sec: 0.1,
      },
    },
  ];
  return serializeProjectFiles(
    createProject({
      project_id: "project-editor-metadata",
      display_name: "Editor Metadata",
      paths: [
        {
          path_id: "path-editor-metadata",
          display_name: "Auto",
          file_name: "auto.json",
          path: createPathModel({
            path_elements: [
              createTranslationTarget({
                intermediate_handoff_radius_meters: 0.45,
                handoff_radius_source: "manual",
              }),
              createTranslationTarget({
                intermediate_handoff_radius_meters: 0.45,
                handoff_radius_source: "auto",
              }),
              createRotationTarget(),
            ],
            ranged_constraints: rangedConstraints,
          }),
        },
      ],
    }),
  );
}

function canonicalFiles(
  options: { withLinkedTarget?: boolean } = {},
): ProjectTextFile[] {
  const element = createTranslationTarget({ x_meters: 1, y_meters: 2 });
  return serializeProjectFiles(
    createProject({
      project_id: "project-1",
      display_name: "Project",
      paths: [
        {
          path_id: "path-1",
          display_name: "Auto",
          file_name: "auto.json",
          path: createPathModel({
            path_elements: [
              options.withLinkedTarget
                ? setPathElementLinkedTargetId(element, "target-1")
                : element,
            ],
          }),
        },
      ],
      linked_targets: options.withLinkedTarget
        ? [
            {
              target_id: "target-1",
              display_name: "Target",
              kind: "translation",
              x_meters: 1,
              y_meters: 2,
            },
          ]
        : [],
    }),
  );
}

function replaceProjectMetadata(
  files: readonly ProjectTextFile[],
  text: string,
): ProjectTextFile[] {
  return files.map((file) =>
    file.relativePath === "project.json" ? { ...file, text } : file,
  );
}

function requiredFile(
  files: readonly ProjectTextFile[],
  relativePath: string,
): ProjectTextFile {
  const file = files.find(
    (candidate) => candidate.relativePath === relativePath,
  );
  if (!file) {
    throw new Error(`Missing test file ${relativePath}`);
  }
  return file;
}

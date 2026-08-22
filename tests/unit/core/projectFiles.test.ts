import { describe, expect, it } from "vitest";
import {
  deserializeProjectFiles,
  serializeProjectFiles,
  type ProjectTextFile,
} from "../../../src/core/io/projectFiles";
import { createProject } from "../../../src/core/model/project";
import {
  createPathModel,
  createTranslationTarget,
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
});

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

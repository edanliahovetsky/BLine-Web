import { describe, expect, it } from "vitest";
import { openProjectFromLegacyWorkspace } from "../../../src/core/io/legacyWorkspace";
import {
  createProjectPathDocument,
  createProjectWorkspaceDocument,
} from "../../../src/core/io/projectSchema";
import { createPathModel } from "../../../src/core/model/path";
import { createProject } from "../../../src/core/model/project";
import {
  addPathToProject,
  duplicatePathInProject,
  renamePathInProject,
} from "../../../src/core/model/projectOperations";

describe("Project and editor navigation", () => {
  it("keeps capitalization, underscores, Unicode and safe punctuation in names and files", () => {
    const result = addPathToProject(
      createProject({ project_id: "names", display_name: "Names" }),
      { display_name: "TEST_AUTO – Score (2)!" },
    );
    expect(result.project.paths[0]).toMatchObject({
      display_name: "TEST_AUTO – Score (2)!",
      file_name: "TEST_AUTO – Score (2)!.json",
    });
    const copy = duplicatePathInProject(
      result.project,
      result.createdPathId,
      "TEST_AUTO – Score (2)!",
    );
    expect(copy.project.paths[1]).toMatchObject({
      display_name: "TEST_AUTO – Score (2)!-2",
      file_name: "TEST_AUTO – Score (2)!-2.json",
    });
    for (const display_name of ["../escape", "a\\b", "a:b", "NUL", "path."]) {
      expect(() => addPathToProject(result.project, { display_name })).toThrow(
        "Use a filename",
      );
    }
  });
  it("uses one filename policy for create, rename, and duplicate", () => {
    const initial = createProject({
      project_id: "project-filename-policy",
      display_name: "Filename Policy",
      paths: [],
    });
    const first = addPathToProject(initial, { display_name: "Third Path" });
    expect(first.project.paths[0]?.file_name).toBe("Third Path.json");

    const renamed = renamePathInProject(
      first.project,
      first.createdPathId,
      "Center Score!",
    );
    expect(renamed.paths[0]?.file_name).toBe("Center Score!.json");

    const duplicated = duplicatePathInProject(
      renamed,
      first.createdPathId,
      "Center Score!",
    );
    expect(duplicated.project.paths.map((path) => path.file_name)).toEqual([
      "Center Score!.json",
      "Center Score!-2.json",
    ]);
  });

  it("preserves safely normalized explicit import filenames", () => {
    const added = addPathToProject(
      createProject({
        project_id: "project-import-filename",
        display_name: "Import Filename",
        paths: [],
      }),
      {
        display_name: "Imported Path",
        file_name: "Legacy_Auto.JSON",
      },
    );

    expect(added.project.paths[0]?.file_name).toBe("Legacy_Auto.json");
  });

  it("keeps navigation outside team-owned Project data", () => {
    const firstPath = createProjectPathDocument({
      path_id: "path-a",
      display_name: "A",
      file_name: "a.json",
      path: createPathModel(),
    });
    const secondPath = createProjectPathDocument({
      path_id: "path-b",
      display_name: "B",
      file_name: "b.json",
      path: createPathModel(),
    });
    const legacy = createProjectWorkspaceDocument({
      project_id: "project-1",
      display_name: "Robot Autos",
      paths: [firstPath, secondPath],
      active_path_id: secondPath.path_id,
    });

    const opened = openProjectFromLegacyWorkspace(legacy);

    expect(opened.project).not.toHaveProperty("active_path_id");
    expect(opened.project).not.toHaveProperty("active_path_group_id");
    expect(opened.navigation.activePathId).toBe(secondPath.path_id);

    expect(opened.project.paths).toEqual([firstPath, secondPath]);
  });
});

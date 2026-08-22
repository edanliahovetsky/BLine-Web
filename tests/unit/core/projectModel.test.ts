import { describe, expect, it } from "vitest";
import {
  legacyWorkspaceFromOpenProject,
  openProjectFromLegacyWorkspace,
} from "../../../src/core/io/legacyWorkspace";
import {
  createProjectPathDocument,
  createProjectWorkspaceDocument,
} from "../../../src/core/io/projectSchema";
import { createPathModel } from "../../../src/core/model/path";

describe("Project and editor navigation", () => {
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

    opened.navigation.activePathId = firstPath.path_id;
    expect(opened.project.paths).toEqual([firstPath, secondPath]);
    expect(legacyWorkspaceFromOpenProject(opened.project, opened.navigation))
      .toMatchObject({ active_path_id: firstPath.path_id });
  });
});

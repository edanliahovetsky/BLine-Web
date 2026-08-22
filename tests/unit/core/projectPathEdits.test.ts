import { describe, expect, it } from "vitest";
import { getPathElementLinkedTargetId } from "../../../src/core/linkedTargets";
import { createProject, type Project } from "../../../src/core/model/project";
import {
  applyPathStructureEdit,
  canMovePathElement,
} from "../../../src/core/model/projectPathEdits";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
} from "../../../src/core/model/path";

describe("project Path structural edits", () => {
  it("atomically remaps ordinals, invalidates generated output, and repairs selection", () => {
    const project = exampleProject();
    project.paths[0].path.ranged_constraints = [
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 3,
      },
      {
        key: "max_velocity_meters_per_sec",
        value: 3,
        start_ordinal: 1,
        end_ordinal: 3,
        source: "auto_velocity",
      },
    ];

    const result = applyPathStructureEdit(
      project,
      "path-a",
      { kind: "remove", index: 3 },
      { selectedElementIndex: 3 },
    );

    expect(result.status).toBe("applied");
    expect(result.project).not.toBe(project);
    expect(project.paths[0].path.path_elements).toHaveLength(4);
    expect(result.project.paths[0].path.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 2,
      },
    ]);
    expect(result.project.paths[0].path.path_elements[0]).toMatchObject({
      intermediate_handoff_radius_meters: null,
    });
    expect(result.consequences).toEqual({
      focusPathId: "path-a",
      selectedElementIndex: 2,
    });
  });

  it("duplicates independently and synchronizes valid linked targets", () => {
    const project = exampleProject();
    project.linked_targets = [
      {
        target_id: "target-a",
        display_name: "Shared Start",
        kind: "translation",
        x_meters: 5,
        y_meters: 6,
      },
    ];
    project.paths[0].path.path_elements[0] = createTranslationTarget({
      x_meters: 1,
      y_meters: 2,
      intermediate_handoff_radius_meters: null,
      linked_target_id: "target-a",
    });

    const result = applyPathStructureEdit(project, "path-a", {
      kind: "duplicate",
      index: 0,
    });

    expect(result.status).toBe("applied");
    const [original, duplicate] = result.project.paths[0].path.path_elements;
    expect(getPathElementLinkedTargetId(original)).toBe("target-a");
    expect(getPathElementLinkedTargetId(duplicate)).toBeNull();
    expect(original).toMatchObject({ x_meters: 5, y_meters: 6 });
    expect(duplicate).toMatchObject({ x_meters: 1, y_meters: 2 });
  });

  it("keeps an inserted element's generated default while clearing stale output", () => {
    const project = exampleProject();
    const result = applyPathStructureEdit(project, "path-a", {
      kind: "insert",
      index: 1,
      element: createTranslationTarget({
        x_meters: 2,
        y_meters: 2,
        intermediate_handoff_radius_meters: 0.45,
        handoff_radius_source: "auto",
      }),
    });

    expect(result.status).toBe("applied");
    expect(result.project.paths[0].path.path_elements[0]).toMatchObject({
      intermediate_handoff_radius_meters: null,
    });
    expect(result.project.paths[0].path.path_elements[1]).toMatchObject({
      intermediate_handoff_radius_meters: 0.45,
      handoff_radius_source: "auto",
    });
  });

  it("returns rejected or no-op results without changing the Project", () => {
    const project = exampleProject();
    const rejected = applyPathStructureEdit(project, "path-a", {
      kind: "reorder",
      fromIndex: 1,
      toIndex: 0,
    });
    const noop = applyPathStructureEdit(project, "path-a", {
      kind: "reorder",
      fromIndex: 0,
      toIndex: 0,
    });

    expect(canMovePathElement(project.paths[0].path, 1, 0)).toBe(false);
    expect(rejected).toMatchObject({ status: "rejected", project });
    expect(noop).toMatchObject({ status: "noop", project });
  });
});

function exampleProject(): Project {
  return createProject({
    project_id: "project-a",
    display_name: "Alpha",
    paths: [
      {
        path_id: "path-a",
        display_name: "Path A",
        file_name: "path-a.json",
        path: createPathModel({
          path_elements: [
            createTranslationTarget({
              x_meters: 0,
              y_meters: 0,
              intermediate_handoff_radius_meters: 0.3,
              handoff_radius_source: "auto",
            }),
            createRotationTarget({ rotation_radians: 0, t_ratio: 0.5 }),
            createTranslationTarget({ x_meters: 3, y_meters: 3 }),
            createTranslationTarget({ x_meters: 4, y_meters: 4 }),
          ],
        }),
      },
    ],
  });
}

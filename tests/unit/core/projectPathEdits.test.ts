import { describe, expect, it } from "vitest";
import { getPathElementLinkedTargetId } from "../../../src/core/linkedTargets";
import { createProject, type Project } from "../../../src/core/model/project";
import {
  applyPathElementEdit,
  applyPathStructureEdit,
  canMovePathElement,
} from "../../../src/core/model/projectPathEdits";
import {
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
} from "../../../src/core/model/path";

describe("project Path element edits", () => {
  it("promotes shared geometry while preserving element-local rotation", () => {
    const project = linkedProject("translation");
    const moved = applyPathElementEdit(project, "path-a", {
      kind: "position",
      index: 0,
      position: { x_meters: 8, y_meters: 7 },
    });

    expect(moved.status).toBe("applied");
    expect(moved.project.linked_targets[0]).toMatchObject({
      x_meters: 8,
      y_meters: 7,
    });
    expect(moved.project.paths[1].path.path_elements[0]).toMatchObject({
      x_meters: 8,
      y_meters: 7,
    });

    const rotated = applyPathElementEdit(moved.project, "path-a", {
      kind: "rotation",
      index: 0,
      rotationRadians: Math.PI / 2,
    });
    expect(rotated.project.linked_targets[0].rotation_radians).toBeUndefined();
    expect(rotated.project.paths[0].path.path_elements[0]).toMatchObject({
      rotation_target: { rotation_radians: Math.PI / 2 },
    });
  });

  it("promotes waypoint-linked rotation to every use", () => {
    const project = linkedProject("waypoint");
    const result = applyPathElementEdit(project, "path-a", {
      kind: "rotation",
      index: 0,
      rotationRadians: Math.PI / 3,
    });

    expect(result.status).toBe("applied");
    expect(result.project.linked_targets[0].rotation_radians).toBeCloseTo(
      Math.PI / 3,
    );
    expect(result.project.paths[0].path.path_elements[0]).toMatchObject({
      rotation_target: { rotation_radians: Math.PI / 3 },
    });
  });

  it("keeps locked geometry canonical while allowing local properties", () => {
    const project = linkedProject("waypoint", true);
    const previous = project.paths[0].path.path_elements[0];
    if (previous.type !== "waypoint") throw new Error("Expected waypoint");
    const replacement = structuredClone(previous);
    replacement.translation_target.x_meters = 99;
    replacement.rotation_target.rotation_radians = Math.PI;
    replacement.rotation_target.profiled_rotation = false;

    const result = applyPathElementEdit(project, "path-a", {
      kind: "replace",
      index: 0,
      element: replacement,
    });

    expect(result.status).toBe("applied");
    expect(result.project.paths[0].path.path_elements[0]).toMatchObject({
      translation_target: { x_meters: 2, y_meters: 3 },
      rotation_target: { rotation_radians: 0.25, profiled_rotation: false },
    });
    expect(
      applyPathElementEdit(project, "path-a", {
        kind: "position",
        index: 0,
        position: { x_meters: 99, y_meters: 99 },
      }).status,
    ).toBe("noop");
  });

  it("rejects type and link identity changes and reports equal edits as noops", () => {
    const project = linkedProject("translation");
    const previous = project.paths[0].path.path_elements[0];
    expect(
      applyPathElementEdit(project, "path-a", {
        kind: "replace",
        index: 0,
        element: createTranslationTarget(),
      }).status,
    ).toBe("rejected");
    if (previous.type !== "waypoint") throw new Error("Expected waypoint");
    const unlinked = structuredClone(previous);
    delete unlinked.linked_target_id;
    expect(
      applyPathElementEdit(project, "path-a", {
        kind: "replace",
        index: 0,
        element: unlinked,
      }).status,
    ).toBe("rejected");
    expect(
      applyPathElementEdit(project, "path-a", {
        kind: "replace",
        index: 0,
        element: previous,
      }).status,
    ).toBe("noop");
  });

  it("normalizes rotations, clamps ratios, and rejects unsupported intents", () => {
    const project = exampleProject();
    const rotated = applyPathElementEdit(project, "path-a", {
      kind: "rotation",
      index: 1,
      rotationRadians: Math.PI * 3,
    });
    expect(rotated.project.paths[0].path.path_elements[1]).toMatchObject({
      rotation_radians: Math.PI,
    });

    const ratio = applyPathElementEdit(rotated.project, "path-a", {
      kind: "ratio",
      index: 1,
      ratio: 4,
    });
    expect(ratio.project.paths[0].path.path_elements[1]).toMatchObject({
      t_ratio: 1,
    });
    expect(
      applyPathElementEdit(project, "path-a", {
        kind: "position",
        index: 1,
        position: { x_meters: 1, y_meters: 1 },
      }).status,
    ).toBe("rejected");
  });

  it("repairs a broken link while applying an edit", () => {
    const project = exampleProject();
    project.paths[0].path.path_elements[0] = createTranslationTarget({
      x_meters: 1,
      y_meters: 1,
      linked_target_id: "missing",
    });

    const result = applyPathElementEdit(project, "path-a", {
      kind: "position",
      index: 0,
      position: { x_meters: 2, y_meters: 3 },
    });

    expect(result.status).toBe("applied");
    expect(result.project.paths[0].path.path_elements[0]).toMatchObject({
      x_meters: 2,
      y_meters: 3,
    });
    expect(
      getPathElementLinkedTargetId(
        result.project.paths[0].path.path_elements[0],
      ),
    ).toBeNull();
  });
});

describe("project Path structural edits", () => {
  it("atomically remaps ordinals, preserves ownership, and repairs selection", () => {
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
      {
        key: "max_velocity_meters_per_sec",
        value: 3,
        start_ordinal: 1,
        end_ordinal: 2,
        source: "auto_velocity",
      },
    ]);
    expect(result.project.paths[0].path.path_elements[0]).toMatchObject({
      intermediate_handoff_radius_meters: 0.3,
      handoff_radius_source: "auto",
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

  it("preserves existing and inserted generated ownership for refresh", () => {
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
      intermediate_handoff_radius_meters: 0.3,
      handoff_radius_source: "auto",
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

function linkedProject(
  kind: "translation" | "waypoint",
  locked = false,
): Project {
  return createProject({
    project_id: "linked-project",
    display_name: "Linked",
    linked_targets: [
      {
        target_id: "shared",
        display_name: "Shared",
        kind,
        x_meters: 2,
        y_meters: 3,
        ...(kind === "waypoint" ? { rotation_radians: 0.25 } : {}),
        ...(locked ? { locked: true } : {}),
      },
    ],
    paths: [
      {
        path_id: "path-a",
        display_name: "Path A",
        file_name: "path-a.json",
        path: createPathModel({
          path_elements: [
            createWaypoint({
              linked_target_id: "shared",
              translation_target: createTranslationTarget({
                x_meters: 2,
                y_meters: 3,
              }),
              rotation_target: createRotationTarget({
                rotation_radians: kind === "waypoint" ? 0.25 : 0,
              }),
            }),
          ],
        }),
      },
      {
        path_id: "path-b",
        display_name: "Path B",
        file_name: "path-b.json",
        path: createPathModel({
          path_elements: [
            kind === "waypoint"
              ? createWaypoint({
                  linked_target_id: "shared",
                  translation_target: createTranslationTarget({
                    x_meters: 2,
                    y_meters: 3,
                  }),
                  rotation_target: createRotationTarget({
                    rotation_radians: 0.25,
                  }),
                })
              : createTranslationTarget({
                  linked_target_id: "shared",
                  x_meters: 2,
                  y_meters: 3,
                }),
          ],
        }),
      },
    ],
  });
}

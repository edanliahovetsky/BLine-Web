import { describe, expect, it } from "vitest";
import { createProjectDocument, type ProjectDocument } from "../../../src/core/io/projectSchema";
import {
  createRotationTarget,
  createPathModel,
  createTranslationTarget,
  createWaypoint,
  isRotationTarget,
  isEventTrigger,
  isTranslationTarget,
  isWaypoint
} from "../../../src/core/model/path";
import {
  canMovePathElement,
  createChangePathElementTypeCommand,
  createConvertedElement,
  createDefaultElement,
  createAddRangedConstraintCommand,
  createInsertPathElementCommand,
  createMovePathElementCommand,
  createRemovePathElementCommand,
  createRemoveRangedConstraintCommand,
  createSetScalarConstraintCommand,
  createSplitRangedConstraintCommand,
  createUpdatePathElementCommand,
  createUpdateRangedConstraintCommand,
  getAddableElementTypes,
  getInsertionIndex,
  getSwitchableElementTypes,
  updateWaypoint
} from "../../../src/ui/sidebar/sidebarCommands";

describe("sidebar commands", () => {
  it("inserts and removes elements through reversible project commands", () => {
    const project = exampleProject();
    const element = createDefaultElement(project, "event_trigger", 0);
    const insert = createInsertPathElementCommand(1, element);

    const inserted = insert.apply(project);

    expect(inserted.path.path_elements).toHaveLength(3);
    expect(isEventTrigger(inserted.path.path_elements[1])).toBe(true);
    expect(project.path.path_elements).toHaveLength(2);

    const reverted = insert.revert(inserted);
    expect(reverted.path.path_elements).toHaveLength(2);

    const remove = createRemovePathElementCommand(0, reverted.path.path_elements[0]);
    const removed = remove.apply(reverted);
    expect(removed.path.path_elements).toHaveLength(1);

    const restored = remove.revert(removed);
    expect(restored.path.path_elements).toHaveLength(2);
    expect(isTranslationTarget(restored.path.path_elements[0])).toBe(true);
  });

  it("updates selected elements while preserving undo payloads", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createWaypoint({
            translation_target: createTranslationTarget({ x_meters: 2, y_meters: 3 })
          })
        ]
      })
    });
    const previous = project.path.path_elements[0];
    if (!isWaypoint(previous)) {
      throw new Error("Expected waypoint");
    }
    const next = updateWaypoint(previous, {
      translation: { x_meters: 4 },
      rotation: { rotation_radians: Math.PI / 3 }
    });

    const command = createUpdatePathElementCommand(0, previous, next);
    const updated = command.apply(project);
    const restored = command.revert(updated);

    const updatedElement = updated.path.path_elements[0];
    const restoredElement = restored.path.path_elements[0];
    expect(isWaypoint(updatedElement)).toBe(true);
    expect(isWaypoint(restoredElement)).toBe(true);
    if (isWaypoint(updatedElement) && isWaypoint(restoredElement)) {
      expect(updatedElement.translation_target.x_meters).toBe(4);
      expect(updatedElement.rotation_target.rotation_radians).toBeCloseTo(Math.PI / 3);
      expect(restoredElement.translation_target.x_meters).toBe(2);
    }
  });

  it("keeps rotation-domain insertions between translation anchors", () => {
    const project = exampleProject();

    expect(getAddableElementTypes(project)).toEqual([
      "waypoint",
      "translation",
      "rotation",
      "event_trigger"
    ]);
    expect(getInsertionIndex(project, "rotation", null)).toBe(1);
    expect(getInsertionIndex(project, "event_trigger", 1)).toBe(1);
    expect(getInsertionIndex(project, "waypoint", 1)).toBe(2);
  });

  it("hides rotation-domain additions until two anchors exist", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [createTranslationTarget({ x_meters: 1, y_meters: 1 })]
      })
    });

    expect(getAddableElementTypes(project)).toEqual(["waypoint", "translation"]);
    expect(createDefaultElement(project, "event_trigger", 0).type).toBe("translation");
  });

  it("limits endpoint type switches to anchor elements", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createWaypoint({
            translation_target: createTranslationTarget({ x_meters: 2, y_meters: 2 })
          }),
          createTranslationTarget({ x_meters: 4, y_meters: 4 })
        ]
      })
    });

    expect(getSwitchableElementTypes(project, 0)).toEqual(["translation", "waypoint"]);
    expect(getSwitchableElementTypes(project, 1)).toEqual([
      "translation",
      "waypoint",
      "rotation",
      "event_trigger"
    ]);
    expect(createConvertedElement(project, 0, "rotation")).toBeNull();
  });

  it("remaps ranged constraints when path structure changes", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createTranslationTarget({ x_meters: 4, y_meters: 4 })
        ],
        ranged_constraints: [
          {
            key: "max_velocity_meters_per_sec",
            value: 2,
            start_ordinal: 1,
            end_ordinal: 2
          }
        ]
      })
    });
    const insertedElement = createTranslationTarget({ x_meters: 0, y_meters: 0 });

    const inserted = createInsertPathElementCommand(0, insertedElement).apply(project);

    expect(inserted.path.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 2,
        end_ordinal: 3
      }
    ]);

    const removed = createRemovePathElementCommand(
      0,
      inserted.path.path_elements[0]
    ).apply(inserted);

    expect(removed.path.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 2
      }
    ]);
  });

  it("reorders path elements while preserving ranged constraint identity", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createTranslationTarget({ x_meters: 2, y_meters: 2 }),
          createTranslationTarget({ x_meters: 3, y_meters: 3 })
        ],
        ranged_constraints: [
          {
            key: "max_velocity_meters_per_sec",
            value: 2,
            start_ordinal: 1,
            end_ordinal: 2
          }
        ]
      })
    });

    expect(canMovePathElement(project, 2, 1)).toBe(true);
    const command = createMovePathElementCommand(2, 1);
    const moved = command.apply(project);

    expect(moved.path.path_elements.map((element) => element.type)).toEqual([
      "translation",
      "translation",
      "translation"
    ]);
    expect(moved.path.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 3
      }
    ]);

    const reverted = command.revert(moved);
    expect(reverted.path.ranged_constraints).toEqual(project.path.ranged_constraints);
  });

  it("converts element types with explicit ordinal remapping", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createRotationTarget({ rotation_radians: Math.PI / 4, t_ratio: 0.5 }),
          createTranslationTarget({ x_meters: 4, y_meters: 4 })
        ],
        ranged_constraints: [
          {
            key: "max_velocity_deg_per_sec",
            value: 600,
            start_ordinal: 1,
            end_ordinal: 1
          }
        ]
      })
    });
    const previous = project.path.path_elements[1];
    const converted = createConvertedElement(project, 1, "event_trigger");

    expect(converted).not.toBeNull();
    if (!converted) {
      return;
    }
    expect(isEventTrigger(converted)).toBe(true);

    const command = createChangePathElementTypeCommand(1, previous, converted);
    const updated = command.apply(project);
    const restored = command.revert(updated);

    expect(isEventTrigger(updated.path.path_elements[1])).toBe(true);
    expect(updated.path.ranged_constraints).toEqual([]);
    expect(isRotationTarget(restored.path.path_elements[1])).toBe(true);
    expect(restored.path.ranged_constraints).toEqual(project.path.ranged_constraints);
  });

  it("edits scalar and ranged constraints through reversible commands", () => {
    const project = exampleProject();
    const scalar = createSetScalarConstraintCommand(
      "end_translation_tolerance_meters",
      null,
      0.03
    );
    const withScalar = scalar.apply(project);
    expect(withScalar.path.constraints.end_translation_tolerance_meters).toBe(0.03);
    expect(scalar.revert(withScalar).path.constraints.end_translation_tolerance_meters).toBeNull();

    const add = createAddRangedConstraintCommand(
      "max_velocity_meters_per_sec",
      2,
      2
    );
    const withRange = add.apply(project);
    expect(withRange.path.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 1
      }
    ]);
    expect(add.revert(withRange).path.ranged_constraints).toEqual([]);

    const previous = {
      key: "max_velocity_meters_per_sec" as const,
      value: 2,
      start_ordinal: 1,
      end_ordinal: 2
    };
    const rangedProject = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createTranslationTarget({ x_meters: 4, y_meters: 4 })
        ],
        ranged_constraints: [previous]
      })
    });
    const update = createUpdateRangedConstraintCommand(0, previous, {
      ...previous,
      value: 3
    });
    expect(update.apply(rangedProject).path.ranged_constraints[0].value).toBe(3);

    const split = createSplitRangedConstraintCommand(0);
    const splitProject = split.apply(rangedProject);
    expect(splitProject.path.ranged_constraints).toHaveLength(2);
    expect(split.revert(splitProject).path.ranged_constraints).toEqual([previous]);

    const remove = createRemoveRangedConstraintCommand(0, previous);
    expect(remove.apply(rangedProject).path.ranged_constraints).toEqual([]);
  });
});

function exampleProject(): ProjectDocument {
  return createProjectDocument({
    project_id: "project-a",
    display_name: "Alpha",
    path: createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 1, y_meters: 1 }),
        createTranslationTarget({ x_meters: 4, y_meters: 4 })
      ]
    })
  });
}

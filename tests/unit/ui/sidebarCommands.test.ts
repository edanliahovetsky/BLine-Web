import { describe, expect, it } from "vitest";
import { createProjectDocument, type ProjectDocument } from "../../../src/core/io/projectSchema";
import {
  createPathModel,
  createTranslationTarget,
  createWaypoint,
  isEventTrigger,
  isTranslationTarget,
  isWaypoint
} from "../../../src/core/model/path";
import {
  createDefaultElement,
  createInsertPathElementCommand,
  createRemovePathElementCommand,
  createUpdatePathElementCommand,
  getInsertionIndex,
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

    expect(getInsertionIndex(project, "rotation", null)).toBe(1);
    expect(getInsertionIndex(project, "event_trigger", 1)).toBe(1);
    expect(getInsertionIndex(project, "waypoint", 1)).toBe(2);
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

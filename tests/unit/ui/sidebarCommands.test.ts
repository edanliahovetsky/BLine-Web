import { describe, expect, it } from "vitest";
import { seedHandoffRadii } from "../../../src/core/bend/autoSeedHandoffRadii";
import {
  fieldCoordinateOffsetMeters,
  fieldLengthMeters,
  fieldWidthMeters,
} from "../../../src/canvas/constants";
import {
  createProjectDocument,
  type ProjectDocument,
} from "../../../src/core/io/projectSchema";
import {
  createEventTrigger,
  createRotationTarget,
  createPathModel,
  createTranslationTarget,
  createWaypoint,
  getHandoffRadiusSource,
  isRotationTarget,
  isEventTrigger,
  isTranslationTarget,
  isWaypoint,
  setHandoffRadiusSource,
} from "../../../src/core/model/path";
import {
  getPathElementLinkedTargetId,
  setPathElementLinkedTargetId,
} from "../../../src/core/linkedTargets";
import {
  canClearGeneratedConstraints,
  canGenerateConstraints,
  canMovePathElement,
  createChangePathElementTypeCommand,
  createClearGeneratedConstraintsCommand,
  createConvertedElement,
  createDefaultElement,
  createDuplicatePathElementCommand,
  createAddRangedConstraintCommand,
  createInsertPathElementCommand,
  createInsertPathElementsCommand,
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
  handoffRadiusChipsForPath,
  updateWaypoint,
} from "../../../src/ui/sidebar/sidebarCommands";

describe("sidebar commands", () => {
  it("inserts and removes elements through reversible project commands", () => {
    const project = exampleProject();
    const element = createDefaultElement(
      project.path,
      project.config,
      "event_trigger",
      0,
    );
    const insert = createInsertPathElementCommand(1, element);

    const inserted = insert.apply(project.path);

    expect(inserted.path_elements).toHaveLength(3);
    expect(isEventTrigger(inserted.path_elements[1])).toBe(true);
    expect(project.path.path_elements).toHaveLength(2);

    const reverted = insert.revert(inserted);
    expect(reverted.path_elements).toHaveLength(2);

    const remove = createRemovePathElementCommand(0, reverted.path_elements[0]);
    const removed = remove.apply(reverted);
    expect(removed.path_elements).toHaveLength(1);

    const restored = remove.revert(removed);
    expect(restored.path_elements).toHaveLength(2);
    expect(isTranslationTarget(restored.path_elements[0])).toBe(true);
  });

  it("duplicates an element as an independent, unlinked copy", () => {
    const project = exampleProject();
    const linked = setPathElementLinkedTargetId(
      project.path.path_elements[0],
      "target-1",
    );
    project.path.path_elements[0] = linked;

    const command = createDuplicatePathElementCommand(0, linked);
    const applied = command.apply(project.path);

    expect(applied.path_elements).toHaveLength(3);
    const original = applied.path_elements[0];
    const copy = applied.path_elements[1];
    expect(isTranslationTarget(original)).toBe(true);
    expect(isTranslationTarget(copy)).toBe(true);
    if (isTranslationTarget(original) && isTranslationTarget(copy)) {
      expect([copy.x_meters, copy.y_meters]).toEqual([
        original.x_meters,
        original.y_meters,
      ]);
    }
    // The original keeps its link; the copy is independent.
    expect(getPathElementLinkedTargetId(original)).toBe("target-1");
    expect(getPathElementLinkedTargetId(copy)).toBeNull();

    const reverted = command.revert(applied);
    expect(reverted.path_elements).toHaveLength(2);
  });

  it("inserts generated curve elements as a single reversible command", () => {
    const project = exampleProject();
    const command = createInsertPathElementsCommand(project.config, 1, [
      createTranslationTarget({ x_meters: 2, y_meters: 1 }),
      createTranslationTarget({ x_meters: 3, y_meters: 2 }),
    ]);

    const inserted = command.apply(project.path);

    expect(inserted.path_elements).toHaveLength(4);
    expect(
      inserted.path_elements
        .filter(isTranslationTarget)
        .map((element) => [element.x_meters, element.y_meters]),
    ).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 4],
    ]);

    const reverted = command.revert(inserted);
    expect(reverted.path_elements).toEqual(project.path.path_elements);
  });

  it("auto-constrains generated curve elements and their exit segment", () => {
    const project = exampleProject();
    const command = createInsertPathElementsCommand(
      project.config,
      1,
      [
        createTranslationTarget({ x_meters: 2, y_meters: 1 }),
        createTranslationTarget({ x_meters: 2.5, y_meters: 2 }),
      ],
      { applyAutoVelocityToInsertedRange: true },
    );

    const inserted = command.apply(project.path);
    const autoVelocityConstraints = inserted.ranged_constraints.filter(
      (constraint) =>
        constraint.key === "max_velocity_meters_per_sec" &&
        constraint.source === "auto_velocity",
    );

    expect(autoVelocityConstraints).not.toHaveLength(0);
    expect(expandedOrdinals(autoVelocityConstraints)).toEqual([2, 3, 4]);
  });

  it("keeps manual velocity constraints when auto-constraining generated curves", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createTranslationTarget({ x_meters: 4, y_meters: 4 }),
        ],
        ranged_constraints: [
          {
            key: "max_velocity_meters_per_sec",
            value: 1.2,
            start_ordinal: 2,
            end_ordinal: 2,
          },
        ],
      }),
    });
    const command = createInsertPathElementsCommand(
      project.config,
      1,
      [
        createTranslationTarget({ x_meters: 2, y_meters: 1 }),
        createTranslationTarget({ x_meters: 2.5, y_meters: 2 }),
      ],
      { applyAutoVelocityToInsertedRange: true },
    );

    const inserted = command.apply(project.path);
    const autoVelocityConstraints = inserted.ranged_constraints.filter(
      (constraint) =>
        constraint.key === "max_velocity_meters_per_sec" &&
        constraint.source === "auto_velocity",
    );
    const manualVelocityConstraints = inserted.ranged_constraints.filter(
      (constraint) =>
        constraint.key === "max_velocity_meters_per_sec" &&
        constraint.source !== "auto_velocity",
    );

    expect(expandedOrdinals(autoVelocityConstraints)).toEqual([2, 3]);
    expect(
      manualVelocityConstraints.map((constraint) => ({
        key: constraint.key,
        value: constraint.value,
        start_ordinal: constraint.start_ordinal,
        end_ordinal: constraint.end_ordinal,
      })),
    ).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 1.2,
        start_ordinal: 4,
        end_ordinal: 4,
      },
    ]);
  });

  it("updates selected elements while preserving undo payloads", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createWaypoint({
            translation_target: createTranslationTarget({
              x_meters: 2,
              y_meters: 3,
            }),
          }),
        ],
      }),
    });
    const previous = project.path.path_elements[0];
    if (!isWaypoint(previous)) {
      throw new Error("Expected waypoint");
    }
    const next = updateWaypoint(previous, {
      translation: { x_meters: 4 },
      rotation: { rotation_radians: Math.PI / 3 },
    });

    const command = createUpdatePathElementCommand(0, previous, next);
    const updated = command.apply(project.path);
    const restored = command.revert(updated);

    const updatedElement = updated.path_elements[0];
    const restoredElement = restored.path_elements[0];
    expect(isWaypoint(updatedElement)).toBe(true);
    expect(isWaypoint(restoredElement)).toBe(true);
    if (isWaypoint(updatedElement) && isWaypoint(restoredElement)) {
      expect(updatedElement.translation_target.x_meters).toBe(4);
      expect(updatedElement.rotation_target.rotation_radians).toBeCloseTo(
        Math.PI / 3,
      );
      expect(restoredElement.translation_target.x_meters).toBe(2);
    }
  });

  it("keeps rotation-domain insertions between translation anchors", () => {
    const project = exampleProject();

    expect(getAddableElementTypes(project.path)).toEqual([
      "waypoint",
      "translation",
      "rotation",
      "event_trigger",
    ]);
    expect(getInsertionIndex(project.path, "rotation", null)).toBe(1);
    expect(getInsertionIndex(project.path, "event_trigger", 1)).toBe(1);
    expect(getInsertionIndex(project.path, "waypoint", 1)).toBe(2);
  });

  it("hides rotation-domain additions until two anchors exist", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [createTranslationTarget({ x_meters: 1, y_meters: 1 })],
      }),
    });

    expect(getAddableElementTypes(project.path)).toEqual([
      "waypoint",
      "translation",
    ]);
    expect(
      createDefaultElement(project.path, project.config, "event_trigger", 0)
        .type,
    ).toBe("translation");
  });

  it("uses the project handoff default for new anchor elements", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      config: {
        kinematic_constraints: {
          default_intermediate_handoff_radius_meters: 0.45,
        },
      },
      path: createPathModel({
        path_elements: [createTranslationTarget({ x_meters: 1, y_meters: 1 })],
      }),
    });

    const translation = createDefaultElement(
      project.path,
      project.config,
      "translation",
      0,
    );
    const waypoint = createDefaultElement(
      project.path,
      project.config,
      "waypoint",
      0,
    );

    expect(isTranslationTarget(translation)).toBe(true);
    if (isTranslationTarget(translation)) {
      expect(translation.intermediate_handoff_radius_meters).toBe(0.45);
      expect(translation.handoff_radius_source).toBe("auto");
    }
    expect(isWaypoint(waypoint)).toBe(true);
    if (isWaypoint(waypoint)) {
      expect(
        waypoint.translation_target.intermediate_handoff_radius_meters,
      ).toBe(0.45);
      expect(waypoint.translation_target.handoff_radius_source).toBe("auto");
    }
  });

  it("bounds new translation elements by the field, not robot size", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      config: {
        gui: {
          robot: {
            length_meters: 4,
            width_meters: 4,
          },
        },
      },
      path: createPathModel({
        path_elements: [
          createTranslationTarget({
            x_meters: fieldLengthMeters,
            y_meters: fieldWidthMeters,
          }),
        ],
      }),
    });

    const translation = createDefaultElement(
      project.path,
      project.config,
      "translation",
      0,
    );

    expect(isTranslationTarget(translation)).toBe(true);
    if (isTranslationTarget(translation)) {
      expect(translation.x_meters).toBe(
        fieldLengthMeters - fieldCoordinateOffsetMeters * 2,
      );
      expect(translation.y_meters).toBe(
        fieldWidthMeters - fieldCoordinateOffsetMeters * 2,
      );
    }
  });

  it("limits endpoint type switches to anchor elements", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createWaypoint({
            translation_target: createTranslationTarget({
              x_meters: 2,
              y_meters: 2,
            }),
          }),
          createTranslationTarget({ x_meters: 4, y_meters: 4 }),
        ],
      }),
    });

    expect(getSwitchableElementTypes(project.path, 0)).toEqual([
      "translation",
      "waypoint",
    ]);
    expect(getSwitchableElementTypes(project.path, 1)).toEqual([
      "translation",
      "waypoint",
      "rotation",
      "event_trigger",
    ]);
    expect(
      createConvertedElement(project.path, project.config, 0, "rotation"),
    ).toBeNull();
  });

  it("remaps ranged constraints when path structure changes", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createTranslationTarget({ x_meters: 4, y_meters: 4 }),
        ],
        ranged_constraints: [
          {
            key: "max_velocity_meters_per_sec",
            value: 2,
            start_ordinal: 1,
            end_ordinal: 2,
          },
        ],
      }),
    });
    const insertedElement = createTranslationTarget({
      x_meters: 0,
      y_meters: 0,
    });

    const inserted = createInsertPathElementCommand(0, insertedElement).apply(
      project.path,
    );

    expect(inserted.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 2,
        end_ordinal: 3,
      },
    ]);

    const removed = createRemovePathElementCommand(
      0,
      inserted.path_elements[0],
    ).apply(inserted);

    expect(removed.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 2,
      },
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
          createTranslationTarget({ x_meters: 3, y_meters: 3 }),
        ],
        ranged_constraints: [
          {
            key: "max_velocity_meters_per_sec",
            value: 2,
            start_ordinal: 1,
            end_ordinal: 2,
          },
        ],
      }),
    });

    expect(canMovePathElement(project.path, 2, 1)).toBe(true);
    const command = createMovePathElementCommand(2, 1);
    const moved = command.apply(project.path);

    expect(moved.path_elements.map((element) => element.type)).toEqual([
      "translation",
      "translation",
      "translation",
    ]);
    expect(moved.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 3,
      },
    ]);

    const reverted = command.revert(moved);
    expect(reverted.ranged_constraints).toEqual(
      project.path.ranged_constraints,
    );
  });

  it("converts element types with explicit ordinal remapping", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createRotationTarget({ rotation_radians: Math.PI / 4, t_ratio: 0.5 }),
          createTranslationTarget({ x_meters: 4, y_meters: 4 }),
        ],
        ranged_constraints: [
          {
            key: "max_velocity_deg_per_sec",
            value: 600,
            start_ordinal: 1,
            end_ordinal: 1,
          },
        ],
      }),
    });
    const previous = project.path.path_elements[1];
    const converted = createConvertedElement(
      project.path,
      project.config,
      1,
      "event_trigger",
    );

    expect(converted).not.toBeNull();
    if (!converted) {
      return;
    }
    expect(isEventTrigger(converted)).toBe(true);

    const command = createChangePathElementTypeCommand(1, previous, converted);
    const updated = command.apply(project.path);
    const restored = command.revert(updated);

    expect(isEventTrigger(updated.path_elements[1])).toBe(true);
    expect(updated.ranged_constraints).toEqual([]);
    expect(isRotationTarget(restored.path_elements[1])).toBe(true);
    expect(restored.ranged_constraints).toEqual(
      project.path.ranged_constraints,
    );
  });

  it("edits scalar and ranged constraints through reversible commands", () => {
    const project = exampleProject();
    const scalar = createSetScalarConstraintCommand(
      "end_translation_tolerance_meters",
      null,
      0.03,
    );
    const withScalar = scalar.apply(project.path);
    expect(withScalar.constraints.end_translation_tolerance_meters).toBe(0.03);
    expect(
      scalar.revert(withScalar).constraints.end_translation_tolerance_meters,
    ).toBeNull();

    const add = createAddRangedConstraintCommand(
      "max_velocity_meters_per_sec",
      2,
      2,
    );
    const withRange = add.apply(project.path);
    expect(withRange.ranged_constraints).toEqual([
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 1,
        end_ordinal: 1,
      },
    ]);
    expect(add.revert(withRange).ranged_constraints).toEqual([]);

    const previous = {
      key: "max_velocity_meters_per_sec" as const,
      value: 2,
      start_ordinal: 1,
      end_ordinal: 2,
    };
    const rangedProject = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createTranslationTarget({ x_meters: 4, y_meters: 4 }),
        ],
        ranged_constraints: [previous],
      }),
    });
    const update = createUpdateRangedConstraintCommand(0, previous, {
      ...previous,
      value: 3,
    });
    expect(update.apply(rangedProject.path).ranged_constraints[0].value).toBe(
      3,
    );

    const split = createSplitRangedConstraintCommand(0);
    const splitProject = split.apply(rangedProject.path);
    expect(splitProject.ranged_constraints).toHaveLength(2);
    expect(split.revert(splitProject).ranged_constraints).toEqual([previous]);

    const remove = createRemoveRangedConstraintCommand(0, previous);
    expect(remove.apply(rangedProject.path).ranged_constraints).toEqual([]);
  });
});

function exampleProject(): ProjectDocument {
  return createProjectDocument({
    project_id: "project-a",
    display_name: "Alpha",
    path: createPathModel({
      path_elements: [
        createTranslationTarget({ x_meters: 1, y_meters: 1 }),
        createTranslationTarget({ x_meters: 4, y_meters: 4 }),
      ],
    }),
  });
}

function expandedOrdinals(
  constraints: readonly {
    start_ordinal: number;
    end_ordinal: number;
  }[],
): number[] {
  return constraints
    .flatMap((constraint) => {
      const start = Math.min(constraint.start_ordinal, constraint.end_ordinal);
      const end = Math.max(constraint.start_ordinal, constraint.end_ordinal);
      return Array.from({ length: end - start + 1 }, (_, index) => {
        return start + index;
      });
    })
    .sort((left, right) => left - right);
}

describe("generated constraint commands", () => {
  const generatableProject = (): ProjectDocument =>
    createProjectDocument({
      project_id: "generate-constraints",
      display_name: "Generate Constraints",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 1 }),
          createTranslationTarget({ x_meters: 4, y_meters: 1 }),
          createWaypoint({
            translation_target: createTranslationTarget({
              x_meters: 4,
              y_meters: 4,
              intermediate_handoff_radius_meters: 0.2,
            }),
          }),
          createTranslationTarget({ x_meters: 7, y_meters: 4 }),
        ],
      }),
    });

  const pinnedProject = (): ProjectDocument => {
    const project = generatableProject();
    const pinnedElements = project.path.path_elements.map((element) =>
      isTranslationTarget(element) || isWaypoint(element)
        ? setHandoffRadiusSource(
            element.type === "translation"
              ? { ...element, intermediate_handoff_radius_meters: 0.3 }
              : {
                  ...element,
                  translation_target: {
                    ...element.translation_target,
                    intermediate_handoff_radius_meters: 0.3,
                  },
                },
            "manual",
          )
        : element,
    );

    return {
      ...project,
      path: {
        ...project.path,
        path_elements: pinnedElements,
        ranged_constraints: [
          {
            key: "max_velocity_meters_per_sec",
            value: 2,
            start_ordinal: 1,
            end_ordinal: 4,
          },
        ],
      },
    };
  };

  const generatedProject = (): ProjectDocument => {
    const project = generatableProject();
    return {
      ...project,
      path: {
        ...seedHandoffRadii(project.path).path,
        ranged_constraints: [
          {
            key: "max_velocity_meters_per_sec",
            value: 2,
            start_ordinal: 1,
            end_ordinal: 4,
            source: "auto_velocity",
            auto_velocity: null,
          },
        ],
      },
    };
  };

  it("reports a fully pinned path as nothing to generate", () => {
    expect(canGenerateConstraints(generatableProject().path)).toBe(true);
    expect(canGenerateConstraints(pinnedProject().path)).toBe(false);
  });

  it("clears generated values and keeps pinned ones", () => {
    const generated = generatedProject();
    expect(canClearGeneratedConstraints(generated.path)).toBe(true);

    const command = createClearGeneratedConstraintsCommand();
    const cleared = command.apply(generated.path);

    const reverted = cleared.path_elements[1];
    expect(
      reverted.type === "translation"
        ? reverted.intermediate_handoff_radius_meters
        : "missing",
    ).toBeNull();
    expect(getHandoffRadiusSource(reverted)).toBeNull();

    const pinned = cleared.path_elements[2];
    expect(
      pinned.type === "waypoint"
        ? pinned.translation_target.intermediate_handoff_radius_meters
        : null,
    ).toBeCloseTo(0.2, 9);
    expect(
      cleared.ranged_constraints.some(
        (constraint) => constraint.source === "auto_velocity",
      ),
    ).toBe(false);
    expect(canClearGeneratedConstraints(cleared)).toBe(false);

    expect(command.revert(cleared)).toEqual(generated.path);
  });
});

describe("handoffRadiusChipsForPath", () => {
  const chipProject = (
    elements: ProjectDocument["path"]["path_elements"],
    defaultRadiusMeters = 0.45,
  ): ProjectDocument =>
    createProjectDocument({
      project_id: "handoff-radius-chips",
      display_name: "Handoff Radius Chips",
      config: {
        kinematic_constraints: {
          default_intermediate_handoff_radius_meters: defaultRadiusMeters,
        },
      },
      path: createPathModel({ path_elements: elements }),
    });

  const chipsForProject = (project: ProjectDocument) =>
    handoffRadiusChipsForPath(project.path, project.config);

  it("numbers anchors in path order and skips everything else", () => {
    const chips = chipsForProject(
      chipProject([
        createTranslationTarget({ x_meters: 1, y_meters: 1 }),
        createRotationTarget({ t_ratio: 0.5 }),
        createTranslationTarget({ x_meters: 4, y_meters: 1 }),
        createEventTrigger({ t_ratio: 0.5, lib_key: "intake" }),
        createWaypoint({
          translation_target: createTranslationTarget({
            x_meters: 4,
            y_meters: 4,
          }),
        }),
      ]),
    );

    expect(chips.map((chip) => [chip.elementIndex, chip.ordinal])).toEqual([
      [0, 1],
      [2, 2],
      [4, 3],
    ]);
  });

  it("marks both endpoint anchors inert and leaves the interior live", () => {
    const chips = chipsForProject(
      chipProject([
        createTranslationTarget({ x_meters: 1, y_meters: 1 }),
        createTranslationTarget({ x_meters: 4, y_meters: 1 }),
        createTranslationTarget({ x_meters: 4, y_meters: 4 }),
        createTranslationTarget({ x_meters: 7, y_meters: 4 }),
      ]),
    );

    expect(chips.map((chip) => chip.inert)).toEqual([true, false, false, true]);
  });

  it("classifies generated, pinned and unset radii", () => {
    const chips = chipsForProject(
      chipProject([
        setHandoffRadiusSource(
          createTranslationTarget({
            x_meters: 1,
            y_meters: 1,
            intermediate_handoff_radius_meters: 0.3,
          }),
          "auto",
        ),
        setHandoffRadiusSource(
          createTranslationTarget({
            x_meters: 4,
            y_meters: 1,
            intermediate_handoff_radius_meters: 0.32,
          }),
          "manual",
        ),
        // Untagged but valued: a file brought it in, so it counts as pinned.
        createTranslationTarget({
          x_meters: 4,
          y_meters: 4,
          intermediate_handoff_radius_meters: 0.34,
        }),
        createTranslationTarget({ x_meters: 7, y_meters: 4 }),
        // Zero is unusable at runtime, which reads the same as unset.
        createTranslationTarget({
          x_meters: 7,
          y_meters: 7,
          intermediate_handoff_radius_meters: 0,
        }),
      ]),
    );

    expect(chips.map((chip) => chip.state)).toEqual([
      "auto",
      "manual",
      "manual",
      "unset",
      "unset",
    ]);
    expect(chips.map((chip) => chip.source)).toEqual([
      "auto",
      "manual",
      null,
      null,
      null,
    ]);
  });

  it("falls back to the configured default for unset radii", () => {
    const chips = chipsForProject(
      chipProject(
        [
          createTranslationTarget({
            x_meters: 1,
            y_meters: 1,
            intermediate_handoff_radius_meters: 0.3,
          }),
          createTranslationTarget({ x_meters: 4, y_meters: 1 }),
        ],
        0.6,
      ),
    );

    expect(chips.map((chip) => chip.valueMeters)).toEqual([0.3, null]);
    expect(chips.map((chip) => chip.effectiveValueMeters)).toEqual([0.3, 0.6]);
  });
});

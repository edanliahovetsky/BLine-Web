import { describe, expect, it } from "vitest";
import { createProjectDocument } from "../../../src/core/io/projectSchema";
import {
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint
} from "../../../src/core/model/path";
import {
  createFieldViewport,
  getElementHeadingRadians,
  getElementPosition,
  getHandoffRadiusMeters,
  getRenderableElementPositions,
  modelToStagePoint,
  stageToModelPoint
} from "../../../src/canvas/geometry";
import {
  createMoveElementCommand,
  updateProjectElementPosition
} from "../../../src/canvas/modelSync";

describe("canvas geometry", () => {
  it("round-trips model coordinates through stage coordinates", () => {
    const viewport = createFieldViewport({ width: 960, height: 540 });
    const modelPoint = { x_meters: 3.25, y_meters: 2.75 };
    const stagePoint = modelToStagePoint(modelPoint, viewport);
    const roundTrip = stageToModelPoint(stagePoint, viewport);

    expect(roundTrip.x_meters).toBeCloseTo(modelPoint.x_meters, 6);
    expect(roundTrip.y_meters).toBeCloseTo(modelPoint.y_meters, 6);
  });

  it("projects rotation and event elements between neighboring anchors", () => {
    const elements = [
      createTranslationTarget({ x_meters: 1, y_meters: 1 }),
      createRotationTarget({ t_ratio: 0.25 }),
      createWaypoint({
        translation_target: createTranslationTarget({ x_meters: 5, y_meters: 3 })
      }),
      createEventTrigger({ t_ratio: 0.5 }),
      createTranslationTarget({ x_meters: 9, y_meters: 5 })
    ];

    expect(getElementPosition(elements, 1)).toEqual({
      x_meters: 2,
      y_meters: 1.5
    });
    expect(getElementPosition(elements, 3)).toEqual({
      x_meters: 7,
      y_meters: 4
    });
  });

  it("keeps every renderable path element in drawing order", () => {
    const elements = [
      createTranslationTarget({ x_meters: 1, y_meters: 1 }),
      createRotationTarget({ t_ratio: 0.25 }),
      createWaypoint({
        translation_target: createTranslationTarget({ x_meters: 5, y_meters: 3 })
      }),
      createEventTrigger({ t_ratio: 0.5 }),
      createTranslationTarget({ x_meters: 9, y_meters: 5 })
    ];

    expect(getRenderableElementPositions(elements).map(({ index }) => index)).toEqual([
      0, 1, 2, 3, 4
    ]);
  });

  it("derives visual headings and handoff radii from path semantics", () => {
    const elements = [
      createTranslationTarget({
        x_meters: 1,
        y_meters: 1,
        intermediate_handoff_radius_meters: 0.6
      }),
      createRotationTarget({ rotation_radians: Math.PI / 4, t_ratio: 0.25 }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 5,
          y_meters: 3,
          intermediate_handoff_radius_meters: 0.25
        }),
        rotation_target: createRotationTarget({ rotation_radians: Math.PI / 2 })
      }),
      createEventTrigger({ t_ratio: 0.5 }),
      createTranslationTarget({ x_meters: 9, y_meters: 3 })
    ];

    expect(getElementHeadingRadians(elements, 0)).toBeCloseTo(0, 6);
    expect(getElementHeadingRadians(elements, 1)).toBeCloseTo(Math.PI / 4, 6);
    expect(getElementHeadingRadians(elements, 2)).toBeCloseTo(Math.PI / 2, 6);
    expect(getElementHeadingRadians(elements, 3)).toBeCloseTo(Math.PI / 2, 6);
    expect(getElementHeadingRadians(elements, 4)).toBeCloseTo(Math.PI / 2, 6);
    expect(getHandoffRadiusMeters(elements[0])).toBe(0.6);
    expect(getHandoffRadiusMeters(elements[2])).toBe(0.25);
    expect(getHandoffRadiusMeters(elements[1])).toBeNull();
  });
});

describe("canvas model sync", () => {
  it("moves and reverts translation-bearing elements through history commands", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [
          createTranslationTarget({ x_meters: 1, y_meters: 2 }),
          createWaypoint({
            translation_target: createTranslationTarget({ x_meters: 3, y_meters: 4 })
          })
        ]
      })
    });
    const move = createMoveElementCommand(
      1,
      { x_meters: 3, y_meters: 4 },
      { x_meters: 6, y_meters: 7 }
    );

    const moved = move.apply(project);
    expect(getElementPosition(moved.path.path_elements, 1)).toEqual({
      x_meters: 6,
      y_meters: 7
    });

    const reverted = move.revert(moved);
    expect(getElementPosition(reverted.path.path_elements, 1)).toEqual({
      x_meters: 3,
      y_meters: 4
    });
    expect(project.path.path_elements).not.toBe(moved.path.path_elements);
  });

  it("rejects direct position updates for non-translation elements", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel({
        path_elements: [createRotationTarget()]
      })
    });

    expect(() =>
      updateProjectElementPosition(project, 0, { x_meters: 2, y_meters: 3 })
    ).toThrow("does not have an editable translation position");
  });
});

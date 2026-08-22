import { describe, expect, it } from "vitest";
import { createProjectDocument } from "../../../src/core/io/projectSchema";
import { defaultFieldGeometry } from "../../../src/core/field/fieldConfig";
import {
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  getHandoffRadiusSource,
} from "../../../src/core/model/path";
import {
  anchorNodeExclusionRadiusPx,
  createFieldViewport,
  clampModelPoint,
  getElementHeadingRadians,
  getElementPosition,
  getNeighborAnchorPositions,
  interpolateSegmentPosition,
  projectPointToSegmentRatio,
  getRenderableElementPositions,
  modelToStagePoint,
  stageToModelPoint,
  stagePointsDiffer,
} from "../../../src/canvas/geometry";
import {
  createSetHandoffRadiusCommand,
  createSetHandoffRadiiCommand,
  updatePathElementHandoffRadius,
} from "../../../src/canvas/modelSync";
import {
  firstDomainIndexForConstraintRange,
  pathIndexesForConstraintRange,
} from "../../../src/canvas/constraintRange";

describe("canvas geometry", () => {
  it("distinguishes a real pointer move from a zero-distance event", () => {
    expect(stagePointsDiffer({ x: 12, y: 8 }, { x: 12, y: 8 })).toBe(false);
    expect(stagePointsDiffer({ x: 12, y: 8 }, { x: 12.01, y: 8 })).toBe(true);
  });

  it("round-trips model coordinates through stage coordinates", () => {
    const viewport = createFieldViewport({ width: 960, height: 540 });
    const modelPoint = { x_meters: 3.25, y_meters: 2.75 };
    const stagePoint = modelToStagePoint(modelPoint, viewport);
    const roundTrip = stageToModelPoint(stagePoint, viewport);

    expect(roundTrip.x_meters).toBeCloseTo(modelPoint.x_meters, 6);
    expect(roundTrip.y_meters).toBeCloseTo(modelPoint.y_meters, 6);
  });

  it("uses active field geometry for viewport sizing and coordinate offsets", () => {
    const viewport = createFieldViewport({ width: 1000, height: 600 }, 24, {
      length_meters: 10,
      width_meters: 5,
      coordinate_offset_meters: 1,
    });
    const modelPoint = { x_meters: 2.5, y_meters: 1.5 };
    const stagePoint = modelToStagePoint(modelPoint, viewport);
    const roundTrip = stageToModelPoint(stagePoint, viewport);

    expect(viewport.width / viewport.height).toBeCloseTo(2, 6);
    expect(viewport.field.length_meters).toBe(10);
    expect(stagePoint.x).toBeCloseTo(viewport.x + 3.5 * viewport.scale, 6);
    expect(stagePoint.y).toBeCloseTo(viewport.y + 2.5 * viewport.scale, 6);
    expect(roundTrip.x_meters).toBeCloseTo(modelPoint.x_meters, 6);
    expect(roundTrip.y_meters).toBeCloseTo(modelPoint.y_meters, 6);
  });

  it("uses per-axis coordinate offsets when present", () => {
    const viewport = createFieldViewport({ width: 1000, height: 600 }, 24, {
      length_meters: 10,
      width_meters: 5,
      coordinate_offset_meters: 0,
      coordinate_offset_x_meters: 1,
      coordinate_offset_y_meters: 0.5,
    });
    const modelPoint = { x_meters: 2.5, y_meters: 1.5 };
    const stagePoint = modelToStagePoint(modelPoint, viewport);
    const roundTrip = stageToModelPoint(stagePoint, viewport);

    expect(stagePoint.x).toBeCloseTo(viewport.x + 3.5 * viewport.scale, 6);
    expect(stagePoint.y).toBeCloseTo(viewport.y + 3 * viewport.scale, 6);
    expect(roundTrip.x_meters).toBeCloseTo(modelPoint.x_meters, 6);
    expect(roundTrip.y_meters).toBeCloseTo(modelPoint.y_meters, 6);
    expect(
      clampModelPoint({ x_meters: 100, y_meters: 100 }, viewport.field),
    ).toEqual({
      x_meters: 8,
      y_meters: 4,
    });
  });

  it("clamps model coordinates to field bounds without robot extents", () => {
    expect(clampModelPoint({ x_meters: -1, y_meters: -1 })).toEqual({
      x_meters: 0,
      y_meters: 0,
    });

    expect(clampModelPoint({ x_meters: 100, y_meters: 100 })).toEqual({
      x_meters:
        defaultFieldGeometry.length_meters -
        defaultFieldGeometry.coordinate_offset_meters * 2,
      y_meters:
        defaultFieldGeometry.width_meters -
        defaultFieldGeometry.coordinate_offset_meters * 2,
    });

    expect(
      clampModelPoint(
        { x_meters: 100, y_meters: 100 },
        {
          length_meters: 10,
          width_meters: 5,
          coordinate_offset_meters: 1,
        },
      ),
    ).toEqual({
      x_meters: 8,
      y_meters: 3,
    });
  });

  it("projects rotation and event elements between neighboring anchors", () => {
    const elements = [
      createTranslationTarget({ x_meters: 1, y_meters: 1 }),
      createRotationTarget({ t_ratio: 0.25 }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 5,
          y_meters: 3,
        }),
      }),
      createEventTrigger({ t_ratio: 0.5 }),
      createTranslationTarget({ x_meters: 9, y_meters: 5 }),
    ];

    expect(getElementPosition(elements, 1)).toEqual({
      x_meters: 2,
      y_meters: 1.5,
    });
    expect(getElementPosition(elements, 3)).toEqual({
      x_meters: 7,
      y_meters: 4,
    });
  });

  it("keeps every renderable path element in drawing order", () => {
    const elements = [
      createTranslationTarget({ x_meters: 1, y_meters: 1 }),
      createRotationTarget({ t_ratio: 0.25 }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 5,
          y_meters: 3,
        }),
      }),
      createEventTrigger({ t_ratio: 0.5 }),
      createTranslationTarget({ x_meters: 9, y_meters: 5 }),
    ];

    expect(
      getRenderableElementPositions(elements).map(({ index }) => index),
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it("maps selected ranged constraints to the highlighted path span", () => {
    const elements = [
      createTranslationTarget(),
      createRotationTarget(),
      createWaypoint(),
      createEventTrigger(),
      createTranslationTarget(),
    ];

    expect(
      pathIndexesForConstraintRange(elements, {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 2,
        end_ordinal: 2,
      }),
    ).toEqual([0, 1, 2]);
    expect(
      pathIndexesForConstraintRange(elements, {
        key: "max_velocity_deg_per_sec",
        value: 90,
        start_ordinal: 2,
        end_ordinal: 3,
      }),
    ).toEqual([1, 2]);
    expect(
      firstDomainIndexForConstraintRange(elements, {
        key: "max_velocity_meters_per_sec",
        value: 2,
        start_ordinal: 0,
        end_ordinal: 3,
      }),
    ).toBe(0);
  });

  it("projects dragged segment points back to rotation/event ratios", () => {
    const elements = [
      createTranslationTarget({ x_meters: 1, y_meters: 1 }),
      createEventTrigger({ t_ratio: 0.5 }),
      createTranslationTarget({ x_meters: 5, y_meters: 1 }),
    ];
    const segment = getNeighborAnchorPositions(elements, 1);

    expect(segment).not.toBeNull();
    if (!segment) {
      return;
    }

    expect(
      projectPointToSegmentRatio(
        { x_meters: 3, y_meters: 3 },
        segment.previous,
        segment.next,
      ),
    ).toBeCloseTo(0.5, 6);
    expect(
      interpolateSegmentPosition(segment.previous, segment.next, 0.25),
    ).toEqual({
      x_meters: 2,
      y_meters: 1,
    });
  });

  it("derives visual headings and handoff radii from path semantics", () => {
    const elements = [
      createTranslationTarget({
        x_meters: 1,
        y_meters: 1,
        intermediate_handoff_radius_meters: 0.6,
      }),
      createRotationTarget({ rotation_radians: Math.PI / 4, t_ratio: 0.25 }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 5,
          y_meters: 3,
          intermediate_handoff_radius_meters: 0.25,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: Math.PI / 2,
        }),
      }),
      createEventTrigger({ t_ratio: 0.5 }),
      createTranslationTarget({ x_meters: 9, y_meters: 3 }),
    ];

    expect(getElementHeadingRadians(elements, 0)).toBeCloseTo(0, 6);
    expect(getElementHeadingRadians(elements, 1)).toBeCloseTo(Math.PI / 4, 6);
    expect(getElementHeadingRadians(elements, 2)).toBeCloseTo(Math.PI / 2, 6);
    expect(getElementHeadingRadians(elements, 3)).toBeCloseTo(Math.PI / 2, 6);
    expect(getElementHeadingRadians(elements, 4)).toBeCloseTo(Math.PI / 2, 6);
    expect(
      getElementHeadingRadians(elements, 2, new Map([[2, Math.PI]])),
    ).toBeCloseTo(Math.PI, 6);
  });

  it("keeps the anchor node exclusion ring on a pixel floor as the view zooms", () => {
    // The formula mirrors the translation node circle hit-test, so overlay
    // grabs outside the ring can never contest a node grab.
    const zoomedOut = {
      ...createFieldViewport({ width: 960, height: 540 }),
      scale: 20,
    };
    const zoomedIn = { ...zoomedOut, scale: 400 };

    expect(anchorNodeExclusionRadiusPx(zoomedOut)).toBeCloseTo(21, 6);
    expect(anchorNodeExclusionRadiusPx(zoomedIn)).toBeCloseTo(54, 6);
  });
});

describe("canvas model sync", () => {
  it("applies and reverts handoff radius plus source together", () => {
    const project = createProjectDocument({
      project_id: "handoff-radius",
      display_name: "Handoff Radius",
      path: handoffRadiusPath(),
    });
    const command = createSetHandoffRadiusCommand(
      2,
      { radiusMeters: 0.4, source: null },
      { radiusMeters: 0.75, source: "manual" },
    );

    const applied = command.apply(project.path);
    const appliedElement = applied.path_elements[2];
    expect(
      appliedElement.type === "translation"
        ? appliedElement.intermediate_handoff_radius_meters
        : null,
    ).toBeCloseTo(0.75, 9);
    expect(getHandoffRadiusSource(appliedElement)).toBe("manual");

    const reverted = command.revert(applied);
    const revertedElement = reverted.path_elements[2];
    expect(
      revertedElement.type === "translation"
        ? revertedElement.intermediate_handoff_radius_meters
        : null,
    ).toBeCloseTo(0.4, 9);
    expect(getHandoffRadiusSource(revertedElement)).toBeNull();
  });

  it("writes handoff radii through to waypoint translation targets", () => {
    const project = createProjectDocument({
      project_id: "handoff-radius",
      display_name: "Handoff Radius",
      path: handoffRadiusPath(),
    });
    const updated = updatePathElementHandoffRadius(project.path, 3, {
      radiusMeters: 0.3,
      source: "auto",
    });
    const element = updated.path_elements[3];
    expect(
      element.type === "waypoint"
        ? element.translation_target.intermediate_handoff_radius_meters
        : null,
    ).toBeCloseTo(0.3, 9);
    expect(getHandoffRadiusSource(element)).toBe("auto");
  });

  it("applies and reverts multiple handoff radii as one command", () => {
    const project = createProjectDocument({
      project_id: "handoff-radii",
      display_name: "Handoff Radii",
      path: handoffRadiusPath(),
    });
    const command = createSetHandoffRadiiCommand([
      {
        index: 2,
        previous: { radiusMeters: 0.4, source: null },
        next: { radiusMeters: 0.65, source: "manual" },
      },
      {
        index: 3,
        previous: { radiusMeters: null, source: null },
        next: { radiusMeters: null, source: null },
      },
    ]);

    const applied = command.apply(project.path);
    expect(getHandoffRadiusSource(applied.path_elements[2])).toBe("manual");
    expect(getHandoffRadiusSource(applied.path_elements[3])).toBeNull();

    const reverted = command.revert(applied);
    expect(getHandoffRadiusSource(reverted.path_elements[2])).toBeNull();
    expect(getHandoffRadiusSource(reverted.path_elements[3])).toBeNull();
  });

  it("rejects handoff radius writes on elements without one", () => {
    const project = createProjectDocument({
      project_id: "handoff-radius",
      display_name: "Handoff Radius",
      path: handoffRadiusPath(),
    });
    expect(() =>
      updatePathElementHandoffRadius(project.path, 1, {
        radiusMeters: 0.2,
        source: null,
      }),
    ).toThrow(/does not carry a handoff radius/);
  });
});

const handoffRadiusPath = () =>
  createPathModel({
    path_elements: [
      createTranslationTarget({ x_meters: 1, y_meters: 1 }),
      createRotationTarget({ t_ratio: 0.5 }),
      createTranslationTarget({
        x_meters: 5,
        y_meters: 1,
        intermediate_handoff_radius_meters: 0.4,
      }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 5,
          y_meters: 5,
        }),
      }),
    ],
  });

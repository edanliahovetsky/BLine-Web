import { expect, test } from "@playwright/test";
import type { PixiRenderInput } from "../../src/canvas/pixi/PixiPathRenderer";

test("cached layers match a full redraw through canvas edits @webkit-canvas", async ({
  page,
}) => {
  await page.goto("/");
  const samples = await page.evaluate(async () => {
    const rendererModulePath = "/src/canvas/pixi/PixiPathRenderer.ts";
    const fieldModulePath = "/src/core/field/fieldConfig.ts";
    const geometryModulePath = "/src/canvas/geometry.ts";
    const pathModulePath = "/src/core/model/path.ts";
    const { PixiPathRenderer } = (await import(
      /* @vite-ignore */ rendererModulePath
    )) as typeof import("../../src/canvas/pixi/PixiPathRenderer");
    const { resolveUserFieldDefinition } = (await import(
      /* @vite-ignore */ fieldModulePath
    )) as typeof import("../../src/core/field/fieldConfig");
    const { createFieldViewport } = (await import(
      /* @vite-ignore */ geometryModulePath
    )) as typeof import("../../src/canvas/geometry");
    const { createPathModel, createWaypoint, createTranslationTarget } =
      (await import(
        /* @vite-ignore */ pathModulePath
      )) as typeof import("../../src/core/model/path");

    const field = resolveUserFieldDefinition("blank-grid", []);
    const stageSize = { width: 600, height: 360 };
    const pathAt = (y: number) =>
      createPathModel({
        path_elements: [-5, 30].map((x) =>
          createWaypoint({
            translation_target: createTranslationTarget({
              x_meters: x,
              y_meters: y,
            }),
          }),
        ),
      });
    let input: PixiRenderInput = {
      stageSize,
      viewport: createFieldViewport(stageSize, 24, field.geometry),
      field,
      path: createPathModel({
        path_elements: [2, 10].map((x) =>
          createWaypoint({
            translation_target: createTranslationTarget({
              x_meters: x,
              y_meters: 2,
            }),
          }),
        ),
      }),
      overlayPaths: [
        { pathId: "ghost", displayName: "Ghost", path: pathAt(4) },
      ],
      hoveredOverlayPathId: null,
      selectedElementIndex: 0,
      selectedRangedConstraint: null,
      positionPreview: new Map(),
      rotationPreview: new Map(),
      selectedPulse: 0,
      simulationResult: null,
      simulationTrace: null,
      trajectoryMaxSpeedMps: 1,
      simulationTimeS: 0,
      simulationPlaying: false,
      simulationEventPulse: 0,
      config: null,
      curvePreview: null,
    };
    const cached = await PixiPathRenderer.create(stageSize, field);
    const reference = await PixiPathRenderer.create(stageSize, field);
    let previousImage = "";
    const results: Array<{
      name: string;
      matchesFullRedraw: boolean;
      changed: boolean;
      fieldDrawCount: number;
      overlayDrawCount: number;
      renderCount: number;
    }> = [];
    const capture = (name: string) => {
      cached.update(input);
      const actual = cached.canvas.toDataURL();
      // Fresh identities force both static layers to rebuild in the reference.
      reference.update({
        ...input,
        viewport: { ...input.viewport },
        overlayPaths: [...input.overlayPaths],
      });
      const { fieldDrawCount, overlayDrawCount, renderCount } = cached
        .getDebugApi()
        .canvasMetrics();
      results.push({
        name,
        matchesFullRedraw: actual === reference.canvas.toDataURL(),
        changed: actual !== previousImage,
        fieldDrawCount,
        overlayDrawCount,
        renderCount,
      });
      previousImage = actual;
    };

    try {
      capture("initial scene");
      capture("unchanged scene");
      input = {
        ...input,
        positionPreview: new Map([[0, { x_meters: 3, y_meters: 3 }]]),
      };
      capture("drag active waypoint");
      input = { ...input, hoveredOverlayPathId: "ghost" };
      capture("hover ghost path");
      input = { ...input, hoveredOverlayPathId: null };
      capture("leave ghost path");
      input = {
        ...input,
        overlayPaths: [{ ...input.overlayPaths[0], path: pathAt(6) }],
      };
      capture("edit ghost path");
      const overlays = input.overlayPaths;
      input = { ...input, overlayPaths: [] };
      capture("hide ghost paths");
      input = { ...input, overlayPaths: overlays };
      capture("restore ghost paths");
      input = {
        ...input,
        viewport: {
          ...input.viewport,
          x: input.viewport.x + 30,
          y: input.viewport.y + 12,
        },
      };
      capture("pan view");
      input = {
        ...input,
        viewport: {
          ...input.viewport,
          width: input.viewport.width * 1.25,
          height: input.viewport.height * 1.25,
          scale: input.viewport.scale * 1.25,
        },
      };
      capture("zoom view");
      // Clipping also depends on canvas bounds, independently of the viewport.
      input = { ...input, stageSize: { width: 760, height: 420 } };
      capture("resize canvas with the same viewport");
      input = {
        ...input,
        viewport: createFieldViewport(input.stageSize, 24, field.geometry),
      };
      capture("fit resized view");
      input = {
        ...input,
        path: null,
        overlayPaths: [],
        selectedElementIndex: null,
        linkedTargets: [
          {
            target_id: "linked",
            display_name: "Linked",
            kind: "translation",
            x_meters: 3,
            y_meters: 3,
          },
        ],
        selectedLinkedTargetId: "linked",
      };
      capture("linked-element scene");
      input = {
        ...input,
        linkedTargets: [{ ...input.linkedTargets![0], x_meters: 6 }],
      };
      capture("drag linked element");
      return results;
    } finally {
      cached.destroy();
      reference.destroy();
    }
  });

  for (const sample of samples) {
    expect(sample.matchesFullRedraw, sample.name).toBe(true);
    expect(sample.changed, sample.name).toBe(sample.name !== "unchanged scene");
  }
  expect(
    samples.slice(0, 3).map(({ fieldDrawCount, overlayDrawCount }) => ({
      fieldDrawCount,
      overlayDrawCount,
    })),
  ).toEqual([
    { fieldDrawCount: 1, overlayDrawCount: 1 },
    { fieldDrawCount: 1, overlayDrawCount: 1 },
    { fieldDrawCount: 1, overlayDrawCount: 1 },
  ]);
  const linkedBefore = samples.at(-2)!;
  const linkedAfter = samples.at(-1)!;
  expect(linkedAfter.fieldDrawCount).toBe(linkedBefore.fieldDrawCount);
  expect(linkedAfter.overlayDrawCount).toBe(linkedBefore.overlayDrawCount);
  expect(linkedAfter.renderCount).toBe(samples.length);
});

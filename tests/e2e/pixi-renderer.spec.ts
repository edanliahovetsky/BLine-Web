import { expect, test } from "@playwright/test";
import type { PixiRenderInput } from "../../src/canvas/pixi/PixiPathRenderer";

test("event trigger preview matches its committed angle while either neighbor moves @webkit-canvas", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const rendererModulePath = "/src/canvas/pixi/PixiPathRenderer.ts";
    const fieldModulePath = "/src/core/field/fieldConfig.ts";
    const geometryModulePath = "/src/canvas/geometry.ts";
    const sampleModulePath = "/src/ui/app/initialProject.ts";
    const { PixiPathRenderer } = (await import(
      /* @vite-ignore */ rendererModulePath
    )) as typeof import("../../src/canvas/pixi/PixiPathRenderer");
    const { resolveUserFieldDefinition } = (await import(
      /* @vite-ignore */ fieldModulePath
    )) as typeof import("../../src/core/field/fieldConfig");
    const { createFieldViewport } = (await import(
      /* @vite-ignore */ geometryModulePath
    )) as typeof import("../../src/canvas/geometry");
    const { createSampleProject } = (await import(
      /* @vite-ignore */ sampleModulePath
    )) as typeof import("../../src/ui/app/initialProject");
    const project = createSampleProject();
    const path = project.paths[0].path;
    const field = resolveUserFieldDefinition("blank-grid", []);
    const stageSize = { width: 960, height: 540 };
    const input: PixiRenderInput = {
      stageSize,
      viewport: createFieldViewport(stageSize, 24, field.geometry),
      field,
      path,
      overlayPaths: [],
      hoveredOverlayPathId: null,
      selectedElementIndex: null,
      selectedRangedConstraint: null,
      positionPreview: new Map(),
      rotationPreview: new Map(),
      selectedPulse: 0.72,
      simulationResult: null,
      simulationTrace: null,
      trajectoryMaxSpeedMps: 1,
      simulationTimeS: 0,
      simulationPlaying: false,
      simulationEventPulse: 0,
      config: project.config,
      curvePreview: null,
    };
    const renderer = await PixiPathRenderer.create(stageSize, field);
    try {
      return [
        { index: 3, position: { x_meters: 8, y_meters: 2 } },
        { index: 5, position: { x_meters: 12.5, y_meters: 3 } },
      ].map(({ index, position }) => {
        const selected = { ...input, selectedElementIndex: index };
        renderer.update(selected);
        const before = renderer.canvas.toDataURL();
        renderer.update({
          ...selected,
          positionPreview: new Map([[index, position]]),
        });
        const preview = renderer.canvas.toDataURL();

        const committedPath = structuredClone(path);
        const anchor = committedPath.path_elements[index];
        if (anchor.type === "waypoint") {
          Object.assign(anchor.translation_target, position);
        } else if (anchor.type === "translation") {
          Object.assign(anchor, position);
        } else {
          throw new Error("Expected an anchor beside the sample event trigger");
        }
        renderer.update({ ...selected, path: committedPath });
        return {
          index,
          changed: preview !== before,
          matchesCommitted: preview === renderer.canvas.toDataURL(),
        };
      });
    } finally {
      renderer.destroy();
    }
  });
  for (const result of results) {
    expect(result.changed, `anchor ${result.index} moves`).toBe(true);
    expect(
      result.matchesCommitted,
      `event orientation before releasing anchor ${result.index}`,
    ).toBe(true);
  }
});

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

test("Open Edge body pixels fit bumper dimensions and only selection ink pulses @webkit-canvas", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const rendererPath = "/src/canvas/pixi/PixiPathRenderer.ts";
    const fieldPath = "/src/core/field/fieldConfig.ts";
    const geometryPath = "/src/canvas/geometry.ts";
    const modelPath = "/src/core/model/path.ts";
    const samplePath = "/src/ui/app/initialProject.ts";
    const { PixiPathRenderer } = (await import(
      /* @vite-ignore */ rendererPath
    )) as typeof import("../../src/canvas/pixi/PixiPathRenderer");
    const { resolveUserFieldDefinition } = (await import(
      /* @vite-ignore */ fieldPath
    )) as typeof import("../../src/core/field/fieldConfig");
    const { createFieldViewport, modelToStagePoint } = (await import(
      /* @vite-ignore */ geometryPath
    )) as typeof import("../../src/canvas/geometry");
    const {
      createPathModel,
      createWaypoint,
      createTranslationTarget,
      createRotationTarget,
      createEventTrigger,
    } = (await import(
      /* @vite-ignore */ modelPath
    )) as typeof import("../../src/core/model/path");
    const { createSampleProject } = (await import(
      /* @vite-ignore */ samplePath
    )) as typeof import("../../src/ui/app/initialProject");
    const config = createSampleProject().config;
    config.gui.robot.length_meters = 1.6;
    config.gui.robot.width_meters = 0.8;
    config.gui.protrusions.enabled = false;
    const field = resolveUserFieldDefinition("blank-grid", []);
    const stageSize = { width: 600, height: 360 };
    const viewport = {
      ...createFieldViewport(stageSize, 24, field.geometry),
      scale: 50,
    };
    const position = { x_meters: 6, y_meters: 4 };
    const originalCenter = modelToStagePoint(position, viewport);
    viewport.x += 300 - originalCenter.x;
    viewport.y += 180 - originalCenter.y;
    const input: PixiRenderInput = {
      stageSize,
      viewport,
      field,
      config,
      path: null,
      overlayPaths: [],
      hoveredOverlayPathId: null,
      selectedElementIndex: null,
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
      curvePreview: null,
    };
    const translation = (x = 6) =>
      createTranslationTarget({ ...position, x_meters: x });
    const anchors = [translation(3), translation(9)];
    const cases = [
      {
        name: "waypoint",
        index: 0,
        path: createPathModel({
          path_elements: [
            createWaypoint({ translation_target: translation() }),
          ],
        }),
        baselinePath: null,
      },
      {
        name: "rotation",
        index: 1,
        path: createPathModel({
          path_elements: [
            anchors[0],
            createRotationTarget({ t_ratio: 0.5 }),
            anchors[1],
          ],
        }),
        baselinePath: createPathModel({ path_elements: anchors }),
      },
      { name: "simulation", index: null, path: null, baselinePath: null },
    ];
    const renderer = await PixiPathRenderer.create(stageSize, field);
    const capture = document.createElement("canvas");
    capture.width = stageSize.width;
    capture.height = stageSize.height;
    const context = capture.getContext("2d", { willReadFrequently: true })!;
    const pixels = (scene: PixiRenderInput) => {
      renderer.update(scene);
      context.clearRect(0, 0, capture.width, capture.height);
      context.drawImage(renderer.canvas, 0, 0, capture.width, capture.height);
      return context.getImageData(0, 0, capture.width, capture.height).data;
    };
    const changed = (
      a: Uint8ClampedArray,
      b: Uint8ClampedArray,
      x: number,
      y: number,
    ) => {
      const offset = ((180 + y) * capture.width + 300 + x) * 4;
      return [0, 1, 2].some(
        (channel) => Math.abs(a[offset + channel] - b[offset + channel]) > 4,
      );
    };
    try {
      const colorSamples = [
        { ...cases[0], rgb: [255, 159, 67], point: [0, -18], ring: [0, -26] },
        { ...cases[1], rgb: [107, 220, 139], point: [0, -18], ring: [0, -26] },
        {
          name: "translation",
          index: 0,
          path: createPathModel({ path_elements: [translation()] }),
          rgb: [88, 166, 255],
          point: [3, 0],
          ring: [0, -13],
        },
        {
          name: "event",
          index: 1,
          path: createPathModel({
            path_elements: [
              anchors[0],
              createEventTrigger({ t_ratio: 0.5 }),
              anchors[1],
            ],
          }),
          rgb: [167, 139, 250],
          point: [0, 0],
          ring: [-5, 0],
        },
      ].map(({ name, index, path, rgb, point, ring }) => {
        const normal = pixels({ ...input, path });
        const selected = pixels({
          ...input,
          path,
          selectedElementIndex: index,
        });
        const hidden = pixels({
          ...input,
          path,
          selectedElementIndex: index,
          hideSelectionOutline: true,
        });
        const at = ([x, y]: number[]) =>
          ((180 + y) * capture.width + 300 + x) * 4;
        return {
          name,
          colorError: Math.max(
            ...rgb.map((value, channel) =>
              Math.abs(normal[at(point) + channel] - value),
            ),
          ),
          visibleDifference: Math.max(
            ...[0, 1, 2].map((channel) =>
              Math.abs(
                selected[at(ring) + channel] - normal[at(ring) + channel],
              ),
            ),
          ),
          hiddenDifference: Math.max(
            ...[0, 1, 2].map((channel) =>
              Math.abs(hidden[at(ring) + channel] - normal[at(ring) + channel]),
            ),
          ),
        };
      });
      const smallMarkers = [20, 40].flatMap((scale) => {
        const smallViewport = { ...viewport, scale };
        const center = modelToStagePoint(position, smallViewport);
        smallViewport.x += 300 - center.x;
        smallViewport.y += 180 - center.y;
        const background = pixels({
          ...input,
          path: null,
          viewport: smallViewport,
        });
        return ["translation", "event"].map((name) => {
          const path = createPathModel({
            path_elements:
              name === "translation"
                ? [translation()]
                : [
                    anchors[0],
                    createEventTrigger({ t_ratio: 0.5 }),
                    anchors[1],
                  ],
          });
          const image = pixels({ ...input, path, viewport: smallViewport });
          const xs: number[] = [],
            ys: number[] = [];
          for (let y = -24; y <= 24; y++)
            for (let x = -24; x <= 24; x++) {
              const offset = ((180 + y) * capture.width + 300 + x) * 4;
              const [r, g, b] = image.slice(offset, offset + 3);
              if (
                ![0, 1, 2].some(
                  (channel) =>
                    Math.abs(
                      image[offset + channel] - background[offset + channel],
                    ) > 4,
                )
              )
                continue;
              if (
                name === "translation"
                  ? b > r * 1.4 && b > g * 1.1
                  : b > r * 1.2 && r > g * 1.1
              ) {
                xs.push(x);
                ys.push(y);
              }
            }
          return {
            name,
            scale,
            pixels: xs.length,
            extent: Math.max(
              Math.max(...xs) - Math.min(...xs) + 1,
              Math.max(...ys) - Math.min(...ys) + 1,
            ),
          };
        });
      });
      const bodies = cases.map(({ name, index, path, baselinePath }) => {
        const scene = { ...input, path };
        if (name === "simulation") {
          scene.simulationPlaying = true;
          scene.simulationResult = {
            poses_by_time: new Map([[0, [6, 4, 0] as const]]),
            times_sorted: [0],
            total_time_s: 1,
            global_s_by_time: new Map(),
            protrusion_visible_by_time: new Map(),
            trail_points: [],
          };
        }
        const baseline = pixels({ ...input, path: baselinePath });
        const normal = pixels(scene);
        let simulationOverlaysWaypoint = true;
        let simulationFillError = 0;
        let simulationCornerClear = true;
        let simulationOutlineError = 0;
        if (name === "simulation") {
          simulationCornerClear = !changed(baseline, normal, 39, 19);
          const outlineOffset = ((180 - 18) * capture.width + 300) * 4;
          simulationOutlineError = Math.max(
            ...[98, 215, 255].map((channel, i) =>
              Math.abs(normal[outlineOffset + i] - channel),
            ),
          );
          const offset = ((180 - 10) * capture.width + 300 - 15) * 4;
          const dark = [5, 8, 11],
            accent = [98, 199, 255];
          simulationFillError = Math.max(
            ...accent.map((channel, i) => {
              const expected =
                (baseline[offset + i] * 0.7 + dark[i] * 0.3) * 0.87 +
                channel * 0.13;
              return Math.abs(normal[offset + i] - expected);
            }),
          );
          const overWaypoint = pixels({ ...scene, path: cases[0].path });
          const centerOffset = (180 * capture.width + 300) * 4;
          // An opaque orange waypoint center must not hide the blue robot above it.
          simulationOverlaysWaypoint =
            overWaypoint[centerOffset + 2] > overWaypoint[centerOffset];
        }
        const points: Array<{ x: number; y: number }> = [];
        for (let y = -30; y < 30; y++)
          for (let x = -50; x < 55; x++) {
            // The heading dot is deliberately outside the physical body bounds.
            if (x > 30 && Math.abs(y + 0.5) < 12) continue;
            if (changed(baseline, normal, x, y)) points.push({ x, y });
          }
        const low = pixels({
          ...scene,
          selectedElementIndex: index,
          selectedPulse: 0,
        });
        const high = pixels({
          ...scene,
          selectedElementIndex: index,
          selectedPulse: 1,
        });
        let bodyChanges = 0,
          outlineChanges = 0;
        for (let y = -35; y < 35; y++)
          for (let x = -55; x < 55; x++) {
            if (!changed(low, high, x, y)) continue;
            if (x >= -40 && x < 40 && y >= -20 && y < 20) bodyChanges++;
            else outlineChanges++;
          }
        return {
          name,
          minX: Math.min(...points.map((p) => p.x)),
          maxX: Math.max(...points.map((p) => p.x)),
          minY: Math.min(...points.map((p) => p.y)),
          maxY: Math.max(...points.map((p) => p.y)),
          bodyChanges,
          outlineChanges,
          simulationOverlaysWaypoint,
          simulationFillError,
          simulationCornerClear,
          simulationOutlineError,
        };
      });
      const scene = {
        ...input,
        path: createPathModel({ path_elements: [translation()] }),
        selectedElementIndex: 0,
      };
      const low = pixels(scene),
        high = pixels({ ...scene, selectedPulse: 1 });
      const radii: number[] = [];
      for (let y = -30; y < 30; y++)
        for (let x = -30; x < 30; x++) {
          if (changed(low, high, x, y))
            radii.push(Math.hypot(x + 0.5, y + 0.5));
        }
      // Compare a small canvas with a crop of the full rendered scene. The
      // reference keeps each element's center onscreen; the crop crosses it.
      const clippedSize = { width: 100, height: 100 };
      const clipped = await PixiPathRenderer.create(clippedSize, field);
      const crop = document.createElement("canvas");
      crop.width = crop.height = 100;
      const cropContext = crop.getContext("2d", { willReadFrequently: true })!;
      const edgeSamples: Array<{ name: string; differences: number }> = [];
      const clippingCases = [
        ...cases.filter((candidate) => candidate.name !== "simulation"),
        { name: "protrusion", path: cases[0].path, index: 0 },
        {
          name: "rotated waypoint",
          path: createPathModel({
            path_elements: [
              createWaypoint({
                translation_target: translation(),
                rotation_target: createRotationTarget({
                  rotation_radians: Math.PI / 6,
                }),
              }),
            ],
          }),
          index: 0,
        },
        { name: "translation", path: scene.path, index: 0 },
        {
          name: "event",
          path: createPathModel({
            path_elements: [
              anchors[0],
              createEventTrigger({ t_ratio: 0.5 }),
              anchors[1],
            ],
          }),
          index: 1,
        },
        {
          name: "handoff ring",
          path: createPathModel({
            path_elements: [
              anchors[0],
              createWaypoint({
                translation_target: createTranslationTarget({
                  ...position,
                  intermediate_handoff_radius_meters: 1.5,
                }),
              }),
              anchors[1],
            ],
          }),
          index: 1,
        },
      ];
      try {
        for (const candidate of clippingCases) {
          const fullScene: PixiRenderInput = {
            ...input,
            path: candidate.path,
            selectedElementIndex: candidate.index,
            config:
              candidate.name === "protrusion"
                ? {
                    ...config,
                    gui: {
                      ...config.gui,
                      protrusions: {
                        ...config.gui.protrusions,
                        enabled: true,
                        default_state: "shown",
                        side: "front",
                        distance_meters: 1,
                      },
                    },
                  }
                : config,
          };
          const reference = pixels(fullScene);
          for (const [edge, x, y] of [
            ["left", -2, 50],
            ["right", 102, 50],
            ["top", 50, -2],
            ["bottom", 50, 102],
            ["far left", -60, 50],
            ["selection corner", -54, 50],
          ] as const) {
            clipped.update({
              ...fullScene,
              stageSize: clippedSize,
              viewport: {
                ...viewport,
                x: viewport.x - 300 + x,
                y: viewport.y - 180 + y,
              },
            });
            cropContext.clearRect(0, 0, 100, 100);
            cropContext.drawImage(clipped.canvas, 0, 0, 100, 100);
            const actual = cropContext.getImageData(0, 0, 100, 100).data;
            let differences = 0;
            for (let cy = 0; cy < 100; cy++)
              for (let cx = 0; cx < 100; cx++) {
                const actualOffset = (cy * 100 + cx) * 4;
                const referenceOffset =
                  ((cy + 180 - y) * 600 + cx + 300 - x) * 4;
                if (
                  [0, 1, 2].some(
                    (channel) =>
                      Math.abs(
                        actual[actualOffset + channel] -
                          reference[referenceOffset + channel],
                      ) > 3,
                  )
                )
                  differences++;
              }
            edgeSamples.push({
              name: `${candidate.name} at ${edge}`,
              differences,
            });
          }
        }
      } finally {
        clipped.destroy();
      }
      const cornerSamples: Array<{
        name: string;
        brightest: number;
        limit: number;
        inkPixels: number;
      }> = [];
      for (const scale of [50, 150, 300])
        for (const heading of [0, Math.PI / 12, Math.PI / 4])
          for (const kind of ["waypoint", "rotation"] as const) {
            const cornerConfig = {
              ...config,
              gui: {
                ...config.gui,
                robot: {
                  ...config.gui.robot,
                  length_meters: 0.8,
                  width_meters: 0.8,
                },
              },
            };
            const cornerViewport = { ...viewport, scale };
            const center = modelToStagePoint(position, cornerViewport);
            cornerViewport.x += 300 - center.x;
            cornerViewport.y += 180 - center.y;
            const rotation = createRotationTarget({
              t_ratio: 0.5,
              rotation_radians: heading,
            });
            const cornerPath = createPathModel({
              path_elements:
                kind === "waypoint"
                  ? [
                      createWaypoint({
                        translation_target: translation(),
                        rotation_target: rotation,
                      }),
                      anchors[1],
                    ]
                  : [anchors[0], rotation, anchors[1]],
            });
            const rendered = pixels({
              ...input,
              viewport: cornerViewport,
              config: cornerConfig,
              path: cornerPath,
              // Dim the footprint so overlapping strokes still reveal a bright wedge.
              selectedElementIndex: kind === "waypoint" ? 1 : 0,
            });
            let brightest = 0,
              inkPixels = 0;
            const half = 0.4 * scale;
            for (let py = 0; py < capture.height; py++)
              for (let px = 0; px < capture.width; px++) {
                const dx = px + 0.5 - 300,
                  dy = py + 0.5 - 180;
                const lx = dx * Math.cos(heading) - dy * Math.sin(heading);
                const ly = dx * Math.sin(heading) + dy * Math.cos(heading);
                if (
                  Math.abs(lx) < half * 0.65 ||
                  Math.abs(ly) < half * 0.65 ||
                  Math.abs(lx) > half ||
                  Math.abs(ly) > half
                )
                  continue;
                const offset = (py * capture.width + px) * 4;
                const [r, g, b] = rendered.slice(offset, offset + 3);
                if (
                  !(kind === "waypoint"
                    ? r > g * 1.2 && g > b * 1.2
                    : g > r * 1.2 && g > b * 1.2)
                )
                  continue;
                inkPixels++;
                brightest = Math.max(brightest, kind === "waypoint" ? r : g);
              }
            // Repeated blending at a self-intersection produces a brighter wedge.
            cornerSamples.push({
              name: `${kind} corner at scale ${scale}, heading ${heading}`,
              brightest,
              // Upper bound over a white background after the black backing and
              // one 58%-opacity accent stroke, allowing two levels for rounding.
              limit: kind === "waypoint" ? 198 : 178,
              inkPixels,
            });
          }
      return {
        colorSamples,
        smallMarkers,
        bodies,
        cornerSamples,
        edgeSamples,
        translation: {
          count: radii.length,
          inner: Math.min(...radii),
          outer: Math.max(...radii),
        },
      };
    } finally {
      renderer.destroy();
    }
  });
  for (const sample of results.colorSamples) {
    expect(sample.colorError, `${sample.name} original color`).toBeLessThan(3);
    expect(
      sample.visibleDifference,
      `${sample.name} selected outline`,
    ).toBeGreaterThan(8);
    expect(
      sample.hiddenDifference,
      `${sample.name} hidden outline`,
    ).toBeLessThan(3);
  }
  for (const marker of results.smallMarkers) {
    expect(
      marker.pixels,
      `${marker.name} remains visible at scale ${marker.scale}`,
    ).toBeGreaterThan(0);
    expect(
      marker.extent,
      `${marker.name} stays smaller than the robot at scale ${marker.scale}`,
    ).toBeLessThan(0.6 * marker.scale * 0.85);
  }
  for (const sample of results.cornerSamples) {
    expect.soft(sample.inkPixels, sample.name).toBeGreaterThan(0);
    expect
      .soft(sample.brightest, sample.name)
      .toBeLessThanOrEqual(sample.limit);
  }
  for (const sample of results.edgeSamples) {
    // Translating rotated strokes can change a few MSAA edge samples on
    // Chromium. Allow 0.32% of this 100×100 crop, not a missing footprint.
    const tolerance = sample.name.startsWith("rotated waypoint") ? 32 : 8;
    expect(sample.differences, sample.name).toBeLessThanOrEqual(tolerance);
  }
  for (const body of results.bodies) {
    expect(body.minX, body.name).toBe(-40);
    expect(body.maxX, body.name).toBe(39);
    expect(body.minY, body.name).toBe(-20);
    expect(body.maxY, body.name).toBe(19);
    expect(body.bodyChanges, `${body.name} remains steady`).toBe(0);
    expect(body.simulationOverlaysWaypoint).toBe(true);
    expect(body.simulationFillError).toBeLessThan(3);
    expect(body.simulationCornerClear).toBe(true);
    expect(body.simulationOutlineError).toBeLessThan(3);
    if (body.name === "simulation") expect(body.outlineChanges).toBe(0);
    else
      expect(
        body.outlineChanges,
        `${body.name} selection pulses`,
      ).toBeGreaterThan(40);
  }
  expect(results.translation.count).toBeGreaterThan(30);
  // A thin circular ring stays at one radius; a rectangle varies by sqrt(2).
  expect(results.translation.outer - results.translation.inner).toBeLessThan(3);
});

test("protrusion attachment corners have continuous bumper ink at high zoom @webkit-canvas", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PixiPathRenderer } = (await import(
      /* @vite-ignore */ "/src/canvas/pixi/PixiPathRenderer.ts" as string
    )) as typeof import("../../src/canvas/pixi/PixiPathRenderer");
    const { resolveUserFieldDefinition } = (await import(
      /* @vite-ignore */ "/src/core/field/fieldConfig.ts" as string
    )) as typeof import("../../src/core/field/fieldConfig");
    const { createFieldViewport, modelToStagePoint } = (await import(
      /* @vite-ignore */ "/src/canvas/geometry.ts" as string
    )) as typeof import("../../src/canvas/geometry");
    const { createProjectConfig } = (await import(
      /* @vite-ignore */ "/src/core/config/projectConfig.ts" as string
    )) as typeof import("../../src/core/config/projectConfig");
    const {
      createPathModel,
      createWaypoint,
      createTranslationTarget,
      createRotationTarget,
    } = (await import(
      /* @vite-ignore */ "/src/core/model/path.ts" as string
    )) as typeof import("../../src/core/model/path");
    const field = resolveUserFieldDefinition("blank-grid", []);
    const stageSize = { width: 1000, height: 1000 };
    const renderer = await PixiPathRenderer.create(stageSize, field);
    const capture = document.createElement("canvas");
    capture.width = capture.height = 1000;
    const context = capture.getContext("2d", { willReadFrequently: true })!;
    const result: Array<{
      side: string;
      scale: number;
      heading: number;
      joint: number;
      dragging: boolean;
      defects: number;
    }> = [];
    let image = "";
    try {
      for (const scale of [100, 500])
        for (const heading of [0, 0.13, 0.7])
          for (const dragging of [false, true])
            for (const side of ["front", "back", "left", "right"] as const) {
              const config = createProjectConfig();
              config.gui.robot = { length_meters: 0.8, width_meters: 1.2 };
              config.gui.protrusions = {
                enabled: true,
                distance_meters: 0.3,
                side,
                default_state: "shown",
                show_on_event_keys: [],
                hide_on_event_keys: [],
              };
              const position = { x_meters: 6, y_meters: 4 };
              const viewport = {
                ...createFieldViewport(stageSize, 24, field.geometry),
                scale,
              };
              const original = modelToStagePoint(position, viewport);
              viewport.x += 500 - original.x;
              viewport.y += 500 - original.y;
              renderer.update({
                stageSize,
                viewport,
                field,
                config,
                path: createPathModel({
                  path_elements: [
                    createWaypoint({
                      translation_target: createTranslationTarget(position),
                      rotation_target: createRotationTarget({
                        rotation_radians: heading,
                      }),
                    }),
                  ],
                }),
                overlayPaths: [],
                hoveredOverlayPathId: null,
                selectedElementIndex: dragging ? 0 : null,
                hideSelectionOutline: dragging,
                selectedRangedConstraint: null,
                positionPreview: dragging
                  ? new Map([
                      [
                        0,
                        {
                          x_meters: position.x_meters + 0.37 / scale,
                          y_meters: position.y_meters - 0.61 / scale,
                        },
                      ],
                    ])
                  : new Map(),
                rotationPreview: new Map(),
                selectedPulse: 0,
                simulationResult: null,
                simulationTrace: null,
                trajectoryMaxSpeedMps: 1,
                simulationTimeS: 0,
                simulationPlaying: false,
                simulationEventPulse: 0,
                curvePreview: null,
              });
              context.fillStyle = "#101518";
              context.fillRect(0, 0, 1000, 1000);
              context.drawImage(renderer.canvas, 0, 0, 1000, 1000);
              if (
                side === "front" &&
                scale === 500 &&
                heading === 0.7 &&
                dragging
              )
                image = capture.toDataURL("image/png");
              const pixels = context.getImageData(0, 0, 1000, 1000).data;
              const stroke = 0.06 * scale,
                halfLength = 0.4 * scale,
                halfWidth = 0.6 * scale;
              for (const joint of [-1, 1]) {
                const inset = (stroke + 1.6) / 2;
                const rootX =
                  side === "front"
                    ? halfLength - inset
                    : side === "back"
                      ? -halfLength + inset
                      : joint * (halfLength - inset);
                const rootY =
                  side === "left"
                    ? -halfWidth + inset
                    : side === "right"
                      ? halfWidth - inset
                      : joint * (halfWidth - inset);
                let defects = 0;
                // Scan the solid interior of the full band crossing the join,
                // leaving two pixels for the outside edge's antialiasing.
                for (let tangent = -stroke; tangent <= stroke; tangent += 0.5)
                  for (
                    let normal = -stroke / 2 + 2;
                    normal <= stroke / 2 - 2;
                    normal += 0.5
                  ) {
                    const x =
                      rootX +
                      (side === "front" || side === "back" ? tangent : normal);
                    const y =
                      rootY +
                      (side === "front" || side === "back" ? normal : tangent);
                    const px = Math.floor(
                      500 +
                        (dragging ? 0.37 : 0) +
                        x * Math.cos(heading) +
                        y * Math.sin(heading),
                    );
                    const py = Math.floor(
                      500 +
                        (dragging ? 0.61 : 0) -
                        x * Math.sin(heading) +
                        y * Math.cos(heading),
                    );
                    const offset = (py * 1000 + px) * 4;
                    const [r, g, blue] = pixels.slice(offset, offset + 3);
                    if (!(r > 230 && g > 135 && g < 185 && blue < 100))
                      defects++;
                  }
                result.push({ side, scale, heading, joint, dragging, defects });
              }
            }
      return { samples: result, image };
    } finally {
      renderer.destroy();
    }
  });
  await testInfo.attach("protrusion-attachment", {
    body: Buffer.from(result.image.split(",")[1], "base64"),
    contentType: "image/png",
  });
  expect(result.samples.filter((sample) => sample.defects > 0)).toEqual([]);
});

import { expect, type Page } from "@playwright/test";
import type {
  PixiCanvasMetrics,
  PixiDebugWindow,
} from "../../../src/canvas/pixi/PixiPathRenderer";

import type { Bounds } from "./app-shell-shared";

interface PointMeters {
  x_meters: number;
  y_meters: number;
}

export async function canvasMetrics(page: Page): Promise<PixiCanvasMetrics> {
  return page.evaluate(() => {
    const metrics = (
      window as PixiDebugWindow
    ).__blinePixiDebug?.canvasMetrics();
    if (!metrics) {
      throw new Error("Expected Pixi canvas metrics");
    }
    return metrics;
  });
}

export async function canvasNodePosition(
  page: Page,
  testId: string,
): Promise<{ x: number; y: number }> {
  let position: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        position = await page.evaluate((nodeTestId) => {
          return (
            (window as PixiDebugWindow).__blinePixiDebug?.nodePosition(
              nodeTestId,
            ) ?? null
          );
        }, testId);
        return position;
      },
      {
        message: `Expected canvas node "${testId}" to exist`,
      },
    )
    .not.toBeNull();

  if (!position) {
    throw new Error(`Expected canvas node "${testId}" to exist`);
  }

  return position;
}

export function canvasNodePositionOrNull(
  page: Page,
  testId: string,
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((nodeTestId) => {
    return (
      (window as PixiDebugWindow).__blinePixiDebug?.nodePosition(nodeTestId) ??
      null
    );
  }, testId);
}

export function pointDistance(
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export async function canvasSceneMetrics(page: Page): Promise<{
  count: number;
  ratios: number[];
  renderer: string;
}> {
  return page.evaluate(() => {
    const ratios = Array.from(
      document.querySelectorAll<HTMLCanvasElement>(".path-stage canvas"),
    ).map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return Number((canvas.width / rect.width).toFixed(2));
    });
    const debugMetrics = (
      window as PixiDebugWindow
    ).__blinePixiDebug?.canvasMetrics();

    return {
      count: ratios.length,
      ratios,
      renderer: debugMetrics?.renderer ?? "",
    };
  });
}

export async function simulationProgress(page: Page): Promise<{
  atEnd: boolean;
  current: number;
  total: number;
}> {
  const text = await page.getByTestId("simulation-time").innerText();
  const values = text.match(/\d+\.\d+/g)?.map(Number) ?? [];
  const [current = 0, total = 0] = values;

  return {
    atEnd: total > 0 && Math.abs(total - current) < 0.011,
    current,
    total,
  };
}

export function modelToCanvasPoint(box: Bounds, point: PointMeters) {
  const fieldLengthMeters = 17.54;
  const fieldWidthMeters = 9.07;
  const fieldCoordinateOffsetMeters = 0.5;
  const padding = Math.min(24, box.width / 12, box.height / 12);
  const availableWidth = Math.max(1, box.width - padding * 2);
  const availableHeight = Math.max(1, box.height - padding * 2);
  const scale = Math.max(
    1,
    Math.min(
      availableWidth / fieldLengthMeters,
      availableHeight / fieldWidthMeters,
    ),
  );
  const viewportWidth = fieldLengthMeters * scale;
  const viewportHeight = fieldWidthMeters * scale;
  const viewportX = box.x + (box.width - viewportWidth) / 2;
  const viewportY = box.y + (box.height - viewportHeight) / 2;

  return {
    x: viewportX + (point.x_meters + fieldCoordinateOffsetMeters) * scale,
    y:
      viewportY +
      (fieldWidthMeters - point.y_meters - fieldCoordinateOffsetMeters) * scale,
  };
}

export async function expectPathElementTypes(
  page: Page,
  expectedTypes: readonly string[],
): Promise<void> {
  const rows = page.locator('[data-testid^="path-element-row-"]');
  await expect(rows).toHaveCount(expectedTypes.length);
  for (const [index, type] of expectedTypes.entries()) {
    await expect(rows.nth(index)).toContainText(`${index + 1}. ${type}`);
  }
}

/**
 * Waits until a canvas node holds still, since the view glides to a new
 * framing whenever the inspector, navigator or Settings panel resizes it.
 */
export async function waitForCanvasSettled(
  page: Page,
  testId = "path-element-node-0",
): Promise<void> {
  let previous: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const current = await canvasNodePositionOrNull(page, testId);
        const settled =
          previous !== null &&
          current !== null &&
          Math.abs(current.x - previous.x) < 0.5 &&
          Math.abs(current.y - previous.y) < 0.5;
        previous = current;
        return settled;
      },
      { intervals: [120] },
    )
    .toBe(true);
}

/**
 * Like waitForCanvasSettled, but also works on an empty path: wait until the
 * stage box and zoom hold still for a few frames, so canvas coordinates are
 * not taken mid-transition.
 */
export async function waitForStageSettled(page: Page): Promise<void> {
  await page.getByTestId("path-stage").evaluate(
    (stage) =>
      new Promise<void>((resolve) => {
        let last = "";
        let stableFrames = 0;
        const tick = () => {
          const box = stage.getBoundingClientRect();
          const zoom = document.querySelector(
            '[aria-label="Fit view"]',
          )?.textContent;
          const key = [box.x, box.y, box.width, box.height, zoom].join();
          stableFrames = key === last ? stableFrames + 1 : 0;
          last = key;
          if (stableFrames >= 3) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

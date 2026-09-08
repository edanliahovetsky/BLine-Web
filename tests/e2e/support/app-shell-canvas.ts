import { expect, type Page } from "@playwright/test";

import type { Bounds } from "./app-shell-shared";

interface PointMeters {
  x_meters: number;
  y_meters: number;
}

type PixiDebugWindow = Window & {
  __blinePixiDebug?: {
    canvasMetrics(): {
      canvasHeight: number;
      canvasWidth: number;
      cssHeight: number;
      cssWidth: number;
      ratio: number;
      renderer: string;
      renderCount: number;
    };
    nodePosition(testId: string): { x: number; y: number } | null;
  };
};

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

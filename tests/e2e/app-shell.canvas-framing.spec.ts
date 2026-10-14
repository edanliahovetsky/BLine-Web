import { expect, test, type Page } from "@playwright/test";
import type { PixiDebugWindow } from "../../src/canvas/pixi/PixiPathRenderer";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";

/** Whether every sample path node sits inside the visible stage. */
async function pathNodesInView(page: Page): Promise<boolean> {
  const stage = await requiredBox(page.getByTestId("path-stage"));
  return page.evaluate(
    ({ width, height }) => {
      const debug = (window as PixiDebugWindow).__blinePixiDebug;
      const nodes = [0, 1, 2, 3, 4, 5]
        .map((index) => debug?.nodePosition(`path-element-node-${index}`))
        .filter((node) => node !== undefined && node !== null);
      return (
        nodes.length === 6 &&
        nodes.every(
          (node) =>
            node.x >= 0 && node.x <= width && node.y >= 0 && node.y <= height,
        )
      );
    },
    { width: stage.width, height: stage.height },
  );
}

async function zoomPercent(page: Page): Promise<number> {
  const text = await page.getByRole("button", { name: "Fit view" }).innerText();
  return Number.parseInt(text, 10);
}

test("frames the whole path from the view controls and the F key", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const stage = page.getByTestId("path-stage");
  for (let step = 0; step < 6; step += 1) await stage.press("=");
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(300);
  await expect.poll(() => pathNodesInView(page)).toBe(false);

  await page.getByRole("button", { name: "Fit path" }).click();
  await expect.poll(() => pathNodesInView(page)).toBe(true);
  // The sample path is short, so framing it zooms past the fitted field.
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);

  await stage.press("0");
  await expect.poll(() => zoomPercent(page)).toBe(100);
  await stage.press("f");
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);
  await expect.poll(() => pathNodesInView(page)).toBe(true);
});

test("keeps a framed path in view as the inspector and navigator open and close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Fit path" }).click();
  await expect.poll(() => pathNodesInView(page)).toBe(true);

  const inspector = page.getByRole("button", { name: "Toggle inspector" });
  for (let toggle = 0; toggle < 3; toggle += 1) {
    const before = (await requiredBox(page.getByTestId("path-stage"))).width;
    await inspector.click();
    await expect
      .poll(
        async () => (await requiredBox(page.getByTestId("path-stage"))).width,
      )
      .not.toBe(before);
    await expect.poll(() => pathNodesInView(page)).toBe(true);
    // Zoomed views stay zoomed instead of snapping back to the whole field.
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);
  }

  await page.getByRole("button", { name: "Open project navigator" }).click();
  await expect(page.locator('[data-tour="project-navigator"]')).toBeVisible();
  await expect.poll(() => pathNodesInView(page)).toBe(true);
});

async function requestCanvasView(
  page: Page,
  request: import("../../src/canvas/canvasViewRequests").CanvasViewRequest,
): Promise<void> {
  await page.evaluate(async (viewRequest) => {
    // The dev server shares the editor's module instance.
    const modulePath = "/src/canvas/canvasViewRequests.ts";
    const { requestCanvasView } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import("../../src/canvas/canvasViewRequests");
    requestCanvasView(viewRequest);
  }, request);
}

test("lets other editor surfaces request path framing", async ({ page }) => {
  await gotoSampleEditor(page);
  await page.getByTestId("path-stage").press("0");
  await expect.poll(() => zoomPercent(page)).toBe(100);

  await requestCanvasView(page, { kind: "frame-path" });
  await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);
  await expect.poll(() => pathNodesInView(page)).toBe(true);

  await requestCanvasView(page, { kind: "fit-field" });
  await expect.poll(() => zoomPercent(page)).toBe(100);
});

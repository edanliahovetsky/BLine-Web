import { expect, test, type Page } from "@playwright/test";
import type { PixiDebugWindow } from "../../src/canvas/pixi/PixiPathRenderer";
import { canvasNodePosition, pointDistance } from "./support/app-shell-canvas";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";
import { runEditMenuAction } from "./support/app-shell-commands";

async function trace(page: Page) {
  return page.evaluate(
    () => (window as PixiDebugWindow).__blinePixiDebug?.simulationTrace() ?? [],
  );
}
async function revision(page: Page) {
  return page.evaluate(async () => {
    const { projectStore }: typeof import("../../src/state/projectStore") =
      await import(/* @vite-ignore */ "/src/state/projectStore.ts" as string);
    return projectStore.getState().revision;
  });
}

test("follows continuous pointer movement even when the preview worker never answers @webkit-canvas", async ({
  page,
}) => {
  // A deliberately unavailable refinement must not throttle visual drag feedback.
  await page.route(/simulationPreview\.worker/, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "self.onmessage = () => {};",
    }),
  );
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Fast forward simulation" }).click();
  const before = await trace(page);
  const originalRevision = await revision(page);
  const box = await requiredBox(page.getByTestId("path-stage-canvas"));
  const start = await canvasNodePosition(page, "path-element-node-1");
  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down();
  const shapes = new Set<string>();
  for (let step = 1; step <= 24; step++) {
    await page.mouse.move(
      box.x + start.x + step * 2,
      box.y + start.y - step * 2,
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    shapes.add(JSON.stringify(await trace(page)));
  }
  expect(shapes.size).toBeGreaterThanOrEqual(22);
  expect(shapes.has(JSON.stringify(before))).toBe(false);
  expect(await revision(page)).toBe(originalRevision);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => trace(page)).toEqual(before);
});

test("updates the blue trace during repeated drags without committing, then matches the final path @webkit-canvas", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.getByTestId("path-element-row-1").click();
  await page.getByRole("button", { name: "Fast forward simulation" }).click();
  const before = await trace(page);
  const originalRevision = await revision(page);
  const beforeX = await page.getByLabel("X (m)").inputValue();
  const box = await requiredBox(page.getByTestId("path-stage-canvas"));
  const start = await canvasNodePosition(page, "path-element-node-1");
  for (const [dx, dy] of [
    [-65, -40],
    [40, 25],
    [-30, -50],
  ]) {
    await page.mouse.move(box.x + start.x, box.y + start.y);
    await page.mouse.down();
    await page.mouse.move(box.x + start.x + dx, box.y + start.y + dy, {
      steps: 12,
    });
    await expect
      .poll(async () => JSON.stringify(await trace(page)))
      .not.toBe(JSON.stringify(before));
    await expect(page.getByLabel("X (m)")).toHaveValue(beforeX);
    expect(await revision(page)).toBe(originalRevision);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect
      .poll(async () => JSON.stringify(await trace(page)))
      .toBe(JSON.stringify(before));
    await expect
      .poll(async () =>
        pointDistance(
          start,
          await canvasNodePosition(page, "path-element-node-1"),
        ),
      )
      .toBeLessThan(0.5);
  }
  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down();
  for (const [dx, dy] of [
    [15, -35],
    [50, 20],
    [-55, -45],
    [60, -55],
  ]) {
    await page.mouse.move(box.x + start.x + dx, box.y + start.y + dy, {
      steps: 4,
    });
  }
  await expect
    .poll(async () => JSON.stringify(await trace(page)))
    .not.toBe(JSON.stringify(before));
  await page.mouse.up();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  const expected = await page.evaluate(async () => {
    const {
      projectStore,
      activePathForProjectStore,
    }: typeof import("../../src/state/projectStore") = await import(
      /* @vite-ignore */ "/src/state/projectStore.ts" as string
    );
    const {
      simulatePathWithTrace,
    }: typeof import("../../src/core/sim/simulatePath") = await import(
      /* @vite-ignore */ "/src/core/sim/simulatePath.ts" as string
    );
    const state = projectStore.getState();
    return simulatePathWithTrace(
      activePathForProjectStore(state)!.path,
      state.project!.config,
      { dt_s: 0.02 },
    ).trace;
  });
  await expect.poll(() => trace(page)).toEqual(expected);
  await runEditMenuAction(page, "Undo");
  await expect(page.getByLabel("X (m)")).toHaveValue(beforeX);
  await expect.poll(() => trace(page)).toEqual(before);
});

import { expect, test } from "@playwright/test";
import {
  focusCount,
  port,
  row,
  seedLongLibrary,
  startDrag,
} from "./support/app-shell-path-groups";
import { requiredBox } from "./support/app-shell-shared";
import { softwareRendering } from "./support/software-rendering";

// Kept apart from the Navigator spec so that spec can render on the GPU.
test.use(softwareRendering);

test("keeps the final Navigator row clear of drag feedback @webkit-canvas", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const nav = await seedLongLibrary(page, "path");
  await page.setViewportSize({ width: 1200, height: 600 });
  await nav
    .getByRole("button", { name: "Focus Group 02", exact: true })
    .click();
  const list = nav.locator('.fc-list-scroll[data-kind="path"]');
  if (testInfo.project.name === "chromium") {
    const bounds = await requiredBox(nav);
    await expect(page).toHaveScreenshot("navigator-list-bottom-edge.png", {
      clip: {
        x: bounds.x,
        y: bounds.y + bounds.height - 180,
        width: bounds.width,
        height: 180,
      },
      animations: "disabled",
    });
  }
  await list.hover();
  await page.mouse.wheel(0, 2200);
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(700);
  const last = row(nav, "Path 23");
  const before = await requiredBox(last);
  await startDrag(page, port(nav, "Path 23"), port(nav, "Group 02"));
  await expect(nav.locator(".fc-wire-preview.is-snapped")).toHaveCount(1);
  const status = await requiredBox(nav.locator(".fc-status"));
  expect(before.y + before.height).toBeLessThan(status.y - 6);
  expect((await requiredBox(last)).y).toBe(before.y);
  if (testInfo.project.name === "chromium") {
    await expect(nav).toHaveScreenshot("navigator-drag-node-outlines.png", {
      animations: "disabled",
    });
  }
  await page.mouse.up();
  await expect(focusCount(nav)).toHaveText("1 Path connected");
});

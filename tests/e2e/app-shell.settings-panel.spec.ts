import { expect, test, type Page } from "@playwright/test";
import { canvasNodePosition, pointDistance } from "./support/app-shell-canvas";
import {
  gotoSampleEditor,
  openProjectSettings,
  requiredBox,
} from "./support/app-shell-shared";

/** Canvas pixels from the first waypoint's center to its front edge. */
async function frontReach(page: Page): Promise<number> {
  const center = await canvasNodePosition(page, "path-element-node-0");
  const front = await canvasNodePosition(page, "path-element-front-0");
  return pointDistance(center, front);
}

test(
  "docks Settings beside the canvas and previews unsaved robot changes",
  { tag: "@smoke" },
  async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoSampleEditor(page);
    const stage = page.getByTestId("path-stage");
    // The inspector is open, so the panel takes its slightly wider place.
    const fullWidth = (await requiredBox(stage)).width;
    const fittedReach = await frontReach(page);

    await openProjectSettings(page);
    const panel = page.getByRole("dialog", { name: "Edit Config" });
    await expect(panel).toHaveAttribute("aria-modal", "false");
    await expect(stage).toBeVisible();
    await expect
      .poll(async () => (await requiredBox(stage)).width)
      .toBeLessThan(fullWidth);
    const panelBox = await requiredBox(panel);
    expect(panelBox.x).toBeGreaterThanOrEqual(
      (await requiredBox(stage)).x + (await requiredBox(stage)).width - 1,
    );
    await expect(
      page.getByRole("button", { name: "Toggle inspector" }),
    ).toBeDisabled();

    // The canvas re-fits for the narrower stage; compare against that scale.
    await expect.poll(() => frontReach(page)).toBeLessThan(fittedReach);
    const dockedReach = await frontReach(page);
    await panel.getByLabel("Robot Length (m)").fill("1.2");
    await panel.getByLabel("Robot Length (m)").press("Tab");
    await expect
      .poll(() => frontReach(page))
      .toBeGreaterThan(dockedReach * 1.3);

    // Cancel drops the preview along with the draft.
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(panel).toHaveCount(0);
    await expect.poll(() => frontReach(page)).toBeCloseTo(fittedReach, 0);

    await openProjectSettings(page);
    await panel.getByLabel("Robot Length (m)").fill("1.2");
    await panel.getByLabel("Robot Length (m)").press("Tab");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel).toHaveCount(0);
    await expect
      .poll(() => frontReach(page))
      .toBeGreaterThan(fittedReach * 1.3);

    await openProjectSettings(page);
    await panel.getByRole("button", { name: "Path Defaults" }).focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Toggle inspector" }),
    ).toBeEnabled();
  },
);

test("overlays Settings on narrow windows without hiding the whole canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 760 });
  await gotoSampleEditor(page);
  await openProjectSettings(page);
  const panel = page.getByRole("dialog", { name: "Edit Config" });
  const panelBox = await requiredBox(panel);
  expect(panelBox.width).toBeLessThanOrEqual(441);
  expect(panelBox.x + panelBox.width).toBeCloseTo(1000, 0);
  await expect(page.getByTestId("path-stage")).toBeVisible();
});

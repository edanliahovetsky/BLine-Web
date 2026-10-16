import { expect, test } from "@playwright/test";
import { simulationProgress } from "./support/app-shell-canvas";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";

test("reads out field coordinates under the pointer", async ({ page }) => {
  await gotoSampleEditor(page);
  const readout = page.getByTestId("pointer-field-position");
  const canvas = page.getByTestId("path-stage-canvas");
  const box = await requiredBox(canvas);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(readout).toBeVisible();
  await expect(readout).toContainText(/X\s*\d+\.\d{2}/);
  await expect(readout).toContainText(/Y\s*\d+\.\d{2}/);

  // The empty margin outside the field shows no coordinates.
  await page.mouse.move(box.x + box.width / 2, box.y + 4);
  await expect(readout).toHaveCount(0);
});

test("runs canvas view and playback actions from the command palette", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("searchbox", {
    name: "Search commands and paths",
  });
  const fit = page.getByRole("button", { name: "Fit view" });

  await page.keyboard.press("F1");
  await search.fill("zoom in");
  await expect(palette.getByRole("option", { name: /^Zoom in/ })).toContainText(
    "+",
  );
  await page.keyboard.press("Enter");
  await expect(fit).toContainText("125%");

  await page.keyboard.press("F1");
  await search.fill("fit field");
  await page.keyboard.press("Enter");
  await expect(fit).toContainText("100%");

  await page.keyboard.press("F1");
  await search.fill("jump to end");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await simulationProgress(page)).atEnd)
    .toBe(true);
});

test("closes the shortcut reference with Escape after opening it from the canvas", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.getByTestId("path-stage").focus();
  await page.keyboard.press("?");

  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Fit field to view");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("path-stage")).toBeFocused();
});

test("zooms a useful step per mouse-wheel notch", async ({ page }) => {
  await gotoSampleEditor(page);
  const canvas = page.getByTestId("path-stage-canvas");
  const box = await requiredBox(canvas);
  const fit = page.getByRole("button", { name: "Fit view" });

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -100);
  await expect(fit).toContainText("110%");
  await page.mouse.wheel(0, -100);
  await expect(fit).toContainText("121%");
  await page.mouse.wheel(0, 200);
  await expect(fit).toContainText("110%");
});

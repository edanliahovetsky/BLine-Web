import { expect, test } from "@playwright/test";
import { simulationProgress } from "./support/app-shell-canvas";
import {
  gotoSampleEditor,
  requiredBox,
  waitForEditorReady,
} from "./support/app-shell-shared";

test("shows the motion profile, scrubs from it, and remembers the choice", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const toggle = page.getByRole("button", { name: "Show motion profile" });
  await expect(page.getByTestId("motion-profile")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("path-stage").focus();
  await page.keyboard.press("p");
  const profile = page.getByTestId("motion-profile");
  await expect(profile).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hide motion profile" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(profile).toContainText(/Speed\s*peak \d+\.\d{2} m\/s/);
  await expect(page.getByTestId("motion-profile-event")).toHaveCount(1);
  await expect(page.getByTestId("motion-profile-limit")).toHaveCount(1);

  const plot = page.getByTestId("motion-profile-plot");
  const box = await requiredBox(plot);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect
    .poll(async () => {
      const { current, total } = await simulationProgress(page);
      return Math.abs(current - total / 2);
    })
    .toBeLessThan(0.05);
  await expect(page.getByTestId("motion-profile-readout")).toContainText("m/s");

  // Dragging continues to scrub the same preview.
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const { current, total } = await simulationProgress(page);
      return current / total;
    })
    .toBeGreaterThan(0.85);

  await page.reload();
  await waitForEditorReady(page);
  await expect(page.getByTestId("motion-profile")).toBeVisible();
  await page.getByRole("button", { name: "Hide motion profile" }).click();
  await expect(page.getByTestId("motion-profile")).toHaveCount(0);
});

test("shows path duration, event timing, and playback speed in the transport", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  const { total } = await simulationProgress(page);
  expect(total).toBeGreaterThan(0);
  await expect(page.getByTestId("simulation-elapsed")).toHaveText(
    `0.00/ ${total.toFixed(2)}s`,
  );
  await expect(page.getByTestId("timeline-event-marker")).toHaveCount(1);

  const rate = page.getByTestId("playback-rate");
  await expect(rate).toHaveText("1×");
  await rate.click();
  await expect(rate).toHaveText("2×");
  await rate.click();
  await expect(rate).toHaveText("¼×");
  await rate.click({ modifiers: ["Shift"] });
  await expect(rate).toHaveText("2×");

  // At 2× the preview reaches its end in about half its real duration.
  await page.getByRole("button", { name: "Play simulation" }).click();
  await expect
    .poll(async () => (await simulationProgress(page)).atEnd, {
      timeout: Math.max(5_000, total * 1000),
    })
    .toBe(true);
});

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

  // Named speed commands stop at the fastest rate instead of wrapping.
  for (let step = 0; step < 2; step += 1) {
    await page.keyboard.press("F1");
    await search.fill("increase playback");
    await page.keyboard.press("Enter");
  }
  await expect(page.getByTestId("playback-rate")).toHaveText("2×");

  await page.keyboard.press("F1");
  await search.fill("motion profile");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("motion-profile")).toBeVisible();
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
  await expect(dialog).toContainText("Show motion profile");
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

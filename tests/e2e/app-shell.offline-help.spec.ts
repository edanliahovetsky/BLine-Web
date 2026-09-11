import { expect, test } from "@playwright/test";
import { gotoSampleEditor } from "./support/app-shell-shared";

test("completes the offline lesson through Guided tours and remembers completion @webkit-canvas", async ({
  page,
}) => {
  await page.goto("/");
  const home = page.getByTestId("start-center");
  await expect(home.getByRole("button", { name: /offline/i })).toHaveCount(0);
  await home.getByTestId("start-center-guided-tour").click();
  const picker = page.getByTestId("tour-picker");
  const lesson = picker.getByTestId("tour-picker-use-bline-offline");
  await expect(lesson).toContainText("How to use BLine offline");
  await expect(lesson).toContainText("1 step");
  await lesson.click();

  const card = page.getByTestId("tour-card");
  await expect(card).toContainText("same browser on this device");
  await expect(card).toContainText("No installation needed");
  await expect(card).toBeFocused();
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 1 of 1");
  await card.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(home).toBeVisible();
  await expect(page.getByTestId("path-stage")).toHaveCount(0);

  await page.reload();
  await home.getByTestId("start-center-guided-tour").click();
  await expect(lesson).toHaveClass("is-done");
  // The normal development server must remain free of offline caches.
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker
        .getRegistrations()
        .then((entries) => entries.length),
    ),
  ).toBe(0);
});

test("opens the offline lesson through editor tours and restores the project @webkit-canvas", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.getByTestId("path-element-row-0").click();
  const name = await page.getByTestId("current-project-status").innerText();
  const pathName = await page.getByTestId("current-path-status").innerText();
  const elements = page.locator('[data-testid^="path-element-row-"]');
  const count = await elements.count();
  const x = await page.getByLabel("X (m)", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  const help = page.getByTestId("help-hub");
  await expect(help.getByRole("button", { name: /offline/i })).toHaveCount(0);
  await help.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-use-bline-offline").click();
  const card = page.getByTestId("tour-card");
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(elements).toHaveCount(count);
  await expect(page.getByTestId("current-project-status")).toHaveText(name);
  await expect(page.getByTestId("current-path-status")).toHaveText(pathName);
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue(x);
});

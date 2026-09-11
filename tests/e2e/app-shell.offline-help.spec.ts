import { expect, test } from "@playwright/test";
import { gotoSampleEditor } from "./support/app-shell-shared";

test("explains offline use from Learn without starting a lesson @webkit-canvas", async ({
  page,
}) => {
  await page.goto("/");
  const home = page.getByTestId("start-center");
  const entry = home.getByRole("button", { name: "Using BLine offline" });
  const dialog = page.getByRole("dialog", { name: "Using BLine offline" });
  await expect(entry).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await entry.click();
  await expect(dialog).toContainText("same browser on this device");
  await expect(dialog).toContainText("No installation needed");
  const done = dialog.getByRole("button", { name: "Got it" });
  await expect(done).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(done).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(done).toBeFocused();
  await done.click();
  await expect(entry).toBeFocused();
  await expect(home).toBeVisible();
  await expect(page.getByTestId("path-stage")).toHaveCount(0);
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
  // The normal development server must remain free of offline caches.
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker
        .getRegistrations()
        .then((entries) => entries.length),
    ),
  ).toBe(0);
});

test("opens offline help from the editor without changing the project @webkit-canvas", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.getByTestId("path-element-row-0").click();
  const name = await page.getByTestId("current-project-status").innerText();
  const elements = page.locator('[data-testid^="path-element-row-"]');
  const count = await elements.count();
  const x = await page.getByLabel("X (m)", { exact: true }).inputValue();
  const help = page.getByRole("button", { name: "Help and tutorials" });
  await help.click();
  await page.getByRole("button", { name: "Using BLine offline" }).click();
  const dialog = page.getByRole("dialog", { name: "Using BLine offline" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Delete");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(elements).toHaveCount(count);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(help).toBeFocused();
  await expect(page.getByTestId("current-project-status")).toHaveText(name);
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue(x);
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
});

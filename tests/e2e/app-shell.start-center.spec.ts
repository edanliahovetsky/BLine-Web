import { expect, test } from "@playwright/test";
import {
  dismissMobileSupportWarning,
  requiredBox,
} from "./support/app-shell-shared";

test("groups imports in a keyboard-accessible start-center disclosure", async ({
  page,
}) => {
  await page.goto("/");
  const start = page.getByTestId("start-center");
  const trigger = start.getByRole("button", { name: "Import", exact: true });
  const options = start.getByRole("group", { name: "Import options" });
  await expect(trigger).toBeEnabled();
  await expect(options).toBeHidden();

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(options).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    options.getByRole("button", { name: "Import autos folder" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await start.getByRole("heading", { name: "BLine Web" }).click();
  await expect(options).toBeHidden();

  await trigger.click();
  const chooserPromise = page.waitForEvent("filechooser");
  await options.getByRole("button", { name: "Import project archive" }).click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(false);
  await expect(options).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("keeps start actions and imports usable in a narrow window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await dismissMobileSupportWarning(page);
  const start = page.getByTestId("start-center");
  await expect(
    start.getByRole("button", { name: "Open project", exact: true }),
  ).toBeVisible();
  await expect(
    start.getByRole("button", { name: "Sample path", exact: true }),
  ).toBeVisible();
  await expect(
    start.getByRole("button", { name: "Guided lessons", exact: true }),
  ).toBeDisabled();

  await start.getByRole("button", { name: "Import", exact: true }).click();
  const options = start.getByRole("group", { name: "Import options" });
  await expect(options).toBeVisible();
  const bounds = await requiredBox(options);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(
    await start.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});

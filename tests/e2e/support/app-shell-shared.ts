import { expect, type Locator, type Page } from "@playwright/test";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function gotoSampleEditor(page: Page): Promise<void> {
  await page.goto("/");

  const pathStage = page.getByTestId("path-stage");
  const mobileWarning = page.getByRole("dialog", {
    name: "Mobile support warning",
  });
  // Home renders while persistence initializes. On reload it may disappear
  // when the saved project opens, so only click Sample after Home is ready.
  const readyHome = page
    .getByTestId("start-center")
    .and(page.locator('[aria-busy="false"]'));
  const initializationError = page.getByRole("alert");
  await expect(
    pathStage.or(mobileWarning).or(readyHome).or(initializationError).first(),
  ).toBeVisible();

  if (await mobileWarning.isVisible()) {
    await mobileWarning.getByRole("button", { name: "Continue" }).click();
    await expect(
      pathStage.or(readyHome).or(initializationError).first(),
    ).toBeVisible();
  }

  if (await initializationError.isVisible()) {
    throw new Error(
      `BLine initialization failed: ${await initializationError.innerText()}`,
    );
  }
  if (await readyHome.isVisible()) {
    await page.getByRole("button", { name: "Sample path" }).click();
  }

  await expect(pathStage).toBeVisible();
  await waitForEditorReady(page);
}

export async function requiredBox(locator: Locator): Promise<Bounds> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected locator to have a bounding box");
  }

  return box;
}

export async function dismissMobileSupportWarning(page: Page): Promise<void> {
  const warning = page.getByRole("dialog", { name: "Mobile support warning" });
  if (await warning.isVisible()) {
    await warning.getByRole("button", { name: "Continue" }).click();
    await expect(warning).toHaveCount(0);
  }
}

export async function openProjectSettings(page: Page): Promise<void> {
  await waitForEditorReady(page);
  const file = page.getByRole("button", { name: "File", exact: true });
  if ((await file.getAttribute("aria-expanded")) !== "true") {
    await file.click();
  }
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit Config" })).toBeVisible();
}

// The canvas can paint during persisted-project restoration. Wait until that
// transition finishes before selecting a row or opening a menu after reload.
export async function waitForEditorReady(page: Page): Promise<void> {
  const status = page.getByTestId("save-status");
  await expect(status).toBeVisible();
  await expect(status).not.toContainText("Loading");
}

/** Select a visible option in the shared portaled dropdown. */
export async function selectDropdownOption(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page
    .getByRole("listbox", { name: `${label} options`, exact: true })
    .getByRole("option", { name: option, exact: true })
    .click();
}

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
  const startHeading = page.getByRole("heading", {
    name: "Simple, rapid, robust.",
  });
  const initializationError = page.getByRole("alert");
  await expect(
    pathStage
      .or(mobileWarning)
      .or(startHeading)
      .or(initializationError)
      .first(),
  ).toBeVisible();

  if (await mobileWarning.isVisible()) {
    await mobileWarning.getByRole("button", { name: "Continue" }).click();
    await expect(
      pathStage.or(startHeading).or(initializationError).first(),
    ).toBeVisible();
  }

  if (await initializationError.isVisible()) {
    throw new Error(
      `BLine initialization failed: ${await initializationError.innerText()}`,
    );
  }
  if (await startHeading.isVisible()) {
    await page.getByRole("button", { name: "Open sample" }).click();
  }

  await expect(pathStage).toBeVisible();
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

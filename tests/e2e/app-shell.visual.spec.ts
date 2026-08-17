import { expect, test, type Page } from "@playwright/test";

test.describe("app shell visual baselines", () => {
  test.use({
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1440, height: 900 },
  });

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime("2026-08-13T12:00:00-04:00");
  });

  test("start center", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Simple, rapid, robust." }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open sample" }),
    ).toBeVisible();

    await expectVisualSnapshot(page, "start-center.png");
  });

  test("editor elements", async ({ page }) => {
    await gotoSampleEditor(page);

    await expect(
      page.getByRole("complementary", { name: "Path inspector" }),
    ).toBeVisible();
    await expect(page.getByText("Path Elements")).toBeVisible();

    await expectVisualSnapshot(page, "editor-elements.png");
  });

  test("editor constraints", async ({ page }) => {
    await gotoSampleEditor(page);
    await page.getByRole("tab", { name: "Constraints", exact: true }).click();

    await expect(
      page.getByRole("article", { name: "Path constraints" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add constraint" }),
    ).toBeVisible();

    await expectVisualSnapshot(page, "editor-constraints.png");
  });

  test("project navigator", async ({ page }) => {
    await gotoSampleEditor(page);
    await page
      .getByRole("button", { name: "Open project navigator", exact: true })
      .click();

    await expect(
      page.getByRole("dialog", { name: "Project Navigator" }),
    ).toBeVisible();

    await expectVisualSnapshot(page, "project-navigator.png");
  });

  test("compact inspector at drawer breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 1121, height: 800 });
    await gotoSampleEditor(page);

    const inspector = page.getByRole("complementary", {
      name: "Path inspector",
    });
    await expect(inspector).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close inspector" }),
    ).toBeHidden();

    await page.setViewportSize({ width: 1120, height: 800 });

    await expect(inspector).toHaveClass(/is-open/);
    await expect(
      page.getByRole("button", { name: "Close inspector" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Dismiss inspector" }),
    ).toBeVisible();

    await expectVisualSnapshot(page, "compact-inspector.png");
  });
});

async function gotoSampleEditor(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Open sample" }).click();

  await expect(page.getByTestId("path-stage")).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
}

async function expectVisualSnapshot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await page.addStyleTag({
    content:
      '[data-testid="path-stage-canvas"] canvas { visibility: hidden !important; }',
  });

  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
  });
}

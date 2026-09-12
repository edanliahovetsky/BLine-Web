import { expect, test, type Page } from "@playwright/test";
import { gotoSampleEditor } from "./support/app-shell-shared";

test.describe("shared theme across dialogs and nested controls", () => {
  test.use({
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1440, height: 900 },
  });

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime("2026-08-13T12:00:00-04:00");
    await gotoSampleEditor(page);
    await expect(page.getByTestId("save-status")).toContainText("Saved");
  });

  for (const section of ["Robot", "Path Defaults", "Field", "Generator"]) {
    test(`Settings — ${section}`, async ({ page }) => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit Config" });
      await dialog.getByRole("button", { name: section, exact: true }).click();
      await expect(
        dialog.getByRole("heading", { name: section, exact: true }),
      ).toBeVisible();
      if (section === "Robot") {
        await dialog.getByLabel("Robot Length (m)").focus();
        await expect(
          dialog.getByLabel("Protrusion Distance (m)"),
        ).toBeDisabled();
      }
      await snapshot(
        page,
        `settings-${section.toLowerCase().replaceAll(" ", "-")}.png`,
      );
    });
  }

  test("File submenu and keyboard focus", async ({ page }) => {
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Import / Export", exact: true })
      .click();
    const submenu = page.getByTestId("top-menu-project-transfer");
    await expect(submenu).toBeVisible();
    await submenu.getByRole("menuitem").first().focus();
    await page.keyboard.press("Tab");
    await snapshot(page, "file-submenu-focus.png");
  });

  test("Path submenu hover", async ({ page }) => {
    await page.getByRole("button", { name: "Path", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Manage Paths", exact: true })
      .click();
    const submenu = page.getByTestId("top-menu-path-manage");
    await expect(submenu).toBeVisible();
    await submenu
      .getByRole("menuitem", { name: "New Path", exact: true })
      .hover();
    await snapshot(page, "path-submenu-hover.png");
  });

  test("Help and Lessons", async ({ page }) => {
    await page.getByRole("button", { name: "Help and tutorials" }).click();
    const hub = page.getByTestId("help-hub");
    const lessons = hub.getByRole("button", { name: "Lessons", exact: true });
    await lessons.hover();
    await snapshot(page, "help-hover.png");
    await lessons.click();
    await expect(page.getByTestId("tour-picker")).toBeVisible();
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "Close lessons" }).focus();
    await snapshot(page, "lessons-focus.png");
  });

  test("Linked Elements selection and locked fields", async ({ page }) => {
    await page.getByRole("button", { name: "Path", exact: true }).click();
    await page.getByRole("menuitem", { name: "Linked Elements..." }).click();
    const dialog = page.getByRole("dialog", {
      name: "Linked Elements",
      exact: true,
    });
    await dialog.getByRole("button", { name: "New Translation" }).click();
    await dialog.getByLabel("Linked element name").fill("Pickup");
    await dialog.getByRole("button", { name: "New Waypoint" }).click();
    await dialog.getByLabel("Linked element name").fill("Scoring pose");
    await dialog.getByRole("switch", { name: "Locked", exact: true }).check();
    await expect(dialog.getByLabel("X (m)")).toBeDisabled();
    await dialog.getByRole("listitem").filter({ hasText: "Pickup" }).hover();
    await snapshot(page, "linked-elements-locked.png");
  });

  test("Navigator connections and row actions in a compact window", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 700 });
    await page
      .getByRole("button", { name: "Open project navigator", exact: true })
      .click();
    const nav = page.getByRole("dialog", { name: "Project Navigator" });
    await nav
      .getByRole("button", { name: "Create Path Group", exact: true })
      .click();
    const name = nav.getByRole("textbox", {
      name: "Path Group name",
      exact: true,
    });
    await name.fill("Competition");
    await name.press("Enter");
    await nav
      .getByRole("button", {
        name: "Connect to Phase 1 Canvas Draft",
        exact: true,
      })
      .click();
    await nav
      .getByRole("button", {
        name: "Path Group actions for Competition",
        exact: true,
      })
      .click();
    await nav
      .getByRole("menuitem", { name: "Rename Path Group", exact: true })
      .focus();
    await snapshot(page, "navigator-connections-compact.png");
  });

  test("Compact Settings primary action and focus", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 700 });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit Config" });
    await dialog
      .getByRole("button", { name: "Generator", exact: true })
      .click();
    await dialog.getByLabel("Velocity safety factor").fill("0.85");
    await dialog.getByLabel("Velocity safety factor").press("Tab");
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeEnabled();
    await save.hover();
    await snapshot(page, "settings-compact-primary.png");
  });

  test("Waypoint properties at minimum inspector width", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 550 });
    await page
      .getByRole("separator", { name: "Resize inspector" })
      .press("Home");
    await page.getByTestId("path-element-row-0").click();
    await expect(page.getByLabel("Profiled Rotation")).toBeInViewport();
    await snapshot(page, "waypoint-properties-minimum-width.png");
  });

  test("Inspector nested link menu", async ({ page }) => {
    await page.getByTestId("path-element-row-1").click();
    await page
      .getByRole("button", { name: "Link element", exact: true })
      .click();
    const actions = page.getByRole("group", { name: "Linked element actions" });
    await actions
      .getByRole("button", { name: /New Linked Translation/ })
      .click();
    await actions.getByLabel("Linked element name").fill("Pickup");
    await actions
      .getByRole("button", { name: "Create & Link", exact: true })
      .hover();
    await snapshot(page, "inspector-link-menu.png");
  });
});

async function snapshot(page: Page, name: string) {
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await page.evaluate(async () => document.fonts.ready);
  await page.addStyleTag({
    content:
      '[data-testid="path-stage-canvas"] canvas { visibility: hidden !important; }',
  });
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
  });
}

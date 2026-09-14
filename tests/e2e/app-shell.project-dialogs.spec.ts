import { expect, test } from "@playwright/test";
import {
  dismissMobileSupportWarning,
  requiredBox,
} from "./support/app-shell-shared";

test("centers an empty Open Project dialog and restores keyboard focus @webkit-canvas", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page
    .getByTestId("start-center")
    .getByRole("button", { name: "Open project", exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Open project",
    exact: true,
  });
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByText("No saved projects yet.")).toBeVisible();
  const bounds = await requiredBox(dialog);
  const viewport = page.viewportSize()!;
  expect(
    Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2),
  ).toBeLessThan(1);
  expect(
    Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2),
  ).toBeLessThan(1);
  const close = dialog.getByRole("button", {
    name: "Close open project",
    exact: true,
  });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const viewport of [
  { width: 1200, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`creates and opens a project in centered dialogs at ${viewport.width}px @webkit-canvas`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    if (viewport.width === 390) {
      await expect(
        page.getByRole("dialog", { name: "Mobile support warning" }),
      ).toBeVisible();
    }
    await dismissMobileSupportWarning(page);
    const start = page.getByTestId("start-center");
    await start
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    const create = page.getByRole("dialog", {
      name: "Create project",
      exact: true,
    });
    const name = create.getByRole("textbox", {
      name: "Project name",
      exact: true,
    });
    await expect(name).toBeFocused();
    const createBounds = await requiredBox(create);
    expect(
      Math.abs(createBounds.x + createBounds.width / 2 - viewport.width / 2),
    ).toBeLessThan(1);
    expect(
      Math.abs(createBounds.y + createBounds.height / 2 - viewport.height / 2),
    ).toBeLessThan(1);
    await name.fill("Championship robot");
    await create
      .getByRole("textbox", { name: "First path name" })
      .fill("Opening move");
    await create.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByTestId("path-stage")).toBeVisible();
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page.getByRole("menuitem", { name: "Home", exact: true }).click();
    await start
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    const open = page.getByRole("dialog", {
      name: "Open project",
      exact: true,
    });
    const bounds = await requiredBox(open);
    expect(
      Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2),
    ).toBeLessThan(1);
    expect(
      Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2),
    ).toBeLessThan(1);
    expect(bounds.x).toBeGreaterThanOrEqual(10);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 10);
    const project = open
      .getByRole("button")
      .filter({ hasText: "Championship robot" });
    await expect(project).toBeFocused();
    await expect(project.locator("time")).toBeVisible();
    await project.press("Enter");
    await expect(open).toHaveCount(0);
    await expect(page.getByTestId("current-project-status")).toHaveText(
      "Project: Championship robot",
    );
    await expect(page.getByTestId("current-path-status")).toHaveText(
      "Current Path: Opening move",
    );
    await expect(page.getByTestId("path-stage")).toBeVisible();
  });
}

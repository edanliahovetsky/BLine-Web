import { expect, test } from "@playwright/test";
import {
  dismissMobileSupportWarning,
  gotoSampleEditor,
  requiredBox,
} from "./support/app-shell-shared";

test("returns Home through File and resumes edits, selection, and undo history", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const projectName = (
    await page.getByTestId("current-project-status").innerText()
  ).replace(/^Project: /, "");
  await page.getByTestId("path-element-row-0").click();
  const xInput = page.getByRole("spinbutton", { name: "X (m)", exact: true });
  const originalX = await xInput.inputValue();
  const editedX = String(Number(originalX) + 0.25);
  await xInput.fill(editedX);
  await xInput.press("Tab");
  const selection = await page
    .getByTestId("selected-element-status")
    .innerText();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled();

  await page.getByRole("button", { name: "File", exact: true }).click();
  const home = page.getByRole("menuitem", { name: "Home", exact: true });
  await home.focus();
  await page.keyboard.press("Enter");
  const start = page.getByTestId("start-center");
  await expect(start).toBeVisible();
  await expect(page.getByTestId("path-stage")).toHaveCount(0);
  await expect(undo).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Open project navigator" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Toolbar path" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(home).toBeDisabled();
  await page.keyboard.press("Escape");
  await start.getByRole("heading", { name: "BLine Web" }).click();
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  for (const key of [
    "Delete",
    "ArrowRight",
    `${modifier}+Z`,
    `${modifier}+D`,
  ]) {
    await page.keyboard.press(key);
  }
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await start.getByRole("button").filter({ hasText: projectName }).click();
  await expect(start).toHaveCount(0);
  await expect(page.getByTestId("path-stage")).toBeVisible();
  await expect(xInput).toHaveValue(editedX);
  await expect(page.getByTestId("selected-element-status")).toHaveText(
    selection,
  );
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(xInput).toHaveValue(originalX);
});

test("stays Home when creation is canceled and opens new or recent projects", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const projectName = (
    await page.getByTestId("current-project-status").innerText()
  ).replace(/^Project: /, "");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Home", exact: true }).click();
  const start = page.getByTestId("start-center");
  await start
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Create project" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(start).toBeVisible();
  await start
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "Project name" })
    .fill("Home navigation project");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(start).toHaveCount(0);
  await expect(page.getByTestId("current-project-status")).toHaveText(
    "Project: Home navigation project",
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Home", exact: true }).click();
  await start.getByRole("button").filter({ hasText: projectName }).click();
  await expect(start).toHaveCount(0);
  await expect(page.getByTestId("current-project-status")).toHaveText(
    `Project: ${projectName}`,
  );
  await expect(page.getByTestId("path-stage")).toBeVisible();
});

test("returns to Home after a guided lesson with an existing project", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const projectName = (
    await page.getByTestId("current-project-status").innerText()
  ).replace(/^Project: /, "");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Home", exact: true }).click();
  const start = page.getByTestId("start-center");
  await start.getByRole("button", { name: "Lessons", exact: true }).click();
  await page.getByTestId("tour-picker-getting-started").click();
  await expect(page.getByTestId("tour-card")).toBeVisible();
  await expect(start).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(start).toBeVisible();
  await start.getByRole("button").filter({ hasText: projectName }).click();
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );
  await expect(page.getByTestId("path-stage")).toBeVisible();
});

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
    start.getByRole("button", { name: "Lessons", exact: true }),
  ).toBeDisabled();
  await expect(
    start.getByRole("link", { name: "Download desktop editor" }),
  ).toBeVisible();
  await expect(start.getByRole("link", { name: "GitHub" })).toBeVisible();

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

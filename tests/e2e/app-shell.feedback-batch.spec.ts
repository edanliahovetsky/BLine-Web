import { expect, test, type Page } from "@playwright/test";
import {
  gotoSampleEditor,
  openProjectSettings,
} from "./support/app-shell-shared";
import {
  createNewProject,
  installSaveFilePickerSpy,
  savedFile,
  savedFileCount,
} from "./support/app-shell-persistence";

async function events(page: Page) {
  await openProjectSettings(page);
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog
    .getByRole("button", { name: "Event Triggers", exact: true })
    .click();
  return dialog;
}

async function addKey(page: Page, key: string) {
  await page.getByRole("button", { name: "Add new", exact: true }).click();
  await page.getByLabel("New Lib Key", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Save Lib Key", exact: true }).click();
}

test("registers, autocompletes, renames and clears event keys with undo @webkit-canvas", async ({
  page,
}, testInfo) => {
  await gotoSampleEditor(page);
  let dialog = await events(page);
  await addKey(page, "intakeFast");
  await addKey(page, "intakeSlow");
  await page
    .getByRole("button", {
      name: "Event trigger actions for intakeFast",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(page.getByLabel("New Lib Key", { exact: true })).toHaveValue(
    "intakeFast_copy",
  );
  await page.getByRole("button", { name: "Save Lib Key", exact: true }).click();
  await page.getByLabel("Search event triggers").fill("slow");
  await expect(page.locator(".event-key-row")).toHaveCount(1);
  await page.getByLabel("Search event triggers").fill("");
  await page.screenshot({
    path: testInfo.outputPath("event-key-settings.png"),
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByTestId("path-element-row-4").click();
  const input = page.getByLabel("Lib Key", { exact: true });
  await input.fill("intakeS");
  await expect(
    page.getByRole("option", { name: "intakeSlow", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("event-key-autocomplete.png"),
  });
  await input.press("Tab");
  await expect(input).toHaveValue("intakeSlow");
  await input.fill("intakeF");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue("intakeFast_copy");
  await input.fill("intakeF");
  await page.getByRole("option", { name: "intakeFast", exact: true }).click();
  await expect(input).toHaveValue("intakeFast");
  await input.press("Tab");
  dialog = await events(page);
  await page
    .getByRole("button", {
      name: "Event trigger actions for intakeFast",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Rename All", exact: true }).click();
  await page.getByLabel("Replacement Lib Key").fill("Collect");
  await page.getByRole("button", { name: "Save Lib Key", exact: true }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(input).toHaveValue("Collect");
  dialog = await events(page);
  await page
    .getByRole("button", {
      name: "Event trigger actions for Collect",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Clear key", exact: true }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("path-element-row-4")).toContainText(
    "Event Trigger",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(input).toHaveValue("Collect");
  // Save and reopen: unused keys also survive.
  await expect(page.getByTestId("save-status")).toHaveClass(/--saved/);
  await page.reload();
  dialog = await events(page);
  await expect(
    page.getByRole("button", {
      name: "Event trigger actions for intakeSlow",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("fits the event key manager and persists the optional legacy marker at narrow width @webkit-canvas", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 560, height: 760 });
  await gotoSampleEditor(page);
  await openProjectSettings(page);
  let dialog = page.getByRole("dialog", { name: "Edit Config" });
  const toggle = page.getByLabel("Legacy appearance", { exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByTestId("path-stage")
    .screenshot({ path: testInfo.outputPath("legacy-heading-triangle.png") });
  dialog = await events(page);
  await addKey(page, "startIntake");
  await page.screenshot({
    path: testInfo.outputPath("event-key-settings-narrow.png"),
  });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await openProjectSettings(page);
  await expect(toggle).toBeChecked();
});

test("offers an export and an exit after a failed project save @webkit-canvas", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    const projectKey = `bline-web:workspace:${localStorage.getItem("bline-web:current-workspace")}`;
    Storage.prototype.setItem = function (key, value) {
      if (key === projectKey) throw new Error("Project folder unavailable");
      return original.call(this, key, value);
    };
  });
  await page.getByTestId("path-element-row-4").click();
  await page.getByLabel("Lib Key", { exact: true }).fill("unsavedAction");
  await page.getByLabel("Lib Key", { exact: true }).press("Tab");
  await createNewProject(page);
  const recovery = page.getByRole("dialog", {
    name: "Unable to save this project",
  });
  await expect(recovery).toBeVisible();
  const download = page.waitForEvent("download");
  await recovery
    .getByRole("button", { name: "Export copy", exact: true })
    .click();
  expect((await download).suggestedFilename()).toContain("bline-project.json");
  await recovery
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Create project", exact: true })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Leave without saving", exact: true })
    .click();
  await expect(recovery).toHaveCount(0);
  await expect(page.getByTestId("current-project-status")).toContainText(
    "Test Project",
  );
});

test("exports the exact navigator name with capitalization and punctuation @webkit-canvas", async ({
  page,
}) => {
  await installSaveFilePickerSpy(page);
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Workspace", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "New Project", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create project",
    exact: true,
  });
  await dialog.getByLabel("First path name").fill("bad/path");
  await expect(dialog.getByRole("alert")).toContainText("Use a filename");
  await expect(
    dialog.getByRole("button", { name: "Done", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("First path name").fill("TEST_AUTO (2)!");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: TEST_AUTO (2)!",
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Import / Export", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Export Path...", exact: true })
    .click();
  await expect.poll(() => savedFileCount(page)).toBe(1);
  expect((await savedFile(page, 0)).suggestedName).toBe("TEST_AUTO (2)!.json");
});

test("remembers typed Lib Keys without registering partial drafts @webkit-canvas", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.getByTestId("path-element-row-4").click();
  const input = page.getByLabel("Lib Key", { exact: true });
  await input.fill("shootCube");
  await input.press("Enter");
  await input.fill("shoot");
  await input.press("Tab");
  await expect(input).toHaveValue("shootCube");
  await input.fill("");
  await input.press("Tab");
  await expect(input).toHaveValue("");
  const dialog = await events(page);
  await expect(
    page.getByRole("button", {
      name: "Event trigger actions for shootCube",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Event trigger actions for shoot",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Event trigger actions for intake",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Event trigger actions for shootCube",
      exact: true,
    })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Rename All", exact: true }),
  ).toHaveCount(0);
});

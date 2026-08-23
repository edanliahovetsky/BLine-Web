import { expect, test } from "@playwright/test";
import {
  expectGlobalShortcutsBlockedByDialog,
  runEditMenuAction,
} from "./support/app-shell-commands";
import { openConstraintsTab } from "./support/app-shell-constraints";
import {
  bumpStoredWorkspaceVersion,
  createNewProject,
  currentPathName,
  makeDirtyEdit,
  openProjectMenu,
  openProjectPanelFromTopMenu,
  waitForSavedProject,
} from "./support/app-shell-persistence";
import {
  createNewPathFromTopMenu,
  openPathManageMenu,
  openPathMenu,
} from "./support/app-shell-project-library";
import {
  dismissMobileSupportWarning,
  gotoSampleEditor,
} from "./support/app-shell-shared";

test("selects and deletes a saved path without crashing", async ({ page }) => {
  await gotoSampleEditor(page);

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await createNewPathFromTopMenu(page, "Second Path");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await openPathManageMenu(page);
  await page.getByRole("menuitem", { name: "Delete Paths..." }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete Paths" }),
  ).toBeVisible();

  await page.getByRole("checkbox", { name: "Phase 1 Canvas Draft" }).check();
  await expect(
    page.getByRole("button", { name: "Delete Selected", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Delete Selected", exact: true })
    .click();

  await expect(page.getByRole("dialog", { name: "Delete Paths" })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.getByLabel("Toolbar path").click();
  await expect(
    page.getByRole("option", { name: "Phase 1 Canvas Draft" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Second Path",
  );
});

test("creates saves and reloads a local project", async ({ page }) => {
  await gotoSampleEditor(page);

  await createNewProject(page);
  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Waypoint" }).click();

  await page.getByLabel("X (m)").fill("6.50");
  await page.getByLabel("Y (m)").fill("3.90");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByTestId("save-status")).toContainText("Saved");
  const currentPath = await page
    .getByTestId("current-path-status")
    .textContent();

  await page.reload();

  if (!currentPath) {
    throw new Error("Expected current path status to be populated");
  }

  await expect(page.getByTestId("current-path-status")).toHaveText(currentPath);
  await expect(page.getByTestId("path-element-row-0")).toContainText(
    "6.50, 3.90 m",
  );
});

test("recovers autosaved edits after reload", async ({ page }) => {
  await gotoSampleEditor(page);

  await page.getByTestId("path-element-row-1").click();
  await page.getByLabel("X (m)").fill("7.50");

  await expect(page.getByTestId("save-status")).toContainText("Saved", {
    timeout: 5_000,
  });

  await page.reload();

  await expect(page.getByTestId("path-element-row-1")).toContainText(
    "7.50, 4.00 m",
  );
});

test("keeps linked elements after reload", async ({ page }) => {
  await gotoSampleEditor(page);

  const pathMenu = await openPathMenu(page);
  await pathMenu.getByRole("menuitem", { name: "Linked Elements..." }).click();

  let dialog = page.getByRole("dialog", { name: "Linked Elements" });
  await dialog.getByRole("button", { name: "New Translation" }).click();
  await dialog.getByLabel("Linked element name").fill("Persistent Note");
  await dialog.getByLabel("X (m)").fill("4.25");
  await dialog.getByLabel("Y (m)").fill("2.75");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.getByTestId("save-status")).toContainText("Saved", {
    timeout: 5_000,
  });
  await page.reload();

  const reopenedPathMenu = await openPathMenu(page);
  await reopenedPathMenu
    .getByRole("menuitem", { name: "Linked Elements..." })
    .click();
  dialog = page.getByRole("dialog", { name: "Linked Elements" });

  await expect(dialog.getByLabel("Linked element name")).toHaveValue(
    "Persistent Note",
  );
  await expect(dialog.getByLabel("X (m)")).toHaveValue("4.25");
  await expect(dialog.getByLabel("Y (m)")).toHaveValue("2.75");
});

test("synchronizes linked inspector and keyboard edits while respecting locks", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  const firstLinkedRow = page.getByTestId("path-element-row-1");
  const secondLinkedRow = page.getByTestId("path-element-row-3");

  await test.step("link two path elements to one shared point", async () => {
    await firstLinkedRow.click();
    await page.getByRole("button", { name: "Link element" }).click();

    let linkedElementActions = page.getByRole("group", {
      name: "Linked element actions",
    });
    await linkedElementActions
      .getByRole("button", { name: /New Linked Translation/ })
      .click();
    await linkedElementActions
      .getByLabel("Linked element name")
      .fill("Shared Point");
    await linkedElementActions
      .getByRole("button", { name: "Create & Link" })
      .click();

    await secondLinkedRow.click();
    await page.getByRole("button", { name: "Link element" }).click();
    linkedElementActions = page.getByRole("group", {
      name: "Linked element actions",
    });
    await linkedElementActions
      .getByRole("button", { name: /Choose Existing/ })
      .click();

    const picker = page.getByRole("dialog", {
      name: "Choose Linked Element",
    });
    await picker
      .getByRole("listitem")
      .filter({ hasText: "Shared Point" })
      .click();
    await picker.getByRole("button", { name: "Link Selected" }).click();

    await expect(firstLinkedRow).toContainText("7.00, 4.00 m");
    await expect(secondLinkedRow).toContainText("7.00, 4.00 m");
  });

  await test.step("propagate an inspector edit and retain it after reload", async () => {
    await firstLinkedRow.click();
    await page.getByTestId("property-editor").getByLabel("X (m)").fill("7.5");

    await expect(firstLinkedRow).toContainText("7.50, 4.00 m");
    await expect(secondLinkedRow).toContainText("7.50, 4.00 m");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("save-status")).toContainText("Saved");
    await page.reload();

    await expect(firstLinkedRow).toContainText("7.50, 4.00 m");
    await expect(secondLinkedRow).toContainText("7.50, 4.00 m");
  });

  await test.step("propagate an unlocked keyboard nudge", async () => {
    await firstLinkedRow.click();
    await firstLinkedRow.focus();
    await page.keyboard.press("ArrowRight");

    await expect(firstLinkedRow).toContainText("7.55, 4.00 m");
    await expect(secondLinkedRow).toContainText("7.55, 4.00 m");
  });

  await test.step("prevent keyboard nudges while the shared point is locked", async () => {
    const pathMenu = await openPathMenu(page);
    await pathMenu
      .getByRole("menuitem", { name: "Linked Elements..." })
      .click();

    const dialog = page.getByRole("dialog", { name: "Linked Elements" });
    await dialog
      .getByRole("listitem")
      .filter({ hasText: "Shared Point" })
      .click();
    const lockedSwitch = dialog.getByRole("switch", { name: "Locked" });
    await lockedSwitch.check();
    await expect(lockedSwitch).toBeChecked();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    await firstLinkedRow.click();
    await firstLinkedRow.focus();
    await page.keyboard.press("ArrowRight");

    await expect(firstLinkedRow).toContainText("7.55, 4.00 m");
    await expect(secondLinkedRow).toContainText("7.55, 4.00 m");
  });
});

test("opens a saved project from the project list", async ({ page }) => {
  await gotoSampleEditor(page);

  const firstProject = await createNewProject(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  const firstPath = await currentPathName(page);

  await createNewProject(page);
  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Waypoint" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await openProjectPanelFromTopMenu(page);
  await expect(page.getByTestId("open-project-panel")).toBeVisible();
  await page.getByText(firstProject.projectName, { exact: true }).click();

  await expect(page.getByTestId("current-path-status")).toHaveText(
    `Current Path: ${firstPath}`,
  );
  await expect(page.getByTestId("path-element-row-0")).toHaveCount(0);
});

test("opens a saved project from the mobile project list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await gotoSampleEditor(page);
  await dismissMobileSupportWarning(page);

  const firstProject = await createNewProject(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  const firstPath = await currentPathName(page);

  await createNewProject(page);
  await page.getByRole("button", { name: "Toggle inspector" }).click();
  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Waypoint" }).click();
  await page.getByTestId("path-element-row-0").click();
  await page.getByLabel("X (m)").fill("5.4");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await page
    .getByRole("complementary", { name: "Path inspector" })
    .getByRole("button", { name: "Close inspector" })
    .click();
  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Workspace" }).click();
  await page.getByRole("menuitem", { name: "Open Project..." }).click();
  await expect(page.getByTestId("open-project-panel")).toBeVisible();
  await page.getByText(firstProject.projectName, { exact: true }).click();

  await expect(page.getByTestId("current-path-status")).toHaveText(
    `Current Path: ${firstPath}`,
  );
  await expect(page.getByTestId("open-project-panel")).toHaveCount(0);
});

test("supports undo and redo for structural sidebar edits", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Event Trigger" }).click();
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "6. Event Trigger",
  );

  await runEditMenuAction(page, "Undo");
  await expect(page.getByTestId("path-element-row-6")).toHaveCount(0);
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "6. Waypoint",
  );

  await runEditMenuAction(page, "Redo");
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "6. Event Trigger",
  );
});

test("switches and reorders path elements with keyboard shortcuts", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await page.getByTestId("path-element-row-2").click();
  await expect(page.getByTestId("path-element-row-2")).toHaveAttribute(
    "aria-keyshortcuts",
    "ArrowUp ArrowDown ArrowLeft ArrowRight Alt+ArrowUp Alt+ArrowDown Delete Backspace",
  );

  // ] steps the selection to the next element.
  await page.keyboard.press("]");
  await expect(page.getByTestId("path-element-row-3")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("path-element-row-2")).toContainText(
    "3. Rotation",
  );
  await expect(page.getByTestId("path-element-row-3")).toContainText(
    "4. Translation",
  );

  // Alt+Up/Down reorders the selected element.
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByTestId("path-element-row-2")).toContainText(
    "3. Translation",
  );
  await expect(page.getByTestId("path-element-row-3")).toContainText(
    "4. Rotation",
  );
  await expect(page.getByTestId("path-element-row-2")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByTestId("path-element-row-2")).toContainText(
    "3. Rotation",
  );
  await expect(page.getByTestId("path-element-row-3")).toContainText(
    "4. Translation",
  );
  await expect(page.getByTestId("path-element-row-3")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // [ steps back to the previous element.
  await page.keyboard.press("[");
  await expect(page.getByTestId("path-element-row-2")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Arrow keys inside a number field still adjust the field, not the path.
  await page.getByLabel("Rotation (deg)").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue("44");
});

test("nudges the selected element on the field with arrow keys", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await page.getByTestId("path-element-row-1").click();
  await expect(page.getByLabel("X (m)")).toHaveValue("7");
  await expect(page.getByLabel("Y (m)")).toHaveValue("4");

  await page.getByTestId("path-element-row-1").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");

  await expect(page.getByLabel("X (m)")).toHaveValue("7.05");
  await expect(page.getByLabel("Y (m)")).toHaveValue("4.05");

  // Shift takes a larger step, and nudging never changes the selection.
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByLabel("X (m)")).toHaveValue("7.3");
  await expect(page.getByTestId("path-element-row-1")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // ] switches to the next element.
  await page.keyboard.press("]");
  await expect(page.getByTestId("path-element-row-2")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("duplicates the selected element after the original", async ({ page }) => {
  await gotoSampleEditor(page);

  await page.getByRole("button", { name: "Duplicate Translation 2" }).click();
  await expect(page.getByTestId("path-element-row-2")).toContainText(
    "3. Translation",
  );
  await expect(page.getByTestId("path-element-row-2")).toContainText(
    "7.00, 4.00 m",
  );
  await expect(page.getByTestId("path-element-row-2")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("path-element-row-3")).toContainText(
    "4. Rotation",
  );

  // Cmd/Ctrl+D duplicates the current selection too.
  const shortcut = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${shortcut}+D`);
  await expect(page.getByTestId("path-element-row-3")).toContainText(
    "4. Translation",
  );

  await page.keyboard.press(`${shortcut}+Z`);
  await expect(page.getByTestId("path-element-row-3")).toContainText(
    "4. Rotation",
  );
});

test("selects Max Velocity segments with the keyboard", async ({ page }) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  const firstSegment = page.getByTestId(
    "constraint-range-max_velocity_meters_per_sec-0",
  );
  await expect(firstSegment).toHaveAttribute("aria-selected", "false");

  await page.getByRole("listbox", { name: "Max Velocity segments" }).focus();
  await page.keyboard.press("ArrowRight");

  await expect(firstSegment).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Constraint 1 value")).toBeEnabled();
});

test("filters and runs command palette actions from the keyboard", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await page.keyboard.press("F1");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("searchbox", {
    name: "Search commands and paths",
  });
  const selectTool = palette.getByRole("option", { name: /^Select tool/ });
  const waypointTool = palette.getByRole("option", {
    name: /^Waypoint tool/,
  });

  await expect(palette).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill("tool");
  await expect(selectTool).toHaveAttribute("aria-selected", "true");
  await expect(waypointTool).toBeVisible();
  await expect(
    palette.getByRole("option", { name: /^Toggle inspector/ }),
  ).toHaveCount(0);

  await page.keyboard.press("ArrowDown");
  await expect(waypointTool).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(palette).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Waypoint tool" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("keeps disabled palette actions inert and restores focus on Escape", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  const trigger = page.getByRole("button", {
    name: "Search commands and paths",
  });
  const shortcut = process.platform === "darwin" ? "Meta" : "Control";
  await trigger.focus();
  await page.keyboard.press(`${shortcut}+K`);

  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("searchbox", {
    name: "Search commands and paths",
  });
  await search.fill("undo");
  const undo = palette.getByRole("option", { name: /^Undo/ });
  await expect(undo).toBeDisabled();

  await page.keyboard.press("Enter");
  await expect(palette).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("supports common keyboard shortcuts", async ({ page }) => {
  await gotoSampleEditor(page);

  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toHaveAttribute("aria-keyshortcuts", /Meta\+Y Control\+Y/);

  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Event Trigger" }).click();
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "6. Event Trigger",
  );

  const shortcut = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${shortcut}+Z`);
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "6. Waypoint",
  );

  await page.keyboard.press(`${shortcut}+Shift+Z`);
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "6. Event Trigger",
  );

  await page.keyboard.press(`${shortcut}+Z`);
  await page.keyboard.press(`${shortcut}+Y`);
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "6. Event Trigger",
  );

  await page.getByTestId("path-element-row-0").click();
  await page.getByLabel("X (m)").focus();
  await page.keyboard.press(`${shortcut}+Z`);
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "6. Event Trigger",
  );
  await page.keyboard.press(`${shortcut}+B`);
  await expect(
    page.getByRole("button", { name: "Toggle inspector" }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press(`${shortcut}+B`);
  await expect(
    page.getByRole("button", { name: "Toggle inspector" }),
  ).toHaveAttribute("aria-expanded", "true");

  await page.getByTestId("path-element-row-5").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "6. Waypoint",
  );

  await page.keyboard.press(`${shortcut}+Z`);
  await expect(page.getByTestId("path-element-row-5")).toContainText(
    "6. Event Trigger",
  );

  await page.keyboard.press(`${shortcut}+S`);
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await page.keyboard.press("?");
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
});

test("keeps global shortcuts behind the path name dialog", async ({ page }) => {
  await gotoSampleEditor(page);

  await openPathManageMenu(page);
  await page.getByRole("menuitem", { name: "Save Path As..." }).click();

  const dialog = page.getByRole("dialog", { name: "Save Path As" });
  const input = dialog.getByRole("textbox", { name: "Path name" });
  await expect(input).toBeFocused();

  await expectGlobalShortcutsBlockedByDialog(page, dialog, input);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("keeps global shortcuts behind the linked element picker", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  const pathMenu = await openPathMenu(page);
  await pathMenu.getByRole("menuitem", { name: "Linked Elements..." }).click();
  const linkedElementsDialog = page.getByRole("dialog", {
    name: "Linked Elements",
  });
  await linkedElementsDialog
    .getByRole("button", { name: "New Translation" })
    .click();
  await linkedElementsDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("Saved", {
    timeout: 5_000,
  });

  await page.getByTestId("path-element-row-1").click();
  await page.getByRole("button", { name: "Link element" }).click();
  await page
    .getByRole("group", { name: "Linked element actions" })
    .getByRole("button", { name: /Choose Existing/ })
    .click();

  const picker = page.getByRole("dialog", { name: "Choose Linked Element" });
  const closePicker = picker.getByRole("button", {
    name: "Close linked elements",
  });
  await closePicker.focus();

  await expectGlobalShortcutsBlockedByDialog(page, picker, closePicker);
});

test("keeps global shortcuts behind the save conflict dialog", async ({
  page,
}) => {
  await waitForSavedProject(page);
  await bumpStoredWorkspaceVersion(page);
  await page.getByTestId("path-element-row-1").click();
  await page.getByLabel("X (m)").fill("7.25");

  const dialog = page.getByTestId("save-conflict-dialog");
  const overwrite = dialog.getByRole("button", { name: "Keep my changes" });
  await expect(dialog).toBeVisible();
  await expect(overwrite).toBeFocused();

  await expectGlobalShortcutsBlockedByDialog(page, dialog, overwrite);
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "title",
    /Project changed on disk/,
  );
});

test("keeps global shortcuts behind the guided tour picker", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();

  const picker = page.getByTestId("tour-picker");
  const firstTour = page.getByTestId("tour-picker-editor-basics");
  await firstTour.focus();

  await expectGlobalShortcutsBlockedByDialog(page, picker, firstTour);

  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
});

test("surfaces the save-conflict dialog when the stored version drifts", async ({
  page,
}) => {
  await waitForSavedProject(page);
  await bumpStoredWorkspaceVersion(page);
  await makeDirtyEdit(page);

  const dialog = page.getByTestId("save-conflict-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("changed on disk");
  await expect(dialog).toContainText("Different contents");
  await expect(dialog).not.toContainText("Changed on both sides");
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "title",
    /Project changed on disk/,
  );
});

test("resolves a save conflict by keeping my changes", async ({ page }) => {
  await waitForSavedProject(page);
  await bumpStoredWorkspaceVersion(page);
  await makeDirtyEdit(page);
  await expect(page.getByTestId("save-conflict-dialog")).toBeVisible();

  await page.getByRole("button", { name: "Keep my changes" }).click();

  await expect(page.getByTestId("save-conflict-dialog")).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
});

test("resolves a save conflict by reloading from disk", async ({ page }) => {
  await waitForSavedProject(page);
  await bumpStoredWorkspaceVersion(page);
  await makeDirtyEdit(page);
  await expect(page.getByTestId("save-conflict-dialog")).toBeVisible();

  await page.getByRole("button", { name: "Reload from disk" }).click();

  await expect(page.getByTestId("save-conflict-dialog")).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
});

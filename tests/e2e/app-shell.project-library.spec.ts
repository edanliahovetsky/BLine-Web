import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { modelToCanvasPoint } from "./support/app-shell-canvas";
import { runEditMenuAction } from "./support/app-shell-commands";
import {
  disableDirectoryPicker,
  installSaveFilePickerSpy,
  openProjectMenu,
  openProjectPanelFromTopMenu,
  parseStoredZip,
  releaseSaveFilePicker,
  requiredZipText,
  savedFile,
  savedFileCount,
} from "./support/app-shell-persistence";
import {
  addPathToGroupFromLibrary,
  createNewPathFromTopMenu,
  createPathGroupFromTopMenu,
  duplicateSelectedLibraryPath,
  expectDialogOverPathLibrary,
  openPathLibraryDialog,
  openPathManageMenu,
  openPathMenu,
  pointBetweenFlyoutAndTrigger,
  selectToolbarOption,
  submitNameDialog,
} from "./support/app-shell-project-library";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";

test("creates path labels and new paths with default label membership", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await createPathGroupFromTopMenu(page, "Score Autos");
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Score Autos / Phase 1 Canvas Draft",
  );

  await openPathManageMenu(page);
  await page.getByRole("menuitem", { name: "Create New Path" }).click();
  const newPathDialog = page.getByRole("dialog", { name: "Create New Path" });
  await expect(newPathDialog).toBeVisible();
  await newPathDialog.getByLabel("Path name").fill("Group Blank");
  await expect(newPathDialog.getByLabel("Add to Score Autos")).toBeChecked();
  await newPathDialog.getByRole("button", { name: "Create Path" }).click();

  await expect(page.getByTestId("current-path-status")).toContainText(
    "Score Autos / Group Blank",
  );

  await openPathLibraryDialog(page);
  await page.getByRole("button", { name: "Delete label" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete Label" });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toContainText(
    "The Paths themselves will stay in the project",
  );
  await deleteDialog
    .getByRole("button", { name: "Delete Label", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Delete Label" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.getByTestId("current-path-status")).toContainText(
    "Current Path: Group Blank",
  );
  await expect(page.getByLabel("Toolbar path")).toContainText("Group Blank");
});

test("switches labeled paths from the toolbar and ghost canvas outlines", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await createPathGroupFromTopMenu(page, "Score Autos");

  await page.getByRole("button", { name: "Path", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage Paths" }).click();
  await page.getByRole("menuitem", { name: "Save Path As..." }).click();
  await submitNameDialog(page, "Save Path As", "Ghost Copy", "Save Copy");

  await addPathToGroupFromLibrary(page, "Score Autos", "Ghost Copy");

  await page.getByTestId("path-element-row-0").click();
  await page.getByLabel("X (m)").fill("6.8");
  await page.getByLabel("Y (m)").fill("2.8");
  await selectToolbarOption(page, "Toolbar path", "Phase 1 Canvas Draft");
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Score Autos / Phase 1 Canvas Draft",
  );

  let labelPanel = await openPathLibraryDialog(page);
  const compareToggle = labelPanel
    .getByLabel("Compare Paths")
    .getByRole("button", { name: "Shown" });
  await expect(compareToggle).toHaveAttribute("aria-pressed", "true");
  await compareToggle.click();
  await labelPanel.getByRole("button", { name: "Close", exact: true }).click();

  const canvas = page.getByTestId("path-stage-canvas");
  const ghostPoint = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 6.8,
    y_meters: 2.8,
  });
  await page.mouse.move(ghostPoint.x, ghostPoint.y);
  await expect(page.getByTestId("path-stage-ghost-label")).toHaveCount(0);

  labelPanel = await openPathLibraryDialog(page);
  await labelPanel
    .getByLabel("Compare Paths")
    .getByRole("button", { name: "Hidden" })
    .click();
  await labelPanel.getByRole("button", { name: "Close", exact: true }).click();
  await page.mouse.move(ghostPoint.x, ghostPoint.y);
  await expect(page.getByTestId("path-stage-ghost-label")).toHaveText(
    "Ghost Copy",
  );
  await page.mouse.click(ghostPoint.x, ghostPoint.y);

  await expect(page.getByTestId("current-path-status")).toContainText(
    "Score Autos / Ghost Copy",
  );
});

test("uses the linked-elements layout across desktop and narrow viewports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoSampleEditor(page);

  const pathMenu = await openPathMenu(page);
  await pathMenu.getByRole("menuitem", { name: "Linked Elements..." }).click();

  const dialog = page.getByRole("dialog", { name: "Linked Elements" });
  await expect(dialog).toBeVisible();
  const desktopViewport = page.viewportSize();
  expect(desktopViewport?.width).toBeGreaterThan(980);
  const desktopDialogBox = await requiredBox(dialog);
  expect(desktopDialogBox.x).toBeGreaterThanOrEqual(24);
  expect(desktopDialogBox.x + desktopDialogBox.width).toBeLessThanOrEqual(
    (desktopViewport?.width ?? 0) - 24,
  );

  const body = dialog.locator(".linked-targets-dialog__body");
  await expect
    .poll(() =>
      body.evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
            .length,
      ),
    )
    .toBe(3);

  await page.setViewportSize({ width: 900, height: 720 });

  const narrowViewport = page.viewportSize();
  expect(narrowViewport?.width).toBeLessThanOrEqual(980);
  const narrowDialogBox = await requiredBox(dialog);
  expect(narrowDialogBox.x).toBeGreaterThanOrEqual(16);
  expect(narrowDialogBox.x + narrowDialogBox.width).toBeLessThanOrEqual(
    (narrowViewport?.width ?? 0) - 16,
  );
  expect(narrowDialogBox.width).toBeLessThanOrEqual(760);
  const sections = body.locator(":scope > *");
  await expect
    .poll(async () => {
      const boxes = await sections.evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { left: bounds.left, top: bounds.top };
        }),
      );
      return {
        columnCount: await body.evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
              .length,
        ),
        aligned: boxes.every(
          (box) => Math.abs(box.left - (boxes[0]?.left ?? box.left)) < 1,
        ),
        stacked: boxes.every(
          (box, index) => index === 0 || box.top > boxes[index - 1].top,
        ),
      };
    })
    .toEqual({ columnCount: 1, aligned: true, stacked: true });
});

test("manages paths from the canonical path library", async ({ page }) => {
  await gotoSampleEditor(page);

  await createPathGroupFromTopMenu(page, "Score Autos");

  const dialog = await openPathLibraryDialog(page);
  await expect(dialog.getByLabel("Labels")).toBeVisible();
  await expect(dialog.getByLabel("Paths", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Label membership")).toBeVisible();
  await expect.poll(async () => (await requiredBox(dialog)).x).toBe(0);
  const panelBox = await requiredBox(dialog);
  expect(panelBox.width).toBeLessThanOrEqual(430);
  const importPathBox = await requiredBox(
    dialog.getByRole("button", { name: "Import Path", exact: true }),
  );
  const exportPathBox = await requiredBox(
    dialog.getByRole("button", { name: "Export Path", exact: true }),
  );
  expect(Math.abs(importPathBox.y - exportPathBox.y)).toBeLessThan(2);
  expect(Math.abs(importPathBox.height - exportPathBox.height)).toBeLessThan(2);
  await expect(
    dialog
      .locator(".path-library-dialog__group")
      .filter({ hasText: "All Paths" }),
  ).toHaveClass(/is-permanent/);

  await dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "All Paths" })
    .click();
  await dialog
    .locator(".path-library-dialog__path")
    .filter({ hasText: "Phase 1 Canvas Draft" })
    .click();
  const pathActions = dialog.locator(".path-library-dialog__path-actions");
  await expect(
    pathActions.getByRole("button", { name: "Open path" }),
  ).toBeVisible();
  await expect(
    pathActions.getByRole("button", { name: "Duplicate path" }),
  ).toBeVisible();
  await expect(
    pathActions.getByRole("button", { name: "Delete path" }),
  ).toBeVisible();
  await expect(
    dialog.locator(".path-library-dialog__details-card"),
  ).toHaveCount(0);
  await expect(
    dialog.locator(".path-library-dialog__details-actions"),
  ).toHaveCount(0);
  await expect(
    dialog.locator(".path-library-dialog__path-actions"),
  ).toBeVisible();

  await pathActions.getByRole("button", { name: "Duplicate path" }).click();
  await submitNameDialog(page, "Save Path As", "Library Branch", "Save Copy");
  await expect(
    dialog.locator(".path-library-dialog__path").filter({
      hasText: "Library Branch",
    }),
  ).toBeVisible();

  const membershipRow = dialog
    .locator(".path-library-dialog__membership-row")
    .filter({ hasText: "Score Autos" });
  await membershipRow.getByRole("checkbox").check();

  await dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "Score Autos" })
    .click();
  await dialog
    .locator(".path-library-dialog__path")
    .filter({ hasText: "Library Branch" })
    .click();
  await pathActions.getByRole("button", { name: "Open path" }).click();
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Score Autos / Library Branch",
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await selectToolbarOption(page, "Toolbar path", "Phase 1 Canvas Draft");
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Score Autos / Phase 1 Canvas Draft",
  );

  await page.setViewportSize({ width: 800, height: 720 });
  await page.getByRole("button", { name: "Actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Path UI" })).toHaveCount(0);
  await expect(page.getByTestId("path-context-bar")).toHaveCount(0);
  await expect(page.getByTestId("path-overlay-legend")).toHaveCount(0);
  await expect(page.getByTestId("path-group-tabs")).toHaveCount(0);
  await expect(page.getByTestId("path-library-dock")).toHaveCount(0);
});

test("uses focused name dialogs for every path and label launch point", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  const pathMenuButton = page.getByRole("button", {
    name: "Path",
    exact: true,
  });

  await openPathManageMenu(page);
  await page.getByRole("menuitem", { name: "Save Path As..." }).click();
  let nameDialog = page.getByRole("dialog", { name: "Save Path As" });
  let nameInput = nameDialog.getByRole("textbox", { name: "Path name" });
  const closeNameDialog = nameDialog.getByRole("button", {
    name: "Close save path as",
  });
  const saveCopyButton = nameDialog.getByRole("button", {
    name: "Save Copy",
    exact: true,
  });

  await expect(nameDialog).toHaveAttribute("aria-modal", "true");
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveValue("Phase 1 Canvas Draft");
  const initialName = await nameInput.inputValue();
  expect(
    await nameInput.evaluate((input) => ({
      end: (input as HTMLInputElement).selectionEnd,
      start: (input as HTMLInputElement).selectionStart,
    })),
  ).toEqual({ end: initialName.length, start: 0 });

  await closeNameDialog.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(saveCopyButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeNameDialog).toBeFocused();

  await nameInput.fill("   ");
  await expect(saveCopyButton).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(nameDialog).toHaveCount(0);
  await expect(pathMenuButton).toBeFocused();
  await expect(page.getByLabel("Toolbar path")).toContainText(
    "Phase 1 Canvas Draft",
  );

  await openPathManageMenu(page);
  await page.getByRole("menuitem", { name: "Save Path As..." }).click();
  await submitNameDialog(page, "Save Path As", "  Menu Copy  ", "Save Copy");
  await expect(page.getByLabel("Toolbar path")).toContainText("Menu Copy");
  await expect(pathMenuButton).toBeFocused();

  await openPathManageMenu(page);
  await page.getByRole("menuitem", { name: "Rename Path..." }).click();
  nameDialog = page.getByRole("dialog", { name: "Rename Path" });
  await expect(nameDialog.getByLabel("Path name")).toHaveValue("Menu Copy");
  await submitNameDialog(page, "Rename Path", "  Menu Renamed  ", "Rename");
  await expect(page.getByLabel("Toolbar path")).toContainText("Menu Renamed");
  await expect(pathMenuButton).toBeFocused();

  await runEditMenuAction(page, "Undo");
  await expect(page.getByLabel("Toolbar path")).toContainText("Menu Copy");
  await runEditMenuAction(page, "Redo");
  await expect(page.getByLabel("Toolbar path")).toContainText("Menu Renamed");

  const navigatorButton = page.getByRole("button", {
    name: "Open project navigator",
    exact: true,
  });
  const library = await openPathLibraryDialog(page);
  await library.getByRole("button", { name: "Create label" }).click();
  await page.getByTestId("path-collection-new-name").fill("Library Autos");
  await page.getByTestId("create-path-collection").click();

  const renameLabelButton = library.getByRole("button", {
    name: "Rename label",
  });
  await renameLabelButton.click();
  nameDialog = page.getByRole("dialog", { name: "Rename Label" });
  await expect(nameDialog.getByLabel("Label name")).toHaveValue(
    "Library Autos",
  );
  await submitNameDialog(page, "Rename Label", "  Renamed Autos  ", "Rename");
  await expect(library).toBeVisible();
  await expect(renameLabelButton).toBeFocused();
  await expect(
    library
      .locator(".path-library-dialog__group")
      .filter({ hasText: "Renamed Autos" }),
  ).toBeVisible();

  const pathActions = library.locator(".path-library-dialog__path-actions");
  const savePathAsButton = pathActions.getByRole("button", {
    name: "Duplicate path",
  });
  await savePathAsButton.click();
  nameDialog = page.getByRole("dialog", { name: "Save Path As" });
  await expect(nameDialog.getByLabel("Path name")).toHaveValue("Menu Renamed");
  await submitNameDialog(page, "Save Path As", "  Library Copy  ", "Save Copy");
  await expect(library).toBeVisible();
  await expect(savePathAsButton).toBeFocused();
  await expect(
    library
      .locator(".path-library-dialog__group")
      .filter({ hasText: "Renamed Autos" }),
  ).toContainText("2");

  const renamePathButton = pathActions.getByRole("button", {
    name: "Rename path",
  });
  await renamePathButton.click();
  nameDialog = page.getByRole("dialog", { name: "Rename Path" });
  await expect(nameDialog.getByLabel("Path name")).toHaveValue("Library Copy");
  await submitNameDialog(
    page,
    "Rename Path",
    "  Library Button Renamed  ",
    "Rename",
  );
  await expect(renamePathButton).toBeFocused();

  let selectedPath = library
    .locator(".path-library-dialog__path")
    .filter({ hasText: "Library Button Renamed" });
  await expect(selectedPath).toBeVisible();
  await selectedPath.focus();
  await page.keyboard.press("F2");
  nameDialog = page.getByRole("dialog", { name: "Rename Path" });
  nameInput = nameDialog.getByLabel("Path name");
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toHaveValue("Library Button Renamed");
  await page.keyboard.press("Escape");
  await expect(nameDialog).toHaveCount(0);
  await expect(selectedPath).toBeFocused();

  await page.keyboard.press("F2");
  await submitNameDialog(
    page,
    "Rename Path",
    "  Library F2 Renamed  ",
    "Rename",
  );
  selectedPath = library
    .locator(".path-library-dialog__path")
    .filter({ hasText: "Library F2 Renamed" });
  await expect(selectedPath).toBeVisible();
  await expect(selectedPath).toBeFocused();
  await expect(
    library
      .locator(".path-library-dialog__path")
      .filter({ hasText: "Menu Renamed" }),
  ).toBeVisible();

  await library.getByRole("button", { name: "Close", exact: true }).click();
  await expect(library).toHaveCount(0);
  await expect(navigatorButton).toBeFocused();
});

test("supports undo and redo for path library content edits", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const shortcut = process.platform === "darwin" ? "Meta" : "Control";

  let dialog = await openPathLibraryDialog(page);
  const undoGroup = dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "Undo Autos" });
  const allPathsGroup = dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "All Paths" });
  const phasePath = dialog
    .locator(".path-library-dialog__path")
    .filter({ hasText: "Phase 1 Canvas Draft" });
  const pathActions = dialog.locator(".path-library-dialog__path-actions");

  await dialog.getByRole("button", { name: "Create label" }).click();
  await page.getByTestId("path-collection-new-name").fill("Undo Autos");
  await page.getByTestId("create-path-collection").click();
  await expect(undoGroup).toBeVisible();

  await allPathsGroup.click();
  await page.keyboard.press(`${shortcut}+Z`);
  await expect(undoGroup).toHaveCount(0);
  await page.keyboard.press(`${shortcut}+Shift+Z`);
  await expect(undoGroup).toBeVisible();

  await allPathsGroup.click();
  await phasePath.click();
  await pathActions.getByRole("button", { name: "Duplicate path" }).click();
  await submitNameDialog(page, "Save Path As", "Undo Copy", "Save Copy");
  const undoCopyPath = dialog
    .locator(".path-library-dialog__path")
    .filter({ hasText: "Undo Copy" });
  await expect(undoCopyPath).toBeVisible();

  await phasePath.click();
  await page.keyboard.press(`${shortcut}+Z`);
  await expect(undoCopyPath).toHaveCount(0);
  await page.keyboard.press(`${shortcut}+Shift+Z`);
  await expect(undoCopyPath).toBeVisible();

  await undoCopyPath.click();
  let membershipCheckbox = dialog
    .locator(".path-library-dialog__membership-row")
    .filter({ hasText: "Undo Autos" })
    .getByRole("checkbox");
  await membershipCheckbox.check();
  await expect(membershipCheckbox).toBeChecked();

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await runEditMenuAction(page, "Undo");
  dialog = await openPathLibraryDialog(page);
  await dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "All Paths" })
    .click();
  await expect(
    dialog
      .locator(".path-library-dialog__path")
      .filter({ hasText: "Undo Copy" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await runEditMenuAction(page, "Redo");
  dialog = await openPathLibraryDialog(page);
  await dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "All Paths" })
    .click();
  const restoredUndoCopyPath = dialog
    .locator(".path-library-dialog__path")
    .filter({ hasText: "Undo Copy" });
  await expect(restoredUndoCopyPath).toBeVisible();
  await restoredUndoCopyPath.click();
  membershipCheckbox = dialog
    .locator(".path-library-dialog__membership-row")
    .filter({ hasText: "Undo Autos" })
    .getByRole("checkbox");
  await expect(membershipCheckbox).toBeChecked();

  await dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "Undo Autos" })
    .click();
  await dialog.getByRole("button", { name: "Delete label" }).click();
  await page
    .getByRole("dialog", { name: "Delete Label" })
    .getByRole("button", { name: "Delete Label", exact: true })
    .click();
  await expect(
    dialog
      .locator(".path-library-dialog__group")
      .filter({ hasText: "Undo Autos" }),
  ).toHaveCount(0);

  await dialog
    .locator(".path-library-dialog__path")
    .filter({ hasText: "Undo Copy" })
    .click();
  await page.keyboard.press(`${shortcut}+Z`);
  await expect(
    dialog
      .locator(".path-library-dialog__group")
      .filter({ hasText: "Undo Autos" }),
  ).toBeVisible();
});

test("deletes only labels and keeps undoable Path memberships", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const shortcut = process.platform === "darwin" ? "Meta" : "Control";

  const dialog = await openPathLibraryDialog(page);
  await dialog.getByRole("button", { name: "Create label" }).click();
  await page.getByTestId("path-collection-new-name").fill("Temp Autos");
  await page.getByTestId("create-path-collection").click();

  const allPathsGroup = dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "All Paths" });
  const tempAutosGroup = dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "Temp Autos" });
  const phasePath = dialog
    .locator(".path-library-dialog__path")
    .filter({ hasText: "Phase 1 Canvas Draft" });
  const pathActions = dialog.locator(".path-library-dialog__path-actions");

  await allPathsGroup.click();
  await duplicateSelectedLibraryPath(page, pathActions, "Temp A");
  await dialog
    .locator(".path-library-dialog__membership-row")
    .filter({ hasText: "Temp Autos" })
    .getByRole("checkbox")
    .check();

  await phasePath.click();
  await duplicateSelectedLibraryPath(page, pathActions, "Temp B");
  await dialog
    .locator(".path-library-dialog__membership-row")
    .filter({ hasText: "Temp Autos" })
    .getByRole("checkbox")
    .check();

  await expect(tempAutosGroup).toContainText("3");
  await tempAutosGroup.click();
  await dialog.getByRole("button", { name: "Delete label" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete Label" });
  await expect(deleteDialog.getByRole("checkbox")).toHaveCount(0);
  await deleteDialog
    .getByRole("button", { name: "Delete Label", exact: true })
    .click();
  await expect(tempAutosGroup).toHaveCount(0);
  await expect(
    dialog
      .locator(".path-library-dialog__path-list")
      .getByRole("option", { name: /^Temp A / }),
  ).toBeVisible();
  await expect(
    dialog
      .locator(".path-library-dialog__path-list")
      .getByRole("option", { name: /^Temp B / }),
  ).toBeVisible();

  await page.keyboard.press(`${shortcut}+Z`);
  await expect(tempAutosGroup).toContainText("3");

  await page.keyboard.press(`${shortcut}+Z`);
  await expect(tempAutosGroup).toContainText("2");
  await tempAutosGroup.click();
  await expect(
    dialog
      .locator(".path-library-dialog__path-list")
      .getByRole("option", { name: /^Temp A / }),
  ).toBeVisible();
  await expect(
    dialog
      .locator(".path-library-dialog__path-list")
      .getByRole("option", { name: /^Temp B / }),
  ).toHaveCount(0);

  await page.keyboard.press(`${shortcut}+Z`);
  await expect(tempAutosGroup).toContainText("1");
  await expect(
    dialog
      .locator(".path-library-dialog__path-list")
      .getByRole("option", { name: /^Temp A / }),
  ).toHaveCount(0);
});

test("overlays create and delete path dialogs above the path library", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await createPathGroupFromTopMenu(page, "Score Autos");

  const dialog = await openPathLibraryDialog(page);
  await dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "All Paths" })
    .click();
  await dialog
    .locator(".path-library-dialog__path")
    .filter({ hasText: "Phase 1 Canvas Draft" })
    .click();

  await dialog.getByRole("button", { name: "Create new path" }).click();
  const newPathDialog = page.getByRole("dialog", { name: "Create New Path" });
  await expect(newPathDialog).toBeVisible();
  await expect(dialog).toBeVisible();
  await expectDialogOverPathLibrary(page, "Create New Path");
  await newPathDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(newPathDialog).toHaveCount(0);
  await expect(dialog).toBeVisible();

  await dialog
    .locator(".path-library-dialog__path-actions")
    .getByRole("button", { name: "Delete path" })
    .click();
  const deletePathDialog = page.getByRole("dialog", { name: "Delete Paths" });
  await expect(deletePathDialog).toBeVisible();
  await expect(dialog).toBeVisible();
  await expectDialogOverPathLibrary(page, "Delete Paths");
  await deletePathDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(deletePathDialog).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test("keeps label actions available when a label has no Paths", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await createPathGroupFromTopMenu(page, "Empty Autos");
  const dialog = await openPathLibraryDialog(page);

  await dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "All Paths" })
    .click();
  await dialog
    .locator(".path-library-dialog__path")
    .filter({ hasText: "Phase 1 Canvas Draft" })
    .click();
  await dialog
    .locator(".path-library-dialog__membership-row")
    .filter({ hasText: "Empty Autos" })
    .getByRole("checkbox")
    .uncheck();

  await dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "Empty Autos" })
    .click();
  await expect(
    dialog.getByText("No Paths match this label and search."),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Rename label" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Delete label" }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete Label" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Delete Label" })
    .getByRole("button", { name: "Cancel" })
    .click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
});

test("exposes PySide-equivalent top menu commands", async ({ page }) => {
  await gotoSampleEditor(page);

  await openProjectMenu(page);
  await expect(page.getByTestId("top-menu-project")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Workspace" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import / Export" }),
  ).toBeVisible();
  const configMenuItem = page.getByRole("menuitem", { name: "Config" });
  await expect(configMenuItem).toBeVisible();
  const configLabelMetrics = await configMenuItem.evaluate((element) => {
    const label = element.querySelector(".top-menu__item-label");
    const labelStyle = label ? window.getComputedStyle(label) : null;

    return {
      itemHeight: element.getBoundingClientRect().height,
      labelHeight: label?.getBoundingClientRect().height ?? 0,
      lineHeight: labelStyle ? Number.parseFloat(labelStyle.lineHeight) : 0,
    };
  });
  expect(configLabelMetrics.itemHeight).toBeGreaterThanOrEqual(32);
  expect(configLabelMetrics.labelHeight).toBeGreaterThanOrEqual(18);
  expect(configLabelMetrics.lineHeight).toBeGreaterThanOrEqual(17);
  await expect(
    page.getByRole("menuitem", { name: "Recent Projects" }),
  ).toBeVisible();

  await page.getByRole("menuitem", { name: "Workspace" }).click();
  await expect(page.getByTestId("top-menu-project-workspace")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "New Project" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Open Project..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Delete Projects..." }),
  ).toBeVisible();

  await page.getByRole("menuitem", { name: "Delete Projects..." }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete Projects" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select All" }).click();
  await page
    .getByRole("button", { name: "Delete Selected", exact: true })
    .click();
  await expect(page.getByText("Delete 1 selected project?")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm Delete" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(page.getByTestId("top-menu-project-transfer")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Autos Folder..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Export Autos Folder..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Project Archive..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Export Project Archive..." }),
  ).toBeVisible();

  await page.getByRole("menuitem", { name: "Config" }).click();
  await expect(page.getByTestId("top-menu-project-config")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Config..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Export Config..." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Path", exact: true }).click();
  await expect(page.getByTestId("top-menu-path")).toBeVisible();
  await expect(page.getByText("Current: Phase 1 Canvas Draft")).toBeVisible();
  await expect(page.getByText("Label: All Paths")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Linked Elements..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Project Navigator...", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Manage Paths" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import / Export" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Manage Paths" }).click();
  await expect(page.getByTestId("top-menu-path-manage")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Create New Path" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Save Path As..." }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(page.getByTestId("top-menu-path-transfer")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Path..." }),
  ).toBeVisible();

  // The menu bar is limited to File and Path; Edit/View/Help were removed
  // and their actions moved to the toolbar, command palette, and shortcuts.
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Help", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Config" })).toBeVisible();
  await expect(page.getByLabel("Robot Length (m)")).toBeVisible();
  await page.getByRole("button", { name: "Close config" }).click();
});

test("keeps top dropdowns streamlined with condensed path side menus", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await openProjectMenu(page);
  const projectMenu = page.getByTestId("top-menu-project");
  await expect(projectMenu).toBeVisible();
  expect((await requiredBox(projectMenu)).width).toBeLessThanOrEqual(260);

  await page.getByRole("menuitem", { name: "Recent Projects" }).click();
  const recentMenu = page.getByTestId("top-menu-project-recent");
  await expect(recentMenu).toBeVisible();
  const projectMenuBox = await requiredBox(projectMenu);
  const recentMenuBox = await requiredBox(recentMenu);
  expect(recentMenuBox.width).toBeLessThanOrEqual(285);
  expect(recentMenuBox.x).toBeGreaterThanOrEqual(
    projectMenuBox.x + projectMenuBox.width,
  );

  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(recentMenu).toHaveCount(0);
  await expect(page.getByTestId("top-menu-project-transfer")).toBeVisible();

  await page.getByRole("button", { name: "Path", exact: true }).click();
  const pathMenu = page.getByTestId("top-menu-path");
  await expect(pathMenu).toBeVisible();
  expect((await requiredBox(pathMenu)).width).toBeLessThanOrEqual(270);

  await page.getByRole("menuitem", { name: "Manage Paths" }).click();
  const managePathMenu = page.getByTestId("top-menu-path-manage");
  await expect(managePathMenu).toBeVisible();
  const pathMenuBox = await requiredBox(pathMenu);
  const managePathMenuBox = await requiredBox(managePathMenu);
  expect(managePathMenuBox.width).toBeLessThanOrEqual(285);
  expect(managePathMenuBox.x).toBeGreaterThanOrEqual(
    pathMenuBox.x + pathMenuBox.width,
  );

  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(managePathMenu).toHaveCount(0);
  const transferMenu = page.getByTestId("top-menu-path-transfer");
  await expect(transferMenu).toBeVisible();
  const transferMenuBox = await requiredBox(transferMenu);
  expect(transferMenuBox.width).toBeLessThanOrEqual(285);
  expect(transferMenuBox.x).toBeGreaterThanOrEqual(
    pathMenuBox.x + pathMenuBox.width,
  );
  await expect(
    transferMenu.getByRole("menuitem", { name: "Import Path..." }),
  ).toBeVisible();
});

test("keeps project flyouts stable while hovering between choices", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Workspace" }).hover();
  await expect(page.getByTestId("top-menu-project-workspace")).toBeVisible();

  await page.getByRole("menuitem", { name: "Import / Export" }).hover();
  const transferMenu = page.getByTestId("top-menu-project-transfer");
  await expect(page.getByTestId("top-menu-project-workspace")).toHaveCount(0);
  await expect(transferMenu).toBeVisible();

  const transferBox = await requiredBox(transferMenu);
  await page.mouse.move(
    transferBox.x + transferBox.width / 2,
    transferBox.y + 12,
  );
  await expect(transferMenu).toBeVisible();
  await page.waitForTimeout(350);
  await expect(transferMenu).toBeVisible();

  await page.mouse.move(16, 16);
  await expect(transferMenu).toHaveCount(0);

  await page.getByRole("menuitem", { name: "Import / Export" }).hover();
  await expect(transferMenu).toBeVisible();
  await page.getByRole("menuitem", { name: "Config" }).hover();
  await expect(transferMenu).toHaveCount(0);
  await expect(page.getByTestId("top-menu-project-config")).toBeVisible();
});

test("switches paths from the toolbar path selector", async ({ page }) => {
  await gotoSampleEditor(page);

  await createNewPathFromTopMenu(page, "Second Path");

  await selectToolbarOption(page, "Toolbar path", "Phase 1 Canvas Draft");
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );
  await selectToolbarOption(page, "Toolbar path", "Second Path");
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Second Path",
  );
});

test("keeps actions flyouts stable and closes them after leaving", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await gotoSampleEditor(page);

  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Import" }).hover();
  const importMenu = page.getByTestId("top-menu-actions-import");
  await expect(importMenu).toBeVisible();

  const importBox = await requiredBox(importMenu);
  await page.mouse.move(importBox.x + importBox.width / 2, importBox.y + 12);
  await expect(importMenu).toBeVisible();
  await page.waitForTimeout(350);
  await expect(importMenu).toBeVisible();

  const actionsMenu = page.getByTestId("top-menu-actions");
  const importTriggerBox = await requiredBox(
    actionsMenu.getByRole("menuitem", { name: "Import" }),
  );
  const importBridgePoint = pointBetweenFlyoutAndTrigger(
    importTriggerBox,
    importBox,
  );
  await page.mouse.move(importBridgePoint.x, importBridgePoint.y);
  await expect(importMenu).toHaveCount(0, { timeout: 500 });

  await page.getByRole("menuitem", { name: "Import" }).hover();
  await expect(importMenu).toBeVisible();
  await page.mouse.move(16, 16);
  await expect(importMenu).toHaveCount(0);

  await page.getByRole("menuitem", { name: "Import" }).hover();
  await expect(importMenu).toBeVisible();
  await page.getByRole("menuitem", { name: "Save" }).hover();
  await expect(importMenu).toHaveCount(0);
});

test("closes the open-project panel when using top menus", async ({ page }) => {
  await gotoSampleEditor(page);

  await openProjectPanelFromTopMenu(page);
  await expect(page.getByTestId("open-project-panel")).toBeVisible();

  await page.getByRole("button", { name: "Path", exact: true }).click();
  await expect(page.getByTestId("open-project-panel")).toHaveCount(0);
  await expect(page.getByTestId("top-menu-path")).toBeVisible();

  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByTestId("top-menu-path")).toHaveCount(0);
  await expect(page.getByTestId("top-menu-project")).toBeVisible();
});

test("project and path menus expose import modes without toolbar clutter", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await openProjectPanelFromTopMenu(page);
  await expect(page.getByTestId("open-project-panel")).toBeVisible();

  await openProjectMenu(page);
  await expect(page.getByTestId("open-project-panel")).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(page.getByTestId("top-menu-project-transfer")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Autos Folder..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Project Archive..." }),
  ).toBeVisible();

  await openPathMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(page.getByTestId("top-menu-path-transfer")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Path..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Import", exact: true }),
  ).toHaveCount(0);
});

test("browser autos folder export downloads one zip preserving the autos tree", async ({
  page,
}) => {
  await disableDirectoryPicker(page);
  await gotoSampleEditor(page);

  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(page.getByTestId("top-menu-project-transfer")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export Autos Folder..." }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("autos.zip");
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Expected autos.zip to be available on disk");
  }

  const entries = parseStoredZip(await readFile(downloadPath));
  expect([...entries.keys()].sort()).toEqual([
    "autos/config.json",
    "autos/paths/phase-1-canvas-draft.json",
    "autos/project.json",
  ]);
  expect(JSON.parse(requiredZipText(entries, "autos/config.json"))).toEqual({
    kinematic_constraints: expect.any(Object),
  });
  expect(requiredZipText(entries, "autos/config.json")).not.toContain("gui");
  expect(
    JSON.parse(requiredZipText(entries, "autos/project.json")),
  ).toMatchObject({
    schema_version: 1,
    path_groups: [],
  });
  const exportedPath = JSON.parse(
    requiredZipText(entries, "autos/paths/phase-1-canvas-draft.json"),
  ) as { path_elements?: unknown[] };
  expect(exportedPath).toMatchObject({
    path_elements: expect.any(Array),
  });
  expect(exportedPath.path_elements?.length).toBeGreaterThan(0);
});

test("browser legacy autos folder import re-exports the clean sidecar tree", async ({
  page,
}) => {
  await disableDirectoryPicker(page);
  const tempRoot = await mkdtemp(join(tmpdir(), "bline-web-legacy-autos-"));
  const autosDir = join(tempRoot, "autos");

  try {
    await mkdir(join(autosDir, "paths"), { recursive: true });
    await mkdir(join(autosDir, ".bline-web"), { recursive: true });
    await writeFile(
      join(autosDir, "config.json"),
      JSON.stringify({
        gui: {
          robot: {
            length_meters: 0.71,
            width_meters: 0.92,
          },
        },
        kinematic_constraints: {
          default_max_velocity_meters_per_sec: 5.1,
          default_max_acceleration_meters_per_sec2: 10.5,
          default_intermediate_handoff_radius_meters: 0.28,
          default_max_velocity_deg_per_sec: 650,
          default_max_acceleration_deg_per_sec2: 1700,
          default_end_translation_tolerance_meters: 0.04,
          default_end_rotation_tolerance_deg: 3,
        },
      }),
      "utf8",
    );
    await writeFile(
      join(autosDir, "pathgroups.json"),
      JSON.stringify({
        schema_version: 1,
        groups: [
          {
            group_id: "legacy",
            display_name: "Legacy Group",
            path_file_names: ["legacy_auto.json"],
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(autosDir, ".bline-web", "path-metadata.json"),
      JSON.stringify({
        paths: {
          "legacy_auto.json": {
            editor_metadata: {
              ranged_constraints: [
                {
                  key: "max_velocity_meters_per_sec",
                  value: 2.2,
                  start_ordinal: 1,
                  end_ordinal: 2,
                  source: "auto_velocity",
                  auto_velocity: {
                    velocity_safety_factor: 0.7,
                    acceleration_safety_factor: 0.6,
                    merge_tolerance_meters_per_sec: 0.2,
                  },
                },
              ],
            },
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(autosDir, "paths", "legacy_auto.json"),
      JSON.stringify({
        path: {
          path_elements: [
            { type: "translation", x_meters: 1, y_meters: 2 },
            { type: "translation", x_meters: 3, y_meters: 4 },
          ],
          constraints: {
            max_velocity_meters_per_sec: [
              { value: 2.2, start_ordinal: 0, end_ordinal: 1 },
            ],
          },
        },
      }),
      "utf8",
    );

    await gotoSampleEditor(page);
    const chooserPromise = page.waitForEvent("filechooser");
    await openProjectMenu(page);
    await page.getByRole("menuitem", { name: "Import / Export" }).click();
    await page
      .getByRole("menuitem", { name: "Import Autos Folder..." })
      .click();
    const chooser = await chooserPromise;
    await chooser.setFiles(autosDir);

    await expect(page.getByTestId("current-path-status")).toContainText(
      "legacy auto",
    );

    await openProjectMenu(page);
    await page.getByRole("menuitem", { name: "Import / Export" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("menuitem", { name: "Export Autos Folder..." })
      .click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    if (!downloadPath) {
      throw new Error("Expected autos.zip to be available on disk");
    }

    const entries = parseStoredZip(await readFile(downloadPath));
    expect([...entries.keys()].sort()).toEqual([
      "autos/config.json",
      "autos/paths/legacy_auto.json",
      "autos/project.json",
    ]);
    expect(requiredZipText(entries, "autos/config.json")).not.toContain("gui");
    expect(
      JSON.parse(requiredZipText(entries, "autos/config.json")),
    ).toMatchObject({
      kinematic_constraints: {
        default_max_velocity_meters_per_sec: 5.1,
        default_intermediate_handoff_radius_meters: 0.28,
      },
    });
    expect(
      JSON.parse(requiredZipText(entries, "autos/project.json")),
    ).toMatchObject({
      path_groups: [
        {
          group_id: "legacy",
          display_name: "Legacy Group",
          path_ids: [expect.any(String)],
        },
      ],
      paths: [
        {
          file_name: "legacy_auto.json",
        },
      ],
    });
    expect(
      JSON.parse(requiredZipText(entries, "autos/paths/legacy_auto.json")),
    ).toMatchObject({
      constraints: {
        max_velocity_meters_per_sec: [
          {
            source: "auto_velocity",
          },
        ],
      },
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("path menu export saves the active path and import path round-trips it", async ({
  page,
}) => {
  await installSaveFilePickerSpy(page, { waitForRelease: true });
  await gotoSampleEditor(page);

  await openPathMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await page.getByRole("menuitem", { name: "Export Path..." }).click();

  await releaseSaveFilePicker(page);
  await expect.poll(() => savedFileCount(page)).toBe(1);
  const saved = await savedFile(page, 0);
  expect(saved.suggestedName).toBe("phase-1-canvas-draft.json");
  expect(JSON.parse(saved.text)).toMatchObject({
    path_elements: expect.any(Array),
  });

  const chooserPromise = page.waitForEvent("filechooser");
  await openPathMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await page.getByRole("menuitem", { name: "Import Path..." }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    buffer: Buffer.from(saved.text),
    mimeType: "application/json",
    name: "roundtrip-path.json",
  });

  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: roundtrip path",
  );
});

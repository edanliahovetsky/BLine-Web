import { expect, type Locator, type Page } from "@playwright/test";

import { requiredBox, type Bounds } from "./app-shell-shared";

export async function expectGlobalShortcutsBlockedByDialog(
  page: Page,
  dialog: Locator,
  focusTarget: Locator,
): Promise<void> {
  await expect(dialog).toBeVisible();
  await expect(focusTarget).toBeFocused();

  const inspectorToggle = page.getByRole("button", {
    name: "Toggle inspector",
  });
  const inspectorExpanded = await inspectorToggle.getAttribute("aria-expanded");
  const useMetaKey = process.platform === "darwin";
  const results = await page.evaluate(
    ({ metaKey }) => {
      const target = document.activeElement;
      if (!(target instanceof HTMLElement)) {
        throw new Error("Expected the blocking surface to own focus");
      }

      return ["b", "s", "k", "F1"].map((key) => {
        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: key === "F1" ? false : !metaKey,
          key,
          metaKey: key === "F1" ? false : metaKey,
        });
        target.dispatchEvent(event);
        return { defaultPrevented: event.defaultPrevented, key };
      });
    },
    { metaKey: useMetaKey },
  );

  expect(results).toEqual([
    { defaultPrevented: false, key: "b" },
    { defaultPrevented: false, key: "s" },
    { defaultPrevented: false, key: "k" },
    { defaultPrevented: false, key: "F1" },
  ]);
  await expect(inspectorToggle).toHaveAttribute(
    "aria-expanded",
    inspectorExpanded ?? "false",
  );
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(focusTarget).toBeFocused();
}

export async function expectDialogOverPathLibrary(
  page: Page,
  dialogName: string,
): Promise<void> {
  const libraryBox = await requiredBox(
    page.getByRole("dialog", { name: "Project Navigator" }),
  );
  const dialogBox = await requiredBox(
    page.getByRole("dialog", { name: dialogName }),
  );
  const center = {
    x: dialogBox.x + dialogBox.width / 2,
    y: dialogBox.y + dialogBox.height / 2,
  };

  expect(center.x).toBeGreaterThan(libraryBox.x);
  expect(center.x).toBeLessThan(libraryBox.x + libraryBox.width);
  expect(center.y).toBeGreaterThan(libraryBox.y);
  expect(center.y).toBeLessThan(libraryBox.y + libraryBox.height);

  await expect
    .poll(() =>
      page.evaluate(({ x, y }) => {
        return (
          document
            .elementFromPoint(x, y)
            ?.closest("[role='dialog']")
            ?.getAttribute("aria-label") ?? null
        );
      }, center),
    )
    .toBe(dialogName);
}

export function pointBetweenFlyoutAndTrigger(
  triggerBox: Bounds,
  flyoutBox: Bounds,
): { x: number; y: number } {
  const triggerLeft = triggerBox.x;
  const triggerRight = triggerBox.x + triggerBox.width;
  const flyoutLeft = flyoutBox.x;
  const flyoutRight = flyoutBox.x + flyoutBox.width;
  const x =
    flyoutLeft >= triggerRight
      ? (triggerRight + flyoutLeft) / 2
      : triggerLeft >= flyoutRight
        ? (flyoutRight + triggerLeft) / 2
        : (Math.max(triggerLeft, flyoutLeft) +
            Math.min(triggerRight, flyoutRight)) /
          2;

  return {
    x,
    y: triggerBox.y + triggerBox.height / 2,
  };
}

export async function currentPathName(page: {
  getByTestId(testId: string): Locator;
}): Promise<string> {
  const currentPath = await page
    .getByTestId("current-path-status")
    .textContent();
  if (!currentPath?.startsWith("Current Path: ")) {
    throw new Error("Expected current path status to include a project name");
  }

  return currentPath.replace("Current Path: ", "");
}

export async function openProjectMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "File", exact: true }).click();
}

export async function openProjectPanelFromTopMenu(page: Page): Promise<void> {
  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Workspace" }).click();
  await page.getByRole("menuitem", { name: "Open Project..." }).click();
}

export async function runEditMenuAction(
  page: Page,
  action: "Undo" | "Redo",
): Promise<void> {
  // Undo/Redo now live on the toolbar rather than an Edit menu.
  await page.getByRole("button", { name: action, exact: true }).click();
}

export async function openPathMenu(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Path", exact: true }).click();
  const menu = page.getByTestId("top-menu-path");
  await expect(menu).toBeVisible();
  return menu;
}

export async function openPathManageMenu(page: Page): Promise<Locator> {
  await openPathMenu(page);
  await page.getByRole("menuitem", { name: "Manage Paths" }).click();
  const menu = page.getByTestId("top-menu-path-manage");
  await expect(menu).toBeVisible();
  return menu;
}

export async function openPathLibraryDialog(page: Page): Promise<Locator> {
  await page
    .getByRole("button", { name: "Open project navigator", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Project Navigator" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function selectToolbarOption(
  page: Page,
  label: "Toolbar collection" | "Toolbar path",
  optionName: string,
): Promise<void> {
  await page.getByLabel(label).click();
  await page
    .getByRole("listbox", { name: `${label} options` })
    .getByRole("option", { name: optionName, exact: true })
    .click();
}

export async function createPathGroupFromTopMenu(
  page: Page,
  groupName: string,
): Promise<void> {
  const dialog = await openPathLibraryDialog(page);
  await dialog.getByRole("button", { name: "Create collection" }).click();
  await page.getByTestId("path-collection-new-name").fill(groupName);
  await page.getByTestId("create-path-collection").click();
  await expect(page.getByTestId("current-path-status")).toContainText(
    `${groupName} /`,
  );
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
}

export async function addPathToGroupFromLibrary(
  page: Page,
  groupName: string,
  pathName: string,
): Promise<void> {
  const dialog = await openPathLibraryDialog(page);
  await dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "All Paths" })
    .click();
  await dialog
    .locator(".path-library-dialog__path")
    .filter({ hasText: pathName })
    .click();
  const membershipRow = dialog
    .locator(".path-library-dialog__membership-row")
    .filter({ hasText: groupName });
  await membershipRow.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
}

export async function duplicateSelectedLibraryPath(
  page: Page,
  pathHeaderActions: Locator,
  displayName: string,
): Promise<void> {
  await pathHeaderActions.getByRole("button", { name: "Save path as" }).click();
  await submitNameDialog(page, "Save Path As", displayName, "Save Copy");
  await expect(
    page
      .getByRole("dialog", { name: "Project Navigator" })
      .locator(".path-library-dialog__path")
      .filter({ hasText: displayName }),
  ).toBeVisible();
}

export async function submitNameDialog(
  page: Page,
  dialogName: "Rename Collection" | "Rename Path" | "Save Path As",
  displayName: string,
  submitLabel: "Rename" | "Save Copy",
): Promise<void> {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill(displayName);
  await dialog.getByRole("button", { name: submitLabel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

let createdProjectSequence = 0;

export async function createNewProject(
  page: Page,
): Promise<{ pathName: string; projectName: string }> {
  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Workspace" }).click();
  await page.getByRole("menuitem", { name: "New Project" }).click();
  createdProjectSequence += 1;
  const projectName = `Test Project ${createdProjectSequence}`;
  const pathName = `Test Path ${createdProjectSequence}`;
  const dialog = page.getByRole("dialog", { name: "Create project" });
  await dialog.getByRole("textbox", { name: "Project name" }).fill(projectName);
  await dialog.getByRole("textbox", { name: "First path name" }).fill(pathName);
  await dialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  return { pathName, projectName };
}

export async function openConstraintsTab(page: Page): Promise<void> {
  const constraintsTab = page.getByRole("tab", { name: /Constraints/ });
  if (!(await constraintsTab.isVisible())) {
    await page.getByRole("button", { name: "Toggle inspector" }).click();
  }
  await constraintsTab.click();
}

export async function createNewPathFromTopMenu(
  page: Page,
  pathName: string,
): Promise<void> {
  await openPathManageMenu(page);
  await page.getByRole("menuitem", { name: "Create New Path" }).click();
  const dialog = page.getByRole("dialog", { name: "Create New Path" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Path name").fill(pathName);
  await dialog.getByRole("button", { name: "Create Path" }).click();
}

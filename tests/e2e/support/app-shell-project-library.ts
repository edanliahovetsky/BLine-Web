import { expect, type Locator, type Page } from "@playwright/test";

import { requiredBox, type Bounds } from "./app-shell-shared";

export async function expectDialogOverPathLibrary(
  page: Page,
  dialogName: string,
): Promise<void> {
  await expect(
    page.getByRole("dialog", { name: "Project Navigator" }),
  ).toBeVisible();
  const dialogBox = await requiredBox(
    page.getByRole("dialog", { name: dialogName }),
  );
  const center = {
    x: dialogBox.x + dialogBox.width / 2,
    y: dialogBox.y + dialogBox.height / 2,
  };

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

export async function openLabelManager(library: Locator): Promise<Locator> {
  await library
    .getByRole("button", { name: "Manage labels…", exact: true })
    .click();
  const manager = library.getByRole("region", { name: "Manage labels" });
  await expect(manager).toBeVisible();
  return manager;
}

export async function openLibraryPathActions(
  library: Locator,
  pathName: string,
): Promise<Locator> {
  await library
    .getByRole("button", { name: `More actions for ${pathName}` })
    .click();
  const menu = library.getByRole("menu", { name: `${pathName} actions` });
  await expect(menu).toBeVisible();
  return menu;
}

export async function selectToolbarOption(
  page: Page,
  label: "Toolbar path",
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
  await openLabelManager(dialog);
  await dialog.getByRole("button", { name: "Create label" }).click();
  await page.getByTestId("path-collection-new-name").fill(groupName);
  await page.getByTestId("create-path-collection").click();
  await expect(page.getByTestId("current-path-status")).toContainText(
    `${groupName} /`,
  );
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
}

export async function addPathToGroupFromLibrary(
  page: Page,
  groupName: string,
  pathName: string,
): Promise<void> {
  const dialog = await openPathLibraryDialog(page);
  await openLabelManager(dialog);
  await dialog
    .locator(".path-library-dialog__manage-label")
    .filter({ hasText: groupName })
    .click();
  const membershipRow = dialog
    .locator(".path-library-dialog__membership-row")
    .filter({ hasText: pathName });
  await membershipRow.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
}

export async function duplicateSelectedLibraryPath(
  page: Page,
  library: Locator,
  pathName: string,
  displayName: string,
): Promise<void> {
  const pathActions = await openLibraryPathActions(library, pathName);
  await pathActions.getByRole("menuitem", { name: "Duplicate" }).click();
  await submitNameDialog(page, "Save Path As", displayName, "Save Copy");
  await expect(
    page
      .getByRole("dialog", { name: "Project Navigator" })
      .locator(".path-library-dialog__path")
      .filter({ has: page.getByText(displayName, { exact: true }) }),
  ).toBeVisible();
}

export async function submitNameDialog(
  page: Page,
  dialogName: "Rename Label" | "Rename Path" | "Save Path As",
  displayName: string,
  submitLabel: "Rename" | "Save Copy",
): Promise<void> {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill(displayName);
  await dialog.getByRole("button", { name: submitLabel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
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

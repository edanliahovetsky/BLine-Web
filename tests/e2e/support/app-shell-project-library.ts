import { expect, type Locator, type Page } from "@playwright/test";

import type { Bounds } from "./app-shell-shared";

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
  await dialog.getByRole("button", { name: "Create Collection" }).click();
  await dialog
    .getByRole("textbox", { name: "Collection name" })
    .fill(groupName);
  await dialog.getByRole("textbox", { name: "Collection name" }).press("Enter");
  await dialog.getByRole("button", { name: "Add to…" }).click();
  await dialog
    .getByRole("menu", { name: "Add to Collections" })
    .getByRole("menuitemcheckbox", { name: new RegExp(groupName) })
    .click();
  await expect(page.getByTestId("current-path-status")).toContainText(
    `${groupName} /`,
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
}

export async function addPathToGroupFromLibrary(
  page: Page,
  groupName: string,
  pathName: string,
): Promise<void> {
  const dialog = await openPathLibraryDialog(page);
  await dialog.locator(".all-paths__row").filter({ hasText: pathName }).click();
  await dialog.getByRole("button", { name: "Add to…" }).click();
  const membership = dialog
    .getByRole("menu", { name: "Add to Collections" })
    .getByRole("menuitemcheckbox", { name: new RegExp(groupName) });
  if ((await membership.getAttribute("aria-checked")) !== "true") {
    await membership.click();
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
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

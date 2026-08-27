import { expect, test } from "@playwright/test";

import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";

test("uses the approved Project Library and unique All Paths layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoSampleEditor(page);

  await page.getByRole("button", { name: "Open project navigator" }).click();
  const navigator = page.getByRole("dialog", { name: "Project Navigator" });
  await expect(navigator.getByLabel("Project library")).toBeVisible();
  await expect(navigator.getByLabel("All Paths")).toBeVisible();
  await expect.poll(async () => (await requiredBox(navigator)).x).toBe(0);
  const bounds = await requiredBox(navigator);
  expect(bounds.width).toBeGreaterThanOrEqual(700);
  expect(bounds.width).toBeLessThanOrEqual(900);

  await expect(
    navigator
      .locator(".project-navigator__header")
      .getByRole("button", { name: /new path/i }),
  ).toHaveCount(0);
  const actionButtons = navigator.locator(".all-paths__actions button");
  await expect(actionButtons.nth(1)).toHaveAccessibleName("Create new path");
  await expect(actionButtons.nth(2)).toHaveAccessibleName(
    "Duplicate selected path",
  );
  await expect(navigator.getByText(/Enter to save|Esc to cancel/)).toHaveCount(
    0,
  );

  const pathRows = navigator.locator(".all-paths__row");
  await expect(pathRows).toHaveCount(1);
  await navigator.getByRole("button", { name: "Create Collection" }).click();
  const collectionInput = navigator.getByRole("textbox", {
    name: "Collection name",
  });
  await expect(collectionInput).toBeFocused();
  await collectionInput.fill("Competition Autos");
  await collectionInput.press("Enter");

  await navigator.getByRole("button", { name: "Add to…" }).click();
  await navigator
    .getByRole("menu", { name: "Add to Collections" })
    .getByRole("menuitemcheckbox", { name: /Competition Autos/ })
    .click();
  await expect(
    pathRows.getByRole("button", { name: "Competition Autos" }),
  ).toBeVisible();

  await navigator
    .getByRole("button", { name: "Collection actions for Competition Autos" })
    .click();
  await navigator
    .getByRole("menuitem", { name: "Duplicate Collection" })
    .click();
  await collectionInput.fill("Testing");
  await collectionInput.press("Enter");
  await expect(pathRows).toHaveCount(1);
  await expect(pathRows.getByRole("button", { name: "Testing" })).toBeVisible();

  await navigator
    .getByRole("button", { name: "Collection actions for Testing" })
    .click();
  await navigator.getByRole("menuitem", { name: "Delete Collection" }).click();
  const deleteCollection = page.getByRole("dialog", {
    name: "Delete Collection",
  });
  await expect(deleteCollection).toContainText("remain in All Paths");
  await deleteCollection
    .getByRole("button", { name: "Delete Collection", exact: true })
    .click();
  await expect(pathRows).toHaveCount(1);
});

test("renames Paths inline and supports bulk Collection membership", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Open project navigator" }).click();
  const navigator = page.getByRole("dialog", { name: "Project Navigator" });

  await navigator.getByRole("button", { name: "Create Collection" }).click();
  let collectionInput = navigator.getByRole("textbox", {
    name: "Collection name",
  });
  await collectionInput.fill("Competition Autos");
  await collectionInput.press("Enter");

  await navigator
    .getByRole("button", { name: "Duplicate selected path" })
    .click();
  const pathInput = navigator.getByRole("textbox", { name: "Path name" });
  await expect(pathInput).toBeFocused();
  await pathInput.fill("Left Coral + Barge");
  await pathInput.press("Enter");
  await expect(navigator.locator(".all-paths__row")).toHaveCount(2);

  await navigator.getByRole("button", { name: "Rename selected path" }).click();
  await pathInput.fill("Left Coral + Barge Renamed");
  await pathInput.press("Enter");
  await expect(
    navigator.locator(".all-paths__row").filter({
      hasText: "Left Coral + Barge Renamed",
    }),
  ).toBeVisible();

  await navigator
    .locator(".all-paths__row")
    .filter({ hasText: "Phase 1 Canvas Draft" })
    .click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  await expect(navigator.getByText("2 Paths selected")).toBeVisible();

  await navigator.getByRole("button", { name: "Create Collection" }).click();
  collectionInput = navigator.getByRole("textbox", { name: "Collection name" });
  await collectionInput.fill("Testing");
  await collectionInput.press("Enter");
  await navigator.getByRole("button", { name: "Add to…" }).click();
  await navigator
    .getByRole("menu", { name: "Add to Collections" })
    .getByRole("menuitemcheckbox", { name: /Testing/ })
    .click();
  await expect(
    navigator
      .locator(".all-paths__row")
      .getByRole("button", { name: "Testing" }),
  ).toHaveCount(2);

  await navigator
    .getByRole("button", { name: "Delete selected paths" })
    .click();
  const deletePaths = page.getByRole("dialog", { name: "Delete Paths" });
  await expect(
    deletePaths.locator("input[type='checkbox']:checked"),
  ).toHaveCount(2);
  await deletePaths.getByRole("button", { name: "Cancel" }).click();
});

test("drags Paths into and back out of Collections", async ({ page }) => {
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Open project navigator" }).click();
  const navigator = page.getByRole("dialog", { name: "Project Navigator" });

  await navigator.getByRole("button", { name: "Create Collection" }).click();
  const collectionInput = navigator.getByRole("textbox", {
    name: "Collection name",
  });
  await collectionInput.fill("Testing");
  await collectionInput.press("Enter");

  const pathRow = navigator.locator(".all-paths__row").first();
  const collectionRow = navigator
    .locator(".project-library__collection-row")
    .first();
  await pathRow.dragTo(collectionRow);
  await expect(pathRow.getByRole("button", { name: "Testing" })).toBeVisible();

  const collectionChild = navigator.locator(".project-library__child").first();
  await collectionChild.dragTo(navigator.locator(".all-paths__list"));
  await expect(pathRow.getByRole("button", { name: "Testing" })).toHaveCount(0);
  await expect(pathRow).toBeVisible();
});

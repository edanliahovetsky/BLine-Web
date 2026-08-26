import { expect, test, type Page } from "@playwright/test";
import { modelToCanvasPoint } from "./support/app-shell-canvas";
import { openConstraintsTab } from "./support/app-shell-constraints";
import { activeFieldLabel } from "./support/app-shell-fields";
import { openPathLibraryDialog } from "./support/app-shell-project-library";
import {
  dismissMobileSupportWarning,
  gotoSampleEditor,
  requiredBox,
} from "./support/app-shell-shared";

test("opens help and the five-lesson course", async ({ page }) => {
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  const hub = page.getByTestId("help-hub");
  await expect(hub.getByRole("link", { name: /Documentation/ })).toBeVisible();
  await hub.getByTestId("start-guided-tour").click();

  const picker = page.getByTestId("tour-picker");
  await expect(picker).toBeVisible();
  for (const title of [
    "Build a First Path",
    "Shape the Route",
    "Plan the Speed",
    "Add Heading and Events",
    "Verify and Export",
  ]) {
    await expect(picker.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(page.getByTestId("tour-picker-progress")).toHaveText(
    "0 of 5 lessons complete",
  );
});

test("runs lessons in an isolated practice session", async ({ page }) => {
  await gotoSampleEditor(page);
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );

  await openLesson(page, "build-first-path");
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Tour practice",
  );

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );
  await page.reload();
  await dismissMobileSupportWarning(page);
  const dialog = await openPathLibraryDialog(page);
  await expect(dialog.getByText("Tour practice", { exact: true })).toHaveCount(
    0,
  );
});

test("builds and orders the first path with manual Continue gates", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openLesson(page, "build-first-path");
  const card = page.getByTestId("tour-card");

  await expect(page.getByLabel("Start zone")).toBeVisible();
  await expect(page.getByLabel("Goal zone")).toBeVisible();
  await expect(card).toContainText("You are on a practice path");
  await next(page, 3);

  await expect(card).toContainText("Place the start");
  await page
    .getByRole("button", { name: "Waypoint tool", exact: true })
    .click();
  await clickFieldPoint(page, 8, 2);
  await expect(card).toContainText("Done. Keep experimenting or continue.");
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 4 of 13");
  await card.getByRole("button", { name: "Next", exact: true }).click();

  await expect(card).toContainText("The start pose");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("button", { name: "Waypoint tool", exact: true })
    .click();
  await clickFieldPoint(page, 10, 3.2);
  await expect(card).toContainText("Done. Keep experimenting or continue.");
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 6 of 13");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("button", { name: "Waypoint tool", exact: true })
    .click();
  await clickFieldPoint(page, 12.5, 4.8);
  await expect(card).toContainText("Done. Keep experimenting or continue.");
  await card.getByRole("button", { name: "Next", exact: true }).click();

  await expect(card).toContainText("Put them in drive order");
  await expect(page.getByTestId("path-element-row-1")).toContainText(
    "12.50, 4.80 m",
  );
  await expect(page.getByTestId("path-element-row-2")).toContainText(
    "10.00, 3.20 m",
  );
  const middleRow = await requiredBox(page.getByTestId("path-element-row-2"));
  const goalRow = await requiredBox(page.getByTestId("path-element-row-1"));
  await page.mouse.move(
    middleRow.x + middleRow.width / 2,
    middleRow.y + middleRow.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    goalRow.x + goalRow.width / 2,
    goalRow.y + goalRow.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(card).toContainText("Done. Keep experimenting or continue.");
  await expect(page.getByTestId("path-element-row-1")).toContainText(
    "10.00, 3.20 m",
  );
  await expect(page.getByTestId("path-element-row-2")).toContainText(
    "12.50, 4.80 m",
  );
});

test("stages field actions beside target-relative dialogue and fades for inspection", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openLesson(page, "shape-route");
  await next(page, 2);

  const card = page.getByTestId("tour-card");
  const structure = page.getByLabel("Field structure");
  const cardBox = await requiredBox(card);
  const structureBox = await requiredBox(structure);

  expect(cardBox.x + cardBox.width).toBeLessThan(structureBox.x);

  await page.waitForTimeout(500);
  await card.getByRole("heading", { name: "Bend the route" }).hover();
  await expect(card).toHaveCSS("opacity", "0.2");

  await card.getByRole("button", { name: "Back" }).hover();
  await expect(card).toHaveCSS("opacity", "1");
});

test("tunes the Shape lesson handoff radius through Constraints", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "shape-route");
  const card = page.getByTestId("tour-card");
  await next(page, 2);

  await page
    .getByRole("button", { name: "Translation tool", exact: true })
    .click();
  const canvas = page.getByTestId("path-stage-canvas");
  const targetPoint = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 11.6,
    y_meters: 6,
  });
  await page.mouse.click(targetPoint.x, targetPoint.y);
  await expect(card).toContainText("Done. Keep experimenting or continue.");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(card).toContainText("Done. Keep experimenting or continue.");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await card.getByRole("button", { name: "Next", exact: true }).click();

  await page.mouse.click(targetPoint.x, targetPoint.y);
  await expect(card).toContainText("Done. Keep experimenting or continue.");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await card.getByRole("button", { name: "Next", exact: true }).click();

  await expect(card).toContainText("Tune the handoff");
  await expect(page.getByRole("tab", { name: "Constraints" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByLabel("Handoff Radius (m)")).toHaveCount(0);

  await page
    .getByRole("group", { name: "Handoff radius mode" })
    .getByRole("button", { name: "Manual" })
    .click();
  await expect(card.getByRole("button", { name: "Next" })).toHaveCount(0);
  const radius = page.getByLabel("Handoff radius 2 value");
  await radius.fill("1.1");
  await radius.press("Enter");
  await expect(card).toContainText("Done. Keep experimenting or continue.");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await card.getByRole("button", { name: "Next", exact: true }).click();

  await expect(card).toContainText("Regenerate the constraints");
  await page
    .getByRole("button", { name: "Generate constraints", exact: true })
    .click();
  await expect(card).toContainText("Done. Keep experimenting or continue.");
});

test("uses each simulation control for one clear purpose", async ({ page }) => {
  await gotoSampleEditor(page);
  await openLesson(page, "heading-events");
  const card = page.getByTestId("tour-card");
  await expect(page.getByLabel("Game piece")).toBeVisible();
  await next(page, 2);

  await expect(card).toContainText("Add a rotation target");
  await expect(page.getByRole("button", { name: "Rotation tool" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Event tool" })).toBeEnabled();
  await expect(page.locator('[data-tour="transport-timeline"]')).toBeVisible();
});

test("starts inspector lessons on Elements and restores the previous tab", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);
  const fieldBefore = await activeFieldLabel(page);
  await openLesson(page, "plan-speed");
  const card = page.getByTestId("tour-card");
  await next(page, 2);

  await expect(card).toContainText("Open Constraints");
  await expect(page.getByRole("tab", { name: "Elements" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Constraints" }).click();
  await expect(card).toContainText("Done. Keep experimenting or continue.");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "Constraints" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect.poll(() => activeFieldLabel(page)).toBe(fieldBefore);
});

test("seeds the capstone with real repair work", async ({ page }) => {
  await gotoSampleEditor(page);
  await openLesson(page, "verify-export");
  await expect(
    page.getByRole("button", { name: "Path health: 2 issues" }),
  ).toBeVisible();

  const card = page.getByTestId("tour-card");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: /^Path health/ }).click();
  await expect(card).toContainText("Done. Keep experimenting or continue.");
  await expect(page.getByRole("dialog", { name: "Path health" })).toContainText(
    "needs a command key",
  );
  await expect(page.getByRole("dialog", { name: "Path health" })).toContainText(
    "outside the configured field",
  );
});

test("starts from the home page and returns there when skipped", async ({
  page,
}) => {
  await page.goto("/");
  await dismissMobileSupportWarning(page);
  await page.getByTestId("start-center-guided-tour").click();
  await expect(page.getByTestId("tour-picker")).toBeVisible();
  await page.getByTestId("tour-picker-build-first-path").click();
  await expect(page.getByTestId("tour-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Simple, rapid, robust." }),
  ).toBeVisible();
});

test("hides guided lessons below the mobile support threshold", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openLesson(page, "shape-route");
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
  await dismissMobileSupportWarning(page);
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await expect(page.getByTestId("start-guided-tour")).toBeDisabled();
});

async function openLesson(page: Page, id: string): Promise<void> {
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId(`tour-picker-${id}`).click();
  await expect(page.getByTestId("tour-card")).toBeVisible();
}

async function next(page: Page, times: number): Promise<void> {
  const card = page.getByTestId("tour-card");
  for (let index = 0; index < times; index += 1) {
    await card.getByRole("button", { name: "Next", exact: true }).click();
  }
}

async function clickFieldPoint(
  page: Page,
  xMeters: number,
  yMeters: number,
): Promise<void> {
  const stage = page.getByTestId("path-stage");
  const box = await requiredBox(stage);
  const padding = 24;
  const availableWidth = box.width - padding * 2;
  const availableHeight = box.height - padding * 2;
  const scale = Math.min(availableWidth / 18, availableHeight / 9);
  const fieldWidth = 18 * scale;
  const fieldHeight = 9 * scale;
  const fieldLeft = box.x + (box.width - fieldWidth) / 2;
  const fieldTop = box.y + (box.height - fieldHeight) / 2;
  await page.mouse.click(
    fieldLeft + xMeters * scale,
    fieldTop + (9 - yMeters) * scale,
  );
}

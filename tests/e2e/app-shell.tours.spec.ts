import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
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
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "build-first-path");
  const card = page.getByTestId("tour-card");

  await expect(page.getByLabel("Start", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Delivery", { exact: true })).toBeVisible();
  await expect(card).toContainText("A route to Delivery");
  await next(page, 1);

  await expect(card).toContainText("Place the endpoints");
  await page
    .getByRole("button", { name: "Waypoint tool", exact: true })
    .click();
  const canvas = page.getByTestId("path-stage-canvas");
  const startPoint = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 8,
    y_meters: 2,
  });
  await page.mouse.click(startPoint.x, startPoint.y);
  await expect(card).toContainText("Place two waypoints");
  await expect(page.locator('[data-testid^="path-element-row-"]')).toHaveCount(
    1,
  );
  await page
    .getByRole("button", { name: "Waypoint tool", exact: true })
    .click();
  const goalPoint = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 12.5,
    y_meters: 4.8,
  });
  await page.mouse.click(goalPoint.x, goalPoint.y);
  await expect(card).toContainText("The new elements are in place.");
  await clickFieldPoint(page, 9, 8);
  await expect(page.locator('[data-testid^="path-element-row-"]')).toHaveCount(
    2,
  );
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 2 of 11");
  await card.getByRole("button", { name: "Next", exact: true }).click();

  await expect(card).toContainText("Start and End");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("button", { name: "Waypoint tool", exact: true })
    .click();
  const middlePoint = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 10,
    y_meters: 7,
  });
  await page.mouse.click(middlePoint.x, middlePoint.y);
  await expect(card).toContainText("The new elements are in place.");
  await clickFieldPoint(page, 14, 7);
  await expect(page.locator('[data-testid^="path-element-row-"]')).toHaveCount(
    3,
  );
  await card.getByRole("button", { name: "Next", exact: true }).click();

  await expect(card).toContainText("Put it in drive order");
  const goalMeta = await page
    .getByTestId("path-element-row-1")
    .locator(".path-element-row__meta")
    .innerText();
  const middleMeta = await page
    .getByTestId("path-element-row-2")
    .locator(".path-element-row__meta")
    .innerText();
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

  await expect(card).toContainText("The route now visits Start");
  await expect(page.getByTestId("path-element-row-1")).toContainText(
    middleMeta,
  );
  await expect(page.getByTestId("path-element-row-2")).toContainText(goalMeta);

  await next(page, 1);
  for (let index = 0; index < 4; index += 1) {
    await card.getByRole("button", { name: "Back", exact: true }).click();
  }
  await expect(card).toContainText("Place the endpoints");
  await expect(card).toContainText("Previously completed");
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-testid^="path-element-row-"]')).toHaveCount(
    3,
  );
  await card
    .getByRole("button", { name: "Restart exercise", exact: true })
    .click();
  await expect(page.locator('[data-testid^="path-element-row-"]')).toHaveCount(
    0,
  );
  await expect(card).toContainText("Place two waypoints");
});

test("keeps tour actions visible and fades dialogue for inspection", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "shape-route");
  await next(page, 1);

  const card = page.getByTestId("tour-card");
  const skip = card.getByRole("button", { name: "Skip tour" });

  await expect(skip).toHaveCSS("border-top-style", "solid");
  await expect(skip).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");

  await skip.hover();
  await page.mouse.down();
  await expect(skip).toHaveCSS("transform", "none");
  await page.mouse.move(0, 0);
  await page.mouse.up();

  await page.waitForTimeout(500);
  await card.getByRole("heading", { name: "Bend the route" }).hover();
  await expect(card).toHaveCSS("opacity", "0.2");

  await card.getByRole("button", { name: "Back" }).hover();
  await expect(card).toHaveCSS("opacity", "1");
});

test("tunes the Shape lesson handoff radius through Constraints", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "shape-route");
  const card = page.getByTestId("tour-card");
  await next(page, 1);

  await page
    .getByRole("button", { name: "Translation tool", exact: true })
    .click();
  const canvas = page.getByTestId("path-stage-canvas");
  const targetPoint = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 10.8,
    y_meters: 6.8,
  });
  await page.mouse.click(targetPoint.x, targetPoint.y);
  await next(page, 2);

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
  await radius.fill("0.25");
  await radius.press("Enter");
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
  await next(page, 1);
  await saveReference(page);
  await next(page, 1);
  await setNumber(page, "Handoff radius 2 value", "1.5");
  await next(page, 1);
  await replayComparison(page);
  await next(page, 1);
  await setNumber(page, "Handoff radius 2 value", "0.25");
  await next(page, 1);
  await page
    .getByRole("button", { name: "Generate constraints", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
});

test("uses each simulation control for one clear purpose", async ({ page }) => {
  await gotoSampleEditor(page);
  await openLesson(page, "heading-events");
  const card = page.getByTestId("tour-card");
  await expect(page.getByLabel("Pickup", { exact: true })).toBeVisible();
  await next(page, 1);

  await expect(card).toContainText("Add a rotation target");
  await expect(
    page.getByRole("button", { name: "Rotation tool" }),
  ).toBeEnabled();
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
  await next(page, 1);

  await expect(card).toContainText("Open Constraints");
  await expect(page.getByRole("tab", { name: "Elements" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Constraints" }).click();
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();

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
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
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

function modelToCanvasPoint(
  box: { x: number; y: number; width: number; height: number },
  point: { x_meters: number; y_meters: number },
) {
  const scale = Math.min((box.width - 48) / 18, (box.height - 48) / 9);
  return {
    x: box.x + (box.width - 18 * scale) / 2 + point.x_meters * scale,
    y: box.y + (box.height - 9 * scale) / 2 + (9 - point.y_meters) * scale,
  };
}
async function setNumber(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Enter");
}
async function saveReference(page: Page) {
  await page
    .getByRole("button", { name: "Compare your path", exact: true })
    .click();
  await page.getByRole("button", { name: "Save current as reference" }).click();
  await expect(
    page.getByRole("dialog", { name: "Compare your path" }),
  ).toContainText("Saved reference");
  await page.getByRole("button", { name: "Close comparison" }).click();
}
async function replayComparison(page: Page) {
  await page
    .getByRole("button", { name: "Compare your path", exact: true })
    .click();
  const lab = page.getByRole("dialog", { name: "Compare your path" });
  await lab.getByLabel("Half speed").uncheck();
  await lab.getByLabel(/Focus on/).check();
  await lab.getByRole("button", { name: "Replay comparison" }).click();
  await expect(
    lab.getByRole("button", { name: "Replay comparison" }),
  ).toBeVisible({ timeout: 20_000 });
  await lab.getByRole("button", { name: "Close comparison" }).click();
}

async function watchRun(page: Page) {
  await page
    .getByRole("button", { name: "Play simulation", exact: true })
    .click();
  await expect(
    page
      .getByTestId("tour-card")
      .getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible({ timeout: 25_000 });
}

test("completes the heading lesson and its independent event challenge", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "heading-events");
  await next(page, 1);
  await page
    .getByRole("button", { name: "Rotation tool", exact: true })
    .click();
  const canvas = page.getByTestId("path-stage-canvas");
  const rotation = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 6.5,
    y_meters: 4,
  });
  await page.mouse.click(rotation.x, rotation.y);
  await next(page, 1);
  await setNumber(page, "Rotation (deg)", "90");
  await setNumber(page, "Rotation Pos (0-1)", "0.5");
  await page.getByLabel("Profiled Rotation", { exact: true }).check();
  const card = page.getByTestId("tour-card");
  await card.getByRole("button", { name: "Get a hint" }).click();
  await card.getByRole("button", { name: "More help" }).click();
  await card.getByRole("button", { name: "Show worked example" }).click();
  await expect(
    page.getByRole("dialog", { name: "Worked example" }),
  ).toContainText("Non-profiled");
  await page.getByRole("button", { name: "Close comparison" }).click();
  await next(page, 1);
  await watchRun(page);
  await next(page, 1);
  await page.getByRole("button", { name: "Event tool", exact: true }).click();
  const event = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 7.1,
    y_meters: 4.8,
  });
  await page.mouse.click(event.x, event.y);
  await next(page, 1);
  await page.getByLabel("Lib Key", { exact: true }).fill("startIntake");
  await setNumber(page, "Event Pos (0-1)", "0.7");
  await next(page, 1);
  await watchRun(page);
  await next(page, 1);
  const timeline = page.getByLabel("Simulation time", { exact: true });
  await timeline.fill("1");
  await next(page, 1);
  await setNumber(page, "Event Pos (0-1)", "0.6");
  await next(page, 1);
  await watchRun(page);
  await next(page, 1);
  await card.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.getByTestId("tour-picker-progress")).toHaveText(
    "1 of 5 lessons complete",
  );
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );
});

test("compares speed caps and preserves the manual turn during the delivery challenge", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "plan-speed");
  await next(page, 1);
  await page.getByRole("tab", { name: "Constraints", exact: true }).click();
  await next(page, 1);
  await page
    .getByRole("button", { name: "Generate constraints", exact: true })
    .click();
  await next(page, 2);
  const splitRanges = page.locator(
    '[data-ranged-constraint-key="max_velocity_meters_per_sec"][data-range-start]',
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let separated = false;
    for (const range of await splitRanges.all()) {
      const start = Number(await range.getAttribute("data-range-start"));
      const end = Number(await range.getAttribute("data-range-end"));
      if (start <= 3 && end >= 3) {
        separated = start === 3 && end === 3;
        if (!separated) {
          await range.click();
          await page.getByRole("button", { name: /^Split constraint/ }).click();
        }
        break;
      }
    }
    if (separated) break;
  }
  await next(page, 1);
  await saveReference(page);
  await next(page, 1);
  const ranges = page.locator(
    '[data-ranged-constraint-key="max_velocity_meters_per_sec"][data-range-start]',
  );
  const corner = ranges.filter({ hasText: "" });
  for (const range of await corner.all()) {
    const start = Number(await range.getAttribute("data-range-start"));
    const end = Number(await range.getAttribute("data-range-end"));
    if (start <= 3 && end >= 3) {
      await range.click();
      break;
    }
  }
  const value = page.getByLabel(/^Constraint \d+ value$/);
  await value.fill("1.2");
  await value.press("Enter");
  await next(page, 1);
  await replayComparison(page);
  await next(page, 1);
  await page
    .getByRole("button", { name: "Generate constraints", exact: true })
    .click();
  await next(page, 1);
  for (const range of await ranges.all()) {
    const start = Number(await range.getAttribute("data-range-start"));
    const end = Number(await range.getAttribute("data-range-end"));
    if (start <= 4 && end >= 4) {
      await range.click();
      break;
    }
  }
  await value.fill("0.8");
  await value.press("Enter");
  await next(page, 1);
  await watchRun(page);
  await next(page, 1);
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Finish", exact: true })
    .click();
  await expect(page.getByTestId("tour-picker-progress")).toHaveText(
    "1 of 5 lessons complete",
  );
});

test("repairs the complete mission and exports the actual practice files", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSampleEditor(page);
  await openLesson(page, "verify-export");
  await next(page, 1);
  await page.getByRole("button", { name: /^Path health/ }).click();
  const card = page.getByTestId("tour-card");
  const health = page.getByRole("dialog", { name: "Path health", exact: true });
  const coachBox = await requiredBox(card);
  const healthBox = await requiredBox(health);
  expect(coachBox.x + coachBox.width).toBeLessThan(healthBox.x);
  await next(page, 1);
  await setNumber(page, "Y (m)", "2.5");
  await next(page, 1);
  await page.getByLabel("Lib Key", { exact: true }).fill("startIntake");
  await page.getByLabel("Lib Key", { exact: true }).press("Tab");
  await next(page, 1);
  await page
    .getByRole("button", { name: "Generate constraints", exact: true })
    .click();
  await next(page, 2);
  await watchRun(page);
  await next(page, 1);
  await card.getByRole("button", { name: "config.json", exact: true }).click();
  await expect(card.getByLabel("Export file contents")).toContainText(
    "kinematic_constraints",
  );
  await card.getByRole("button", { name: /^paths\// }).click();
  await expect(card.getByLabel("Export file contents")).toContainText(
    "startIntake",
  );
  await expect(card.getByLabel("Export file contents")).toContainText(
    "prepareDelivery",
  );
  const downloaded = page.waitForEvent("download");
  await card
    .getByRole("button", { name: "Download practice autos.zip" })
    .click();
  const zip = await downloaded;
  expect(zip.suggestedFilename()).toBe("practice-autos.zip");
  const bytes = await readFile((await zip.path())!);
  expect(bytes.includes(Buffer.from("autos/config.json"))).toBe(true);
  expect(bytes.includes(Buffer.from("startIntake"))).toBe(true);
  await next(page, 2);
  const copied = page.waitForEvent("download");
  await card.getByRole("button", { name: "Keep a practice copy" }).click();
  const copy = await copied;
  const archive = JSON.parse(await readFile((await copy.path())!, "utf8"));
  expect(JSON.stringify(archive)).toContain("prepareDelivery");
  await card.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.getByTestId("tour-picker-progress")).toHaveText(
    "1 of 5 lessons complete",
  );
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );
});

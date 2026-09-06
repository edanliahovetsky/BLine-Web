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

test("opens help and the seven-lesson course", async ({ page }) => {
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
    "Understand Handoffs",
    "Control Heading",
    "Trigger Actions",
    "Verify and Hand Off",
  ]) {
    await expect(picker.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(page.getByTestId("tour-picker-progress")).toHaveText(
    "0 of 7 lessons complete",
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

test("builds a first path, previews immediately, and recovers edits at every step", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "build-first-path");
  const card = page.getByTestId("tour-card");
  await next(page, 1);
  await place(page, "Waypoint", 5, 2);
  await place(page, "Waypoint", 14, 2.5);
  await expect(card).toContainText("The requested elements are in place.");
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 2 of 8");
  await next(page, 1);
  await expect(card).toContainText("Play your first path");
  await watchRun(page);
  await next(page, 1);
  await setNumber(page, "X (m)", "13");
  await next(page, 1);
  await card
    .getByRole("button", { name: "Undo last edit", exact: true })
    .click();
  await expect(card).toContainText("The original route is restored.");
  await next(page, 1);
  await setNumber(page, "X (m)", "15");
  await next(page, 1);
  await watchRun(page);
  await next(page, 1);
  await card
    .getByRole("button", {
      name: "Review step 2: Place the endpoints",
      exact: true,
    })
    .click();
  await expect(card).toContainText("Previously completed");
  await expect(rows(page)).toHaveCount(2);
  await card
    .getByRole("button", { name: "Restart exercise", exact: true })
    .click();
  await expect(rows(page)).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toHaveCount(0);
  await place(page, "Waypoint", 5, 2);
  await place(page, "Waypoint", 15, 2.5);
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
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
  await card.getByRole("heading", { name: "Add a bend" }).hover();
  await expect(card).toHaveCSS("opacity", "0.2");

  await card.getByRole("button", { name: "Back" }).hover();
  await expect(card).toHaveCSS("opacity", "1");
});

test("shapes a route with translation order and bumper clearance", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "shape-route");
  const card = page.getByTestId("tour-card");
  await next(page, 1);
  await place(page, "Translation", 10.8, 6.8);
  await next(page, 1);
  await page.getByTestId("path-element-row-2").click();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(card).toContainText(
    "The route visits Start, the bend, then Delivery.",
  );
  await next(page, 1);
  await setNumber(page, "X (m)", "10.8");
  await setNumber(page, "Y (m)", "6.8");
  await next(page, 1);
  await watchRun(page);
  await next(page, 1);
  await setNumber(page, "X (m)", "10.5");
  await setNumber(page, "Y (m)", "7");
  await next(page, 1);
  await finish(page);
});

test("uses each simulation control for one clear purpose", async ({ page }) => {
  await gotoSampleEditor(page);
  await openLesson(page, "control-heading");
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

test("starts each lesson at zero and keeps its controls reachable after resizing", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page
    .getByRole("button", { name: "Fast forward simulation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Help and tutorials", exact: true })
    .click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-understand-handoffs").click();
  await expect(page.getByLabel("Simulation time", { exact: true })).toHaveValue(
    "0",
  );
  await next(page, 1);
  await page.setViewportSize({ width: 1024, height: 768 });
  const card = page.getByTestId("tour-card");
  await card
    .getByRole("button", { name: "Show required controls", exact: true })
    .click();
  await setNumber(page, "Handoff radius 2 value", "0.25");
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Skip tour", exact: true }).click();
  await page
    .getByRole("button", { name: "Fast forward simulation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Help and tutorials", exact: true })
    .click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-verify-export").click();
  await expect(page.getByLabel("Simulation time", { exact: true })).toHaveValue(
    "0",
  );
});

async function openLesson(page: Page, id: string): Promise<void> {
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId(`tour-picker-${id}`).click();
  await expect(page.getByTestId("tour-card")).toBeVisible();
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Restart exercise", exact: true })
    .click();
}

async function next(page: Page, times: number): Promise<void> {
  const card = page.getByTestId("tour-card");
  for (let index = 0; index < times; index += 1) {
    await auditStepRecovery(page);
    await card.getByRole("button", { name: "Next", exact: true }).click();
    const title = await card.getByRole("heading").innerText();
    await card
      .getByRole("button", { name: "Restart exercise", exact: true })
      .click();
    await expect(card.getByRole("heading")).toHaveText(title);
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

async function setNumber(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Enter");
}
async function replayComparison(page: Page) {
  await page
    .getByRole("button", { name: "Compare your path", exact: true })
    .click();
  const lab = page.getByRole("dialog", { name: "Compare your path" });
  await lab.getByLabel("Half speed").uncheck();
  if (await lab.getByLabel(/Focus on/).count())
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

test("compares heading modes while keeping the route fixed", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "control-heading");
  await next(page, 1);
  await place(page, "Rotation", 7.4, 5.2);
  await next(page, 1);
  await setNumber(page, "Rotation (deg)", "90");
  await setNumber(page, "Rotation Pos (0-1)", "0.5");
  await page.getByLabel("Profiled Rotation", { exact: true }).check();
  await next(page, 1);
  await expect(page.getByTestId("tour-reference-trace")).toBeVisible();
  await page.getByLabel("Profiled Rotation", { exact: true }).uncheck();
  await next(page, 1);
  await replayComparison(page);
  await next(page, 1);
  await page.getByLabel("Profiled Rotation", { exact: true }).check();
  await setNumber(page, "Rotation Pos (0-1)", "0.35");
  await next(page, 1);
  await finish(page);
});

test("compares a local speed before splitting a shared cell", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "plan-speed");
  await next(page, 1);
  await page.getByRole("tab", { name: "Constraints", exact: true }).click();
  await next(page, 1);
  await expect(page.getByTestId("tour-reference-trace")).toBeVisible();
  await setSpeed(page, 3, "1.2");
  await next(page, 1);
  await replayComparison(page);
  await next(page, 1);
  await page
    .getByRole("button", { name: "Generate constraints", exact: true })
    .click();
  await next(page, 1);
  await isolateSpeed(page, 2);
  await next(page, 1);
  await setSpeed(page, 2, "0.9");
  await next(page, 1);
  await watchRun(page);
  await next(page, 1);
  await finish(page);
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
  await page.getByTestId("path-element-row-2").click();
  await page.getByLabel("Lib Key", { exact: true }).fill("startIntake");
  await page.getByLabel("Lib Key", { exact: true }).press("Tab");
  await next(page, 1);
  await page
    .getByRole("button", { name: "Generate constraints", exact: true })
    .click();
  await next(page, 1);
  await watchRun(page);
  await next(page, 1);
  await card.getByRole("button", { name: "config.json", exact: true }).click();
  await expect(card.getByLabel("Export file contents")).toContainText(
    "kinematic_constraints",
  );
  await expect(card.getByLabel("Export file contents")).not.toContainText(
    "robot",
  );
  await card.getByRole("button", { name: "project.json", exact: true }).click();
  await expect(card.getByLabel("Export file contents")).toContainText(
    "editor_config",
  );
  await expect(card.getByLabel("Export file contents")).toContainText(
    "length_meters",
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
  await next(page, 1);
  const copied = page.waitForEvent("download");
  await card.getByRole("button", { name: "Keep a practice copy" }).click();
  const copy = await copied;
  const archive = JSON.parse(await readFile((await copy.path())!, "utf8"));
  expect(JSON.stringify(archive)).toContain("prepareDelivery");
  await finish(page);
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );
});

test("compares handoff radii at a controlled speed", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "understand-handoffs");
  await next(page, 1);
  await setNumber(page, "Handoff radius 2 value", "0.25");
  await next(page, 1);
  await setNumber(page, "Handoff radius 2 value", "1.5");
  await next(page, 1);
  await replayComparison(page);
  await next(page, 1);
  await setNumber(page, "Handoff radius 2 value", "0.25");
  await next(page, 2);
  await finish(page);
});

test("changes an event's time while preserving its geometric position", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "trigger-actions");
  await next(page, 1);
  await place(page, "Event", 7.5, 5.3);
  await next(page, 1);
  await page.getByLabel("Lib Key", { exact: true }).fill("startIntake");
  await page.getByLabel("Lib Key", { exact: true }).press("Tab");
  await setNumber(page, "Event Pos (0-1)", "0.7");
  await next(page, 1);
  const timeline = page.locator('[data-tour="transport-timeline"]');
  const box = await requiredBox(timeline);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await next(page, 1);
  await setSpeed(page, 2, "1");
  await next(page, 1);
  await page
    .getByRole("button", { name: "Compare your path", exact: true })
    .click();
  const lab = page.getByRole("dialog", { name: "Compare your path" });
  const eventTimes = await lab
    .locator(".tour-lab__event-time")
    .allTextContents();
  expect(eventTimes).toHaveLength(2);
  const values = eventTimes.map(
    (text) => text.match(/: ([\d.]+) s · ([\d.]+) m/)!,
  );
  expect(Number(values[1][1])).toBeGreaterThan(Number(values[0][1]));
  expect(values[1][2]).toBe(values[0][2]);
  await lab.getByRole("button", { name: "Replay comparison" }).click();
  await expect(
    lab.getByRole("button", { name: "Replay comparison" }),
  ).toBeVisible({ timeout: 20_000 });
  await lab.getByRole("button", { name: "Close comparison" }).click();
  await next(page, 1);
  await setNumber(page, "Event Pos (0-1)", "0.6");
  await next(page, 1);
  await finish(page);
});

test("blocks wrong pointer tools and keyboard duplicates, then permits undo repair", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openLesson(page, "build-first-path");
  await next(page, 1);
  const card = page.getByTestId("tour-card");
  const wrongTool = await requiredBox(
    page.getByRole("button", { name: "Translation tool", exact: true }),
  );
  await page.mouse.click(
    wrongTool.x + wrongTool.width / 2,
    wrongTool.y + wrongTool.height / 2,
  );
  await clickFieldPoint(page, 14, 6);
  await expect(rows(page)).toHaveCount(0);
  await card.focus();
  await page.keyboard.press("2");
  await clickFieldPoint(page, 14, 6);
  await expect(rows(page)).toHaveCount(0);
  await place(page, "Waypoint", 5, 2);
  await place(page, "Waypoint", 15, 2.5);
  await card.focus();
  await page.keyboard.press("ControlOrMeta+d");
  await clickFieldPoint(page, 14, 6);
  await expect(rows(page)).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(rows(page)).toHaveCount(1);
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(rows(page)).toHaveCount(2);
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
});

test("opens and closes expanded constraints without exiting or trapping the lesson", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openLesson(page, "plan-speed");
  await next(page, 1);
  await page.getByRole("tab", { name: "Constraints", exact: true }).click();
  await next(page, 1);
  const expand = page.getByRole("button", {
    name: "Expand Max Velocity editor",
    exact: true,
  });
  await expand.click();
  const popout = page.getByTestId("constraint-popout-window");
  await expect(popout).toBeVisible();
  await popout
    .getByRole("button", {
      name: "Close Max Velocity expanded editor",
      exact: true,
    })
    .click();
  await expect(popout).toHaveCount(0);
  await expand.click();
  await page.keyboard.press("Escape");
  await expect(popout).toHaveCount(0);
  await expect(page.getByTestId("tour-card")).toContainText(
    "Slow the second turn",
  );
  await setSpeed(page, 3, "1.2");
  await expect(
    page
      .getByTestId("tour-card")
      .getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
});

test("restores heading selection and reports extra or missing elements", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "control-heading");
  await next(page, 1);
  await place(page, "Rotation", 7.4, 5.2);
  await next(page, 1);
  const card = page.getByTestId("tour-card");
  // Reproduce a stale selection from an editor action before the coach prepares it.
  await mutatePractice(page, "select-end");
  await expect(
    page.getByLabel("Rotation Pos (0-1)", { exact: true }),
  ).toHaveCount(0);
  await card.getByRole("button", { name: "Show required controls" }).click();
  await expect(
    page.getByLabel("Rotation Pos (0-1)", { exact: true }),
  ).toBeVisible();
  await mutatePractice(page, "extra");
  await expect(card).toContainText("Extra waypoint");
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toHaveCount(0);
  await card
    .getByRole("button", { name: "Restart exercise", exact: true })
    .click();
  await expect(rows(page)).toHaveCount(3);
  await expect(
    page.getByLabel("Rotation Pos (0-1)", { exact: true }),
  ).toBeVisible();
  await mutatePractice(page, "delete-rotation");
  await expect(card).toContainText("Missing rotation target");
  await card
    .getByRole("button", { name: "Restart exercise", exact: true })
    .click();
  await setNumber(page, "Rotation (deg)", "90");
  await setNumber(page, "Rotation Pos (0-1)", "0.5");
  await page.getByLabel("Profiled Rotation", { exact: true }).check();
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toBeVisible();
});

function rows(page: Page) {
  return page.locator('[data-testid^="path-element-row-"]');
}
async function place(page: Page, tool: string, x: number, y: number) {
  await page.getByRole("button", { name: tool + " tool", exact: true }).click();
  await clickFieldPoint(page, x, y);
}
async function selectSpeed(page: Page, ordinal: number) {
  const cells = page.locator(
    '[data-ranged-constraint-key="max_velocity_meters_per_sec"][data-range-start]',
  );
  for (const cell of await cells.all()) {
    const start = Number(await cell.getAttribute("data-range-start"));
    const end = Number(await cell.getAttribute("data-range-end"));
    if (start <= ordinal && end >= ordinal) {
      await cell.click();
      return { start, end };
    }
  }
  throw new Error("No speed cell for approach " + ordinal);
}
async function setSpeed(page: Page, ordinal: number, value: string) {
  await selectSpeed(page, ordinal);
  const input = page.getByLabel(/^Constraint \d+ value$/);
  await input.fill(value);
  await input.press("Enter");
}
async function isolateSpeed(page: Page, ordinal: number) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const range = await selectSpeed(page, ordinal);
    if (range.start === ordinal && range.end === ordinal) return;
    await page.getByRole("button", { name: /^Split constraint/ }).click();
  }
  throw new Error("Could not split approach " + ordinal);
}
async function finish(page: Page) {
  await auditStepRecovery(page);
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Finish", exact: true })
    .click();
  await expect(page.getByTestId("tour-picker-progress")).toHaveText(
    "1 of 7 lessons complete",
  );
}

// Every completed step in the walkthroughs exercises history and backward review.
async function auditStepRecovery(page: Page) {
  const card = page.getByTestId("tour-card");
  const title = await card.getByRole("heading").innerText();
  const forward = card.getByRole("button", { name: /^(Next|Finish)$/ });
  await expect(forward).toBeVisible({ timeout: 25_000 });
  await page
    .getByRole("button", {
      name: "Hide instructions · Practice only",
      exact: true,
    })
    .click();
  await expect(card).toBeHidden();
  await page
    .getByRole("button", {
      name: "Show instructions · Practice only",
      exact: true,
    })
    .click();
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press("F1");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("dialog", { name: /Command palette/i }),
  ).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(forward).toBeVisible({ timeout: 10_000 });
  // A future command or a stale editor state must not turn malformed practice
  // into a completed step. The two capstone opening cards intentionally allow repair work.
  if (!["Finish the pickup and delivery", "Open Path Health"].includes(title)) {
    for (const damage of ["extra", "missing", "wrong-type"] as const) {
      const snapshot = await damagePractice(page, damage);
      if (!snapshot) continue;
      await expect(forward).toHaveCount(0);
      await page.evaluate(async (snapshot) => {
        const { projectStore }: typeof import("../../src/state/projectStore") =
          await import(
            /* @vite-ignore */ "/src/state/projectStore.ts" as string
          );
        const {
          selectionStore,
        }: typeof import("../../src/state/selectionStore") = await import(
          /* @vite-ignore */ "/src/state/selectionStore.ts" as string
        );
        projectStore.setState({ project: snapshot.project });
        selectionStore.setState(snapshot.selection);
      }, snapshot);
      await expect(forward).toBeVisible();
    }
  }
  if (
    await card.getByRole("button", { name: "Back", exact: true }).isEnabled()
  ) {
    await card.getByRole("button", { name: "Back", exact: true }).click();
    await card.getByRole("button", { name: "Next", exact: true }).click();
    await expect(card.getByRole("heading")).toHaveText(title);
    await expect(forward).toBeVisible();
  }
}

async function damagePractice(
  page: Page,
  damage: "extra" | "missing" | "wrong-type",
) {
  return page.evaluate(async (damage) => {
    const { projectStore }: typeof import("../../src/state/projectStore") =
      await import(/* @vite-ignore */ "/src/state/projectStore.ts" as string);
    const { selectionStore }: typeof import("../../src/state/selectionStore") =
      await import(/* @vite-ignore */ "/src/state/selectionStore.ts" as string);
    const model: typeof import("../../src/core/model/path") = await import(
      /* @vite-ignore */ "/src/core/model/path.ts" as string
    );
    const state = projectStore.getState();
    const project = structuredClone(state.project!);
    const path = project.paths.find(
      (path) => path.path_id === state.activePathId,
    )!.path;
    if (!path.path_elements.length && damage !== "extra") return null;
    const selection = selectionStore.getState();
    const snapshot = {
      project: structuredClone(state.project!),
      selection: {
        selectedElementIndex: selection.selectedElementIndex,
        selectedRangedConstraint: selection.selectedRangedConstraint,
      },
    };
    if (damage === "extra") path.path_elements.push(model.createWaypoint());
    else if (damage === "missing") path.path_elements.shift();
    else
      path.path_elements[path.path_elements.length - 1] = model.isWaypoint(
        path.path_elements.at(-1)!,
      )
        ? model.createTranslationTarget({ x_meters: 15, y_meters: 2.5 })
        : model.createWaypoint();
    projectStore.setState({ project });
    return snapshot;
  }, damage);
}

async function mutatePractice(
  page: Page,
  operation: "extra" | "select-end" | "delete-rotation",
) {
  await page.evaluate(async (operation) => {
    const projectModule: typeof import("../../src/state/projectStore") =
      await import(/* @vite-ignore */ "/src/state/projectStore.ts" as string);
    const selectionModule: typeof import("../../src/state/selectionStore") =
      await import(/* @vite-ignore */ "/src/state/selectionStore.ts" as string);
    const state = projectModule.projectStore.getState();
    const project = structuredClone(state.project!);
    const path = project.paths.find(
      (path) => path.path_id === state.activePathId,
    )!.path;
    if (operation === "select-end") {
      selectionModule.selectionStore
        .getState()
        .selectElement(path.path_elements.length - 1, path);
      return;
    }
    if (operation === "extra")
      path.path_elements.push(structuredClone(path.path_elements[0]));
    else
      path.path_elements = path.path_elements.filter(
        (element) => element.type !== "rotation",
      );
    projectModule.projectStore.setState({ project });
  }, operation);
}

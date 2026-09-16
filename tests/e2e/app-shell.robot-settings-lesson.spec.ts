import { expect, test, type Page } from "@playwright/test";
import {
  gotoSampleEditor,
  openProjectSettings,
  requiredBox,
} from "./support/app-shell-shared";

import { canvasNodePosition } from "./support/app-shell-canvas";
import type { PixiDebugWindow } from "../../src/canvas/pixi/PixiPathRenderer";

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { projectStore }: typeof import("../../src/state/projectStore") =
      await import(/* @vite-ignore */ "/src/state/projectStore.ts" as string);
    const { readUserData }: typeof import("../../src/userData") = await import(
      /* @vite-ignore */ "/src/userData/index.ts" as string
    );
    const state = projectStore.getState();
    const data = readUserData();
    return {
      project: state.project,
      session: state.projectSessionId,
      undo: state.history.getState().undoStack.length,
      hasPersistence: state.io !== null,
      preferences: {
        fields: data.field_backgrounds,
        views: data.project_views,
        generation: data.automatic_generation,
      },
    };
  });
}
async function openLesson(page: Page) {
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-robot-settings").click();
  await expect(page.getByTestId("tour-card")).toContainText("Robot size");
}
async function next(page: Page, heading: string) {
  const card = page.getByTestId("tour-card");
  await card.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    card.getByRole("heading", { name: heading, exact: true }),
  ).toBeVisible();
}
async function layout(page: Page) {
  const card = await requiredBox(page.getByTestId("tour-card"));
  const dialog = await requiredBox(
    page.getByRole("dialog", { name: "Edit Config" }),
  );
  expect(card.x + card.width).toBeLessThanOrEqual(dialog.x);
  expect(card.y + card.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(dialog.y + dialog.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
}

const dialogFor = (page: Page) =>
  page.getByRole("dialog", { name: "Edit Config" });
const forward = (page: Page) =>
  page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Continue", exact: true });
async function number(page: Page, name: string, value: string) {
  const input = page.getByLabel(name, { exact: true });
  await input.fill(value);
  await input.press("Tab");
}
async function play(page: Page, observeExtension = false) {
  // Read the same state passed into the canvas drawing function on every frame.
  const watch = observeExtension
    ? page.waitForFunction(
        () =>
          (window as PixiDebugWindow).__blinePixiDebug?.simulationRobot()
            ?.protrusionVisible === true,
        undefined,
        { polling: "raf", timeout: 15000 },
      )
    : null;
  await page
    .getByRole("button", { name: "Play simulation", exact: true })
    .click();
  if (watch) await watch;
  await expect(forward(page)).toBeVisible({ timeout: 20000 });
  const robot = await page.evaluate(() =>
    (window as PixiDebugWindow).__blinePixiDebug?.simulationRobot(),
  );
  expect(robot).toMatchObject({
    lengthMeters: 0.8,
    widthMeters: 1.2,
    protrusionVisible: false,
  });
}
async function addEvent(
  page: Page,
  start: number,
  end: number,
  key: string,
  ratio: string,
) {
  await page.getByRole("button", { name: "Event tool", exact: true }).click();
  const a = await canvasNodePosition(page, `path-element-node-${start}`);
  const b = await canvasNodePosition(page, `path-element-node-${end}`);
  const box = await requiredBox(page.getByTestId("path-stage"));
  await page.mouse.click(box.x + (a.x + b.x) / 2, box.y + (a.y + b.y) / 2);
  await next(
    page,
    key === "startIntake" ? "Set the extend event" : "Set the retract event",
  );
  await number(page, "Event Pos (0-1)", ratio);
  await page.getByLabel("Lib Key", { exact: true }).fill(key);
  await page.getByLabel("Lib Key", { exact: true }).press("Tab");
  await expect(forward(page)).toBeVisible();
}
async function navigate(page: Page, section: string, previous: string) {
  const dialog = dialogFor(page);
  await expect(
    dialog.getByRole("button", { name: previous, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(forward(page)).toBeHidden();
  await dialog.getByRole("button", { name: section, exact: true }).click();
  await expect(forward(page)).toBeVisible();
  await layout(page);
}
async function fieldState(page: Page) {
  return page.evaluate(() =>
    (window as PixiDebugWindow).__blinePixiDebug?.fieldState(),
  );
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1024, height: 600 },
]) {
  test(`completes the interactive settings lesson and restores the project at ${viewport.width}px @webkit-canvas`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await gotoSampleEditor(page);
    await openProjectSettings(page);
    const dialog = dialogFor(page);
    await dialog.getByLabel("Robot Width (m)", { exact: true }).fill("1.7");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("save-status")).toContainText("Saved");
    const original = await snapshot(page);
    await openLesson(page);
    expect((await snapshot(page)).hasPersistence).toBe(false);
    expect(
      (await snapshot(page)).project?.config.gui.protrusions,
    ).toMatchObject({
      enabled: false,
      distance_meters: 0,
      side: "none",
      show_on_event_keys: [],
      hide_on_event_keys: [],
    });
    await expect(
      dialog.getByLabel("Robot Width (m)", { exact: true }),
    ).toHaveValue("0.8");
    await expect(dialog.locator(".config-dialog__footer")).toHaveCount(0);
    await expect(dialog).not.toContainText("Lesson preview");
    await expect(dialog).not.toContainText("Use Continue");
    await layout(page);
    await expect(forward(page)).toBeHidden();
    await number(page, "Robot Width (m)", "1.2");
    await number(page, "Robot Length (m)", "0.8");
    await expect(forward(page)).toBeVisible();
    await page.getByTestId("tour-card").getByRole("heading").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(
      dialog.getByLabel("Robot Width (m)", { exact: true }),
    ).toHaveValue("0.8");
    await expect(forward(page)).toBeHidden();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(
      dialog.getByLabel("Robot Width (m)", { exact: true }),
    ).toHaveValue("1.2");
    await expect(forward(page)).toBeVisible();
    await page
      .getByTestId("tour-card")
      .getByRole("button", { name: "Restart step", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Robot Width (m)", { exact: true }),
    ).toHaveValue("0.8");
    await expect(forward(page)).toBeHidden();
    await number(page, "Robot Width (m)", "1.2");
    await next(page, "See the bumper size");
    await expect(dialog).toBeHidden();
    await play(page);
    await next(page, "Enable protrusions");
    await page.getByRole("switch", { name: "Enable Protrusions" }).check();
    await next(page, "Set up the extension");
    await number(page, "Protrusion Distance (m)", "0.3");
    await page
      .getByLabel("Protrusion Side", { exact: true })
      .selectOption("front");
    await page
      .getByLabel("Default Protrusion State", { exact: true })
      .selectOption("hidden");
    await next(page, "Connect the event keys");
    await page
      .getByLabel("Show On Event Keys", { exact: true })
      .fill("startIntake");
    await page
      .getByLabel("Hide On Event Keys", { exact: true })
      .fill("stopIntake");
    await next(page, "Place the extend event");
    await addEvent(page, 0, 1, "startIntake", "0.3");
    await next(page, "Place the retract event");
    await addEvent(page, 2, 3, "stopIntake", "0.7");
    await next(page, "Watch the intake extend and retract");
    await expect(forward(page)).toBeHidden();
    await play(page, true);
    await next(page, "Open Path Defaults");
    await navigate(page, "Path Defaults", "Robot");
    await next(page, "Translation defaults");
    await number(page, "Default Max Velocity (m/s)", "4");
    await number(page, "Default Max Accel (m/s2)", "8");
    await next(page, "Rotation defaults");
    await layout(page);
    await next(page, "End tolerance");
    await layout(page);
    await next(page, "Open Field");
    await navigate(page, "Field", "Path Defaults");
    await next(page, "Choose a competition field");
    await page
      .getByLabel("Field Image", { exact: true })
      .selectOption("frc2025-reefscape");
    await next(page, "See the new field");
    await expect
      .poll(() => fieldState(page))
      .toMatchObject({ id: "frc2025-reefscape", imageLoaded: true });
    await next(page, "Try the blank grid");
    await page
      .getByLabel("Field Image", { exact: true })
      .selectOption("blank-grid");
    await next(page, "Resize the grid");
    await number(page, "Field Length (m)", "12");
    await number(page, "Field Width (m)", "6");
    await next(page, "See the resized grid");
    await expect
      .poll(() => fieldState(page))
      .toMatchObject({ id: "blank-grid", lengthMeters: 12, widthMeters: 6 });
    await next(page, "Custom field images");
    await expect(
      dialog.getByRole("button", { name: "Upload Image", exact: true }),
    ).toBeDisabled();
    await next(page, "Open Generator");
    await navigate(page, "Generator", "Field");
    await next(page, "Generator factors");
    await number(page, "Velocity safety factor", "0.9");
    await next(page, "Keep generation in sync");
    await page.getByRole("switch", { name: "Keep in sync" }).uncheck();
    await next(page, "Restore automatic updates");
    await page.getByRole("switch", { name: "Keep in sync" }).check();
    await next(page, "Tune your robot");
    const card = page.getByTestId("tour-card");
    await expect(
      card.getByRole("link", { name: "Read Tune Your Robot" }),
    ).toHaveAttribute(
      "href",
      "https://bline-docs.pages.dev/getting-started/tuning/",
    );
    await layout(page);
    expect((await snapshot(page)).preferences).toEqual(original.preferences);
    await card.getByRole("button", { name: "Back", exact: true }).click();
    await next(page, "Tune your robot");
    await card.getByRole("button", { name: "Finish", exact: true }).click();
    await expect(dialog).toBeHidden();
    const restored = await snapshot(page);
    expect(restored.project).toEqual(original.project);
    expect(restored.preferences).toEqual(original.preferences);
    expect(restored.undo).toBe(original.undo);
    expect(restored.hasPersistence).toBe(true);
    await page
      .getByRole("button", { name: "Close lessons", exact: true })
      .click();
    await page.reload();
    await expect(page.getByTestId("path-stage")).toBeVisible();
    expect((await snapshot(page)).project).toEqual(original.project);
  });
}

for (const exit of ["skip", "escape"] as const) {
  test(`discards settings lesson changes on ${exit} @webkit-canvas`, async ({
    page,
  }) => {
    await gotoSampleEditor(page);
    await expect(page.getByTestId("save-status")).toContainText("Saved");
    const original = await snapshot(page);
    await openLesson(page);
    await number(page, "Robot Width (m)", "1.2");
    if (exit === "skip")
      await page
        .getByTestId("tour-card")
        .getByRole("button", { name: "Skip lesson", exact: true })
        .click();
    else await page.keyboard.press("Escape");
    await expect(dialogFor(page)).toBeHidden();
    expect((await snapshot(page)).project).toEqual(original.project);
    expect((await snapshot(page)).preferences).toEqual(original.preferences);
    await openLesson(page);
    await expect(
      page.getByLabel("Robot Width (m)", { exact: true }),
    ).toHaveValue("0.8");
  });
}

import { expect, test, type Page } from "@playwright/test";
import {
  gotoSampleEditor,
  openProjectSettings,
  requiredBox,
} from "./support/app-shell-shared";

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
  await expect(page.getByTestId("tour-card")).toContainText(
    "Open robot settings",
  );
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

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1024, height: 600 },
]) {
  test(`completes robot settings lesson and restores original project at ${viewport.width}px @webkit-canvas`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await gotoSampleEditor(page);
    await expect(page.getByTestId("save-status")).toContainText("Saved");
    const original = await snapshot(page);
    await openLesson(page);
    expect((await snapshot(page)).hasPersistence).toBe(false);
    await openProjectSettings(page);
    await next(page, "Size and bumper clearance");
    await layout(page);
    const dialog = page.getByRole("dialog", { name: "Edit Config" });
    await dialog.getByLabel("Robot Length (m)", { exact: true }).fill("1");
    await dialog.getByLabel("Robot Width (m)", { exact: true }).fill("0.9");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await snapshot(page)).preferences).toEqual(original.preferences);
    await next(page, "Points and the blue trace");
    await page
      .getByRole("button", { name: "Play simulation", exact: true })
      .click();
    await next(page, "Find motion limits");
    await openProjectSettings(page);
    await dialog
      .getByRole("button", { name: "Path Defaults", exact: true })
      .click();
    await next(page, "Speed, acceleration and turning");
    await layout(page);
    for (const [label, value] of [
      ["Default Max Velocity (m/s)", "2"],
      ["Default Max Accel (m/s2)", "2"],
      ["Default Max Rot Vel (deg/s)", "180"],
      ["Default Max Rot Accel (deg/s2)", "360"],
    ])
      await dialog.getByLabel(label, { exact: true }).fill(value);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await snapshot(page)).preferences).toEqual(original.preferences);
    await next(page, "Preview the new settings");
    await page
      .getByRole("button", { name: "Play simulation", exact: true })
      .click();
    await next(page, "Generate using your robot settings");
    await page
      .getByRole("button", { name: "Generate constraints", exact: true })
      .click();
    await next(page, "Next: deeper tuning");
    await page
      .getByTestId("tour-card")
      .getByRole("button", { name: "Finish", exact: true })
      .click();
    await expect(page.getByTestId("tour-picker-robot-settings")).toHaveClass(
      /is-done/,
    );
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

test("exits settings practice with an open dialog and restores preferences", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  const original = await snapshot(page);
  await openLesson(page);
  await openProjectSettings(page);
  await next(page, "Size and bumper clearance");
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByLabel("Robot Length (m)", { exact: true }).fill("1.7");
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Skip lesson", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect((await snapshot(page)).project).toEqual(original.project);
  expect((await snapshot(page)).preferences).toEqual(original.preferences);
});

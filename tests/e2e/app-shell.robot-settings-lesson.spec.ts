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

const sections = [
  ["Robot size", "Robot", "settings-size"],
  ["Protrusions", "Robot", "settings-protrusions"],
  ["Translation defaults", "Path Defaults", "settings-translation"],
  ["Rotation defaults", "Path Defaults", "settings-rotation"],
  ["End tolerance", "Path Defaults", "settings-end-tolerance"],
  ["Field image", "Field", "settings-field-image"],
  ["Field dimensions and padding", "Field", "settings-field-geometry"],
  ["Generator settings", "Generator", "settings-generator"],
];

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1024, height: 600 },
]) {
  test(`walks through preset settings without editing and restores the project at ${viewport.width}px @webkit-canvas`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await gotoSampleEditor(page);
    // Deliberately differ from lesson presets, using the ordinary settings UI.
    await openProjectSettings(page);
    const dialog = page.getByRole("dialog", { name: "Edit Config" });
    await dialog.getByLabel("Robot Length (m)", { exact: true }).fill("1.7");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("save-status")).toContainText("Saved");
    const original = await snapshot(page);
    await openLesson(page);
    const practice = await snapshot(page);
    expect(practice.hasPersistence).toBe(false);
    expect(practice.project!.config.gui.robot.length_meters).toBe(0.8);
    await expect(
      dialog.getByLabel("Robot Length (m)", { exact: true }),
    ).toHaveValue("0.8");
    for (const [index, [heading, section, target]] of sections.entries()) {
      if (index) await next(page, heading);
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: section, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(dialog.locator(`[data-tour="${target}"]`)).toBeInViewport({
        ratio: 1,
      });
      await expect(
        dialog.locator(
          "fieldset input:enabled, fieldset select:enabled, fieldset button:enabled",
        ),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: "Save", exact: true }),
      ).toHaveCount(0);
      await expect(
        page
          .getByTestId("tour-card")
          .getByRole("button", { name: "Continue", exact: true }),
      ).toBeEnabled();
      await layout(page);
      expect((await snapshot(page)).project).toEqual(practice.project);
      expect((await snapshot(page)).preferences).toEqual(original.preferences);
      if (section === "Path Defaults" && heading === "Translation defaults") {
        await expect(
          dialog.getByLabel("Default Max Velocity (m/s)", { exact: true }),
        ).toHaveValue("4.5");
        await expect(
          dialog.getByLabel("Default Max Accel (m/s2)", { exact: true }),
        ).toHaveValue("12");
      }
    }
    // Back navigation reopens the correct section and scroll position too.
    await page
      .getByTestId("tour-card")
      .getByRole("button", { name: "Back", exact: true })
      .click();
    await expect(
      dialog.locator('[data-tour="settings-field-geometry"]'),
    ).toBeInViewport({ ratio: 1 });
    await next(page, "Generator settings");
    await next(page, "Tune your robot");
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByTestId("tour-card")
        .getByRole("link", { name: "Read Tune Your Robot" }),
    ).toHaveAttribute(
      "href",
      "https://bline-docs.pages.dev/getting-started/tuning/",
    );
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

for (const exit of ["skip", "escape"] as const) {
  test(`exits the read-only settings walkthrough with ${exit} and restores preferences @webkit-canvas`, async ({
    page,
  }) => {
    await gotoSampleEditor(page);
    await expect(page.getByTestId("save-status")).toContainText("Saved");
    const original = await snapshot(page);
    await openLesson(page);
    await next(page, "Protrusions");
    if (exit === "skip")
      await page
        .getByTestId("tour-card")
        .getByRole("button", { name: "Skip lesson", exact: true })
        .click();
    else await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Edit Config" }),
    ).toBeHidden();
    expect((await snapshot(page)).project).toEqual(original.project);
    expect((await snapshot(page)).preferences).toEqual(original.preferences);
  });
}

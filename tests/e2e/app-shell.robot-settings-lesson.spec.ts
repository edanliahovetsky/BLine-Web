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

const steps = [
  { title: "Robot size", section: "Robot", target: "settings-size" },
  {
    title: "Enable protrusions",
    section: "Robot",
    target: "settings-protrusions",
    action: "protrusions",
  },
  {
    title: "Protrusion settings",
    section: "Robot",
    target: "settings-protrusions",
  },
  {
    title: "Open Path Defaults",
    section: "Path Defaults",
    previous: "Robot",
    action: "navigate",
  },
  {
    title: "Translation defaults",
    section: "Path Defaults",
    target: "settings-translation",
  },
  {
    title: "Rotation defaults",
    section: "Path Defaults",
    target: "settings-rotation",
  },
  {
    title: "End tolerance",
    section: "Path Defaults",
    target: "settings-end-tolerance",
  },
  {
    title: "Open Field",
    section: "Field",
    previous: "Path Defaults",
    action: "navigate",
  },
  {
    title: "Field image",
    section: "Field",
    target: "settings-field-image",
    action: "field",
  },
  {
    title: "Open Generator",
    section: "Generator",
    previous: "Field",
    action: "navigate",
  },
  {
    title: "Generator settings",
    section: "Generator",
    target: "settings-generator",
  },
  { title: "Tune your robot", section: "Generator" },
];

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1024, height: 600 },
]) {
  test(`navigates settings, enables protrusions and changes the field without saving at ${viewport.width}px @webkit-canvas`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await gotoSampleEditor(page);
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
    await expect(
      dialog.getByLabel("Robot Length (m)", { exact: true }),
    ).toHaveValue("0.8");
    const card = page.getByTestId("tour-card");
    const forward = card.getByRole("button", { name: "Continue", exact: true });
    for (const [index, step] of steps.entries()) {
      if (index) await next(page, step.title);
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText("Lesson preview", { exact: true }),
      ).toHaveCount(0);
      await expect(dialog.locator(".config-dialog__footer")).toHaveCount(0);
      // The content occupies the removed footer's space, with only the border below it.
      const body = await requiredBox(dialog.locator(".config-dialog__body"));
      const bounds = await requiredBox(dialog);
      expect(
        bounds.y + bounds.height - body.y - body.height,
      ).toBeLessThanOrEqual(2);
      if (step.action) await expect(forward).toBeHidden();
      if (step.action === "navigate") {
        await expect(
          dialog.getByRole("button", { name: step.previous!, exact: true }),
        ).toHaveAttribute("aria-current", "page");
        await dialog
          .getByRole("button", { name: step.section, exact: true })
          .click();
      } else if (step.action === "protrusions") {
        const toggle = dialog.getByRole("switch", {
          name: "Enable Protrusions",
        });
        await toggle.check();
        await expect(toggle).toBeChecked();
        await expect(forward).toBeVisible();
        await card
          .getByRole("button", { name: "Restart step", exact: true })
          .click();
        await expect(toggle).not.toBeChecked();
        await expect(forward).toBeHidden();
        await toggle.check();
      } else if (step.action === "field") {
        const field = dialog.getByLabel("Field Image", { exact: true });
        await expect(dialog.locator(".field-preview")).toBeInViewport({
          ratio: 1,
        });
        const originalImage = await dialog
          .locator(".field-preview img")
          .getAttribute("src");
        await field.selectOption("frc2025-reefscape");
        await expect(field).toHaveValue("frc2025-reefscape");
        await expect(dialog.locator(".field-preview")).toBeInViewport({
          ratio: 1,
        });
        await expect(dialog.locator(".field-preview img")).not.toHaveAttribute(
          "src",
          originalImage!,
        );
        await expect(
          dialog.getByRole("button", { name: "Upload Image", exact: true }),
        ).toBeDisabled();
      }
      await expect(
        dialog.getByRole("button", { name: step.section, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      if (step.target)
        await expect(
          dialog.locator(`[data-tour="${step.target}"]`),
        ).toBeInViewport({ ratio: 1 });
      // Preset numerical/text values remain locked even on the interactive steps.
      await expect(
        dialog.locator(
          '.config-dialog__content input:not([type="checkbox"]):enabled',
        ),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole("button", { name: "Save", exact: true }),
      ).toHaveCount(0);
      if (step.title !== "Tune your robot") await expect(forward).toBeVisible();
      await layout(page);
      expect((await snapshot(page)).project).toEqual(practice.project);
      expect((await snapshot(page)).preferences).toEqual(original.preferences);
      if (step.title === "Translation defaults") {
        await expect(
          dialog.getByLabel("Default Max Velocity (m/s)", { exact: true }),
        ).toHaveValue("4.5");
        await expect(
          dialog.getByLabel("Default Max Accel (m/s2)", { exact: true }),
        ).toHaveValue("12");
      }
    }
    await expect(
      card.getByRole("link", { name: "Read Tune Your Robot" }),
    ).toHaveAttribute(
      "href",
      "https://bline-docs.pages.dev/getting-started/tuning/",
    );
    await card.getByRole("button", { name: "Back", exact: true }).click();
    await expect(card).toContainText("Generator settings");
    await next(page, "Tune your robot");
    await expect(dialog).toBeVisible();
    await card.getByRole("button", { name: "Finish", exact: true }).click();
    await expect(dialog).toBeHidden();
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
  test(`discards settings lesson changes on ${exit} @webkit-canvas`, async ({
    page,
  }) => {
    await gotoSampleEditor(page);
    await expect(page.getByTestId("save-status")).toContainText("Saved");
    const original = await snapshot(page);
    await openLesson(page);
    await next(page, "Enable protrusions");
    await page.getByRole("switch", { name: "Enable Protrusions" }).check();
    await next(page, "Protrusion settings");
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
    // Reopening the lesson always starts from its preset values.
    await openLesson(page);
    await next(page, "Enable protrusions");
    await expect(
      page.getByRole("switch", { name: "Enable Protrusions" }),
    ).not.toBeChecked();
  });
}

import { expect, test, type Page } from "@playwright/test";
import {
  gotoSampleEditor,
  openProjectSettings,
  selectDropdownOption,
} from "./support/app-shell-shared";

async function optionLabels(page: Page, label: string): Promise<string[]> {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  const listbox = page.getByRole("listbox", {
    name: `${label} options`,
    exact: true,
  });
  const labels = await listbox.getByRole("option").allTextContents();
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  return labels;
}

async function storedConfig(page: Page) {
  return page.evaluate(async () => {
    const modulePath = "/src/state/projectStore.ts";
    const { projectStore } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import("../../src/state/projectStore");
    const config = projectStore.getState().project?.config;
    return {
      side: config?.gui.protrusions.side,
      state: config?.gui.protrusions.default_state,
      mode: config?.kinematic_constraints.default_handoff_mode,
    };
  });
}

test("shows readable names for stored Settings values", async ({ page }) => {
  await gotoSampleEditor(page);
  await openProjectSettings(page);
  const dialog = page.getByRole("dialog", { name: "Edit Config" });

  await expect(dialog.getByLabel("Protrusion Side")).toHaveText("None");
  await dialog.getByLabel("Enable Protrusions").check();
  await expect(dialog.getByLabel("Default Protrusion State")).toHaveText(
    "Shown",
  );
  expect(await optionLabels(page, "Protrusion Side")).toEqual([
    "None",
    "Left",
    "Right",
    "Front",
    "Back",
  ]);
  expect(await optionLabels(page, "Default Protrusion State")).toEqual([
    "Shown",
    "Hidden",
  ]);
  await selectDropdownOption(page, "Protrusion Side", "Front");
  await selectDropdownOption(page, "Default Protrusion State", "Hidden");

  await dialog.getByRole("button", { name: "Path Defaults" }).click();
  await expect(dialog.getByLabel("Default Handoff Mode")).toHaveText("Radius");
  expect(await optionLabels(page, "Default Handoff Mode")).toEqual([
    "Radius",
    "Progress",
  ]);
  await selectDropdownOption(page, "Default Handoff Mode", "Progress");

  await dialog.getByRole("button", { name: "Save" }).click();
  // The labels are display only: the project keeps its stored values.
  await expect
    .poll(() => storedConfig(page))
    .toEqual({ side: "front", state: "hidden", mode: "progress" });
});

test("scrolls newly added Settings rows into view and focuses them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  await gotoSampleEditor(page);
  await openProjectSettings(page);
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByLabel("Enable Protrusions").check();

  const addHide = dialog.getByRole("button", {
    name: "Add hide event key",
    exact: true,
  });
  for (let row = 1; row <= 5; row += 1) {
    await addHide.click();
    const input = dialog.getByLabel(`Hide event key ${row}`, { exact: true });
    await expect(input).toBeFocused();
    await expect(input).toBeInViewport();
    await page.keyboard.type(`retract${row}`);
  }

  await dialog
    .getByRole("button", { name: "Event Triggers", exact: true })
    .click();
  for (const key of ["alpha", "bravo", "charlie", "delta", "echo", "fox"]) {
    await dialog.getByRole("button", { name: "Add new", exact: true }).click();
    const input = dialog.getByLabel("New Lib Key", { exact: true });
    await expect(input).toBeInViewport();
    await input.fill(key);
    await input.press("Enter");
    const actions = dialog.getByRole("button", {
      name: `Event trigger actions for ${key}`,
    });
    await expect(actions).toBeFocused();
    await expect(actions).toBeInViewport();
  }
});

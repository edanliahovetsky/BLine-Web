import { expect, test, type Page } from "@playwright/test";
import {
  gotoSampleEditor,
  openProjectSettings,
} from "./support/app-shell-shared";

async function config(page: Page) {
  return page.evaluate(async () => {
    const { projectStore } = await import(
      /* @vite-ignore */ "/src/state/projectStore.ts" as string
    );
    return projectStore.getState().project.config;
  });
}

for (const width of [1280, 390]) {
  test(`edits protrusion key lists with autocomplete at ${width}px @webkit-canvas`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(30_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoSampleEditor(page);
    await page.getByTestId("path-element-row-4").click();
    await page.getByLabel("Lib Key", { exact: true }).fill("deployOne");
    await page.getByLabel("Lib Key", { exact: true }).press("Tab");
    if (width < 700)
      await page
        .getByRole("button", { name: "Toggle inspector", exact: true })
        .click();
    await page.setViewportSize({ width, height: 800 });
    if (width < 700)
      await page
        .getByRole("dialog", { name: "Mobile support warning" })
        .getByRole("button", { name: "Continue", exact: true })
        .click();
    await openProjectSettings(page);
    const dialog = page.getByRole("dialog", { name: "Edit Config" });
    const section = (name: string) =>
      dialog.getByRole("button", { name, exact: true });
    const add = (action: string) =>
      page.getByRole("button", {
        name: `Add ${action} event key`,
        exact: true,
      });
    const field = (action: string, index: number) =>
      page.getByLabel(`${action} event key ${index}`, { exact: true });
    const menu = async (action: string, index: number, name: string) => {
      await page
        .getByRole("button", {
          name: `Event trigger actions for ${action} key ${index}`,
          exact: true,
        })
        .click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    };
    await expect(add("show")).toBeDisabled();
    await expect(add("hide")).toBeDisabled();
    await page.getByRole("switch", { name: "Enable Protrusions" }).check();
    await section("Event Triggers").click();
    for (const key of ["deployTwo", "retract"]) {
      await page.getByRole("button", { name: "Add new", exact: true }).click();
      await page.getByLabel("New Lib Key", { exact: true }).fill(key);
      await page
        .getByRole("button", { name: "Save Lib Key", exact: true })
        .click();
    }
    await section("Robot").click();
    await add("show").click();
    await expect(field("Show", 1)).toBeFocused();
    await field("Show", 1).fill("dep");
    await expect(
      page.getByRole("option", { name: "deployOne", exact: true }),
    ).toBeVisible();
    await expect(dialog.locator(".event-key-input__completion")).toHaveText(
      "deployOne",
    );
    await field("Show", 1).press("Tab");
    await expect(field("Show", 1)).toHaveValue("deployOne");
    await expect(dialog).toBeVisible();
    await add("show").click();
    await field("Show", 2).fill("dep");
    await field("Show", 2).press("ArrowDown");
    await field("Show", 2).press("Enter");
    await expect(field("Show", 2)).toHaveValue("deployTwo");
    await add("hide").click();
    await field("Hide", 1).fill("ret");
    await page.getByRole("option", { name: "retract", exact: true }).click();
    await expect(field("Hide", 1)).toHaveValue("retract");
    await menu("show", 1, "Duplicate");
    await expect(field("Show", 2)).toBeFocused();
    await expect(field("Show", 2)).toHaveValue("deployOne_copy");
    await menu("show", 2, "Rename");
    await expect(field("Show", 2)).toBeFocused();
    await field("Show", 2).fill("extendAlias");
    await field("Show", 2).press("Enter");
    await menu("show", 1, "Remove");
    await expect(field("Show", 1)).toHaveValue("extendAlias");
    await expect(field("Show", 2)).toHaveValue("deployTwo");
    await expect(field("Show", 3)).toHaveCount(0);
    await field("Hide", 1).focus();
    await field("Hide", 1).press("Escape");
    await expect(dialog).toBeVisible();
    for (const input of [
      field("Show", 1),
      field("Show", 2),
      field("Hide", 1),
    ]) {
      const bounds = await input.boundingBox();
      expect(bounds!.width).toBeGreaterThan(100);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({
      path: testInfo.outputPath("protrusion-key-lists.png"),
    });
    await section("Save").click();
    await expect(dialog).toBeHidden();
    if (width < 700)
      await page
        .getByRole("button", { name: "Toggle inspector", exact: true })
        .click();
    await expect(page.getByLabel("Lib Key", { exact: true })).toHaveValue(
      "deployOne",
    );
    if (width < 700)
      await page
        .getByRole("button", { name: "Toggle inspector", exact: true })
        .click();
    const saved = await config(page);
    expect(saved.gui.protrusions.show_on_event_keys).toEqual([
      "extendAlias",
      "deployTwo",
    ]);
    expect(saved.gui.protrusions.hide_on_event_keys).toEqual(["retract"]);
    expect(saved.gui.event_trigger_keys).toEqual(
      expect.arrayContaining([
        "extendAlias",
        "deployOne",
        "deployTwo",
        "retract",
      ]),
    );
    expect(saved.gui.event_trigger_keys).not.toContain("dep");
    await expect(page.getByTestId("save-status")).toHaveClass(/--saved/);
    await page.reload();
    await openProjectSettings(page);
    await expect(field("Show", 1)).toHaveValue("extendAlias");
    await expect(field("Hide", 1)).toHaveValue("retract");
    // Pending project-wide renames must also change autocomplete before Save.
    await section("Event Triggers").click();
    await page
      .getByRole("button", {
        name: "Event trigger actions for deployOne",
        exact: true,
      })
      .click();
    await page
      .getByRole("menuitem", { name: "Rename All", exact: true })
      .click();
    await page.getByLabel("Replacement Lib Key").fill("renamedDeploy");
    await page
      .getByRole("button", { name: "Save Lib Key", exact: true })
      .click();
    await section("Robot").click();
    await add("show").click();
    await field("Show", 3).fill("ren");
    await expect(
      page.getByRole("option", { name: "renamedDeploy", exact: true }),
    ).toBeVisible();
    await field("Show", 3).press("Tab");
    await expect(field("Show", 3)).toHaveValue("renamedDeploy");
    await section("Cancel").click();
    expect(await config(page)).toEqual(saved);
  });
}

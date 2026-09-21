import {
  installSaveFilePickerSpy,
  openProjectMenu,
  savedFile,
  savedFileCount,
} from "./support/app-shell-persistence";
import { expect, test } from "@playwright/test";
import {
  gotoSampleEditor,
  openProjectSettings,
  requiredBox,
} from "./support/app-shell-shared";

test("tank driving direction persists with Undo/Redo and fits beside playback @webkit-canvas", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installSaveFilePickerSpy(page);
  await gotoSampleEditor(page);
  await openProjectSettings(page);
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog
    .getByRole("combobox", { name: "Drive type", exact: true })
    .selectOption("tank");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const backward = page.getByRole("button", {
    name: "Drive backward",
    exact: true,
  });
  const forward = page.getByRole("button", {
    name: "Drive forward",
    exact: true,
  });
  await expect(forward).toHaveAttribute("aria-pressed", "true");
  await backward.click();
  await expect(backward).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(forward).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(backward).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await page.reload();
  await expect(backward).toHaveAttribute("aria-pressed", "true");
  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await page.getByRole("menuitem", { name: "Export Path..." }).click();
  await expect.poll(() => savedFileCount(page)).toBe(1);
  const exported = JSON.parse((await savedFile(page, 0)).text);
  expect(exported.tank_drive_direction).toBe("backward");
  expect(exported).not.toHaveProperty("preview");
  for (const legacy of [true, false]) {
    await openProjectSettings(page);
    await dialog
      .getByRole("switch", { name: "Legacy appearance", exact: true })
      .setChecked(legacy);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    for (const [direction, button] of [
      ["forward", forward],
      ["backward", backward],
    ] as const) {
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(button).toHaveAttribute("title", `Drive ${direction}`);
      const bounds = await requiredBox(button);
      expect(bounds.width).toBe(32);
      expect(bounds.height).toBe(32);
      await page.locator(".simulation-transport-row").screenshot({
        path: testInfo.outputPath(
          `${legacy ? "legacy" : "regular"}-${direction}.png`,
        ),
      });
    }
  }
  await page
    .getByRole("button", { name: "Toggle inspector", exact: true })
    .click();
  await page.setViewportSize({ width: 440, height: 800 });
  await page
    .getByRole("dialog", { name: "Mobile support warning" })
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  const transport = await requiredBox(page.getByTestId("simulation-transport"));
  const direction = await requiredBox(
    page.getByRole("group", { name: "Tank driving direction" }),
  );
  const save = await requiredBox(page.getByTestId("save-status"));
  expect(direction.x).toBeGreaterThan(transport.x + transport.width);
  expect(
    Math.abs(
      direction.y + direction.height / 2 - transport.y - transport.height / 2,
    ),
  ).toBeLessThan(1);
  expect(direction.x + direction.width).toBeLessThanOrEqual(save.x);
  await openProjectSettings(page);
  await dialog
    .getByRole("combobox", { name: "Drive type", exact: true })
    .selectOption({ label: "Swerve / Mecanum" });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(backward).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Play simulation", exact: true }),
  ).toBeEnabled();
});

import { expect, test } from "@playwright/test";
import {
  gotoSampleEditor,
  openProjectSettings,
  selectDropdownOption,
} from "./support/app-shell-shared";

test("previews the robot footprint live while editing Robot settings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await gotoSampleEditor(page);
  await openProjectSettings(page);
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  const preview = dialog.getByTestId("robot-preview");
  const body = preview.getByTestId("robot-preview-body");
  await expect(preview).toContainText("0.8 × 0.8 m");

  const widthBefore = Number(await body.getAttribute("width"));
  await dialog.getByLabel("Robot Length (m)").fill("1.1");
  await dialog.getByLabel("Robot Length (m)").press("Tab");
  await expect(preview).toContainText("1.1 × 0.8 m");
  expect(Number(await body.getAttribute("width"))).toBeGreaterThan(widthBefore);

  await dialog.getByLabel("Enable Protrusions").check();
  await dialog.getByLabel("Protrusion Distance (m)").fill("0.3");
  await dialog.getByLabel("Protrusion Distance (m)").press("Tab");
  await selectDropdownOption(page, "Protrusion Side", "Front");
  const protrusion = preview.getByTestId("robot-preview-protrusion");
  await expect(protrusion).toHaveCount(1);
  await expect(preview).toContainText("0.3 m front protrusion");
  await selectDropdownOption(page, "Default Protrusion State", "Hidden");
  await expect(protrusion).toHaveClass(/is-hidden/);
  await expect(preview).toContainText("starts hidden");

  // The preview stays in sight beside the rows that change it.
  await dialog
    .getByRole("button", { name: "Add hide event key", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(preview).toBeInViewport();
});

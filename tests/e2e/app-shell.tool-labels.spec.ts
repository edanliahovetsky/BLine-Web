import { expect, test } from "@playwright/test";
import { gotoSampleEditor } from "./support/app-shell-shared";

test("labels canvas tools instantly and keeps explanations in the shortcut reference", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const eventTool = page.getByRole("button", { name: "Event tool" });
  const label = page.getByTestId("tool-label-event");

  await expect(label).toBeHidden();
  await eventTool.hover();
  // No native-title delay: the short label is visible on the first check.
  await expect(label).toBeVisible({ timeout: 250 });
  await expect(label).toHaveText("Event · 4");
  await expect(eventTool).not.toHaveAttribute("title", /.*/);

  await page.getByRole("button", { name: "Waypoint tool" }).hover();
  await expect(label).toBeHidden();
  await expect(page.getByTestId("tool-label-waypoint")).toHaveText(
    "Waypoint · 1",
  );

  await page.getByTestId("path-stage").focus();
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toContainText("Trigger an action along the path");
  await expect(help).toContainText("Place a robot position and heading");
  // The move/rotate gestures are explained once, not on every tool.
  await expect(help.getByText("Drag its front edge")).toHaveCount(1);
});

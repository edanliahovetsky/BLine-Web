import type { Page } from "@playwright/test";

export async function openConstraintsTab(page: Page): Promise<void> {
  const constraintsTab = page.getByRole("tab", { name: /Constraints/ });
  if (!(await constraintsTab.isVisible())) {
    await page.getByRole("button", { name: "Toggle inspector" }).click();
  }
  await constraintsTab.click();
}

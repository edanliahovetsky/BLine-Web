import { expect, type Locator, type Page } from "@playwright/test";

export async function expectGlobalShortcutsBlockedByDialog(
  page: Page,
  dialog: Locator,
  focusTarget: Locator,
): Promise<void> {
  await expect(dialog).toBeVisible();
  await expect(focusTarget).toBeFocused();

  const inspectorToggle = page.getByRole("button", {
    name: "Toggle inspector",
  });
  const inspectorExpanded = await inspectorToggle.getAttribute("aria-expanded");
  const useMetaKey = process.platform === "darwin";
  const results = await page.evaluate(
    ({ metaKey }) => {
      const target = document.activeElement;
      if (!(target instanceof HTMLElement)) {
        throw new Error("Expected the blocking surface to own focus");
      }

      return ["b", "s", "k", "F1"].map((key) => {
        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: key === "F1" ? false : !metaKey,
          key,
          metaKey: key === "F1" ? false : metaKey,
        });
        target.dispatchEvent(event);
        return { defaultPrevented: event.defaultPrevented, key };
      });
    },
    { metaKey: useMetaKey },
  );

  expect(results).toEqual([
    { defaultPrevented: false, key: "b" },
    { defaultPrevented: false, key: "s" },
    { defaultPrevented: false, key: "k" },
    { defaultPrevented: false, key: "F1" },
  ]);
  await expect(inspectorToggle).toHaveAttribute(
    "aria-expanded",
    inspectorExpanded ?? "false",
  );
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(focusTarget).toBeFocused();
}

export async function runEditMenuAction(
  page: Page,
  action: "Undo" | "Redo",
): Promise<void> {
  // Undo/Redo now live on the toolbar rather than an Edit menu.
  await page.getByRole("button", { name: action, exact: true }).click();
}

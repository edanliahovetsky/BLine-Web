import { expect, test } from "@playwright/test";
import { gotoSampleEditor } from "./support/app-shell-shared";

// Browser zoom changes the CSS viewport and device pixel ratio together.
// Model a 1440px window at common zoom levels, including both sides of the
// former 1280/1120px layout transitions. This is layout zoom, not pinch zoom.
for (const zoom of [0.75, 0.9, 1, 1.1, 1.25, 1.5, 2]) {
  test.describe(`page zoom ${Math.round(zoom * 100)}%`, () => {
    test.use({
      viewport: {
        width: Math.round(1440 / zoom),
        height: Math.round(900 / zoom),
      },
      deviceScaleFactor: zoom,
    });
    test("centers the selector with inspector open and closed", async ({
      page,
    }) => {
      await gotoSampleEditor(page);
      for (const open of [false, true]) {
        const toggle = page.getByRole("button", { name: "Toggle inspector" });
        if ((await toggle.getAttribute("aria-expanded")) !== String(open)) {
          await toggle.click();
        }
        await expectCenteredToolbar(page);
        await page.getByLabel("Toolbar path", { exact: true }).click();
        const menu = page.getByRole("listbox", {
          name: "Toolbar path options",
        });
        await expect(menu).toBeInViewport({ ratio: 1 });
        await page
          .getByRole("option", { name: "Phase 1 Canvas Draft", exact: true })
          .click();
        await expect(menu).toHaveCount(0);
      }
    });
  });
}

async function expectCenteredToolbar(page: import("@playwright/test").Page) {
  const selector = page.getByLabel("Toolbar path", { exact: true });
  const geometry = await selector.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const buttons = Array.from(
      document.querySelectorAll(".app-toolbar button"),
    );
    const boxes = buttons.map((button) => button.getBoundingClientRect());
    return {
      centerError: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
      overlaps: boxes.some((a, i) =>
        boxes
          .slice(i + 1)
          .some(
            (b) =>
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1,
          ),
      ),
      inViewport: boxes.every(
        (box) =>
          box.left >= 0 &&
          box.right <= window.innerWidth &&
          box.top >= 0 &&
          box.bottom <= window.innerHeight,
      ),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  expect(geometry.centerError).toBeLessThanOrEqual(1);
  expect(geometry.overlaps).toBe(false);
  expect(geometry.inViewport).toBe(true);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
}

test("keeps the selector centered through responsive and canvas zoom changes @webkit-canvas", async ({
  page,
}) => {
  await page.addLocatorHandler(
    page.getByRole("dialog", { name: "Mobile support warning" }),
    async (warning) => {
      await warning.getByRole("button", { name: "Continue" }).click();
    },
  );
  await gotoSampleEditor(page);
  for (const width of [
    1440, 1281, 1280, 1121, 1120, 981, 980, 821, 820, 641, 640, 450, 390, 361,
    360, 320,
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await expectCenteredToolbar(page);
    await page.getByLabel("Toolbar path", { exact: true }).click();
    const menu = page.getByRole("listbox", { name: "Toolbar path options" });
    await expect(menu).toBeInViewport({ ratio: 1 });
    const centerError = await menu.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return Math.abs(box.left + box.width / 2 - window.innerWidth / 2);
    });
    expect(centerError).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1180, height: 860 });
  const toggle = page.getByRole("button", { name: "Toggle inspector" });
  if ((await toggle.getAttribute("aria-expanded")) === "true")
    await toggle.click();
  for (const name of ["Zoom in", "Zoom out"]) {
    for (let step = 0; step < 5; step++) {
      await page.getByRole("button", { name, exact: true }).click();
      await expectCenteredToolbar(page);
    }
  }
});

import { expect, test } from "@playwright/test";
import { canvasNodePosition, pointDistance } from "./support/app-shell-canvas";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";
import { openEditMenu } from "./support/app-shell-project-library";
import { runEditMenuAction } from "./support/app-shell-commands";

test("keeps hand and rotation cursors when the pointer moves during field loading @webkit-canvas", async ({
  page,
}) => {
  let releaseField!: () => void;
  let fieldRequested!: () => void;
  const fieldGate = new Promise<void>((resolve) => {
    releaseField = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    fieldRequested = resolve;
  });
  await page.route(/\/field26\.png(?:\?.*)?$/, async (route) => {
    if (route.request().resourceType() !== "image") {
      await route.continue();
      return;
    }
    fieldRequested();
    await fieldGate;
    await route.continue();
  });
  try {
    await gotoSampleEditor(page);
    await requested;
    // Pixi listens to document pointer events while the texture is pending.
    await page.mouse.move(10, 10);
  } finally {
    releaseField();
  }
  const canvas = page.getByTestId("path-stage-pixi-canvas");
  await expect(canvas).toBeVisible();
  const box = await requiredBox(page.getByTestId("path-stage-canvas"));
  const center = await canvasNodePosition(page, "path-element-node-0");
  const front = await canvasNodePosition(page, "path-element-front-0");
  await page.mouse.move(box.x + center.x, box.y + center.y);
  await expect(canvas).toHaveCSS("cursor", "grab");
  await page.mouse.move(box.x + front.x, box.y + front.y);
  await expect(canvas).toHaveCSS("cursor", /url\(.+\) 14 14, crosshair/);
});

for (const tool of [
  "Select",
  "Waypoint",
  "Translation",
  "Rotation",
  "Event",
  "Curve",
]) {
  for (const index of [0, 1]) {
    test(`drags ${index === 0 ? "waypoint" : "translation"} center with ${tool} tool and one undo @webkit-canvas`, async ({
      page,
    }) => {
      await gotoSampleEditor(page);
      const row = page.getByTestId(`path-element-row-${index}`);
      await row.click();
      const x = page.getByLabel("X (m)");
      const beforeX = await x.inputValue();
      const rows = page.locator('[data-testid^="path-element-row-"]');
      const count = await rows.count();
      const button = page.getByRole("button", {
        name: `${tool} tool`,
        exact: true,
      });
      await button.click();
      const canvas = page.getByTestId("path-stage-canvas");
      const box = await requiredBox(canvas);
      const start = await canvasNodePosition(
        page,
        `path-element-node-${index}`,
      );
      const paintedCanvas = page.getByTestId("path-stage-pixi-canvas");
      await page.mouse.move(box.x + start.x, box.y + start.y);
      await expect(paintedCanvas).toHaveCSS("cursor", "grab");
      await page.mouse.down();
      await expect(paintedCanvas).toHaveCSS("cursor", "grabbing");
      await page.mouse.move(box.x + start.x + 46, box.y + start.y - 28, {
        steps: 8,
      });
      await expect
        .poll(async () =>
          pointDistance(
            start,
            await canvasNodePosition(page, `path-element-node-${index}`),
          ),
        )
        .toBeGreaterThan(30);
      await expect(x).toHaveValue(beforeX);
      await expect(rows).toHaveCount(count);
      await page.mouse.up();
      await expect(paintedCanvas).toHaveCSS("cursor", "grab");
      await page.mouse.move(box.x + box.width - 40, box.y + box.height / 2);
      await expect(paintedCanvas).toHaveCSS(
        "cursor",
        tool === "Select" ? "grab" : "crosshair",
      );
      await expect(x).not.toHaveValue(beforeX);
      const afterX = await x.inputValue();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("save-status")).toContainText("Saved");
      await runEditMenuAction(page, "Undo");
      await expect(x).toHaveValue(beforeX);
      await runEditMenuAction(page, "Redo");
      await expect(x).toHaveValue(afterX);
      await expect(rows).toHaveCount(count);
      await expect(page.getByTestId("save-status")).toContainText("Saved");
      await page.reload();
      await expect(row).toBeVisible();
      await row.click();
      await expect(x).toHaveValue(afterX);
      await expect(rows).toHaveCount(count);
    });
  }

  test(`shows the rotate cursor and turns a waypoint with ${tool} tool @webkit-canvas`, async ({
    page,
  }) => {
    await gotoSampleEditor(page);
    const toolButton = page.getByRole("button", {
      name: `${tool} tool`,
      exact: true,
    });
    await toolButton.click();
    const host = page.getByTestId("path-stage-canvas");
    const paintedCanvas = page.getByTestId("path-stage-pixi-canvas");
    const box = await requiredBox(host);
    const center = await canvasNodePosition(page, "path-element-node-0");
    const front = await canvasNodePosition(page, "path-element-front-0");
    const rotationCursor = /url\(.+\) 14 14, crosshair/;
    await page.mouse.move(box.x + front.x, box.y + front.y);
    await expect(paintedCanvas).toHaveCSS("cursor", rotationCursor);
    await page.mouse.down();
    await expect(page.getByLabel("Rotation (deg)")).toHaveValue("45");
    // Leave the footprint while rotating; pointer capture must keep its cursor.
    await page.mouse.move(box.x + center.x, box.y + center.y - 65, {
      steps: 8,
    });
    await expect(paintedCanvas).toHaveCSS("cursor", rotationCursor);
    await page.mouse.up();
    // WebKit rounds mouse coordinates to CSS pixels at this zoom.
    await expect
      .poll(async () =>
        Math.abs(
          Number(await page.getByLabel("Rotation (deg)").inputValue()) - 90,
        ),
      )
      .toBeLessThan(1);
    await expect(toolButton).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('[data-testid^="path-element-row-"]'),
    ).toHaveCount(6);
    expect(
      pointDistance(
        center,
        await canvasNodePosition(page, "path-element-node-0"),
      ),
    ).toBeLessThan(0.5);
    await expect(paintedCanvas).toHaveCSS(
      "cursor",
      tool === "Select" ? "grab" : "crosshair",
    );
    await runEditMenuAction(page, "Undo");
    await expect(page.getByLabel("Rotation (deg)")).toHaveValue("45");
  });

  test(`Escape cancels a center drag with ${tool} tool`, async ({ page }) => {
    await gotoSampleEditor(page);
    await page.getByTestId("path-element-row-0").click();
    const beforeX = await page.getByLabel("X (m)").inputValue();
    await page
      .getByRole("button", { name: `${tool} tool`, exact: true })
      .click();
    const box = await requiredBox(page.getByTestId("path-stage-canvas"));
    const start = await canvasNodePosition(page, "path-element-node-0");
    await page.mouse.move(box.x + start.x, box.y + start.y);
    await page.mouse.down();
    await page.mouse.move(box.x + start.x + 55, box.y + start.y - 25, {
      steps: 5,
    });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.getByLabel("X (m)")).toHaveValue(beforeX);
    await expect
      .poll(async () =>
        pointDistance(
          start,
          await canvasNodePosition(page, "path-element-node-0"),
        ),
      )
      .toBeLessThan(0.5);
    await expect(
      page.locator('[data-testid^="path-element-row-"]'),
    ).toHaveCount(6);
  });
}

for (const index of [0, 1]) {
  test(`keeps locked ${index === 0 ? "waypoints" : "translations"} fixed with every tool`, async ({
    page,
  }) => {
    await gotoSampleEditor(page);
    await page.getByTestId(`path-element-row-${index}`).click();
    await page
      .getByRole("button", { name: "Link element", exact: true })
      .click();
    const actions = page.getByRole("group", { name: "Linked element actions" });
    await actions
      .getByRole("button", {
        name: index === 0 ? /New Linked Waypoint/ : /New Linked Translation/,
      })
      .click();
    await actions.getByLabel("Linked element name").fill("Locked position");
    await actions
      .getByRole("button", { name: "Create & Link", exact: true })
      .click();
    const menu = await openEditMenu(page);
    await menu.getByRole("menuitem", { name: "Linked Elements..." }).click();
    const dialog = page.getByRole("dialog", {
      name: "Linked Elements",
      exact: true,
    });
    await dialog
      .getByRole("listitem")
      .filter({ hasText: "Locked position" })
      .click();
    await dialog.getByRole("switch", { name: "Locked", exact: true }).check();
    await dialog
      .getByRole("button", { name: "Close linked elements", exact: true })
      .click();
    // The linked-library canvas owns the debug hook while open. Reload also verifies the saved lock.
    await expect(page.getByTestId("save-status")).toContainText("Saved");
    await page.reload();
    await page.getByTestId(`path-element-row-${index}`).click();
    const box = await requiredBox(page.getByTestId("path-stage-canvas"));
    const start = await canvasNodePosition(page, `path-element-node-${index}`);
    for (const tool of [
      "Select",
      "Waypoint",
      "Translation",
      "Rotation",
      "Event",
      "Curve",
    ]) {
      await page
        .getByRole("button", { name: `${tool} tool`, exact: true })
        .click();
      await page.mouse.move(box.x + start.x, box.y + start.y);
      await page.mouse.down();
      await page.mouse.move(box.x + start.x + 50, box.y + start.y - 25, {
        steps: 6,
      });
      await page.mouse.up();
      expect(
        pointDistance(
          start,
          await canvasNodePosition(page, `path-element-node-${index}`),
        ),
      ).toBeLessThan(0.5);
      await expect(
        page.locator('[data-testid^="path-element-row-"]'),
      ).toHaveCount(6);
      if (index === 0) {
        const front = await canvasNodePosition(page, "path-element-front-0");
        await page.mouse.move(box.x + front.x, box.y + front.y);
        await expect(page.getByTestId("path-stage-pixi-canvas")).not.toHaveCSS(
          "cursor",
          /url\(/,
        );
        await page.mouse.down();
        await page.mouse.move(box.x + start.x, box.y + start.y - 65, {
          steps: 6,
        });
        await page.mouse.up();
        await expect(page.getByLabel("Rotation (deg)")).toHaveValue("45");
        await expect(
          page.locator('[data-testid^="path-element-row-"]'),
        ).toHaveCount(6);
      }
    }
  });
}

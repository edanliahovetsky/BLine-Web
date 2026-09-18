import { openProjectMenu } from "./support/app-shell-persistence";
import { expect, test, type Page } from "@playwright/test";
import { canvasNodePosition } from "./support/app-shell-canvas";
import { openConstraintsTab } from "./support/app-shell-constraints";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

test("renders generated, manual, and default handoffs in purple @webkit-canvas", async ({
  page,
}) => {
  await importHandoffPath(page, [
    [1, 1, null],
    [4, 1, 0.45],
    [4, 4, null],
    [4, 7, null],
  ]);
  await page.getByRole("button", { name: "Generate constraints" }).click();
  await expect(
    page
      .getByTestId("constraint-card-max_velocity_meters_per_sec")
      .getByRole("status"),
  ).toHaveText("Up to date");
  await expect(page.getByTestId("handoff-radius-chip-0")).toHaveClass(/--auto/);
  await expect(page.getByTestId("handoff-radius-chip-1")).toHaveClass(
    /--manual/,
  );
  await expect(page.getByTestId("handoff-radius-chip-2")).toHaveClass(
    /--unset/,
  );
  await expect(page.getByTestId("handoff-radius-chip-3")).toBeDisabled();

  // Inspect rendered pixels, so hiding a default ring cannot satisfy the
  // same assertion as changing its color. These isolated anchors have no
  // other purple canvas objects nearby.
  for (const index of [0, 1, 2]) {
    await expect
      .poll(() => purplePixelsAroundAnchor(page, index), {
        message: `Anchor ${index + 1} has a visible purple handoff ring`,
      })
      .toBeGreaterThan(40);
  }
  expect(await purplePixelsAroundAnchor(page, 3)).toBe(0);
});

test("generates and persists handoffs below the former 0.3 meter cutoff", async ({
  page,
}) => {
  await importHandoffPath(page, [
    [1, 1, null],
    [1.299, 1, null],
    [1.299, 1.299, null],
    [2, 1.299, null],
  ]);
  const generate = page.getByRole("button", { name: "Generate constraints" });
  await generate.click();
  await expect(
    page
      .getByTestId("constraint-card-max_velocity_meters_per_sec")
      .getByRole("status"),
  ).toHaveText("Up to date");

  for (const index of [1, 2]) {
    const chip = page.getByTestId(`handoff-radius-chip-${index}`);
    await expect(chip).toHaveClass(/--auto/, { timeout: 30_000 });
    const radius = Number.parseFloat(await chip.innerText());
    expect(radius).toBeGreaterThanOrEqual(0.05);
    expect(radius).toBeLessThanOrEqual(0.269);
  }
  await expect(page.getByTestId("handoff-radius-chip-3")).toBeDisabled();
  const chips = page.locator('[data-testid^="handoff-radius-chip-"]');
  const generatedValues = await chips.allTextContents();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await page.reload();
  await page.getByRole("tab", { name: "Constraints", exact: true }).click();
  await expect(chips).toHaveText(generatedValues);
  await expect(page.getByTestId("handoff-radius-chip-1")).toHaveClass(/--auto/);
  await expect(page.getByTestId("handoff-radius-chip-2")).toHaveClass(/--auto/);
  await generate.click();
  await expect(
    page
      .getByTestId("constraint-card-max_velocity_meters_per_sec")
      .getByRole("status"),
  ).toHaveText("Up to date");
  await expect(chips).toHaveText(generatedValues);
});

async function importHandoffPath(
  page: Page,
  anchors: Array<[number, number, number | null]>,
): Promise<void> {
  await gotoSampleEditor(page);
  const choosing = page.waitForEvent("filechooser");
  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await page.getByRole("menuitem", { name: "Import Path..." }).click();
  await (
    await choosing
  ).setFiles({
    name: "handoff-radii.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        path_elements: anchors.map(([x, y, radius]) => ({
          type: "translation",
          x_meters: x,
          y_meters: y,
          intermediate_handoff_radius_meters: radius,
        })),
        constraints: {},
      }),
    ),
  });
  // The sample and imported fixture both have four anchors. Wait for the
  // imported path itself before changing modes or starting generation.
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: handoff-radii",
  );
  await openConstraintsTab(page);
  await expect(
    page.locator('[data-testid^="handoff-radius-chip-"]'),
  ).toHaveCount(anchors.length);

  // Native path import materializes project defaults as authored radii.
  // Give the intended unset anchors back to the generator through the UI.
  const automaticIndexes = anchors.flatMap((anchor, index) =>
    anchor[2] === null && index < anchors.length - 1 ? [index] : [],
  );
  for (const [position, index] of automaticIndexes.entries()) {
    await page.getByTestId(`handoff-radius-chip-${index}`).click({
      modifiers:
        position === 0
          ? []
          : [process.platform === "darwin" ? "Meta" : "Control"],
    });
  }
  await page
    .getByRole("group", {
      name:
        automaticIndexes.length > 1
          ? "Selected handoff radius mode"
          : "Handoff radius mode",
      exact: true,
    })
    .getByRole("button", { name: "Auto", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Generate constraints" }),
  ).toBeEnabled();
}

async function purplePixelsAroundAnchor(
  page: Page,
  index: number,
): Promise<number> {
  const node = await canvasNodePosition(page, `path-element-node-${index}`);
  const box = await requiredBox(page.getByTestId("path-stage-canvas"));
  const screenshot = await page.screenshot({
    clip: {
      x: box.x + node.x - 40,
      y: box.y + node.y - 40,
      width: 80,
      height: 80,
    },
  });
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let purple = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [red, green, blue] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
      if (red > 100 && blue > 100 && red > green * 1.5 && blue > green * 1.5)
        purple += 1;
    }
    return purple;
  }, screenshot.toString("base64"));
}

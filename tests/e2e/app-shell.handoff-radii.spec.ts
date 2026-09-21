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

test("geometry buttons preserve inheritance, distance ownership and compact alignment", async ({
  page,
}, testInfo) => {
  await importHandoffPath(page, [
    [1, 1, null],
    [4, 1, 0.45],
    [4, 4, null],
  ]);
  await page.getByTestId("handoff-radius-chip-1").click();
  const row = page.getByTestId("handoff-radius-detail");
  const mode = row.getByRole("group", { name: "Handoff mode 2", exact: true });
  const radius = mode.getByRole("button", { name: "Radius", exact: true });
  const progress = mode.getByRole("button", { name: "Progress", exact: true });
  const reset = page.getByRole("button", {
    name: "Use default handoff mode for point 2",
    exact: true,
  });
  const distance = row.getByRole("spinbutton");
  const source = row.getByRole("group", { name: "Handoff distance source" });
  await expect(mode.getByRole("button")).toHaveCount(2);
  await expect(radius).toHaveAttribute("aria-pressed", "true");
  await expect(reset).toHaveCount(0);
  await radius.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Using project default (Radius)",
  );

  // The spinbox, arrows and separate metre suffix together stay 88px wide.
  // Both sidebar extremes must retain one row with a right-aligned geometry group.
  const resize = page.getByRole("separator", { name: "Resize inspector" });
  for (const [key, name] of [
    ["Home", "narrow"],
    ["End", "wide"],
  ] as const) {
    await resize.press(key);
    const rowBox = await requiredBox(row);
    const sourceBox = await requiredBox(source);
    const distanceBox = await requiredBox(
      row.locator(".handoff-distance-control"),
    );
    const modeBox = await requiredBox(mode);
    const inputBox = await requiredBox(distance);
    const arrowsBox = await requiredBox(row.locator(".sidebar-stepper"));
    const unitBox = await requiredBox(
      row.locator(".handoff-distance-control > span"),
    );
    const centers = [sourceBox, distanceBox, modeBox].map(
      (box) => box.y + box.height / 2,
    );
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
    expect(distanceBox.width).toBe(88);
    expect(inputBox.height).toBe(arrowsBox.height);
    expect(inputBox.y).toBe(arrowsBox.y);
    expect(unitBox.x).toBeGreaterThan(arrowsBox.x + arrowsBox.width);
    expect(sourceBox.x).toBeCloseTo(rowBox.x);
    expect(modeBox.x + modeBox.width).toBeCloseTo(rowBox.x + rowBox.width);
    expect(distanceBox.x).toBeGreaterThan(sourceBox.x + sourceBox.width);
    expect(modeBox.x - distanceBox.x - distanceBox.width).toBe(8);
    await page
      .getByTestId("constraint-card-max_velocity_meters_per_sec")
      .screenshot({
        path: testInfo.outputPath(`handoff-controls-${name}.png`),
      });
  }
  await resize.press("Home");
  await progress.click();
  await expect(progress).toHaveAttribute("aria-pressed", "true");
  await expect(radius).toHaveAttribute("aria-pressed", "false");
  await expect(reset).toBeVisible();
  await expect(distance).toHaveValue("0.45");
  await expect(page.getByTestId("handoff-radius-chip-1")).toHaveClass(
    /--manual/,
  );
  await source.getByRole("button", { name: "Auto", exact: true }).click();
  await expect(distance).toBeDisabled();
  await expect(progress).toBeEnabled();
  await reset.click();
  await expect(radius).toHaveAttribute("aria-pressed", "true");
  await expect(reset).toHaveCount(0);
  await expect(distance).toHaveValue("0.45");
  await expect(distance).toBeDisabled();
  await expect(page.getByTestId("handoff-radius-chip-1")).toHaveClass(/--auto/);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(progress).toHaveAttribute("aria-pressed", "true");
  await expect(reset).toBeVisible();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(radius).toHaveAttribute("aria-pressed", "true");
  await expect(reset).toHaveCount(0);
  // Pin the value before checking persistence: Auto radii are regenerated on
  // reopen, so their current draft is not an authored distance to preserve.
  await source.getByRole("button", { name: "Manual", exact: true }).click();
  await progress.click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  // Exercise opening Constraints before the new document has mounted its UI.
  await page.reload({ waitUntil: "commit" });
  await openConstraintsTab(page);
  await page.getByTestId("handoff-radius-chip-1").click();
  await expect(progress).toHaveAttribute("aria-pressed", "true");
  await expect(reset).toBeVisible();
  await expect(distance).toHaveValue("0.45");
  await expect(distance).toBeEnabled();
  await page
    .getByTestId("constraint-card-max_velocity_meters_per_sec")
    .screenshot({ path: testInfo.outputPath("handoff-controls-override.png") });
  await reset.click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await page.reload({ waitUntil: "commit" });
  await openConstraintsTab(page);
  await page.getByTestId("handoff-radius-chip-1").click();
  await expect(radius).toHaveAttribute("aria-pressed", "true");
  await expect(reset).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Path handoff mode", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await page.getByTestId("path-element-row-1").click();
  await expect(page.getByTestId("property-editor")).toBeVisible();
  await expect(row).toHaveCount(0);
});

test("deleting a handoff selection never removes its path element", async ({
  page,
}) => {
  await importHandoffPath(page, [
    [1, 1, null],
    [4, 1, 0.45],
    [4, 4, null],
  ]);
  const chip = page.getByTestId("handoff-radius-chip-1");
  await chip.click();
  for (const key of ["Delete", "Backspace"]) {
    await chip.press(key);
    // Retain the radius selection while focus moves to the canvas. Both its
    // own handler and the global shortcut must respect the selected object.
    await page.getByTestId("path-stage-canvas").focus();
    await page.keyboard.press(key);
    await expect(
      page.locator('[data-testid^="handoff-radius-chip-"]'),
    ).toHaveCount(3);
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await page.getByTestId("path-element-row-1").click();
  await page.keyboard.press("Delete");
  await expect(page.locator('[data-testid^="path-element-row-"]')).toHaveCount(
    2,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-testid^="path-element-row-"]')).toHaveCount(
    3,
  );
  await openConstraintsTab(page);
  await page.getByTestId("path-stage-canvas").focus();
  await page.keyboard.press("Delete");
  await expect(
    page.locator('[data-testid^="handoff-radius-chip-"]'),
  ).toHaveCount(3);
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
          : "Handoff distance source",
      exact: true,
    })
    .getByRole("button", { name: "Auto", exact: true })
    .click();
  // Switching radius mode queues automatic synchronization. The Generate
  // button is enabled during that debounce but can disable between pointer
  // down/up when the solve starts. Finish that edit before the manual action.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const {
          autoVelocityStore,
        }: typeof import("../../src/state/autoVelocityStore") = await import(
          /* @vite-ignore */ "/src/state/autoVelocityStore.ts" as string
        );
        return autoVelocityStore.getState().phase;
      }),
    )
    .toBe("idle");
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

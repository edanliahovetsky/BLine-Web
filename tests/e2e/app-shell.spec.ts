import { expect, test, type Locator } from "@playwright/test";

test("boots the Phase 1 shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByRole("heading", { name: "BLine Web" })).toBeVisible();
  await expect(page.getByLabel("Editor canvas")).toBeVisible();
  await expect(page.getByTestId("path-stage")).toBeVisible();
  await expect(page.getByText("Current Path: Phase 1 Canvas Draft")).toBeVisible();
  await expect(page.getByText("Path Elements")).toBeVisible();
  await expect(page.getByTestId("path-element-row-0")).toContainText("1. Translation");
  await expect(page.getByText("Element Properties")).toBeVisible();
});

test("selects and drags a canvas anchor", async ({ page }) => {
  await page.goto("/");

  const stage = page.getByTestId("path-stage");
  await expect(stage).toBeVisible();

  const canvas = page.getByTestId("path-stage-canvas");
  const firstAnchor = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 1.2,
    y_meters: 1.1
  });

  await page.mouse.click(firstAnchor.x, firstAnchor.y);
  await expect(page.getByTestId("selected-element-status")).toContainText(
    "Selected: TranslationTarget #1 1.20, 1.10 m"
  );

  await page.mouse.move(firstAnchor.x, firstAnchor.y);
  await page.mouse.down();
  await page.mouse.move(firstAnchor.x + 80, firstAnchor.y - 48, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId("selected-element-status")).not.toContainText(
    "1.20, 1.10 m"
  );
  await expect(page.getByTestId("save-status")).toContainText("Autosave pending");
});

test("keeps the canvas bounded on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 450, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "BLine Web" })).toHaveCount(1);

  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const stageBox = await requiredBox(page.getByTestId("path-stage"));

  expect(documentHeight).toBeLessThan(1_700);
  expect(stageBox.height).toBeLessThan(320);
});

test("plays and seeks the simulation transport", async ({ page }) => {
  await page.goto("/");

  const transport = page.getByTestId("simulation-transport");
  await expect(transport).toBeVisible();
  await expect(page.getByTestId("simulation-time")).toContainText("0.00 /");

  await transport.getByRole("button", { name: "Play simulation" }).click();
  await expect(transport.getByRole("button", { name: "Pause simulation" })).toBeVisible();
  await expect
    .poll(async () => page.getByTestId("simulation-time").innerText())
    .not.toMatch(/^0\.00 /);
  await transport.getByRole("button", { name: "Pause simulation" }).click();

  await page.getByLabel("Simulation time").evaluate((input) => {
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Expected range input");
    }
    input.value = "1.00";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByTestId("simulation-time")).toContainText("1.00 /");
  await transport.getByRole("button", { name: "Reset simulation" }).click();
  await expect(page.getByTestId("simulation-time")).toContainText("0.00 /");
});

test("adds edits and removes path elements from the inspector", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Waypoint" }).click();

  await expect(page.getByTestId("path-element-row-5")).toContainText("6. Waypoint");
  await expect(page.getByTestId("selected-element-status")).toContainText(
    "Selected: Waypoint #6"
  );

  const typeSelect = page.getByLabel("Type");
  const typeRow = page.locator(".property-row").filter({ has: typeSelect });
  const typeIndicatorIcon = typeRow.locator(".property-select-indicator svg");
  await expect(typeIndicatorIcon).toBeVisible();
  expect((await requiredBox(typeIndicatorIcon)).width).toBeGreaterThan(6);

  const xInput = page.getByRole("spinbutton", { name: "X (m)" });
  await xInput.fill("6.25");
  await page.getByLabel("Y (m)").fill("3.75");
  await page.getByLabel("Rotation (deg)").fill("45");

  const xRow = page.locator(".property-row").filter({ has: xInput });
  const increaseX = xRow.getByRole("button", { name: "Increase value" });
  const decreaseX = xRow.getByRole("button", { name: "Decrease value" });
  await expect(increaseX.locator("svg")).toBeVisible();
  await expect(decreaseX.locator("svg")).toBeVisible();
  expect((await requiredBox(increaseX.locator("svg"))).width).toBeGreaterThan(6);
  expect((await requiredBox(decreaseX.locator("svg"))).width).toBeGreaterThan(6);

  await increaseX.click();
  await expect(xInput).toHaveValue("6.300");
  await decreaseX.click();
  await expect(xInput).toHaveValue("6.250");

  await expect(page.getByTestId("path-element-row-5")).toContainText("6.25, 3.75 m");
  await expect(page.getByTestId("save-status")).toContainText("Autosave pending");

  await page.getByRole("button", { name: "Remove Waypoint 6" }).click();

  await expect(page.getByTestId("path-element-row-5")).toHaveCount(0);
});

test("reorders and converts path elements from the inspector", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Move Waypoint 3 down" })).toHaveCount(0);

  const sourceBox = await requiredBox(page.getByTestId("path-element-row-2"));
  const targetBox = await requiredBox(page.getByTestId("path-element-row-3"));
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 8
  });
  await page.mouse.up();

  await expect(page.getByTestId("path-element-row-2")).toContainText(
    "3. Event Trigger"
  );
  await expect(page.getByTestId("path-element-row-3")).toContainText("4. Waypoint");

  await page.getByTestId("path-element-row-3").click();
  await page.getByLabel("Type").selectOption("translation");
  await expect(page.getByTestId("path-element-row-3")).toContainText(
    "4. Translation"
  );

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("path-element-row-3")).toContainText("4. Waypoint");
});

test("drags path elements in the inspector while preserving selection", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("path-element-row-3").click();
  await expect(page.getByTestId("selected-element-status")).toContainText(
    "Selected: EventTrigger #4"
  );

  const sourceBox = await requiredBox(page.getByTestId("path-element-row-3"));
  const targetBox = await requiredBox(page.getByTestId("path-element-row-1"));
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 8
  });
  await page.mouse.up();

  await expect(page.getByTestId("path-element-row-1")).toContainText(
    "2. Event Trigger"
  );
  await expect(page.getByTestId("path-element-row-2")).toContainText("3. Rotation");
  await expect(page.getByTestId("selected-element-status")).toContainText(
    "Selected: EventTrigger #2"
  );
});

test("rotates selected elements with the canvas handle", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("path-element-row-2").click();
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue("90");

  const canvas = page.getByTestId("path-stage-canvas");
  const center = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 5.1,
    y_meters: 3.2
  });

  await page.mouse.move(center.x, center.y - 42);
  await page.mouse.down();
  await page.mouse.move(center.x + 42, center.y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => Number(await page.getByLabel("Rotation (deg)").inputValue()))
    .toBeGreaterThan(-5);
  await expect
    .poll(async () => Number(await page.getByLabel("Rotation (deg)").inputValue()))
    .toBeLessThan(5);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue("90");
});

test("adds edits and deletes ranged constraints", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Add constraint").click();
  await page.getByRole("menuitem", { name: "End Translation Tolerance" }).click();
  await expect(page.getByRole("spinbutton", { name: "End Translation Tolerance" })).toHaveValue("0.03");
  await page.getByRole("button", { name: "Remove End Translation Tolerance" }).click();
  await expect(page.getByRole("spinbutton", { name: "End Translation Tolerance" })).toHaveCount(0);

  await page.getByText("Add constraint").click();
  await page.getByRole("menuitem", { name: "Max Velocity" }).click();

  await expect(
    page.getByTestId("constraint-card-max_velocity_meters_per_sec")
  ).toBeVisible();
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-1")
  ).toContainText("4.500 m/s");

  await expect(page.getByTestId("ranged-constraint-row-1")).toBeVisible();
  const addSegmentIcon = page.getByLabel("Add Max Velocity segment").locator("svg");
  const deleteSegmentIcon = page.getByLabel("Delete constraint 1").locator("svg");
  await expect(addSegmentIcon).toBeVisible();
  await expect(deleteSegmentIcon).toBeVisible();
  expect((await requiredBox(addSegmentIcon)).width).toBeGreaterThan(8);
  expect((await requiredBox(deleteSegmentIcon)).width).toBeGreaterThan(8);

  await page.getByLabel("Constraint 1 value").fill("2.0");
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-1")
  ).toContainText("2 m/s");

  const firstCell = page.getByTestId("constraint-cell-max_velocity_meters_per_sec-1");
  const secondCell = page.getByTestId("constraint-cell-max_velocity_meters_per_sec-2");
  const firstRange = page.getByTestId("constraint-range-max_velocity_meters_per_sec-0");
  const firstBox = await requiredBox(firstCell);
  const secondBox = await requiredBox(secondCell);
  await page.mouse.move(firstBox.x + firstBox.width - 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2, {
    steps: 6
  });
  await page.mouse.up();
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-2")
  ).toContainText("2 m/s");
  await expect(firstRange).toContainText("T1-W1");
  expect((await requiredBox(firstRange)).width).toBeGreaterThan(firstBox.width * 1.6);

  await page.getByRole("button", { name: "Split constraint 1" }).click();
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-2")
  ).toContainText("2 m/s");

  await page.getByLabel("Add Max Velocity segment").click();
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-3")
  ).toContainText("4.500 m/s");

  await page.getByTestId("constraint-cell-max_velocity_meters_per_sec-2").click();
  await page.getByRole("button", { name: "Open Max Velocity editor" }).click();
  const dialog = page.getByRole("dialog", { name: "Constraint Editor" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Add Max Velocity segment in popout", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Constraint 2 value")).toHaveValue("2");
  await page.getByRole("button", { name: "Close Constraint Editor" }).click();

  await page.getByLabel("Delete constraint 2").click();
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-2")
  ).toContainText("Open");
  await expect(page.getByTestId("save-status")).toContainText("Autosave pending");
});

test("keeps the constraint editor movable and modeless", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Add constraint").click();
  await page.getByRole("menuitem", { name: "Max Velocity" }).click();
  await page.getByRole("button", { name: "Open Max Velocity editor" }).click();

  const dialog = page.getByRole("dialog", { name: "Constraint Editor" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "false");

  const initialDialogBox = await requiredBox(dialog);
  const dragHandle = page.getByTestId("constraint-popout-drag-handle");
  const handleBox = await requiredBox(dragHandle);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 - 120, handleBox.y + handleBox.height / 2 + 70, {
    steps: 8
  });
  await page.mouse.up();

  const movedDialogBox = await requiredBox(dialog);
  expect(movedDialogBox.x).toBeLessThan(initialDialogBox.x - 40);
  expect(movedDialogBox.y).toBeGreaterThan(initialDialogBox.y + 40);

  const canvas = page.getByTestId("path-stage-canvas");
  const firstAnchor = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 1.2,
    y_meters: 1.1
  });
  await page.mouse.click(firstAnchor.x, firstAnchor.y);

  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("selected-element-status")).toContainText(
    "Selected: TranslationTarget #1"
  );

  await dialog.getByLabel("Constraint 1 value").fill("3.25");
  await expect(
    dialog.getByTestId("constraint-cell-max_velocity_meters_per_sec-1")
  ).toContainText("3.250 m/s");
});

test("edits project config with undo support", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Config" })).toBeVisible();
  await page.getByLabel("Robot Length (m)").fill("0.825");
  await page.getByLabel("Enable Protrusions").check();
  await page.getByLabel("Protrusion Side").selectOption("front");
  await page.getByLabel("Show On Event Keys").fill("intake, deploy");
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Autosave pending");

  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Robot Length (m)")).toHaveValue("0.500");
  await expect(page.getByLabel("Enable Protrusions")).not.toBeChecked();
  await page.getByRole("button", { name: "Close config" }).click();
});

test("creates saves and reloads a local project", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "New" }).click();
  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Waypoint" }).click();

  await page.getByLabel("X (m)").fill("6.50");
  await page.getByLabel("Y (m)").fill("3.90");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByTestId("save-status")).toContainText("Saved");
  const currentPath = await page.getByTestId("current-path-status").textContent();

  await page.reload();

  if (!currentPath) {
    throw new Error("Expected current path status to be populated");
  }

  await expect(page.getByTestId("current-path-status")).toHaveText(currentPath);
  await expect(page.getByTestId("path-element-row-5")).toContainText("6.50, 3.90 m");
});

test("recovers autosaved edits after reload", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("path-element-row-2").click();
  await page.getByLabel("X (m)").fill("5.75");

  await expect(page.getByTestId("save-status")).toContainText("Saved", {
    timeout: 5_000
  });

  await page.reload();

  await expect(page.getByTestId("path-element-row-2")).toContainText("5.75, 3.20 m");
});

test("opens a saved project from the project list", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  const firstPath = await currentPathName(page);

  await page.getByRole("button", { name: "New" }).click();
  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Event Trigger" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByTestId("open-project-panel")).toBeVisible();
  await page.getByText(firstPath, { exact: true }).click();

  await expect(page.getByTestId("current-path-status")).toHaveText(
    `Current Path: ${firstPath}`
  );
  await expect(page.getByTestId("path-element-row-5")).toHaveCount(0);
});

test("supports undo and redo for structural sidebar edits", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Event Trigger" }).click();
  await expect(page.getByTestId("path-element-row-4")).toContainText("5. Event Trigger");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("path-element-row-5")).toHaveCount(0);
  await expect(page.getByTestId("path-element-row-4")).toContainText("5. Translation");

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByTestId("path-element-row-4")).toContainText("5. Event Trigger");
});

test("supports common keyboard shortcuts", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Event Trigger" }).click();
  await expect(page.getByTestId("path-element-row-4")).toContainText("5. Event Trigger");

  const shortcut = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${shortcut}+Z`);
  await expect(page.getByTestId("path-element-row-4")).toContainText("5. Translation");

  await page.keyboard.press(`${shortcut}+Shift+Z`);
  await expect(page.getByTestId("path-element-row-4")).toContainText("5. Event Trigger");

  await page.keyboard.press(`${shortcut}+S`);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
});

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PointMeters {
  x_meters: number;
  y_meters: number;
}

async function requiredBox(locator: Locator): Promise<Bounds> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected locator to have a bounding box");
  }

  return box;
}

async function currentPathName(page: {
  getByTestId(testId: string): Locator;
}): Promise<string> {
  const currentPath = await page.getByTestId("current-path-status").textContent();
  if (!currentPath?.startsWith("Current Path: ")) {
    throw new Error("Expected current path status to include a project name");
  }

  return currentPath.replace("Current Path: ", "");
}

function modelToCanvasPoint(box: Bounds, point: PointMeters) {
  const fieldLengthMeters = 17.54;
  const fieldWidthMeters = 9.07;
  const fieldCoordinateOffsetMeters = 0.5;
  const padding = Math.min(24, box.width / 12, box.height / 12);
  const availableWidth = Math.max(1, box.width - padding * 2);
  const availableHeight = Math.max(1, box.height - padding * 2);
  const scale = Math.max(
    1,
    Math.min(availableWidth / fieldLengthMeters, availableHeight / fieldWidthMeters)
  );
  const viewportWidth = fieldLengthMeters * scale;
  const viewportHeight = fieldWidthMeters * scale;
  const viewportX = box.x + (box.width - viewportWidth) / 2;
  const viewportY = box.y + (box.height - viewportHeight) / 2;

  return {
    x: viewportX + (point.x_meters + fieldCoordinateOffsetMeters) * scale,
    y:
      viewportY +
      (fieldWidthMeters - point.y_meters - fieldCoordinateOffsetMeters) * scale
  };
}

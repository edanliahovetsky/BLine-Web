import { expect, test, type Locator } from "@playwright/test";

test("boots the Phase 1 shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Top menu" })).toBeVisible();
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

  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

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

  await page.getByLabel("X (m)").fill("6.25");
  await page.getByLabel("Y (m)").fill("3.75");
  await page.getByLabel("Rotation (deg)").fill("45");

  await expect(page.getByTestId("path-element-row-5")).toContainText("6.25, 3.75 m");
  await expect(page.getByTestId("save-status")).toContainText("Autosave pending");

  await page.getByRole("button", { name: "Remove Waypoint 6" }).click();

  await expect(page.getByTestId("path-element-row-5")).toHaveCount(0);
});

test("reorders and converts path elements from the inspector", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Move Waypoint 3 down" }).click();
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
  await page.getByRole("menuitem", { name: "Max Velocity" }).click();

  await expect(
    page.getByTestId("constraint-card-max_velocity_meters_per_sec")
  ).toBeVisible();
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-1")
  ).toContainText("4.500 m/s");

  await page.getByLabel("Add Max Velocity segment").click();
  await expect(page.getByTestId("ranged-constraint-row-1")).toBeVisible();

  await page.getByLabel("Constraint 1 value").fill("2.0");
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-1")
  ).toContainText("2 m/s");
  await page.getByLabel("Constraint 1 end ordinal").fill("2");
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-2")
  ).toContainText("2 m/s");

  await page.getByRole("button", { name: "Open Max Velocity editor" }).click();
  await expect(page.getByRole("dialog", { name: "Max Velocity editor" })).toBeVisible();
  await page.getByRole("button", { name: "Close Max Velocity editor" }).click();

  await page.getByLabel("Delete constraint 1").click();
  await expect(page.getByTestId("ranged-constraint-row-0")).toHaveCount(1);
  await expect(page.getByTestId("save-status")).toContainText("Autosave pending");
});

test("edits project config with undo support", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  const saveButton = dialog.getByRole("button", { name: "Save" });
  await expect(dialog).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await expect(dialog.getByLabel("Protrusion Distance (m)")).toBeDisabled();
  await expect(dialog.getByLabel("Protrusion Side")).toBeDisabled();
  await page.getByLabel("Robot Length (m)").fill("0.825");
  await expect(saveButton).toBeEnabled();
  await page.getByLabel("Enable Protrusions").check();
  await expect(dialog.getByLabel("Protrusion Distance (m)")).toBeEnabled();
  await expect(dialog.getByLabel("Protrusion Side")).toBeEnabled();
  await expect(page.getByLabel("Default Protrusion State")).toHaveValue("shown");
  await page.getByLabel("Protrusion Side").selectOption("front");
  await page.getByLabel("Show On Event Keys").fill("intake, deploy");
  await saveButton.click();
  await expect(page.getByTestId("save-status")).toContainText("Autosave pending");

  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Robot Length (m)")).toHaveValue("0.5000");
  await expect(page.getByLabel("Enable Protrusions")).not.toBeChecked();
  await page.getByRole("button", { name: "Close config" }).click();
});

test("cancels project config edits with Escape", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("Robot Width (m)").fill("0.725");
  await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Robot Width (m)")).toHaveValue("0.5000");
  await page.getByRole("button", { name: "Close config" }).click();
});

test("exposes PySide-equivalent top menu commands", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Project" }).click();
  await expect(page.getByTestId("top-menu-project")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Open Project..." })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Import Project..." })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Export Project..." })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Recent Projects" })).toBeVisible();

  await page.getByRole("button", { name: "Path" }).click();
  await expect(page.getByTestId("top-menu-path")).toBeVisible();
  await expect(page.getByText("Current: Phase 1 Canvas Draft")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Load Path" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Create New Path" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Save Path As..." })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Rename Path..." })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete Paths..." })).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByTestId("top-menu-edit")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Undo Ctrl+Z" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Redo Ctrl+Y" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Config" })).toBeVisible();
  await expect(page.getByLabel("Robot Length (m)")).toBeVisible();
  await page.getByRole("button", { name: "Close config" }).click();
});

test("keeps top dropdowns streamlined with flyout path lists", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Project" }).click();
  const projectMenu = page.getByTestId("top-menu-project");
  await expect(projectMenu).toBeVisible();
  expect((await requiredBox(projectMenu)).width).toBeLessThanOrEqual(260);

  await page.getByRole("menuitem", { name: "Recent Projects" }).click();
  const recentMenu = page.getByTestId("top-menu-project-recent");
  await expect(recentMenu).toBeVisible();
  expect((await requiredBox(recentMenu)).width).toBeLessThanOrEqual(285);

  await page.getByRole("button", { name: "Path" }).click();
  const pathMenu = page.getByTestId("top-menu-path");
  await expect(pathMenu).toBeVisible();
  expect((await requiredBox(pathMenu)).width).toBeLessThanOrEqual(270);

  await page.getByRole("menuitem", { name: "Load Path" }).click();
  const loadPathMenu = page.getByTestId("top-menu-path-load");
  await expect(loadPathMenu).toBeVisible();
  expect((await requiredBox(loadPathMenu)).width).toBeLessThanOrEqual(285);
});

test("opens settings from a narrow portrait top bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page.getByRole("dialog", { name: "Edit Config" })).toBeVisible();
  await expect(page.getByLabel("Robot Length (m)")).toBeVisible();
});

test("selects and deletes a saved path without crashing", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await page.getByRole("button", { name: "Path" }).click();
  await page.getByRole("menuitem", { name: "Delete Paths..." }).click();
  await expect(page.getByRole("dialog", { name: "Delete Paths" })).toBeVisible();

  await page.getByRole("checkbox", { name: "Phase 1 Canvas Draft" }).check();
  await expect(page.getByRole("button", { name: "Delete Selected" })).toBeEnabled();
  await page.getByRole("button", { name: "Delete Selected" }).click();

  await expect(page.getByRole("dialog", { name: "Delete Paths" })).toHaveCount(0);
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.getByRole("button", { name: "Path" }).click();
  await page.getByRole("menuitem", { name: "Load Path" }).click();
  await expect(page.getByTestId("top-menu-path-load")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Phase 1 Canvas Draft" })).toHaveCount(0);
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

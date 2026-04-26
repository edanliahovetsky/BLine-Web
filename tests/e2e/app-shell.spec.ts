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
  await expect(page.getByRole("button", { name: "Zoom in" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Fit view" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Canvas tools" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Select tool" })).toHaveCount(0);
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
  await expect(page.getByTestId("save-status")).toContainText(/Autosave pending|Saved/);
});

test("keeps the canvas bounded on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 450, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();

  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const stageBox = await requiredBox(page.getByTestId("path-stage"));

  expect(documentHeight).toBeLessThan(1_850);
  expect(stageBox.height).toBeGreaterThan(450);
  expect(stageBox.height).toBeLessThan(650);
});

test("locks document scrolling to the viewport", async ({ page }) => {
  for (const viewport of [
    { width: 1200, height: 900 },
    { width: 390, height: 900 },
    { width: 320, height: 360 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const metrics = await page.evaluate(() => {
      const documentScroller = document.scrollingElement ?? document.documentElement;
      const shell = document.querySelector(".app-shell");
      const sidebar = document.querySelector<HTMLElement>(".inspector-sidebar");

      if (!shell || !sidebar) {
        throw new Error("Expected app shell and sidebar to be present");
      }

      const shellBox = shell.getBoundingClientRect();
      sidebar.scrollTop = sidebar.scrollHeight;

      return {
        bodyOverflowY: getComputedStyle(document.body).overflowY,
        documentClientHeight: documentScroller.clientHeight,
        documentScrollHeight: documentScroller.scrollHeight,
        htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
        shellBottom: shellBox.bottom,
        shellTop: shellBox.top,
        sidebarClientHeight: sidebar.clientHeight,
        sidebarScrollHeight: sidebar.scrollHeight,
        sidebarScrollTop: sidebar.scrollTop,
        viewportHeight: window.innerHeight
      };
    });

    expect(metrics.htmlOverflowY).toBe("hidden");
    expect(metrics.bodyOverflowY).toBe("hidden");
    expect(metrics.documentScrollHeight).toBeLessThanOrEqual(
      metrics.documentClientHeight + 1
    );
    expect(metrics.shellTop).toBe(0);
    expect(metrics.shellBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);

    if (viewport.width < 980) {
      expect(metrics.sidebarScrollHeight).toBeGreaterThan(metrics.sidebarClientHeight);
      expect(metrics.sidebarScrollTop).toBeGreaterThan(0);
    }

    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, 1200);
    await page.evaluate(() => window.scrollTo(0, 1_000));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
});

test("keeps dense sidebar content inside the viewport without horizontal sidebar scroll", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 900 },
    { width: 1200, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    for (let index = 0; index < 5; index += 1) {
      await page.getByText("Add element").click();
      await page.getByRole("menuitem", { name: "Waypoint" }).click();
    }

    await page.getByText("Add constraint").click();
    await page.getByRole("menuitem", { name: "Max Rot Acceleration" }).click();

    const metrics = await page.evaluate(() => {
      const documentScroller = document.scrollingElement ?? document.documentElement;
      const sidebar = document.querySelector(".inspector-sidebar");
      const valueControl = document.querySelector(
        ".ranged-constraint-controls .sidebar-number-control"
      );
      const valueInput = document.querySelector<HTMLInputElement>(
        ".ranged-constraint-controls input[type='number']"
      );
      const actionButtons = Array.from(
        document.querySelectorAll(".ranged-constraint-controls__actions button")
      );

      if (!sidebar || !valueControl || !valueInput || actionButtons.length !== 4) {
        throw new Error("Expected dense sidebar ranged controls to be present");
      }

      const sidebarBox = sidebar.getBoundingClientRect();
      const valueBox = valueControl.getBoundingClientRect();
      const childBoxes = Array.from(sidebar.children).map((child) => {
        const rect = child.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          scrollWidth: child.scrollWidth,
          clientWidth: child.clientWidth
        };
      });
      const actionButtonBoxes = actionButtons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom
        };
      });

      return {
        viewportWidth: window.innerWidth,
        documentClientWidth: documentScroller.clientWidth,
        documentScrollWidth: documentScroller.scrollWidth,
        sidebarClientWidth: sidebar.clientWidth,
        sidebarScrollWidth: sidebar.scrollWidth,
        sidebarLeft: sidebarBox.left,
        sidebarRight: sidebarBox.right,
        childBoxes,
        valueControlBottom: valueBox.bottom,
        valueInputClientWidth: valueInput.clientWidth,
        valueInputScrollWidth: valueInput.scrollWidth,
        actionButtonBoxes
      };
    });

    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth + 1);
    expect(metrics.sidebarScrollWidth).toBeLessThanOrEqual(metrics.sidebarClientWidth + 1);
    expect(metrics.sidebarLeft).toBeGreaterThanOrEqual(-1);
    expect(metrics.sidebarRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);

    for (const childBox of metrics.childBoxes) {
      expect(childBox.left).toBeGreaterThanOrEqual(-1);
      expect(childBox.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
      expect(childBox.scrollWidth).toBeLessThanOrEqual(childBox.clientWidth + 1);
    }

    for (const actionButtonBox of metrics.actionButtonBoxes) {
      expect(Math.abs(actionButtonBox.bottom - metrics.valueControlBottom)).toBeLessThanOrEqual(1);
    }

    expect(metrics.valueInputScrollWidth).toBeLessThanOrEqual(
      metrics.valueInputClientWidth + 1
    );
  }
});

test("plays and seeks the simulation transport", async ({ page }) => {
  await page.goto("/");

  const transport = page.getByTestId("simulation-transport");
  await expect(transport).toBeVisible();
  await expect(page.getByTestId("simulation-time")).toContainText("0.00 /");
  await expect(transport.getByRole("button", { name: "Reset simulation" })).toHaveCount(0);
  await expect(transport.getByRole("button", { name: "Play simulation" })).toHaveText("");

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
  await page.getByLabel("Simulation time").evaluate((input) => {
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Expected range input");
    }
    input.value = "0.00";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.getByTestId("simulation-time")).toContainText("0.00 /");
});

test("adds edits and removes path elements from the inspector", async ({ page }) => {
  await page.goto("/");

  const addElementIcon = page.getByTestId("add-element-icon");
  await expect(addElementIcon).toBeVisible();
  expect((await requiredBox(addElementIcon)).width).toBeGreaterThanOrEqual(24);

  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Waypoint" }).click();

  await expect(page.getByTestId("path-element-row-5")).toContainText("6. Waypoint");
  await expect(page.getByTestId("selected-element-status")).toContainText(
    "Selected: Waypoint #6"
  );

  const typeSelect = page.getByLabel("Type");
  const typeRow = page.locator(".property-row").filter({ has: typeSelect });
  const typeIndicatorIcon = typeRow.locator(".sidebar-select-indicator svg");
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

test("collapses sidebar sections persistently while keeping header actions available", async ({ page }) => {
  await page.goto("/");

  const pathToggle = page.getByTestId("sidebar-section-path-elements-toggle");
  const propertiesToggle = page.getByTestId("sidebar-section-element-properties-toggle");
  const constraintsToggle = page.getByTestId("sidebar-section-constraints-toggle");
  const pathBody = page.getByTestId("sidebar-section-path-elements-body");
  const propertiesBody = page.getByTestId("sidebar-section-element-properties-body");
  const constraintsBody = page.getByTestId("sidebar-section-constraints-body");

  await expect(pathToggle).toHaveAttribute("aria-expanded", "true");
  await expect(propertiesToggle).toHaveAttribute("aria-expanded", "true");
  await expect(constraintsToggle).toHaveAttribute("aria-expanded", "true");

  await pathToggle.click();
  await expect(pathToggle).toHaveAttribute("aria-expanded", "false");
  await expect(pathBody).toBeHidden();

  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Waypoint" }).click();
  await expect(pathBody).toBeHidden();
  await pathToggle.click();
  await expect(page.getByTestId("path-element-row-5")).toContainText("6. Waypoint");

  await pathToggle.click();
  await propertiesToggle.click();
  await constraintsToggle.click();
  await expect(propertiesBody).toBeHidden();
  await expect(constraintsBody).toBeHidden();

  await page.getByText("Add constraint").click();
  await page.getByRole("menuitem", { name: "End Translation Tolerance" }).click();
  await expect(constraintsBody).toBeHidden();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await page.reload();

  await expect(pathToggle).toHaveAttribute("aria-expanded", "false");
  await expect(propertiesToggle).toHaveAttribute("aria-expanded", "false");
  await expect(constraintsToggle).toHaveAttribute("aria-expanded", "false");
  await expect(pathBody).toBeHidden();
  await expect(propertiesBody).toBeHidden();
  await expect(constraintsBody).toBeHidden();

  await constraintsToggle.click();
  await expect(page.getByRole("spinbutton", { name: "End Translation Tolerance" })).toHaveValue("0.030");
});

test("keeps selected element context visible and scrolls selected rows into view", async ({ page }) => {
  await page.goto("/");

  const context = page.getByTestId("sidebar-selection-context");
  await expect(context).toContainText("No element selected");

  await page.getByTestId("path-element-row-3").click();
  await expect(context).toContainText("4. Event Trigger");
  await expect(context).toContainText("7.83, 2.50 m");

  for (let index = 0; index < 12; index += 1) {
    await page.getByText("Add element").click();
    await page.getByRole("menuitem", { name: "Waypoint" }).click();
  }

  const pathList = page.getByRole("list", { name: "Path elements" });
  const selectedRow = page.getByTestId("path-element-row-15");
  await expect(context).toContainText("16. Waypoint");
  await expect(selectedRow).toContainText("16. Waypoint");

  const listBox = await requiredBox(pathList);
  const selectedBox = await requiredBox(selectedRow);
  expect(selectedBox.y).toBeGreaterThanOrEqual(listBox.y - 1);
  expect(selectedBox.y + selectedBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1);
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

test("keeps rotation handles hidden until an element is selected", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("selected-element-status")).toContainText(
    "Selected: none"
  );

  const canvas = page.getByTestId("path-stage-canvas");
  const center = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 5.1,
    y_meters: 3.2
  });

  await page.mouse.move(center.x, center.y - 42);
  await page.mouse.down();
  await page.mouse.move(center.x + 42, center.y, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId("selected-element-status")).toContainText(
    "Selected: none"
  );
});

test("adds edits and deletes ranged constraints", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Add constraint").click();
  await page.getByRole("menuitem", { name: "End Translation Tolerance" }).click();
  await expect(page.getByRole("spinbutton", { name: "End Translation Tolerance" })).toHaveValue("0.030");
  await page.getByRole("button", { name: "Remove End Translation Tolerance" }).click();
  await expect(page.getByRole("spinbutton", { name: "End Translation Tolerance" })).toHaveCount(0);

  const addConstraintIcon = page.getByTestId("add-constraint-icon");
  await expect(addConstraintIcon).toBeVisible();
  expect((await requiredBox(addConstraintIcon)).width).toBeGreaterThanOrEqual(24);

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
  await expect(page.getByLabel("Add Max Velocity segment")).toHaveCSS("color", "rgb(88, 166, 255)");
  await expect(page.getByLabel("Delete constraint 1")).toHaveCSS("color", "rgb(255, 77, 77)");
  expect((await requiredBox(addSegmentIcon)).width).toBeGreaterThan(8);
  expect((await requiredBox(deleteSegmentIcon)).width).toBeGreaterThan(8);

  const firstConstraintRow = page.getByTestId("ranged-constraint-row-1");
  const firstConstraintInput = page.getByLabel("Constraint 1 value");
  const firstConstraintStepper = firstConstraintRow.locator(".sidebar-number-control");
  await expect(firstConstraintStepper).toBeVisible();
  expect((await requiredBox(firstConstraintStepper)).width).toBeLessThan(120);
  const increaseConstraint = firstConstraintRow.getByRole("button", { name: "Increase value" });
  const decreaseConstraint = firstConstraintRow.getByRole("button", { name: "Decrease value" });
  await expect(increaseConstraint.locator("svg")).toBeVisible();
  await expect(decreaseConstraint.locator("svg")).toBeVisible();
  await increaseConstraint.click();
  await expect(firstConstraintInput).toHaveValue("4.600");
  await decreaseConstraint.click();
  await expect(firstConstraintInput).toHaveValue("4.500");

  await firstConstraintInput.fill("2.0");
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
  const dialogConstraintRow = dialog.getByTestId("ranged-constraint-row-2");
  const dialogConstraintInput = dialog.getByLabel("Constraint 2 value");
  const dialogConstraintStepper = dialogConstraintRow.locator(".sidebar-number-control");
  await expect(dialogConstraintInput).toHaveValue("2");
  await expect(dialogConstraintStepper).toBeVisible();
  expect((await requiredBox(dialogConstraintStepper)).width).toBeLessThan(120);
  await expect(dialogConstraintRow.getByRole("button", { name: "Increase value" }).locator("svg")).toBeVisible();
  await expect(dialogConstraintRow.getByRole("button", { name: "Decrease value" }).locator("svg")).toBeVisible();
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
  const closeButton = page.getByRole("button", { name: "Close Constraint Editor" });
  await expect(closeButton.locator("svg")).toBeVisible();
  const closeButtonBox = await requiredBox(closeButton);
  expect(Math.abs(closeButtonBox.width - closeButtonBox.height)).toBeLessThanOrEqual(1);

  const initialDialogBox = await requiredBox(dialog);
  const dragHandle = page.getByTestId("constraint-popout-drag-handle");
  await expect(dragHandle).toBeVisible();
  const edgeDragStart = {
    x: initialDialogBox.x + 6,
    y: initialDialogBox.y + 6
  };
  await page.mouse.move(edgeDragStart.x, edgeDragStart.y);
  await page.mouse.down();
  await page.mouse.move(edgeDragStart.x - 120, edgeDragStart.y + 70, {
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
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  const saveButton = dialog.getByRole("button", { name: "Save" });
  await expect(dialog).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await expect(dialog.getByLabel("Protrusion Distance (m)")).toBeDisabled();
  await expect(
    dialog.getByTitle("Increase Protrusion Distance (m)")
  ).toBeDisabled();
  await expect(dialog.getByLabel("Protrusion Side")).toBeDisabled();
  await expect(
    dialog.getByTitle("Increase Robot Length (m)")
  ).toBeVisible();
  await page.getByLabel("Robot Length (m)").fill("0.825");
  await expect(saveButton).toBeEnabled();
  await page.getByLabel("Enable Protrusions").check();
  await expect(dialog.getByLabel("Protrusion Distance (m)")).toBeEnabled();
  await expect(
    dialog.getByTitle("Increase Protrusion Distance (m)")
  ).toBeEnabled();
  await expect(dialog.getByLabel("Protrusion Side")).toBeEnabled();
  await expect(page.getByLabel("Default Protrusion State")).toHaveValue("shown");
  await page.getByLabel("Protrusion Side").selectOption("front");
  await page.getByLabel("Show On Event Keys").fill("intake, deploy");
  await saveButton.click();
  await expect(page.getByTestId("save-status")).toContainText("Autosave pending");

  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Robot Length (m)")).toHaveValue("0.500");
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
  await expect(page.getByLabel("Robot Width (m)")).toHaveValue("0.500");
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

test("keeps top dropdowns streamlined with right-side path flyouts", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Project" }).click();
  const projectMenu = page.getByTestId("top-menu-project");
  await expect(projectMenu).toBeVisible();
  expect((await requiredBox(projectMenu)).width).toBeLessThanOrEqual(260);

  await page.getByRole("menuitem", { name: "Recent Projects" }).click();
  const recentMenu = page.getByTestId("top-menu-project-recent");
  await expect(recentMenu).toBeVisible();
  const projectMenuBox = await requiredBox(projectMenu);
  const recentMenuBox = await requiredBox(recentMenu);
  expect(recentMenuBox.width).toBeLessThanOrEqual(285);
  expect(recentMenuBox.x).toBeGreaterThanOrEqual(projectMenuBox.x + projectMenuBox.width);

  await page.getByRole("button", { name: "Path" }).click();
  const pathMenu = page.getByTestId("top-menu-path");
  await expect(pathMenu).toBeVisible();
  expect((await requiredBox(pathMenu)).width).toBeLessThanOrEqual(270);

  await page.getByRole("menuitem", { name: "Load Path" }).click();
  const loadPathMenu = page.getByTestId("top-menu-path-load");
  await expect(loadPathMenu).toBeVisible();
  const pathMenuBox = await requiredBox(pathMenu);
  const loadPathMenuBox = await requiredBox(loadPathMenu);
  expect(loadPathMenuBox.width).toBeLessThanOrEqual(285);
  expect(loadPathMenuBox.x).toBeGreaterThanOrEqual(pathMenuBox.x + pathMenuBox.width);
});

test("opens settings from a narrow portrait top bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page.getByRole("dialog", { name: "Edit Config" })).toBeVisible();
  await expect(page.getByLabel("Robot Length (m)")).toBeVisible();
});

test("keeps the compact top menu scrollable instead of wrapping", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto("/");

  const topMenu = page.getByRole("navigation", { name: "Top menu" });
  const metrics = await topMenu.evaluate((element) => {
    const buttonRows = Array.from(element.querySelectorAll("button")).map((button) =>
      Math.round(button.getBoundingClientRect().top)
    );

    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      rowCount: new Set(buttonRows).size,
      overflowX: getComputedStyle(element).overflowX
    };
  });

  expect(metrics.overflowX).toBe("auto");
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.rowCount).toBe(1);

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Config" })).toBeVisible();
});

test("bounds compact dropdown panels to the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto("/");

  await page.getByRole("button", { name: "Path" }).click();

  const panelMetrics = await page.getByTestId("top-menu-path").evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return {
      bottom: rect.bottom,
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      viewportHeight: window.innerHeight
    };
  });

  expect(panelMetrics.overflowY).toBe("auto");
  expect(panelMetrics.bottom).toBeLessThanOrEqual(panelMetrics.viewportHeight);
  expect(panelMetrics.scrollHeight).toBeGreaterThan(panelMetrics.clientHeight);
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

import { expect, test } from "@playwright/test";
import {
  canvasNodePosition,
  canvasSceneMetrics,
  expectPathElementTypes,
  modelToCanvasPoint,
  pointDistance,
  simulationProgress,
} from "./support/app-shell-canvas";
import { runEditMenuAction } from "./support/app-shell-commands";
import { openConstraintsTab } from "./support/app-shell-constraints";
import {
  createNewProject,
  installWorkspaceWriteSpy,
  resetWorkspaceWriteSpy,
  workspaceWriteCount,
} from "./support/app-shell-persistence";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";

test.describe("Pixi canvas rendering", () => {
  test.use({
    deviceScaleFactor: 2,
    viewport: { width: 1180, height: 860 },
  });

  test("keeps the WebGL overlay sharp while panning @webkit-canvas", async ({
    page,
  }) => {
    await gotoSampleEditor(page);

    const canvas = page.getByTestId("path-stage-canvas");
    await expect(canvas).toBeVisible();
    await expect
      .poll(() => canvasSceneMetrics(page))
      .toMatchObject({
        count: 1,
        ratios: [2],
      });
    await expect
      .poll(async () => (await canvasSceneMetrics(page)).renderer.toLowerCase())
      .toContain("webgl");

    let box = await requiredBox(canvas);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let zoomStep = 0; zoomStep < 12; zoomStep += 1) {
      await page.mouse.wheel(0, -400);
    }

    await expect
      .poll(() => canvasSceneMetrics(page))
      .toMatchObject({
        count: 1,
        ratios: [2],
      });

    const nodeBeforePan = await canvasNodePosition(page, "path-element-node-0");
    box = await requiredBox(canvas);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 96,
      box.y + box.height / 2 + 72,
      {
        steps: 4,
      },
    );
    await page.mouse.up();

    await expect
      .poll(() => canvasSceneMetrics(page))
      .toMatchObject({
        count: 1,
        ratios: [2],
      });
    const nodeAfterPan = await canvasNodePosition(page, "path-element-node-0");
    expect(pointDistance(nodeBeforePan, nodeAfterPan)).toBeGreaterThan(8);
  });
});

test("selects and drags a canvas anchor", async ({ page }) => {
  await gotoSampleEditor(page);

  const stage = page.getByTestId("path-stage");
  await expect(stage).toBeVisible();

  const canvas = page.getByTestId("path-stage-canvas");
  const firstAnchor = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 5.7,
    y_meters: 2.5,
  });

  await page.mouse.click(firstAnchor.x, firstAnchor.y);
  const selectedRow = page.getByTestId("path-element-row-0");
  await expect(selectedRow).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("X (m)")).toHaveValue("5.7");
  await expect(page.getByLabel("Y (m)")).toHaveValue("2.5");

  await page.mouse.move(firstAnchor.x, firstAnchor.y);
  await page.mouse.down();
  await page.mouse.move(firstAnchor.x + 80, firstAnchor.y - 48, { steps: 8 });
  await page.mouse.up();

  await expect(selectedRow).not.toContainText("5.70, 2.50 m");
  await expect(page.getByTestId("save-status")).toContainText(
    /Autosave pending|Saved/,
  );
});

test("keeps handoff radius tuning in the Constraints tab", async ({ page }) => {
  await gotoSampleEditor(page);

  await page.getByTestId("path-element-row-1").click();
  await expect(page.getByLabel("Handoff Radius (m)")).toHaveCount(0);

  await openConstraintsTab(page);
  const chip = page.getByTestId("handoff-radius-chip-1");
  await chip.click();
  const radiusInput = page.getByLabel("Handoff radius 2 value");
  const mode = page.getByRole("group", { name: "Handoff radius mode" });

  await radiusInput.fill("0.5");
  await radiusInput.press("Enter");
  await expect(chip).toHaveClass(/handoff-radius-chip--manual/);

  await mode.getByRole("button", { name: "Auto" }).click();
  await expect(chip).toHaveClass(/handoff-radius-chip--auto/);
  await expect(radiusInput).toBeDisabled();

  const generate = page.getByRole("button", { name: "Generate constraints" });
  await expect(generate).toBeEnabled();
  await generate.click();

  await expect(chip).toHaveClass(/handoff-radius-chip--auto/);
  await expect(radiusInput).not.toHaveValue("0.5");
});

test("keeps the rotation handle attached while dragging selected elements", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await page.getByTestId("path-element-row-2").click();

  const canvas = page.getByTestId("path-stage-canvas");
  const center = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 8.3,
    y_meters: 4.0,
  });
  const selectedNodeBefore = await canvasNodePosition(
    page,
    "path-element-node-2",
  );
  const handleRootBefore = await canvasNodePosition(
    page,
    "rotation-handle-root",
  );
  expect(pointDistance(selectedNodeBefore, handleRootBefore)).toBeLessThan(0.5);

  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 72, center.y - 36);

  const selectedNodeDuring = await canvasNodePosition(
    page,
    "path-element-node-2",
  );
  const handleRootDuring = await canvasNodePosition(
    page,
    "rotation-handle-root",
  );
  expect(pointDistance(selectedNodeDuring, handleRootDuring)).toBeLessThan(0.5);

  await page.mouse.up();
});

test("defers autosave while a dirty canvas drag is active", async ({
  page,
}) => {
  await installWorkspaceWriteSpy(page);
  await gotoSampleEditor(page);

  await expect(page.getByTestId("save-status")).toContainText("Saved");

  const canvas = page.getByTestId("path-stage-canvas");
  const firstAnchor = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 5.7,
    y_meters: 2.5,
  });

  await page.mouse.click(firstAnchor.x, firstAnchor.y);
  await expect
    .poll(async () => Number(await page.getByLabel("X (m)").inputValue()))
    .toBeCloseTo(5.7, 2);

  await page.getByLabel("X (m)").fill("5.750");

  const movedAnchor = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 5.75,
    y_meters: 2.5,
  });
  await page.mouse.move(movedAnchor.x, movedAnchor.y);
  await page.mouse.down();
  await resetWorkspaceWriteSpy(page);
  await page.mouse.move(movedAnchor.x + 60, movedAnchor.y - 24, { steps: 4 });
  await page.waitForTimeout(550);

  expect(await workspaceWriteCount(page)).toBe(0);

  await page.mouse.up();
  await expect(page.getByTestId("save-status")).toContainText("Saved", {
    timeout: 3_000,
  });
  expect(await workspaceWriteCount(page)).toBeGreaterThan(0);
});

test("plays and seeks the simulation transport", async ({ page }) => {
  await gotoSampleEditor(page);

  const transport = page.getByTestId("simulation-transport");
  await expect(transport).toBeVisible();
  await expect(page.getByTestId("simulation-time")).toContainText("0.00 /");
  await expect(
    transport.getByRole("button", { name: "Reset simulation" }),
  ).toBeDisabled();
  await expect(
    transport.getByRole("button", { name: "Fast forward simulation" }),
  ).toBeEnabled();
  await expect(
    transport.getByRole("button", { name: "Play simulation" }),
  ).toHaveText("");
  await expect(
    transport.getByRole("button", { name: "Play simulation" }),
  ).toHaveAttribute("aria-keyshortcuts", "Space K");
  await expect(
    transport.getByRole("button", { name: "Reset simulation" }),
  ).toHaveAttribute("aria-keyshortcuts", "J Home");
  await expect(
    transport.getByRole("button", { name: "Fast forward simulation" }),
  ).toHaveAttribute("aria-keyshortcuts", "L End");

  await page.getByTestId("path-stage").focus();
  await page.keyboard.press("Space");
  await expect(
    transport.getByRole("button", { name: "Pause simulation" }),
  ).toBeVisible();
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

  await page.getByTestId("path-stage").focus();
  await page.keyboard.press("l");
  await expect
    .poll(() => simulationProgress(page))
    .toMatchObject({
      atEnd: true,
    });

  await page.keyboard.press("j");
  await expect(page.getByTestId("simulation-time")).toContainText("0.00 /");

  await page.keyboard.press("End");
  await expect
    .poll(() => simulationProgress(page))
    .toMatchObject({
      atEnd: true,
    });

  await page.keyboard.press("Home");
  await expect(page.getByTestId("simulation-time")).toContainText("0.00 /");

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

test("creates every path element type from the inspector menu", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await createNewProject(page);

  const addElement = page.getByRole("button", { name: "Add element" });
  await addElement.click();
  let menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Waypoint",
    "Translation",
  ]);
  await menu.getByRole("menuitem", { name: "Translation" }).click();
  await expect(page.getByLabel("X (m)")).toHaveValue("9.52");
  await expect(page.getByLabel("Y (m)")).toHaveValue("4.89");

  await addElement.click();
  await page.getByRole("menuitem", { name: "Waypoint" }).click();
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue("0");
  await expect(page.getByLabel("X (m)")).toHaveValue("10.27");
  await expect(page.getByLabel("Y (m)")).toHaveValue("5.24");

  await addElement.click();
  menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Waypoint",
    "Translation",
    "Rotation",
    "Event Trigger",
  ]);
  await menu.getByRole("menuitem", { name: "Rotation" }).click();
  await expect(page.getByLabel("Rotation Pos (0-1)")).toHaveValue("0.5");

  await addElement.click();
  await page.getByRole("menuitem", { name: "Event Trigger" }).click();
  await expectPathElementTypes(page, [
    "Translation",
    "Rotation",
    "Event Trigger",
    "Waypoint",
  ]);
  await expect(page.getByLabel("Event Pos (0-1)")).toHaveValue("0.5");
  await expect(page.getByLabel("Lib Key")).toHaveValue("event");
});

test("places every path element type with the canvas tools", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await createNewProject(page);

  const canvas = page.getByTestId("path-stage-canvas");
  const canvasBox = await requiredBox(canvas);
  const tools = page.getByRole("complementary", { name: "Canvas tools" });
  const waypointTool = tools.getByRole("button", {
    name: "Waypoint tool",
    exact: true,
  });
  const translationTool = tools.getByRole("button", {
    name: "Translation tool",
    exact: true,
  });
  const rotationTool = tools.getByRole("button", {
    name: "Rotation tool",
    exact: true,
  });
  const eventTool = tools.getByRole("button", {
    name: "Event tool",
    exact: true,
  });
  await expect(rotationTool).toBeDisabled();
  await expect(eventTool).toBeDisabled();

  const waypointPoint = modelToCanvasPoint(canvasBox, {
    x_meters: 3,
    y_meters: 3,
  });
  await waypointTool.click();
  await page.mouse.click(waypointPoint.x, waypointPoint.y);
  await expect(page.getByLabel("X (m)")).toHaveValue("3");
  await expect(page.getByLabel("Y (m)")).toHaveValue("3");

  const translationPoint = modelToCanvasPoint(canvasBox, {
    x_meters: 9,
    y_meters: 3,
  });
  await translationTool.click();
  await page.mouse.click(translationPoint.x, translationPoint.y);
  await expect(page.getByLabel("X (m)")).toHaveValue("9");
  await expect(page.getByLabel("Y (m)")).toHaveValue("3");
  await expect(rotationTool).toBeEnabled();
  await expect(eventTool).toBeEnabled();

  const rotationPoint = modelToCanvasPoint(canvasBox, {
    x_meters: 6,
    y_meters: 3,
  });
  await rotationTool.click();
  await page.mouse.click(rotationPoint.x, rotationPoint.y);
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue("0");
  await expect(page.getByLabel("Rotation Pos (0-1)")).toHaveValue("0.5");

  const eventPoint = modelToCanvasPoint(canvasBox, {
    x_meters: 7.5,
    y_meters: 3,
  });
  await eventTool.click();
  await page.mouse.click(eventPoint.x, eventPoint.y);
  await expectPathElementTypes(page, [
    "Waypoint",
    "Rotation",
    "Event Trigger",
    "Translation",
  ]);
  await expect(page.getByLabel("Event Pos (0-1)")).toHaveValue("0.75");
  await expect(page.getByLabel("Lib Key")).toHaveValue("event");
});

test("draws curves at the requested insertion point and cancels safely", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  const canvas = page.getByTestId("path-stage-canvas");
  const canvasBox = await requiredBox(canvas);
  const addCurve = page.getByRole("button", { name: "Add curve" });
  const curveTool = page.getByRole("button", { name: "Curve tool" });
  const selectTool = page.getByRole("button", { name: "Select tool" });
  const cancelledStart = modelToCanvasPoint(canvasBox, {
    x_meters: 6.1,
    y_meters: 3.3,
  });

  await page.getByTestId("path-element-row-0").click();
  await addCurve.click();
  await expect(addCurve).toBeDisabled();
  await page.mouse.move(cancelledStart.x, cancelledStart.y);
  await page.mouse.down();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator('[data-testid^="path-element-row-"]')).toHaveCount(
    6,
  );
  await expect(selectTool).toHaveAttribute("aria-pressed", "true");

  const insertedEnd = modelToCanvasPoint(canvasBox, {
    x_meters: 6.6,
    y_meters: 3.6,
  });
  await addCurve.click();
  await page.mouse.move(cancelledStart.x, cancelledStart.y);
  await page.mouse.down();
  await page.mouse.move(insertedEnd.x, insertedEnd.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-testid^="path-element-row-"]')).toHaveCount(
    8,
  );
  await expect(page.getByTestId("path-element-row-1")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("X (m)")).toHaveValue("6.1");
  await expect(page.getByLabel("Y (m)")).toHaveValue("3.3");

  const appendedStart = modelToCanvasPoint(canvasBox, {
    x_meters: 12,
    y_meters: 4,
  });
  const appendedEnd = modelToCanvasPoint(canvasBox, {
    x_meters: 14,
    y_meters: 6,
  });
  await curveTool.click();
  await page.mouse.move(appendedStart.x, appendedStart.y);
  await page.mouse.down();
  await page.mouse.move(appendedEnd.x, appendedEnd.y, { steps: 8 });
  await page.mouse.up();
  await expectPathElementTypes(page, [
    "Waypoint",
    "Translation",
    "Translation",
    "Translation",
    "Rotation",
    "Translation",
    "Event Trigger",
    "Waypoint",
    "Translation",
    "Translation",
  ]);
  await expect(page.getByTestId("path-element-row-8")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("X (m)")).toHaveValue("12");
  await expect(page.getByLabel("Y (m)")).toHaveValue("4");
  await expect(selectTool).toHaveAttribute("aria-pressed", "true");
});

test("adds edits and removes path elements from the inspector", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  const addElementIcon = page.getByTestId("add-element-icon");
  await expect(addElementIcon).toBeVisible();
  expect((await requiredBox(addElementIcon)).width).toBeGreaterThanOrEqual(24);

  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Waypoint" }).click();

  await expect(page.getByTestId("path-element-row-6")).toContainText(
    "7. Waypoint",
  );
  await expect(page.getByTestId("path-element-row-6")).toHaveAttribute(
    "aria-pressed",
    "true",
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
  expect((await requiredBox(increaseX.locator("svg"))).width).toBeGreaterThan(
    6,
  );
  expect((await requiredBox(decreaseX.locator("svg"))).width).toBeGreaterThan(
    6,
  );

  await increaseX.click();
  await expect(xInput).toHaveValue("6.3");
  await decreaseX.click();
  await expect(xInput).toHaveValue("6.25");

  await expect(page.getByTestId("path-element-row-6")).toContainText(
    "6.25, 3.75 m",
  );
  await openConstraintsTab(page);
  await expect(page.getByTestId("handoff-radius-chip-6")).toHaveClass(
    /handoff-radius-chip--auto/,
  );
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await expect(page.getByTestId("save-status")).toContainText(
    /Autosave pending|Saved/,
  );

  await page.getByRole("button", { name: "Remove Waypoint 7" }).click();

  await expect(page.getByTestId("path-element-row-6")).toHaveCount(0);
});

test("persists the inspector tab while keeping header actions available", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.getByTestId("path-element-row-0").click();

  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Waypoint" }).click();
  await expect(page.getByTestId("path-element-row-1")).toContainText(
    "2. Waypoint",
  );

  await openConstraintsTab(page);
  await page.getByRole("button", { name: "Add constraint" }).click();
  await expect(
    page.locator(".add-constraint-menu [role='menuitem']"),
  ).toHaveText([
    "Max Velocity (+)",
    "Max Acceleration",
    "Min Velocity",
    "Max Rot Velocity",
    "Max Rot Acceleration",
    "Min Rot Velocity",
    "End Translation Tolerance",
    "End Rotation Tolerance",
  ]);
  await page
    .getByTestId("path-stage-canvas")
    .click({ position: { x: 8, y: 8 } });
  await expect(page.locator(".add-constraint-menu")).not.toHaveAttribute(
    "open",
    "",
  );
  await expect(
    page.locator(".add-constraint-menu .add-element-menu__panel"),
  ).toBeHidden();

  await page.getByRole("button", { name: "Add constraint" }).click();
  await page
    .getByRole("menuitem", { name: "End Translation Tolerance" })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  await page.reload();
  await expect(page.getByRole("tab", { name: /Constraints/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("spinbutton", { name: "End Translation Tolerance" }),
  ).toHaveValue("0.03");
});

test("scrolls selected rows into view", async ({ page }) => {
  await gotoSampleEditor(page);

  await expect(page.getByTestId("sidebar-selection-context")).toHaveCount(0);

  await page.getByTestId("path-element-row-4").click();
  await expect(page.getByTestId("path-element-row-4")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  for (let index = 0; index < 12; index += 1) {
    await page.getByText("Add element").click();
    await page.getByRole("menuitem", { name: "Waypoint" }).click();
  }

  const pathList = page.getByRole("list", { name: "Path elements" });
  const selectedRow = page.getByTestId("path-element-row-16");
  await expect(selectedRow).toContainText("17. Waypoint");
  await expect(selectedRow).toHaveAttribute("aria-pressed", "true");

  const listBox = await requiredBox(pathList);
  const selectedBox = await requiredBox(selectedRow);
  expect(selectedBox.y).toBeGreaterThanOrEqual(listBox.y - 1);
  expect(selectedBox.y + selectedBox.height).toBeLessThanOrEqual(
    listBox.y + listBox.height + 1,
  );
});

test("keeps outer sidebar scroll while selected canvas elements scroll within the path list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 720 });
  await gotoSampleEditor(page);

  for (let index = 0; index < 12; index += 1) {
    await page.getByText("Add element").click();
    await page.getByRole("menuitem", { name: "Waypoint" }).click();
  }

  const scrollBefore = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".inspector-sidebar");
    const pathList = document.querySelector<HTMLElement>(".path-element-list");

    if (!sidebar || !pathList) {
      throw new Error("Expected sidebar and path element list to be present");
    }

    const sidebarMaxScrollTop = sidebar.scrollHeight - sidebar.clientHeight;
    sidebar.scrollTop = Math.max(1, Math.min(320, sidebarMaxScrollTop - 80));
    pathList.scrollTop = Math.max(
      1,
      pathList.scrollHeight - pathList.clientHeight,
    );

    return {
      pathListScrollTop: pathList.scrollTop,
      sidebarScrollTop: sidebar.scrollTop,
    };
  });

  expect(scrollBefore.pathListScrollTop).toBeGreaterThan(0);
  expect(scrollBefore.sidebarScrollTop).toBeGreaterThanOrEqual(0);

  const canvas = page.getByTestId("path-stage-canvas");
  const firstAnchor = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 5.7,
    y_meters: 2.5,
  });
  await page.mouse.click(firstAnchor.x, firstAnchor.y);
  await expect(page.getByTestId("path-element-row-0")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await expect
    .poll(async () =>
      page.evaluate((expectedSidebarScrollTop) => {
        const sidebar =
          document.querySelector<HTMLElement>(".inspector-sidebar");
        const pathList =
          document.querySelector<HTMLElement>(".path-element-list");
        const selectedRow = document.querySelector<HTMLElement>(
          "[data-testid='path-element-row-0']",
        );

        if (!sidebar || !pathList || !selectedRow) {
          throw new Error(
            "Expected sidebar, path element list, and selected row to be present",
          );
        }

        const listBox = pathList.getBoundingClientRect();
        const selectedBox = selectedRow.getBoundingClientRect();

        return {
          selectedRowVisibleInList:
            selectedBox.top >= listBox.top - 1 &&
            selectedBox.bottom <= listBox.bottom + 1,
          sidebarScrollDelta: Math.abs(
            sidebar.scrollTop - expectedSidebarScrollTop,
          ),
        };
      }, scrollBefore.sidebarScrollTop),
    )
    .toMatchObject({
      selectedRowVisibleInList: true,
      sidebarScrollDelta: 0,
    });

  const scrollAfter = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".inspector-sidebar");
    const pathList = document.querySelector<HTMLElement>(".path-element-list");

    if (!sidebar || !pathList) {
      throw new Error("Expected sidebar and path element list to be present");
    }

    return {
      pathListScrollTop: pathList.scrollTop,
      sidebarScrollTop: sidebar.scrollTop,
    };
  });

  expect(scrollAfter.pathListScrollTop).toBeLessThan(
    scrollBefore.pathListScrollTop,
  );
  expect(scrollAfter.sidebarScrollTop).toBe(scrollBefore.sidebarScrollTop);
});

test("reorders and converts path elements from the inspector", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await expect(
    page.getByRole("button", { name: "Move Waypoint 3 down" }),
  ).toHaveCount(0);

  const sourceBox = await requiredBox(page.getByTestId("path-element-row-2"));
  const targetBox = await requiredBox(page.getByTestId("path-element-row-3"));
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    {
      steps: 8,
    },
  );
  await page.mouse.up();

  await expect(page.getByTestId("path-element-row-2")).toContainText(
    "3. Translation",
  );
  await expect(page.getByTestId("path-element-row-3")).toContainText(
    "4. Rotation",
  );

  await page.getByTestId("path-element-row-3").click();
  await page.getByLabel("Type").selectOption("translation");
  await expect(page.getByTestId("path-element-row-3")).toContainText(
    "4. Translation",
  );

  await runEditMenuAction(page, "Undo");
  await expect(page.getByTestId("path-element-row-3")).toContainText(
    "4. Rotation",
  );
});

test("drags path elements in the inspector while preserving selection", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await page.getByTestId("path-element-row-4").click();
  await expect(page.getByTestId("path-element-row-4")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const sourceBox = await requiredBox(page.getByTestId("path-element-row-4"));
  const targetBox = await requiredBox(page.getByTestId("path-element-row-1"));
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    {
      steps: 8,
    },
  );
  await page.mouse.up();

  await expect(page.getByTestId("path-element-row-1")).toContainText(
    "2. Event Trigger",
  );
  await expect(page.getByTestId("path-element-row-2")).toContainText(
    "3. Translation",
  );
  await expect(page.getByTestId("path-element-row-1")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("rotates selected elements with the canvas handle", async ({ page }) => {
  await gotoSampleEditor(page);

  await page.getByTestId("path-element-row-2").click();
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue("45");

  const canvas = page.getByTestId("path-stage-canvas");
  const center = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 8.3,
    y_meters: 4.0,
  });

  await page.mouse.move(center.x + 30, center.y - 30);
  await page.mouse.down();
  await page.mouse.move(center.x + 42, center.y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () =>
      Number(await page.getByLabel("Rotation (deg)").inputValue()),
    )
    .toBeGreaterThan(-5);
  await expect
    .poll(async () =>
      Number(await page.getByLabel("Rotation (deg)").inputValue()),
    )
    .toBeLessThan(5);
  await runEditMenuAction(page, "Undo");
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue("45");
});

test("keeps rotation handles hidden until an element is selected", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await expect(page.getByTestId("sidebar-selection-context")).toHaveCount(0);

  const canvas = page.getByTestId("path-stage-canvas");
  const center = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 8.3,
    y_meters: 4.0,
  });

  await page.mouse.move(center.x, center.y - 42);
  await page.mouse.down();
  await page.mouse.move(center.x + 42, center.y, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByTestId("sidebar-selection-context")).toHaveCount(0);
});

test("marks the start and end of the path in the element list", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  const rows = page.locator('[data-testid^="path-element-row-"]');
  const count = await rows.count();
  await expect(rows.first()).toContainText("Start");
  await expect(rows.nth(count - 1)).toContainText("End");

  // Only the two endpoints are marked; everything between is intermediate.
  await expect(page.locator(".path-element-row__role")).toHaveCount(2);
});

test("highlights, dismisses, and resolves path health issues", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await expect(
    page.getByRole("button", { name: /^Path health/ }),
  ).toHaveCount(0);

  // An event trigger with no command key is a warning-level issue.
  await page.getByText("Add element").click();
  await page.getByRole("menuitem", { name: "Event Trigger" }).click();
  await page.getByLabel("Lib Key").fill("");

  const health = page.getByRole("button", { name: "Path health: 1 issue" });
  await expect(health).toHaveClass(/status-bar__diagnostics--warning/);
  await health.click();
  await expect(page.getByRole("dialog", { name: "Path health" })).toContainText(
    "needs a command key",
  );
  await page.locator(".status-bar__hint").click();
  await expect(page.getByRole("dialog", { name: "Path health" })).toHaveCount(
    0,
  );
  await expect(health).toHaveAttribute("aria-expanded", "false");

  await health.click();
  const dialog = page.getByRole("dialog", { name: "Path health" });
  await dialog
    .getByRole("button")
    .filter({ hasText: "needs a command key" })
    .click();
  await expect(page.getByLabel("Lib Key")).toHaveValue("event");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Path health/ }),
  ).toHaveCount(0);
});

test("adds missing waypoints from path health as one undoable fix", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await createNewProject(page);

  const rows = page.locator('[data-testid^="path-element-row-"]');
  await expect(rows).toHaveCount(0);

  const health = page.getByRole("button", { name: "Path health: 1 issue" });
  await health.click();
  const dialog = page.getByRole("dialog", { name: "Path health" });
  await expect(dialog).toContainText("Add two waypoints");
  await dialog
    .getByRole("button")
    .filter({ hasText: "Add two waypoints" })
    .click();

  await expect(rows).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /^Path health/ }),
  ).toHaveCount(0);

  await runEditMenuAction(page, "Undo");
  await expect(rows).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Path health: 1 issue" }),
  ).toBeVisible();
});

test("keeps the element properties card tight to its content", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  // A rotation element has few properties, so a card that stretched to fill
  // the panel would leave a large empty band inside its own border.
  await page.getByTestId("path-element-row-2").click();
  await expect(page.getByLabel("Rotation Pos (0-1)")).toBeVisible();

  const section = page.locator(".property-editor-section");
  const body = section.locator(".sidebar-section__body");
  const sectionBox = await requiredBox(section);
  const bodyBox = await requiredBox(body);

  // Nothing but the card's own border sits below the last property.
  expect(
    sectionBox.y + sectionBox.height - (bodyBox.y + bodyBox.height),
  ).toBeLessThanOrEqual(2);
});

test("gives the element list the panel height the properties leave over", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  const panel = page.locator(".inspector-sidebar__panel--elements");
  const list = page.locator(".path-elements-section");
  const rows = page.locator(".path-element-list");
  const properties = page.locator(".property-editor-section");

  await page.getByTestId("path-element-row-1").click();
  await expect(page.getByLabel("X (m)")).toBeVisible();

  // The sample's elements all fit, so the list must not scroll just because a
  // fixed row cap cut it short.
  const scrolls = async () =>
    await rows.evaluate((node) => node.scrollHeight > node.clientHeight + 1);
  expect(await scrolls()).toBe(false);

  // Duplicating past the panel height moves the overflow inside the list
  // rather than pushing the properties card out of the panel.
  const shortcut = process.platform === "darwin" ? "Meta" : "Control";
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press(`${shortcut}+D`);
  }
  await expect(page.getByTestId("path-element-row-21")).toHaveCount(1);
  expect(await scrolls()).toBe(true);

  const panelBox = await requiredBox(panel);
  const listBox = await requiredBox(list);
  const propertiesBox = await requiredBox(properties);
  expect(propertiesBox.y + propertiesBox.height).toBeLessThanOrEqual(
    panelBox.y + panelBox.height + 1,
  );

  // The list keeps the lion's share: the old fixed 38% row wasted the space a
  // short properties card gave back.
  expect(listBox.height).toBeGreaterThan(panelBox.height * 0.5);
});

test("keeps velocity status and actions on one centered row", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  const card = page.getByTestId("constraint-card-max_velocity_meters_per_sec");
  const chip = card.getByRole("status");
  const generate = card.getByRole("button", {
    name: "Generate constraints",
  });
  const clear = card.getByRole("button", {
    name: "Clear generated constraints",
  });

  const expectCenteredHeaderRow = async () => {
    const cardBox = await requiredBox(card);
    const chipBox = await requiredBox(chip);
    const generateBox = await requiredBox(generate);
    const clearBox = await requiredBox(clear);
    const cardCenter = cardBox.x + cardBox.width / 2;
    const rowCenter = (chipBox.x + clearBox.x + clearBox.width) / 2;
    const chipYCenter = chipBox.y + chipBox.height / 2;
    const generateYCenter = generateBox.y + generateBox.height / 2;
    const clearYCenter = clearBox.y + clearBox.height / 2;

    expect(Math.abs(chipYCenter - generateYCenter)).toBeLessThanOrEqual(2);
    expect(Math.abs(clearYCenter - generateYCenter)).toBeLessThanOrEqual(2);
    expect(Math.abs(rowCenter - cardCenter)).toBeLessThanOrEqual(3);
  };

  await expect(card).not.toContainText("Path Constraints");
  await expectCenteredHeaderRow();

  // The centered single-row composition remains stable as the inspector grows.
  await page.evaluate(() => {
    document
      .querySelector<HTMLElement>(".workspace")
      ?.style.setProperty("--inspector-width", "460px");
  });
  await expectCenteredHeaderRow();
});

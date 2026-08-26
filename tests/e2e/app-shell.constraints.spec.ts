import { expect, test } from "@playwright/test";
import { canvasNodePosition, pointDistance } from "./support/app-shell-canvas";
import { openConstraintsTab } from "./support/app-shell-constraints";
import {
  installWorkspaceWriteSpy,
  resetWorkspaceWriteSpy,
  workspaceWriteCount,
} from "./support/app-shell-persistence";
import { openPathMenu } from "./support/app-shell-project-library";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";

test("keeps the expanded constraint editor out of the current UI", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  await page
    .getByTestId("constraint-range-max_velocity_meters_per_sec-0")
    .click();
  await expect(
    page.getByRole("button", { name: "Expand Max Velocity editor" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("listbox", { name: "Max Velocity segments" }),
  ).toBeVisible();
  await expect(page.getByTestId("constraint-popout-window")).toHaveCount(0);
});

test("adds edits and deletes ranged constraints", async ({ page }) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);
  const shortcut = process.platform === "darwin" ? "Meta" : "Control";

  await page.getByRole("button", { name: "Add constraint" }).click();
  await page
    .getByRole("menuitem", { name: "End Translation Tolerance" })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "End Translation Tolerance" }),
  ).toHaveValue("0.03");
  await page
    .getByRole("button", { name: "Remove End Translation Tolerance" })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "End Translation Tolerance" }),
  ).toHaveCount(0);

  const addConstraintIcon = page.getByTestId("add-constraint-icon");
  await expect(addConstraintIcon).toBeVisible();
  expect((await requiredBox(addConstraintIcon)).width).toBeGreaterThanOrEqual(
    16,
  );

  await page
    .getByTestId("constraint-range-max_velocity_meters_per_sec-0")
    .click();
  await page.getByLabel("Delete constraint 1").click();
  await expect(
    page.getByTestId("constraint-card-max_velocity_meters_per_sec"),
  ).toBeVisible();
  await expect(
    page.getByTestId("constraint-range-max_velocity_meters_per_sec-0"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("ranged-constraint-row-max_velocity_meters_per_sec-empty"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add constraint" }).click();
  await page.getByRole("menuitem", { name: "Max Velocity" }).click();

  await expect(
    page.getByTestId("constraint-card-max_velocity_meters_per_sec"),
  ).toBeVisible();
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-1"),
  ).toContainText("4.5 m/s");

  await expect(page.getByTestId("ranged-constraint-row-1")).toBeVisible();
  const addSegmentIcon = page
    .getByLabel("Add Max Velocity segment")
    .locator("svg");
  const deleteSegmentIcon = page
    .getByLabel("Delete constraint 1")
    .locator("svg");
  await expect(
    page.getByTestId("constraint-range-max_velocity_meters_per_sec-0"),
  ).toHaveAttribute("aria-keyshortcuts", "Delete Backspace");
  await expect(page.getByLabel("Delete constraint 1")).toHaveAttribute(
    "aria-keyshortcuts",
    "Delete Backspace",
  );
  await expect(addSegmentIcon).toBeVisible();
  await expect(deleteSegmentIcon).toBeVisible();
  await expect(page.getByLabel("Add Max Velocity segment")).toHaveCSS(
    "color",
    "rgb(88, 166, 255)",
  );
  await expect(page.getByLabel("Delete constraint 1")).toHaveCSS(
    "color",
    "rgb(255, 77, 77)",
  );
  expect((await requiredBox(addSegmentIcon)).width).toBeGreaterThan(8);
  expect((await requiredBox(deleteSegmentIcon)).width).toBeGreaterThan(8);

  await page
    .getByTestId("constraint-range-max_velocity_meters_per_sec-0")
    .click();
  await page.keyboard.press("Delete");
  await expect(
    page.getByTestId("constraint-card-max_velocity_meters_per_sec"),
  ).toBeVisible();
  await expect(
    page.getByTestId("constraint-range-max_velocity_meters_per_sec-0"),
  ).toHaveCount(0);
  await expect(
    page.getByTestId("ranged-constraint-row-max_velocity_meters_per_sec-empty"),
  ).toBeVisible();
  await page.keyboard.press(`${shortcut}+Z`);
  await expect(
    page.getByTestId("constraint-range-max_velocity_meters_per_sec-0"),
  ).toBeVisible();

  const firstConstraintRow = page.getByTestId("ranged-constraint-row-1");
  const firstConstraintInput = page.getByLabel("Constraint 1 value");
  const firstConstraintStepper = firstConstraintRow.locator(
    ".sidebar-number-control",
  );
  await expect(firstConstraintStepper).toBeVisible();
  expect((await requiredBox(firstConstraintStepper)).width).toBeLessThan(125);
  const increaseConstraint = firstConstraintRow.getByRole("button", {
    name: "Increase value",
  });
  const decreaseConstraint = firstConstraintRow.getByRole("button", {
    name: "Decrease value",
  });
  await expect(increaseConstraint.locator("svg")).toBeVisible();
  await expect(decreaseConstraint.locator("svg")).toBeVisible();
  await increaseConstraint.click();
  await expect(firstConstraintInput).toHaveValue("4.6");
  await decreaseConstraint.click();
  await expect(firstConstraintInput).toHaveValue("4.5");

  await firstConstraintInput.fill("");
  await expect(firstConstraintInput).toHaveValue("");
  await firstConstraintInput.fill("2.");
  await expect(firstConstraintInput).toHaveValue("2.");
  await firstConstraintInput.fill("2.456");
  await expect(firstConstraintInput).toHaveValue("2.45");
  await firstConstraintInput.fill("2.4");
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-1"),
  ).toContainText("2.4 m/s");

  const firstCell = page.getByTestId(
    "constraint-cell-max_velocity_meters_per_sec-1",
  );
  const secondCell = page.getByTestId(
    "constraint-cell-max_velocity_meters_per_sec-2",
  );
  const firstRange = page.getByTestId(
    "constraint-range-max_velocity_meters_per_sec-0",
  );
  const firstBox = await requiredBox(firstCell);
  const secondBox = await requiredBox(secondCell);
  await page.mouse.move(
    firstBox.x + firstBox.width / 2,
    firstBox.y + firstBox.height - 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height / 2,
    {
      steps: 6,
    },
  );
  await page.mouse.up();
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-2"),
  ).toContainText("2.4 m/s");
  await expect(firstRange).toHaveText("2.4 m/s");
  expect((await requiredBox(firstRange)).height).toBeGreaterThan(
    firstBox.height * 1.6,
  );

  await page
    .getByTestId("constraint-card-max_velocity_meters_per_sec")
    .locator(".constraint-card__header")
    .click({ position: { x: 1, y: 1 } });
  const emptyConstraintRow = page.getByTestId(
    "ranged-constraint-row-max_velocity_meters_per_sec-empty",
  );
  await expect(emptyConstraintRow).toBeVisible();
  // With nothing selected the fields are replaced by a single hint.
  await expect(
    emptyConstraintRow.getByText("Select a segment to edit its value."),
  ).toBeVisible();
  await expect(emptyConstraintRow.getByLabel("Max Velocity value")).toHaveCount(
    0,
  );
  await expect(
    emptyConstraintRow.getByRole("button", {
      name: "Delete selected constraint",
    }),
  ).toBeDisabled();
  await expect(
    emptyConstraintRow.getByRole("button", {
      name: "Split selected constraint",
    }),
  ).toBeDisabled();
  await expect(
    emptyConstraintRow.getByRole("button", {
      name: "Add Max Velocity segment",
    }),
  ).toBeVisible();
  await firstRange.click();

  await page.getByRole("button", { name: "Split constraint 1" }).click();
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-2"),
  ).toContainText("2.4 m/s");

  await page.getByLabel("Add Max Velocity segment").click();
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-3"),
  ).toContainText("4.5 m/s");

  await page
    .getByTestId("constraint-range-max_velocity_meters_per_sec-1")
    .click();
  await page.getByLabel("Delete constraint 2").click();
  await expect(
    page.getByTestId("constraint-cell-max_velocity_meters_per_sec-2"),
  ).toContainText("Open");
  await expect(page.getByTestId("save-status")).toContainText(
    /Autosave pending|Saved/,
  );
});

test("generates velocity constraints directly and reports their lifecycle", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  const card = page.getByTestId("constraint-card-max_velocity_meters_per_sec");
  const status = card.getByRole("status");
  const generate = card.getByRole("button", {
    name: "Generate constraints",
  });

  await page
    .getByTestId("constraint-range-max_velocity_meters_per_sec-0")
    .click();
  await page.getByLabel("Delete constraint 1").click();
  await expect(status).toHaveText("Not generated");
  await generate.click();
  await expect(status).toHaveText("Up to date");
  await expect(
    card.getByRole("button", { name: "Apply", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await page.getByTestId("path-element-row-0").click();
  const xInput = page.getByLabel("X (m)");
  await xInput.fill(String(Number(await xInput.inputValue()) + 0.1));
  await openConstraintsTab(page);

  // The background sync owns the refresh now; Generate is for the first run.
  await expect(status).toHaveText("Up to date");

  await card
    .getByRole("button", { name: "Clear generated constraints" })
    .click();
  await expect(status).toHaveText("Not generated");
});

test("resizes vertical ranges both ways and prevents whole-range overlap", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  const upperRange = page.getByTestId(
    "constraint-range-max_velocity_meters_per_sec-0",
  );
  await upperRange.click();
  await page.getByRole("button", { name: "Split constraint 1" }).click();

  const lowerRange = page.getByTestId(
    "constraint-range-max_velocity_meters_per_sec-1",
  );
  await lowerRange.click();
  await page.getByLabel("Constraint 2 value").fill("2");

  const lowerStartHandle = page.getByTestId(
    "constraint-range-handle-max_velocity_meters_per_sec-1-start",
  );
  const secondCell = page.getByTestId(
    "constraint-cell-max_velocity_meters_per_sec-2",
  );
  const thirdCell = page.getByTestId(
    "constraint-cell-max_velocity_meters_per_sec-3",
  );

  // Pull the lower range's shared top edge upward. The lower range owns the
  // handle that was clicked, so the upper range cannot steal the drag.
  let handleBox = await requiredBox(lowerStartHandle);
  let targetBox = await requiredBox(secondCell);
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect(secondCell).toContainText("2 m/s");

  // Push the same edge back down and restore the original divider.
  handleBox = await requiredBox(lowerStartHandle);
  targetBox = await requiredBox(thirdCell);
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect(secondCell).toContainText("3 m/s");
  await expect(thirdCell).toContainText("2 m/s");

  // Dragging the complete lower range through its contiguous neighbor clamps
  // in place: it preserves width and never overlaps or jumps across it.
  const lowerBefore = await requiredBox(lowerRange);
  const firstCell = page.getByTestId(
    "constraint-cell-max_velocity_meters_per_sec-1",
  );
  const firstCellBox = await requiredBox(firstCell);
  await page.mouse.move(
    lowerBefore.x + lowerBefore.width / 2,
    lowerBefore.y + lowerBefore.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    firstCellBox.x + firstCellBox.width / 2,
    firstCellBox.y + firstCellBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  const upperAfter = await requiredBox(upperRange);
  const lowerAfter = await requiredBox(lowerRange);
  expect(Math.abs(lowerAfter.y - lowerBefore.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(lowerAfter.height - lowerBefore.height)).toBeLessThanOrEqual(
    1,
  );
  expect(upperAfter.y + upperAfter.height).toBeLessThan(lowerAfter.y);
  await expect(firstCell).toContainText("3 m/s");
  await expect(thirdCell).toContainText("2 m/s");
});

test("uses range and toggle selection for velocity segments", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);
  const shortcut = process.platform === "darwin" ? "Meta" : "Control";

  const firstRange = page.getByTestId(
    "constraint-range-max_velocity_meters_per_sec-0",
  );
  await firstRange.click();
  await page.getByRole("button", { name: "Split constraint 1" }).click();

  const secondRange = page.getByTestId(
    "constraint-range-max_velocity_meters_per_sec-1",
  );
  await secondRange.click();
  await page.getByRole("button", { name: "Split constraint 2" }).click();

  const thirdRange = page.getByTestId(
    "constraint-range-max_velocity_meters_per_sec-2",
  );
  await firstRange.click();
  await thirdRange.click({ modifiers: ["Shift"] });

  const bulk = page.getByTestId(
    "ranged-constraint-bulk-max_velocity_meters_per_sec",
  );
  await expect(bulk).toContainText("3 segments selected");

  await secondRange.click({ modifiers: [shortcut] });
  await expect(bulk).toContainText("2 segments selected");
  const value = bulk.getByLabel("Selected Max Velocity values");
  await value.fill("2.2");
  await value.press("Enter");
  await expect(firstRange).toContainText("2.2 m/s");
  await expect(secondRange).not.toContainText("2.2 m/s");
  await expect(thirdRange).toContainText("2.2 m/s");
  await expect(
    bulk
      .getByRole("group", { name: "Selected velocity constraint mode" })
      .getByRole("button", { name: "Manual" }),
  ).toHaveCSS("background-color", "rgb(23, 87, 127)");

  await bulk.getByLabel("Delete 2 Max Velocity segments").click();
  await expect(
    page.locator('[data-testid^="constraint-range-max_velocity"]'),
  ).toHaveCount(1);

  await page.keyboard.press(`${shortcut}+Z`);
  await expect(firstRange).toBeVisible();
  await expect(secondRange).toBeVisible();
  await expect(thirdRange).toBeVisible();
  await firstRange.click();
  await thirdRange.click({ modifiers: ["Shift"] });
  await expect(bulk).toContainText("3 segments selected");
  await page
    .getByRole("group", { name: "Selected velocity constraint mode" })
    .getByRole("button", { name: "Auto" })
    .click();
  await expect(page.locator(".ranged-segment-range--auto")).not.toHaveCount(0);
});

test("refreshes the generated policy in the background after a path edit", async ({
  page,
}) => {
  await installWorkspaceWriteSpy(page);
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  const card = page.getByTestId("constraint-card-max_velocity_meters_per_sec");
  const status = card.getByRole("status");
  const constraintsTab = page.getByRole("tab", { name: "Constraints" });
  await page
    .getByTestId("constraint-range-max_velocity_meters_per_sec-0")
    .click();
  await page.getByLabel("Delete constraint 1").click();
  await card.getByRole("button", { name: "Generate constraints" }).click();
  await expect(status).toHaveText("Up to date");
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await resetWorkspaceWriteSpy(page);

  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await page.getByTestId("path-element-row-1").click();
  const xInput = page.getByLabel("X (m)");
  await xInput.fill(String(Number(await xInput.inputValue()) + 1.4));

  // The current traces the Constraints tab, so a solve is visible from the
  // Elements tab too.
  await expect(constraintsTab).toHaveClass(/is-optimizing/);
  const saveStatus = page.getByTestId("save-status");
  await expect(
    saveStatus.locator(".workspace-status__save-glyph"),
  ).toHaveText("🚀");
  await expect(constraintsTab).not.toHaveClass(/is-optimizing/);
  await expect(
    saveStatus.locator(".workspace-status__save-glyph"),
  ).toHaveText("✅");
  expect(await workspaceWriteCount(page)).toBeGreaterThanOrEqual(2);

  await openConstraintsTab(page);
  await expect(status).toHaveText("Up to date");

  // The move is the only thing on the undo stack; the resync is not.
  await expect(page.getByRole("button", { name: "Undo" })).toHaveAttribute(
    "title",
    /Undo Update element/,
  );
});

test("keeps optimizer controls in Settings instead of Constraints", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  await expect(page.getByTestId("auto-velocity-controls")).toHaveCount(0);
  await expect(
    page.getByText("Generator settings", { exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByRole("button", { name: "Generator" }).click();

  await expect(dialog.getByLabel("Keep in sync")).toBeChecked();
  await expect(dialog.getByLabel("Velocity safety factor")).toHaveValue("1");
  await expect(dialog.getByLabel("Acceleration safety factor")).toHaveValue(
    "1",
  );
  await expect(dialog.getByLabel("Merge difference (m/s)")).toHaveValue("0.3");

  await dialog.getByLabel("Keep in sync").uncheck();
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Generator" }).click();
  await expect(page.getByLabel("Keep in sync")).not.toBeChecked();
});

test("warns when a large path receives a scaled optimizer budget", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const chooserPromise = page.waitForEvent("filechooser");
  await openPathMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await page.getByRole("menuitem", { name: "Import Path..." }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    buffer: Buffer.from(
      JSON.stringify({
        path_elements: Array.from({ length: 17 }, (_, index) => ({
          type: "translation",
          x_meters: index,
          y_meters: index % 2 === 0 ? 0 : 1,
          intermediate_handoff_radius_meters: null,
        })),
        ranged_constraints: [],
      }),
    ),
    mimeType: "application/json",
    name: "large-optimizer-path.json",
  });
  await openConstraintsTab(page);

  const firstRadius = page.getByTestId("handoff-radius-chip-1");
  const lastRadius = page.getByTestId("handoff-radius-chip-15");
  await firstRadius.click();
  await lastRadius.click({ modifiers: ["Shift"] });
  await page
    .getByTestId("handoff-radius-bulk-detail")
    .getByRole("group", { name: "Selected handoff radius mode" })
    .getByRole("button", { name: "Auto" })
    .click();

  const warning = page.getByTestId("auto-velocity-workload-warning");
  await expect(warning).toContainText(
    "Large path — optimization may take longer. Up to 7348 candidate evaluations are expected.",
  );
});

test("turns dragged auto velocity ranges into manual ranges", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Edit Config" });
  await settingsDialog.getByRole("button", { name: "Generator" }).click();
  await settingsDialog.getByLabel("Merge difference (m/s)").fill("20");
  await settingsDialog.getByRole("button", { name: "Save" }).click();
  await openConstraintsTab(page);

  const firstRange = page.getByTestId(
    "constraint-range-max_velocity_meters_per_sec-0",
  );
  await firstRange.click();
  await page.getByLabel("Delete constraint 1").click();
  await expect(firstRange).toHaveCount(0);

  await page
    .getByRole("button", {
      name: "Generate constraints",
    })
    .click();
  await expect(page.getByText("Generated constraints ready")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toHaveCount(0);

  const autoRange = page.getByTestId(
    "constraint-range-max_velocity_meters_per_sec-0",
  );
  await expect(autoRange).toHaveClass(/ranged-segment-range--auto/);

  const secondCell = page.getByTestId(
    "constraint-cell-max_velocity_meters_per_sec-2",
  );
  const autoBox = await requiredBox(autoRange);
  const secondBox = await requiredBox(secondCell);
  await page.mouse.move(
    autoBox.x + autoBox.width / 2,
    autoBox.y + autoBox.height + 1,
  );
  await page.mouse.down();
  await page.mouse.move(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height / 2,
    {
      steps: 6,
    },
  );
  await page.mouse.up();

  await expect(autoRange).toHaveClass(/ranged-segment-range--manual/);
  const modeControl = page.getByRole("group", {
    name: "Velocity constraint mode",
  });
  // Both mode buttons stay enabled; the active mode is conveyed via
  // aria-pressed so assistive tech announces "pressed" rather than "dimmed".
  await expect(
    modeControl.getByRole("button", { name: "Manual" }),
  ).toBeEnabled();
  await expect(
    modeControl.getByRole("button", { name: "Manual" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(modeControl.getByRole("button", { name: "Auto" })).toBeEnabled();
  await expect(
    modeControl.getByRole("button", { name: "Auto" }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("warns when ranged constraints exceed the global value", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  const range = page.getByTestId(
    "constraint-range-max_velocity_meters_per_sec-0",
  );
  await range.click();
  await expect(page.getByText("Above global")).toHaveCount(0);

  await page.getByLabel("Constraint 1 value").fill("4.6");
  await expect(page.getByText("Above global")).toBeVisible();
  await expect(range).toHaveClass(/has-warning/);
  await expect(range).toHaveAttribute("title", "Above global value");

  await page.getByLabel("Constraint 1 value").fill("4.5");
  await expect(page.getByText("Above global")).toHaveCount(0);
});

test("warns when minimum constraints exceed their paired maximum", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  await page.getByRole("button", { name: "Add constraint" }).click();
  await page.getByRole("menuitem", { name: "Min Velocity" }).click();

  const minCard = page.getByTestId(
    "constraint-card-min_velocity_meters_per_sec",
  );
  const minimumTooltipText =
    "Minimum constraints are an advanced tuning feature for paths where the translation PID controller may be undertuned near the end of a path. They are not recommended for most users.";
  const tooltip = minCard.getByTestId("minimum-constraint-tooltip");
  await expect(tooltip).not.toHaveAttribute("title", /.*/);
  await tooltip.hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.waitForTimeout(1100);
  await expect(page.getByRole("tooltip")).toHaveText(minimumTooltipText);
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await tooltip.click();
  await expect(page.getByRole("tooltip")).toHaveText(minimumTooltipText, {
    timeout: 300,
  });
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  const minRange = page.getByTestId(
    "constraint-range-min_velocity_meters_per_sec-1",
  );
  await expect(minRange).toHaveText("0.5 m/s");
  await minRange.click();
  await page.getByLabel("Constraint 1 value").fill("3.1");

  await expect(page.getByText("Above max constraint")).toBeVisible();
  await expect(minRange).toHaveClass(/has-warning/);
  await expect(minRange).toHaveAttribute(
    "title",
    "Above max constraint; BLine will use the global default and disable the minimum baseline.",
  );

  await page.getByLabel("Constraint 1 value").fill("2.9");
  await expect(page.getByText("Above max constraint")).toHaveCount(0);
});

test("keeps constraint editing beside the live canvas", async ({ page }) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);
  await expect(page.getByTestId("path-stage-pixi-canvas")).toBeVisible();
  const constraintCard = page.getByTestId(
    "constraint-card-max_velocity_meters_per_sec",
  );
  await expect(constraintCard).toBeVisible();
  await constraintCard
    .getByTestId("constraint-range-max_velocity_meters_per_sec-0")
    .click();
  await constraintCard.getByLabel("Constraint 1 value").fill("3.25");
  await expect(
    constraintCard.getByTestId("constraint-cell-max_velocity_meters_per_sec-1"),
  ).toContainText("3.25 m/s");
  await expect(
    page.getByRole("dialog", { name: "Constraint Editor" }),
  ).toHaveCount(0);
});

test("guides the user when every velocity segment is manual", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  const card = page.getByTestId("constraint-card-max_velocity_meters_per_sec");
  await expect(card.getByRole("status")).toHaveText("Not generated");
  await expect(
    card.getByRole("button", { name: "Generate constraints" }),
  ).toBeDisabled();
  await expect(
    card.getByText(
      "All values are set manually. Switch one to Auto to generate.",
    ),
  ).toBeVisible();
});

test("keeps inert handoff radii in the Constraints card", async ({ page }) => {
  await gotoSampleEditor(page);

  const rows = page.locator('[data-testid^="path-element-row-"]');
  const lastIndex = (await rows.count()) - 1;

  // Element properties stay about path geometry; tuning lives in Constraints.
  await rows.nth(lastIndex).click();
  await expect(page.getByLabel("Handoff Radius (m)")).toHaveCount(0);
  await rows.nth(1).click();
  await expect(page.getByLabel("Handoff Radius (m)")).toHaveCount(0);

  await openConstraintsTab(page);
  await expect(
    page.getByTestId(`handoff-radius-chip-${lastIndex}`),
  ).toBeDisabled();
  await expect(
    page.getByTestId(`handoff-radius-chip-${lastIndex}`),
  ).toHaveAttribute(
    "title",
    "Not used on the final element — the path finishes here by tolerance, not by a handoff.",
  );
});

test("presents every anchor radius as a chip in the Constraints tab", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  const card = page.getByTestId("constraint-card-max_velocity_meters_per_sec");
  const radiusLane = page.getByTestId("constraint-card-handoff-radii");
  await expect(card).toHaveAttribute("aria-label", "Path constraints");
  await expect(card).not.toContainText("Path Constraints");
  await expect(radiusLane).toBeVisible();
  await expect(card.getByLabel("Value modes")).toContainText("AutoManual");
  await expect(card).not.toContainText(/\b[WT]\d+\b/);

  // One chip per anchor: the sample's two interior anchors carry values, and
  // both endpoints remain blank because no handoff happens there.
  const chips = radiusLane.locator('[data-testid^="handoff-radius-chip-"]');
  await expect(chips).toHaveCount(4);
  await expect(page.getByTestId("handoff-radius-chip-1")).toHaveClass(
    /handoff-radius-chip--manual/,
  );
  await expect(
    page
      .getByTestId("handoff-radius-chip-1")
      .locator(".handoff-radius-chip__value"),
  ).toHaveText("0.4 m");
  await expect(page.getByTestId("handoff-radius-chip-5")).toHaveClass(
    /handoff-radius-chip--unset/,
  );
  await expect(
    page
      .getByTestId("handoff-radius-chip-5")
      .locator(".handoff-radius-chip__value"),
  ).toHaveCount(0);

  // Both endpoints are inert: nothing hands off to the start, and the path
  // finishes by tolerance rather than by a handoff.
  await expect(page.getByTestId("handoff-radius-chip-0")).toBeDisabled();
  await expect(page.getByTestId("handoff-radius-chip-0")).toHaveAttribute(
    "title",
    /Not used on the first element/,
  );
  await expect(page.getByTestId("handoff-radius-chip-5")).toBeDisabled();
  await expect(page.getByTestId("handoff-radius-chip-5")).toHaveAttribute(
    "title",
    "Not used on the final element — the path finishes here by tolerance, not by a handoff.",
  );

  // Selecting a chip is selecting the anchor, so the element list agrees.
  await page.getByTestId("handoff-radius-chip-1").click();
  await expect(page.getByTestId("handoff-radius-detail")).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "Handoff radius mode" })
      .getByRole("button", { name: "Manual" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Handoff radius 2 value")).toHaveValue("0.4");
  await expect(
    card.getByTestId("ranged-constraint-row-max_velocity_meters_per_sec-empty"),
  ).toHaveCount(0);

  await card
    .getByTestId("constraint-range-max_velocity_meters_per_sec-0")
    .click();
  await expect(page.getByTestId("handoff-radius-detail")).toHaveCount(0);
  await expect(page.getByLabel("Constraint 1 value")).toBeVisible();
  await page.getByTestId("handoff-radius-chip-1").click();

  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await expect(page.getByTestId("path-element-item-1")).toHaveClass(
    /is-selected/,
  );
  await openConstraintsTab(page);
  await expect(page.getByTestId("handoff-radius-chip-1")).toHaveClass(
    /is-selected/,
  );
});

test("pins and releases handoff radii around the optimizer", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  const pinnedChip = page.getByTestId("handoff-radius-chip-1");
  const pinnedValue = pinnedChip.locator(".handoff-radius-chip__value");
  const generatedChip = page.getByTestId("handoff-radius-chip-3");
  const generatedValue = generatedChip.locator(".handoff-radius-chip__value");
  const mode = page.getByRole("group", { name: "Handoff radius mode" });
  const generate = page.getByRole("button", { name: "Generate constraints" });

  // A manual value the user typed is a pin the optimizer must respect.
  await pinnedChip.click();
  const pinnedInput = page.getByLabel("Handoff radius 2 value");
  await pinnedInput.fill("0.28");
  await pinnedInput.press("Enter");
  await expect(pinnedValue).toHaveText("0.28 m");

  // Handing the other interior anchor to the optimizer gives Generate work.
  await generatedChip.click();
  await mode.getByRole("button", { name: "Auto" }).click();
  await expect(generatedChip).toHaveClass(/handoff-radius-chip--auto/);
  await expect(page.getByLabel("Handoff radius 3 value")).toBeDisabled();

  await expect(generate).toBeEnabled();
  await generate.click();

  // The generated radius moves; the pinned one does not.
  await expect(generatedValue).not.toHaveText("0.4 m");
  await expect(generatedChip).toHaveClass(/handoff-radius-chip--auto/);
  await expect(pinnedValue).toHaveText("0.28 m");
  await expect(pinnedChip).toHaveClass(/handoff-radius-chip--manual/);

  // Releasing the pin hands that anchor back, and the next run reseeds it.
  await pinnedChip.click();
  await mode.getByRole("button", { name: "Auto" }).click();
  await expect(pinnedChip).toHaveClass(/handoff-radius-chip--auto/);
  await expect(page.getByLabel("Handoff radius 2 value")).toBeDisabled();

  await generate.click();
  await expect(pinnedChip).toHaveClass(/handoff-radius-chip--auto/);
  await expect(pinnedValue).not.toHaveText("0.28 m");
});

test("uses range and toggle selection for handoff radii", async ({ page }) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);
  const shortcut = process.platform === "darwin" ? "Meta" : "Control";

  const first = page.getByTestId("handoff-radius-chip-1");
  const second = page.getByTestId("handoff-radius-chip-3");
  await first.click();
  await second.click({ modifiers: ["Shift"] });

  const bulk = page.getByTestId("handoff-radius-bulk-detail");
  await expect(bulk).toContainText("2 radii selected");

  await first.click({ modifiers: [shortcut] });
  await expect(bulk).toHaveCount(0);
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await first.click({ modifiers: [shortcut] });
  await expect(bulk).toContainText("2 radii selected");

  const value = bulk.getByLabel("Selected handoff radii value");
  await value.fill("0.35");
  await value.press("Enter");
  await expect(first.locator(".handoff-radius-chip__value")).toHaveText(
    "0.35 m",
  );
  await expect(second.locator(".handoff-radius-chip__value")).toHaveText(
    "0.35 m",
  );

  const mode = bulk.getByRole("group", {
    name: "Selected handoff radius mode",
  });
  await expect(mode.getByRole("button", { name: "Manual" })).toHaveCSS(
    "background-color",
    "rgb(23, 87, 127)",
  );
  await mode.getByRole("button", { name: "Auto" }).click();
  await expect(first).toHaveClass(/handoff-radius-chip--auto/);
  await expect(second).toHaveClass(/handoff-radius-chip--auto/);
  await expect(mode.getByRole("button", { name: "Auto" })).toHaveCSS(
    "background-color",
    "rgb(36, 93, 68)",
  );

  await bulk.getByLabel("Delete 2 handoff radii").click();
  await expect(first).toHaveClass(/handoff-radius-chip--unset/);
  await expect(second).toHaveClass(/handoff-radius-chip--unset/);
});

test("keeps canvas handoff radii visual-only", async ({ page }) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  const chip = page.getByTestId("handoff-radius-chip-1");
  await chip.click();
  const mode = page.getByRole("group", { name: "Handoff radius mode" });
  await mode.getByRole("button", { name: "Auto" }).click();
  await expect(chip).toHaveClass(/handoff-radius-chip--auto/);

  const canvas = page.getByTestId("path-stage-canvas");
  const canvasBox = await requiredBox(canvas);
  const anchor = await canvasNodePosition(page, "path-element-node-1");
  const nextAnchor = await canvasNodePosition(page, "path-element-node-3");
  const metersBetweenAnchors = 2.6;
  const scale = pointDistance(anchor, nextAnchor) / metersBetweenAnchors;
  const nodeExclusionPx = Math.max(7, 0.1 * scale) + 14;
  const grabDistancePx = Math.max(0.4 * scale, nodeExclusionPx + 2);
  const targetRadiusMeters = 0.7;
  const start = {
    x: canvasBox.x + anchor.x + grabDistancePx,
    y: canvasBox.y + anchor.y,
  };
  const target = {
    x: canvasBox.x + anchor.x + targetRadiusMeters * scale,
    y: canvasBox.y + anchor.y,
  };

  await page.mouse.move(start.x, start.y);
  await expect(canvas).not.toHaveClass(/is-handoff-radius-target/);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect(page.getByTestId("handoff-radius-drag-label")).toHaveCount(0);
  await page.mouse.up();

  await expect(chip).toHaveClass(/handoff-radius-chip--auto/);
  await chip.click();
  await mode.getByRole("button", { name: "Manual" }).click();
  await expect(chip).toHaveClass(/handoff-radius-chip--manual/);
  await page.mouse.dblclick(target.x, target.y);
  await expect(chip).toHaveClass(/handoff-radius-chip--manual/);
});

import { expect, test, type Page } from "@playwright/test";
import { openConstraintsTab } from "./support/app-shell-constraints";
import { activeFieldLabel } from "./support/app-shell-fields";
import { openPathLibraryDialog } from "./support/app-shell-project-library";
import {
  dismissMobileSupportWarning,
  gotoSampleEditor,
  requiredBox,
} from "./support/app-shell-shared";

test("opens help and tutorials from the toolbar", async ({ page }) => {
  await gotoSampleEditor(page);

  // Path health keeps its own diagnostic identity, separate from help.
  await expect(
    page.getByRole("button", { name: /^Path health/ }),
  ).toHaveAttribute("title", "Path health — editor checks for this path");

  await page.getByRole("button", { name: "Help and tutorials" }).click();
  const hub = page.getByTestId("help-hub");
  await expect(hub).toBeVisible();
  await expect(hub.getByRole("link", { name: /Documentation/ })).toBeVisible();
  await expect(
    hub.getByRole("button", { name: /Open sample path/ }),
  ).toBeVisible();

  await hub.getByRole("button", { name: /Keyboard shortcuts/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
});

test("runs the guided tour in an isolated practice session", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );
  const ghostPathsToggle = page.getByRole("button", {
    name: /collection paths/,
  });
  const ghostPathsBefore = await ghostPathsToggle.getAttribute("aria-pressed");

  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-editor-basics").click();

  // The tour moves the user onto a scratch path so steps are safe to perform.
  await expect(page.getByTestId("tour-card")).toBeVisible();
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Tour practice",
  );

  // The practice path is seeded with a valid two-waypoint run, so the
  // path-health check has nothing to flag.
  await expect(
    page.getByRole("button", { name: "Path health: 0 issues" }),
  ).toBeVisible();

  // Leaving the tour puts them back on the path they were editing.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );

  // Starting again creates another in-memory session without touching the
  // durable Project.
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-editor-basics").click();
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Tour practice",
  );
  const card = page.getByTestId("tour-card");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Waypoint tool" }).click();
  const pathStage = page.getByTestId("path-stage");
  const canvas = await requiredBox(pathStage);
  await pathStage.click({
    position: { x: canvas.width / 2, y: canvas.height / 2 },
  });
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 3 of 6");
  await ghostPathsToggle.click();
  await expect(ghostPathsToggle).not.toHaveAttribute(
    "aria-pressed",
    ghostPathsBefore ?? "",
  );
  await page.waitForTimeout(450);
  await page.keyboard.press("Escape");
  await expect(ghostPathsToggle).toHaveAttribute(
    "aria-pressed",
    ghostPathsBefore ?? "",
  );

  // Even after a real practice edit sits beyond the autosave delay, a reload
  // sees only the original durable Project.
  await page.reload();
  await dismissMobileSupportWarning(page);
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );

  const dialog = await openPathLibraryDialog(page);
  await expect(dialog.getByText("Tour practice", { exact: true })).toHaveCount(
    0,
  );
});

test("restores editor navigation, history, selection, inspector, and tool after a Tour", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  await page.getByTestId("path-element-row-0").click();
  await page.keyboard.press(`${modifier}+D`);
  await page.keyboard.press(`${modifier}+Z`);
  const fieldBefore = await activeFieldLabel(page);
  const selectedBefore = await page
    .getByTestId("selected-element-status")
    .textContent();
  await page.getByRole("button", { name: "Waypoint tool" }).click();
  // Change the child-owned tab last, so Tour capture must read the current
  // preference synchronously rather than relying on an AppShell render.
  await openConstraintsTab(page);
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-editor-basics").click();
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Tour practice",
  );
  await expect(
    page.getByRole("button", { name: "Select tool" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );
  await expect.poll(() => activeFieldLabel(page)).toBe(fieldBefore);
  await expect(page.getByTestId("selected-element-status")).toHaveText(
    selectedBefore ?? "",
  );
  await expect(
    page.getByRole("button", { name: "Redo", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Waypoint tool" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Toggle inspector" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("tab", { name: "Constraints" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("starts inspector lessons on Elements and restores the previous tab", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-constrain-optimize").click();

  const card = page.getByTestId("tour-card");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(card).toContainText("Open Constraints");
  await expect(page.getByRole("tab", { name: "Elements" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // The lesson must wait for a fresh click instead of treating the user's
  // pre-tour Constraints preference as completion.
  await page.waitForTimeout(600);
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 2 of 6");
  await page.getByRole("tab", { name: "Constraints" }).click();
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 3 of 6");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "Constraints" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("does not start a Tour across an active inspector dialog", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);
  await page
    .getByTestId("constraint-range-max_velocity_meters_per_sec-0")
    .click();
  await page
    .getByRole("button", { name: "Expand Max Velocity editor" })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Max Velocity expanded editor",
  });
  await expect(dialog).toBeVisible();

  await page.getByRole("button", { name: "Help and tutorials" }).click();
  // The popout deliberately overlays most underlying surfaces. Force the
  // otherwise-hidden entry controls to exercise the start guard itself.
  await page
    .getByTestId("start-guided-tour")
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByTestId("tour-picker")).toBeAttached();
  await page
    .getByTestId("tour-picker-editor-basics")
    .evaluate((button: HTMLButtonElement) => button.click());

  await expect(page.getByTestId("tour-card")).toHaveCount(0);
  await expect(page.getByTestId("tour-picker")).toBeAttached();
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );
});

test("starts the guided tour from the start center", async ({ page }) => {
  await page.goto("/");
  await dismissMobileSupportWarning(page);
  await expect(
    page.getByRole("heading", { name: "Simple, rapid, robust." }),
  ).toBeVisible();

  await page.getByTestId("start-center-guided-tour").click();

  await expect(page.getByTestId("tour-card")).toBeVisible();
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 1 of 6");

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Simple, rapid, robust." }),
  ).toBeVisible();
  await expect(page.getByTestId("current-path-status")).toContainText(
    "No path",
  );
});

test("teaches concepts across multiple lessons", async ({ page }) => {
  await gotoSampleEditor(page);

  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();

  // The picker lists every outcome with an estimated duration.
  const picker = page.getByTestId("tour-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByText("Quick Start")).toBeVisible();
  await expect(picker.getByText("Shape a Path")).toBeVisible();
  await expect(picker.getByText("Set Speed")).toBeVisible();
  await expect(picker.getByText("Check a Run")).toBeVisible();
  await expect(picker.getByText("Recommended first")).toBeVisible();
  await expect(picker.getByText("3 min")).toBeVisible();

  await page.getByTestId("tour-picker-shape-paths").click();
  const card = page.getByTestId("tour-card");
  await expect(card).toBeVisible();

  // Lesson two opens with a concept card: dimmed editor, no spotlight.
  await expect(card).toContainText("Elements define the route");
  await expect(page.locator(".tour-scrim")).toBeVisible();
  await expect(page.locator(".tour-spotlight")).toHaveCount(0);

  // The next step returns to spotlighting a real control.
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".tour-spotlight")).toBeVisible();

  // The add step shows a live task instead of a disabled action button.
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(card).toContainText("Add a translation target");
  await expect(card).toContainText("Waiting for this action");
  await expect(
    card.getByRole("button", { name: "Next", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Translation tool" }).click();
  const canvas = await requiredBox(page.getByTestId("path-stage"));
  await page.mouse.click(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 4 of 6");

  // The lesson clears the automatic placement selection and asks the learner
  // to find the new element in the Elements tab.
  await expect(card).toContainText("Find the new element");
  await expect(page.getByRole("tab", { name: "Elements" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByTestId("path-element-row-1").click();
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 5 of 6");
  await expect(card).toContainText("Move the element");

  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 6 of 6");
  await expect(card).toContainText("Review the handoff");

  await card.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.getByTestId("tour-card")).toHaveCount(0);

  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await expect(
    page.getByTestId("tour-picker-shape-paths").locator(".tour-picker__badge"),
  ).toHaveText("✓");
});

test("advances lessons when the user performs the taught action", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  // Set Speed: clicking the Constraints tab advances the step.
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-constrain-optimize").click();
  const card = page.getByTestId("tour-card");
  await expect(card).toContainText("Constraints limit motion");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(card).toContainText("Open Constraints");
  await page.getByRole("tab", { name: /Constraints/ }).click();
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 3 of 6");
  await expect(page.locator(".tour-spotlight")).toBeVisible();
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Generate constraints" }).click();
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 5 of 6");
  await page
    .getByTestId("constraint-range-max_velocity_meters_per_sec-0")
    .click();
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 6 of 6");
  await page
    .getByRole("group", { name: "Velocity constraint mode" })
    .getByRole("button", { name: "Manual" })
    .click();
  await expect(card).toContainText("You generated a velocity cap");
  await card.getByRole("button", { name: "Finish", exact: true }).click();

  // Check a Run: pressing play advances the first action step.
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-simulate-verify").click();
  await expect(card).toContainText("Review the sample path");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(card).toContainText("Run the simulation");
  await page.getByRole("button", { name: "Play simulation" }).click();
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 3 of 6");
  await expect(card).toContainText("Scrub the timeline");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(card).toContainText("Open Path Health");
  await expect(page.locator(".tour-spotlight")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("hides guided tours below the mobile support threshold", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-editor-basics").click();
  await expect(page.getByTestId("tour-card")).toBeVisible();

  // Shrinking into the mobile layout exits the tour rather than letting the
  // coach marks fight the overlay inspector.
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
  await dismissMobileSupportWarning(page);
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );

  // And the help hub stops offering it until the window grows again.
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await expect(page.getByTestId("start-guided-tour")).toBeDisabled();
});

test("walks the guided tour with a spotlight on every step", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-editor-basics").click();

  const card = page.getByTestId("tour-card");
  await expect(card).toBeVisible();

  // While a step allows no interaction, stray clicks are shielded: clicking
  // the Waypoint tool during the intro step must not activate it.
  const waypointTool = page.getByRole("button", { name: "Waypoint tool" });
  const toolBox = await requiredBox(waypointTool);
  await page.mouse.click(
    toolBox.x + toolBox.width / 2,
    toolBox.y + toolBox.height / 2,
  );
  await expect(waypointTool).toHaveAttribute("aria-pressed", "false");

  await expectTourSpotlightInViewport(page, 1, 6);
  await card.getByRole("button", { name: "Next", exact: true }).click();

  await expectTourSpotlightInViewport(page, 2, 6);
  await expect(card).toContainText("Waiting for this action");
  await waypointTool.click();
  await expect(waypointTool).toHaveAttribute("aria-pressed", "true");
  const pathStage = page.getByTestId("path-stage");
  const canvas = await requiredBox(pathStage);
  await pathStage.click({
    position: { x: canvas.width / 2, y: canvas.height / 2 },
  });

  await expectTourSpotlightInViewport(page, 3, 6);
  await expect(page.getByRole("button", { name: "Select tool" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("ArrowRight");

  await expectTourSpotlightInViewport(page, 4, 6);
  await expect(page.getByRole("tab", { name: "Elements" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Constraints" }).click();

  await expectTourSpotlightInViewport(page, 5, 6);
  await page.getByRole("button", { name: "Generate constraints" }).click();

  await expectTourSpotlightInViewport(page, 6, 6);
  await page.getByRole("button", { name: "Play simulation" }).click();
  await expect(card).toContainText("You edited the route");
  await card.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.getByTestId("tour-card")).toHaveCount(0);

  // Escape leaves a tour part way through.
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-editor-basics").click();
  await expect(page.getByTestId("tour-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
});

async function expectTourSpotlightInViewport(
  page: Page,
  step: number,
  total: number,
): Promise<void> {
  await expect(page.getByTestId("tour-step-count")).toHaveText(
    `Step ${step} of ${total}`,
  );
  const spotlight = page.locator(".tour-spotlight");
  await expect(spotlight).toBeVisible();
  const box = await requiredBox(spotlight);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport?.width ?? 0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport?.height ?? 0);
}

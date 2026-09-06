import { expect, test } from "@playwright/test";
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

  await expect(
    page.getByRole("button", { name: "Search commands and paths" }),
  ).toHaveCount(0);

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
    name: /Path Group overlays/,
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
  // Path health stays out of the status bar when there is nothing to flag.
  await expect(
    page.getByRole("button", { name: "Path health: 0 issues" }),
  ).toHaveCount(0);

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
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 3 of 7");
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

test("starts the guided tour from the start center", async ({ page }) => {
  await page.goto("/");
  await dismissMobileSupportWarning(page);
  await expect(
    page.getByRole("heading", { name: "Simple, rapid, robust." }),
  ).toBeVisible();

  await page.getByTestId("start-center-guided-tour").click();

  await expect(page.getByTestId("tour-card")).toBeVisible();
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 1 of 7");

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

  // The picker lists every lesson with its step count.
  const picker = page.getByTestId("tour-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByText("Editor basics")).toBeVisible();
  await expect(picker.getByText("Draw better paths")).toBeVisible();
  await expect(picker.getByText("Constrain and optimize")).toBeVisible();
  await expect(picker.getByText("Simulate and verify")).toBeVisible();

  await page.getByTestId("tour-picker-shape-paths").click();
  const card = page.getByTestId("tour-card");
  await expect(card).toBeVisible();

  // Lesson two opens with a concept card: dimmed editor, no spotlight.
  await expect(card).toContainText("BLine drives point to point");
  await expect(page.locator(".tour-scrim")).toBeVisible();
  await expect(page.locator(".tour-spotlight")).toHaveCount(0);

  // The next step returns to spotlighting a real control.
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".tour-spotlight")).toBeVisible();

  // The bend-the-route step locks Next until the element is really added.
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(card).toContainText("Bend the route");
  await expect(
    card.getByRole("button", { name: "Try it", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Translation tool" }).click();
  const canvas = await requiredBox(page.getByTestId("path-stage"));
  await page.mouse.click(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 4 of 8");

  // Two informational steps, then the handoff step waits for a real
  // selection of the element the learner just added.
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(card).toContainText("Select your new element");
  await expect(
    card.getByRole("button", { name: "Try it", exact: true }),
  ).toBeDisabled();
  await page.mouse.click(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 7 of 8");
  await expect(card).toContainText("Bigger circle, earlier turn");

  await card.getByRole("button", { name: "Next", exact: true }).click();
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

  // Constrain and optimize: clicking the Constraints tab advances the step.
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-constrain-optimize").click();
  const card = page.getByTestId("tour-card");
  await expect(card).toContainText("Geometry says where");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(card).toContainText("Open the Constraints tab");
  await page.getByRole("tab", { name: /Constraints/ }).click();
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 3 of 6");
  await expect(page.locator(".tour-spotlight")).toBeVisible();
  await page.keyboard.press("Escape");

  // Simulate and verify: pressing play advances the first step.
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-simulate-verify").click();
  await expect(card).toContainText("A complete little auto");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(card).toContainText("Watch the run");
  await page.getByRole("button", { name: "Play simulation" }).click();
  await expect(page.getByTestId("tour-step-count")).toHaveText("Step 3 of 6");
  await expect(card).toContainText("not a robot sim");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(card).toContainText("Check path health");
  await expect(page.locator(".tour-spotlight")).toHaveCount(0);
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
  const spotlight = page.locator(".tour-spotlight");
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

  // Every step must anchor to something real and on screen.
  for (let step = 1; step <= 7; step += 1) {
    await expect(page.getByTestId("tour-step-count")).toHaveText(
      `Step ${step} of 7`,
    );
    await expect(spotlight).toBeVisible();
    const box = await spotlight.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    if (step === 3) {
      // The placement step hands back the Select tool so a stray canvas
      // click cannot drop another waypoint.
      await expect(
        page.getByRole("button", { name: "Select tool" }),
      ).toHaveAttribute("aria-pressed", "true");
    }

    if (step === 2) {
      // Action step: Next stays locked until the waypoint is really placed.
      await expect(
        card.getByRole("button", { name: "Try it", exact: true }),
      ).toBeDisabled();
      await waypointTool.click();
      await expect(waypointTool).toHaveAttribute("aria-pressed", "true");
      const pathStage = page.getByTestId("path-stage");
      const canvas = await requiredBox(pathStage);
      // Locator clicking waits until the tour's interaction hole exposes the
      // canvas. A raw coordinate click can race that layout frame under load
      // and land on the temporary shield instead.
      await pathStage.click({
        position: { x: canvas.width / 2, y: canvas.height / 2 },
      });
    } else if (step === 5) {
      // Gated: the lesson waits for the Constraints tab itself.
      await page.getByRole("tab", { name: /Constraints/ }).click();
    } else if (step === 6) {
      // Gated: generate the velocity plan before the simulation step.
      await page.getByRole("button", { name: "Generate constraints" }).click();
    } else if (step < 7) {
      await card.getByRole("button", { name: "Next", exact: true }).click();
    }
  }

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

import { expect, test, type Page } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PathModel } from "../../src/core/model/path";
import { waitForStageSettled } from "./support/app-shell-canvas";
import { openConstraintsTab } from "./support/app-shell-constraints";
import { activeFieldLabel } from "./support/app-shell-fields";
import {
  openPathLibraryDialog,
  selectToolbarOption,
} from "./support/app-shell-project-library";
import {
  disableDirectoryPicker,
  parseStoredZip,
  requiredZipText,
} from "./support/app-shell-persistence";
import {
  dismissMobileSupportWarning,
  gotoSampleEditor,
  requiredBox,
  selectDropdownOption,
} from "./support/app-shell-shared";

// Lesson walks chain dozens of gated steps, so give them three times the
// default timeout rather than fail on a busy machine. A test that sets its
// own timeout keeps that value.
test.beforeEach(() => test.slow());

const lessonSections = [
  [
    "Core",
    [
      "Getting Started",
      "BLine Fundamentals",
      "Event triggers",
      "Importing and Exporting",
    ],
  ],
  ["Settings", ["Robot", "Path Defaults", "Field", "Generator", "Lib Keys"]],
  [
    "Advanced",
    [
      "Path Tuning",
      "Rotation targets",
      "Path Management",
      "How to use BLine offline",
      "Current-pose Starts",
      "Handoff Modes",
      "Linked Elements",
      "Path Linking",
    ],
  ],
] as const;

test("starts a linked lesson on a fresh browser and consumes only its URL parameter @webkit-canvas", async ({
  page,
}) => {
  await page.goto("/?lesson=handoff-modes&source=docs#handoffs");
  await heading(page, "Two ways to reach a handoff");
  await expect(page.getByTestId("tour-picker")).toHaveCount(0);
  expect((await practice(page)).hasPersistence).toBe(false);
  await expect(page).toHaveURL(/\/\?source=docs#handoffs$/);
  await exitLesson(page);
  await expect(page.getByTestId("start-center")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("start-center")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
});

test(
  "restores a saved project after a linked lesson and after reloading during practice @webkit-canvas",
  { tag: "@smoke" },
  async ({ page }) => {
    await gotoSampleEditor(page);
    await expect(page.getByTestId("save-status")).toContainText("Saved");
    const before = await practice(page);
    await page.goto("/?lesson=rotation-targets");
    await heading(page, "Add a rotation target");
    expect((await practice(page)).hasPersistence).toBe(false);
    await exitLesson(page);
    expect((await practice(page)).path).toEqual(before.path);
    expect((await practice(page)).config).toEqual(before.config);

    await page.goto("/?lesson=handoff-modes");
    await heading(page, "Two ways to reach a handoff");
    await page.reload();
    await expect(page.getByTestId("path-stage")).toBeVisible();
    await expect(page.getByTestId("save-status")).not.toContainText("Loading");
    await expect(page.getByTestId("tour-card")).toHaveCount(0);
    expect((await practice(page)).path).toEqual(before.path);
    expect((await practice(page)).config).toEqual(before.config);
  },
);

test("offers available lessons for an unknown lesson link @webkit-canvas", async ({
  page,
}) => {
  await page.goto("/?lesson=old-lesson");
  const picker = page.getByTestId("tour-picker");
  await expect(picker.getByRole("status")).toHaveText(
    "This lesson link is unavailable. Choose a lesson below.",
  );
  await expect(page).not.toHaveURL(/lesson=/);
  await picker.getByText("Rotation targets", { exact: true }).click();
  await heading(page, "Add a rotation target");
  await exitLesson(page);
  await expect(page.getByTestId("start-center")).toBeVisible();
});

test(
  "opens help and all lessons, including offline guidance before advanced lessons",
  { tag: "@smoke" },
  async ({ page }) => {
    await gotoSampleEditor(page);
    await page.getByRole("button", { name: "Help and tutorials" }).click();
    const hub = page.getByTestId("help-hub");
    await expect(
      hub.getByRole("link", { name: /Documentation/ }),
    ).toBeVisible();
    await hub.getByRole("button", { name: "Lessons", exact: true }).click();
    const picker = page.getByTestId("tour-picker");
    await expect(picker).toHaveAttribute("aria-label", "Lessons");
    await expect(picker.locator(".tour-picker__header")).toHaveText(
      "🧭 Lessons",
    );
    for (const [section, titles] of lessonSections) {
      const group = picker.getByRole("region", { name: section, exact: true });
      await expect(group.getByRole("heading")).toContainText(
        new RegExp(`^${section}\\s*0 / ${titles.length} · \\d+ min$`),
      );
      await expect(group.locator(".tour-picker__copy > strong")).toHaveText([
        ...titles,
      ]);
    }
    await expect(picker.locator(".tour-picker__badge").first()).toHaveText("1");
    await expect(picker.getByText("Recommended first")).toHaveCount(1);
    await expect(page.getByTestId("tour-card")).toHaveCount(0);
  },
);

test("keeps the course reachable in a short window", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  const picker = page.getByTestId("tour-picker");
  const box = await requiredBox(picker);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  await picker.getByText("Path Linking", { exact: true }).click();
  await auditLayout(page);
});

test(
  "asks before leaving and offers to resume where the learner left",
  { tag: "@smoke" },
  async ({ page }) => {
    await gotoSampleEditor(page);
    await openLesson(page, "Getting Started");
    const card = page.getByTestId("tour-card");
    await expect(card.getByRole("button", { name: "Skip lesson" })).toHaveCount(
      0,
    );
    await advance(page);
    await heading(page, "Sidebar");
    await expect(page.getByTestId("tour-step-count")).toHaveText("2 / 5");

    // Escape and × both ask; Keep going returns to the same step.
    await card.focus();
    await page.keyboard.press("Escape");
    const confirm = page.getByTestId("tour-leave-confirmation");
    await expect(confirm).toContainText("resume at step 2");
    await confirm.getByRole("button", { name: "Keep going" }).click();
    await expect(confirm).toHaveCount(0);
    await heading(page, "Sidebar");
    await card.getByRole("button", { name: "Leave lesson" }).click();
    await confirm.getByRole("button", { name: "Leave lesson" }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("path-stage")).toBeVisible();

    await page.getByRole("button", { name: "Help and tutorials" }).click();
    await page.getByTestId("start-guided-tour").click();
    const picker = page.getByTestId("tour-picker");
    await expect(picker.getByTestId("tour-picker-resume-banner")).toContainText(
      "Left at step 2 of 5",
    );
    await expect(
      picker.getByTestId("tour-picker-getting-started"),
    ).toContainText("Resume at step 2");
    await picker.getByTestId("tour-picker-resume").click();
    await heading(page, "Sidebar");
    await exitLesson(page);
    await page.getByRole("button", { name: "Help and tutorials" }).click();
    await page.getByTestId("start-guided-tour").click();
    await picker.getByTestId("tour-picker-start-over").click();
    await heading(page, "The editor at a glance");
    await page.reload();
    await page.getByRole("button", { name: "Help and tutorials" }).click();
    await page.getByTestId("start-guided-tour").click();
    await expect(picker.getByTestId("tour-picker-resume-banner")).toHaveCount(
      0,
    );
  },
);

test(
  "walks Handoff Modes to completion with a guided Radius and Progress comparison @webkit-canvas",
  { tag: "@smoke" },
  async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?lesson=handoff-modes");
    const card = page.getByTestId("tour-card");
    await heading(page, "Two ways to reach a handoff");
    // The lesson frames its small practice route instead of the whole field.
    await expect
      .poll(async () =>
        parseInt(
          await page
            .getByRole("button", { name: "Fit view", exact: true })
            .innerText(),
        ),
      )
      .toBeGreaterThan(150);
    // The gate is explained only once Progress exists.
    await expect(card).not.toContainText("gate");
    await advance(page);

    await heading(page, "Change one point");
    await expect(page.getByTestId("tour-headline")).toHaveText(
      /^○\s*Set the middle point’s handoff to Progress$/,
    );
    await expect(advanceButton(page)).toHaveCount(0);
    // Show me points at the middle point’s own cell, then at Progress.
    await page.getByTestId("tour-show-me").click();
    await expect(page.getByTestId("tour-spotlight")).toHaveAttribute(
      "data-show-me",
      "testid:handoff-radius-chip-1",
    );
    await page.getByTestId("handoff-radius-chip-1").click();
    const modes = page.getByRole("group", {
      name: "Handoff mode 2",
      exact: true,
    });
    await modes.getByRole("button", { name: "Progress", exact: true }).click();
    // The gate is explained once it appears, in the step’s success line.
    await expect(card).toContainText("The middle point now uses Progress.");
    await expect(card).toContainText("purple dashed line");
    await advance(page);

    await heading(page, "Try both on a corner");
    const items = card
      .getByRole("list", { name: "Requirements" })
      .locator("li");
    await expect(items).toHaveCount(3);
    await expect(items.locator("[data-complete=true]")).toHaveCount(0);
    await expect(card.locator("li[data-complete=true]")).toHaveCount(0);
    await playAndInspect(page);
    await expect(items.nth(0)).toHaveAttribute("data-complete", "true");
    await expect(advanceButton(page)).toHaveCount(0);
    await page.getByTestId("handoff-radius-chip-1").click();
    await modes.getByRole("button", { name: "Radius", exact: true }).click();
    await expect(items.nth(1)).toHaveAttribute("data-complete", "true");
    await expect(items.nth(2)).toHaveAttribute("data-complete", "false");
    await playAndInspect(page);
    await expect(items.nth(2)).toHaveAttribute("data-complete", "true");
    await advance(page);

    await heading(page, "Choose an inherited default");
    const settings = page.getByRole("dialog", { name: "Edit Config" });
    await expect(settings).toBeVisible();
    await selectDropdownOption(page, "Default Handoff Mode", "Progress");
    await expect(card).toContainText("New handoffs will use Progress.");
    await card.getByRole("button", { name: "Finish", exact: true }).click();
    const recap = page.getByTestId("tour-recap");
    await expect(recap).toContainText("Handoff Modes");
    await expect(recap.locator("li")).toHaveCount(2);
    await expect(recap.getByTestId("tour-next-lesson")).toHaveText(
      "Next: Linked Elements",
    );
    await recap.getByTestId("tour-next-lesson").click();
    await expect(recap).toHaveCount(0);
    await heading(page, "See where the paths meet");
    await exitLesson(page);
    await page.getByRole("button", { name: "Help and tutorials" }).click();
    await page.getByTestId("start-guided-tour").click();
    await expect(page.getByTestId("tour-picker-handoff-modes")).toHaveClass(
      /is-done/,
    );
  },
);

test("frames a lesson's practice path and gives back the full field on exit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoSampleEditor(page);
  const zoom = page.getByRole("button", { name: "Fit view", exact: true });
  await expect(zoom).toHaveText("100%");
  const frameRequests = await countFramePathRequests(page);
  await openLesson(page, "Handoff Modes");
  await expect
    .poll(async () => parseInt(await zoom.innerText()))
    .toBeGreaterThan(150);
  // The first step frames the path now and again 400 ms later. That second
  // request is not cancelled by leaving, so a quicker exit gets re-framed
  // (an app bug); leave after it, as a learner reading the step would.
  await expect.poll(frameRequests).toBe(2);
  await exitLesson(page);
  await expect(zoom).toHaveText("100%");
});

test("inserts a key chip into the Lib Key field", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?lesson=event-triggers");
  await heading(page, "Slide an event trigger");
  const libKey = page.getByLabel("Lib Key", { exact: true });
  await libKey.fill("");
  await libKey.focus();
  await page
    .getByTestId("tour-card")
    .getByTestId("tour-key-chip")
    .first()
    .click();
  await expect(libKey).toHaveValue("startIntake");
  await expect(libKey).toBeFocused();
  expect(
    (await practice(page)).path.path_elements.find(
      (element) => element.type === "event_trigger",
    ),
  ).toMatchObject({ lib_key: "startIntake" });
  // Both keys the lesson asks for are registered before any event uses them.
  expect((await practice(page)).config.gui.event_trigger_keys).toEqual(
    expect.arrayContaining(["startIntake", "stopIntake"]),
  );
});

test("collapses and moves the card without losing the task", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?lesson=event-triggers");
  const card = page.getByTestId("tour-card");
  await expect(page.getByTestId("tour-headline")).toContainText(
    "Slide startIntake along the path",
  );
  await card.getByRole("button", { name: "Collapse lesson card" }).click();
  await expect(card).toHaveClass(/is-collapsed/);
  await expect(page.getByTestId("tour-headline")).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Lesson options" }),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Back" })).toHaveCount(0);
  const collapsed = await requiredBox(card);
  expect(collapsed.height).toBeLessThan(110);
  const handle = await requiredBox(page.getByTestId("tour-card-handle"));
  await page.mouse.move(handle.x + 20, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 420, handle.y + 300, { steps: 8 });
  await page.mouse.up();
  const moved = await requiredBox(card);
  expect(moved.x).toBeGreaterThan(collapsed.x + 350);
  expect(moved.y).toBeGreaterThan(collapsed.y + 250);
  await card.getByRole("button", { name: "Expand lesson card" }).click();
  await expect(card.getByRole("button", { name: "Back" })).toBeVisible();
  expect((await requiredBox(card)).x).toBeCloseTo(moved.x, 0);
});

// The core lessons run once at 1280px, the tighter of the two common desktop
// widths; every step audits that the card fits the viewport.
{
  const [width, height] = [1280, 800];
  test(
    "opens each overview panel and menu at " + width + "px",
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoSampleEditor(page);
      await openLesson(page, "Getting Started");
      const original = await practice(page);
      await heading(page, "The editor at a glance");
      await page.getByTestId("tour-show-me").click();
      await expect(page.getByTestId("tour-spotlight")).toHaveAttribute(
        "data-show-me",
        "tool-rail",
      );
      await expect(page.getByTestId("tour-spotlight")).toHaveAttribute(
        "data-show-me",
        "simulation-transport",
      );
      await advance(page);
      await heading(page, "Sidebar");
      await expect(advanceButton(page)).toHaveCount(0);
      const checklist = page
        .getByTestId("tour-card")
        .getByRole("list", { name: "Requirements" });
      await expect(checklist.locator("li[data-complete=true]")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Toggle inspector", exact: true })
        .click();
      // It opens on Elements, so the first two items are done.
      await expect(checklist.locator("li[data-complete=true]")).toHaveCount(2);
      await page.getByRole("tab", { name: "Elements", exact: true }).click();
      await page.getByRole("tab", { name: "Constraints", exact: true }).click();
      await expect(checklist.locator("li[data-complete=true]")).toHaveCount(3);
      await advance(page);
      await heading(page, "Menus");
      await page.locator('[data-tour="export-menu-entry"]').click();
      await expect(
        page.locator('[data-tour="export-menu-entry"]'),
      ).toHaveAttribute("aria-expanded", "true");
      const fileMenu = page.getByTestId("top-menu-project");
      await expect(fileMenu.getByRole("menuitem").first()).toHaveText("Home");
      await expect(fileMenu.getByRole("menuitem").nth(1)).toHaveText(
        "New Path",
      );
      await expect(fileMenu.getByRole("menuitem").last()).toHaveText(
        "Settings",
      );
      await expect(advanceButton(page)).toHaveCount(0);
      await page.locator('[data-tour="path-menu-entry"]').click();
      await expect(
        page.locator('[data-tour="path-menu-entry"]'),
      ).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.getByTestId("top-menu-path").getByRole("menuitem"),
      ).toHaveText([
        "Save Path As...",
        "Rename Path...",
        "Delete Paths...",
        "Delete Path Groups...",
        "Linked Elements...",
      ]);
      await advance(page);
      await heading(page, "Path dropdown");
      await page
        .getByRole("button", { name: "Toolbar path", exact: true })
        .click();
      await expect(
        page.getByRole("listbox", {
          name: "Toolbar path options",
          exact: true,
        }),
      ).toBeVisible();
      await advance(page);
      await heading(page, "Path Groups");
      await page
        .getByRole("button", { name: "Open project navigator", exact: true })
        .click();
      const navigator = page.locator('[data-tour="project-navigator"]');
      await expect(navigator).toBeVisible();
      await expect(
        navigator.getByText("Top Side Auto", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Close project navigator", exact: true })
        .click();
      await expect(navigator).toBeHidden();
      await expect(page.getByTestId("tour-card")).toBeVisible();
      expect((await practice(page)).path).toEqual(original.path);
      await finish(page);
    },
  );

  test(
    "builds and freely explores a route with bumper clearance at " +
      width +
      "px",
    async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height });
      await gotoSampleEditor(page);
      await openLesson(page, "BLine Fundamentals");
      await heading(page, "See a complete path");
      expect(elementCounts((await practice(page)).path)).toEqual({
        waypoint: 2,
        translation: 2,
        rotation: 1,
        event_trigger: 1,
      });
      await playAndInspect(page);
      await advance(page);
      await heading(page, "Place Start and End");
      expect((await practice(page)).path.path_elements).toHaveLength(0);
      await place(page, "Waypoint", 5, 2);
      await place(page, "Waypoint", 15, 2.5);
      await advance(page);
      await heading(page, "Turn a waypoint");
      await setNumber(page, "Rotation (deg)", "-90");
      await playAndInspect(page);
      await lessonOption(page, "Restart step");
      await heading(page, "Turn a waypoint");
      await expect(
        page.getByLabel("Rotation (deg)", { exact: true }),
      ).toHaveValue("0");
      await expect(advanceButton(page)).toHaveCount(0);
      await setNumber(page, "Rotation (deg)", "-90");
      await playAndInspect(page);
      await advance(page);
      await heading(page, "Fix a mistake");
      const card = page.getByTestId("tour-card");
      await expect(card.getByLabel("Keys").locator("kbd")).toHaveText([
        "Delete",
        "⌘Z",
        "Ctrl+Z",
      ]);
      const fixes = card
        .getByRole("list", { name: "Requirements" })
        .locator("li");
      await place(page, "Translation", 10, 4.5);
      await expect(fixes.nth(0)).toHaveAttribute("data-complete", "true");
      await expect(advanceButton(page)).toHaveCount(0);
      await card.focus();
      await page.keyboard.press("ControlOrMeta+z");
      await expect
        .poll(async () => (await practice(page)).path.path_elements.length)
        .toBe(2);
      await expect(fixes.nth(1)).toHaveAttribute("data-complete", "true");
      await advance(page);
      await heading(page, "Route around the obstacle");
      await expect(card.getByLabel("Keys").locator("kbd")).toHaveText([
        "Delete",
        "⌘Z",
      ]);
      // A misplaced extra point can be deleted with the keyboard mid-exercise.
      await place(page, "Translation", 7, 3);
      await page.getByTestId("path-element-row-1").click();
      await page.keyboard.press("Delete");
      await expect
        .poll(async () => (await practice(page)).path.path_elements.length)
        .toBe(2);
      // So does the row's remove button, under the lesson shield.
      await place(page, "Translation", 7, 3);
      await page
        .getByRole("button", { name: /^Remove Translation \d+$/ })
        .click();
      await expect
        .poll(async () => (await practice(page)).path.path_elements.length)
        .toBe(2);
      await page.getByTestId("path-element-row-0").click();
      await place(page, "Translation", 10, 4.5);
      await expect(advanceButton(page)).toHaveCount(0);
      await expect(page.getByTestId("tour-card")).toContainText("Robot clears");
      await setNumber(page, "X (m)", "10.8");
      await setNumber(page, "Y (m)", "6.8");
      await expect(page.getByTestId("tour-card")).toContainText(
        "Robot clears the obstacle — done",
        { timeout: 30_000 },
      );
      await advance(page);
      await heading(page, "Try more route points");
      await page
        .getByRole("button", { name: "Add element", exact: true })
        .click();
      const addMenu = page.getByRole("menu", {
        name: "Add element",
        exact: true,
      });
      await expect(addMenu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(addMenu).toHaveCount(0);
      await heading(page, "Try more route points");
      await place(page, "Waypoint", 12.4, 6.8);
      await place(page, "Translation", 13.5, 5.4);
      expect((await practice(page)).path.path_elements).toHaveLength(5);
      // The closing exploration step ends the lesson.
      await expect(
        page
          .getByTestId("tour-card")
          .getByRole("button", { name: "Finish", exact: true }),
      ).toBeVisible();
      await page.getByTestId("tour-card").focus();
      await page.keyboard.press("ControlOrMeta+z");
      await expect
        .poll(async () => (await practice(page)).path.path_elements.length)
        .toBe(4);
      // Let any background regeneration settle: it must not erase Redo.
      await expect(page.getByTestId("save-status")).toContainText("Saved");
      await expect(
        page.getByRole("button", { name: "Redo", exact: true }),
      ).toBeEnabled();
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect
        .poll(async () => (await practice(page)).path.path_elements.length)
        .toBe(5);
      // Reordering rows changes the drive order; Undo puts it back.
      const beforeOrder = geometry((await practice(page)).path);
      await page.getByTestId("path-element-row-1").click();
      await page.keyboard.press("Alt+ArrowDown");
      expect(geometry((await practice(page)).path)).not.toEqual(beforeOrder);
      await page.keyboard.press("ControlOrMeta+z");
      expect(geometry((await practice(page)).path)).toEqual(beforeOrder);
      await page
        .getByTestId("tour-card")
        .getByRole("button", { name: "Back", exact: true })
        .click();
      await heading(page, "Route around the obstacle");
      await advance(page);
      await heading(page, "Try more route points");
      expect((await practice(page)).path.path_elements).toHaveLength(5);
      await expect(
        page
          .getByTestId("tour-card")
          .getByRole("button", { name: /Download|Keep a copy/ }),
      ).toHaveCount(0);
      expect((await practice(page)).dirty).toBe(false);
      await finish(page);
    },
  );

  test(
    "animates handoffs on the canvas and preserves manual tuning at " +
      width +
      "px @webkit-canvas",
    async ({ page }) => {
      await page.clock.install();
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height });
      await gotoSampleEditor(page);
      await openLesson(page, "Path Tuning");
      const stage = page.getByTestId("path-stage");
      const canvas = page.getByTestId("path-stage-canvas");
      await heading(page, "Approach the translation");
      await expect(stage).toHaveAttribute(
        "data-lesson-phase",
        "handoff-approach",
      );
      await expect(page.getByTestId("tour-handoff-guide")).toBeVisible();
      await expect(
        page.getByTestId("tour-active-target").locator("line"),
      ).toHaveAttribute("stroke", "#ff5cf4");
      await expect(
        page.getByTestId("tour-current-handoff").locator(":scope > circle"),
      ).toHaveAttribute("stroke", "#ff5cf4");
      await expect(
        page
          .getByTestId("tour-card")
          .getByRole("button", { name: "Replay", exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("tour-active-target")).toHaveAttribute(
        "data-target",
        /Bend|Translation/,
      );
      await expect
        .poll(async () => Number(await stage.getAttribute("data-lesson-time")))
        .toBeGreaterThan(0);
      // Capture rendered frames before playback starts. Remote polling can miss
      // the brief handoff flash entirely on a busy runner.
      const pulse = await canvas.evaluateHandle((element) => {
        const result = { peak: 0 };
        const observer = new MutationObserver(() => {
          if (
            element
              .closest('[data-testid="path-stage"]')
              ?.getAttribute("data-lesson-phase") === "handoff-crossing"
          )
            result.peak = Math.max(
              result.peak,
              Number(element.getAttribute("data-simulation-event-pulse") ?? 0),
            );
        });
        observer.observe(element, {
          attributes: true,
          attributeFilter: ["data-simulation-event-pulse"],
        });
        return { result, stop: () => observer.disconnect() };
      });
      try {
        await advance(page);
        await heading(page, "Cross the handoff radius");
        await expect(stage).toHaveAttribute(
          "data-lesson-phase",
          "handoff-crossing",
        );
        // Advance through the whole animation, including the flash fading out.
        await page.clock.runFor(6_000);
        await expect
          .poll(async () =>
            Number(await stage.getAttribute("data-lesson-zoom")),
          )
          .toBeGreaterThan(1.5);
        await expect(canvas).toHaveAttribute(
          "data-simulation-event-pulse",
          "0.000",
        );
        await expect
          .poll(() => pulse.evaluate(({ result }) => result.peak))
          .toBeGreaterThan(0.1);
      } finally {
        await pulse.evaluate(({ stop }) => stop());
        await pulse.dispose();
      }
      await expect(page.getByTestId("tour-active-target")).toHaveAttribute(
        "data-target",
        "End",
        { timeout: 15_000 },
      );
      await page
        .getByTestId("tour-card")
        .getByRole("button", { name: "Replay", exact: true })
        .click();
      await expect(page.getByTestId("tour-active-target")).toHaveAttribute(
        "data-target",
        "Bend",
      );
      const closeZoom = Number(await stage.getAttribute("data-lesson-zoom"));
      await advance(page);
      await heading(page, "Target the next element");
      await expect(stage).toHaveAttribute(
        "data-lesson-phase",
        "handoff-departure",
      );
      await expect
        .poll(async () => Number(await stage.getAttribute("data-lesson-zoom")))
        .toBeLessThan(closeZoom);
      await expect(
        page.getByRole("dialog", { name: "Compare runs", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Compare runs", exact: true }),
      ).toHaveCount(0);
      await advance(page);
      await heading(page, "Lower acceleration makes a wider turn");
      expect(
        (await practice(page)).path.constraints
          .max_acceleration_meters_per_sec2,
      ).toBe(0.6);
      await expect
        .poll(async () => Number(await stage.getAttribute("data-lesson-time")))
        .toBeGreaterThan(0.5);
      await advance(page);
      // The tuning route arrives with Open Constraints, its points locked.
      await heading(page, "Open Constraints");
      const rectangle = (await practice(page)).path;
      expect(geometry(rectangle)).toEqual([
        { type: "waypoint", x: 6, y: 7.6, rotation: 0 },
        { type: "translation", x: 12.3, y: 7.6 },
        { type: "translation", x: 12.3, y: 4.5 },
        { type: "translation", x: 12.3, y: 1.4 },
        { type: "waypoint", x: 6, y: 1.4, rotation: 0 },
      ]);
      expect(hasGeneratedValues(rectangle)).toBe(false);
      await page.clock.runFor(900);
      expect(hasGeneratedValues((await practice(page)).path)).toBe(false);
      await dragField(page, [12.3, 4.5], [14, 5]);
      await page.getByTestId("tour-card").focus();
      await page.keyboard.press("Delete");
      await page.keyboard.press("ControlOrMeta+d");
      expect(geometry((await practice(page)).path)).toEqual(
        geometry(rectangle),
      );
      await lessonOption(page, "Restart step");
      expect(geometry((await practice(page)).path)).toEqual(
        geometry(rectangle),
      );
      expect(hasGeneratedValues((await practice(page)).path)).toBe(false);
      await page.getByRole("tab", { name: "Constraints", exact: true }).click();
      await advance(page);
      await heading(page, "Find a speed limit");
      await expect(
        page.locator('[data-tour="max-velocity-card"]').getByRole("status"),
      ).toHaveText("Not generated");
      await selectSpeed(page, 3);
      expect((await practice(page)).selection).toMatchObject({
        key: "max_velocity_meters_per_sec",
        startOrdinal: 3,
        endOrdinal: 3,
      });
      await advance(page);
      await heading(page, "Generate starting values");
      expect(hasGeneratedValues((await practice(page)).path)).toBe(false);
      await generate(page);
      await advance(page);
      await heading(page, "Play the generated path");
      await playAndInspect(page);
      await advance(page);
      await heading(page, "Make a radius Manual");
      // Another point’s radius is a near miss: the task names Intermediate.
      await page.getByTestId("handoff-radius-chip-1").click();
      await page
        .getByRole("group", { name: "Handoff distance source", exact: true })
        .getByRole("button", { name: "Manual", exact: true })
        .click();
      await expect(page.getByTestId("tour-card")).toContainText(
        "That’s another point’s radius",
      );
      await expect(advanceButton(page)).toHaveCount(0);
      await page.getByTestId("handoff-radius-chip-2").click();
      await page
        .getByRole("group", { name: "Handoff distance source", exact: true })
        .getByRole("button", { name: "Manual", exact: true })
        .click();
      await setNumber(page, "Handoff distance 3 (m)", "0.4");
      await advance(page);
      await heading(page, "Make a speed limit Manual");
      await selectSpeed(page, 4);
      await page
        .getByRole("group", { name: "Velocity constraint mode", exact: true })
        .getByRole("button", { name: "Manual", exact: true })
        .click();
      const value = page.getByLabel(/^Constraint \d+ value$/);
      await value.fill("1.1");
      await value.press("Enter");
      await advance(page);
      await heading(page, "Explore radii and speed limits");
      await generate(page);
      const manual = (await practice(page)).path;
      expect(manual.path_elements[2]).toMatchObject({
        intermediate_handoff_radius_meters: 0.4,
        handoff_radius_source: "manual",
      });
      const cap = manual.ranged_constraints.find(
        (constraint) =>
          constraint.key === "max_velocity_meters_per_sec" &&
          constraint.start_ordinal <= 4 &&
          constraint.end_ordinal >= 4,
      );
      expect(cap?.value).toBe(1.1);
      expect(cap?.source).not.toBe("auto_velocity");
      expect(geometry(manual)).toEqual(geometry(rectangle));
      await playAndInspect(page);
      await finish(page);
    },
  );
}

test("keeps the element type dropdown usable during lessons @webkit-canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "Rotation targets");
  await heading(page, "Add a rotation target");

  const type = page.getByRole("combobox", { name: "Type", exact: true });
  const options = page.getByRole("listbox", { name: "Type options" });
  await type.click();
  await type.press("Home");
  await type.press("Escape");
  await expect(options).toHaveCount(0);
  await heading(page, "Add a rotation target");
  await expect(type).toHaveText("Waypoint");

  await type.click();
  await options
    .getByRole("option", { name: "Translation", exact: true })
    .click();
  await expect(type).toHaveText("Translation");
  await type.press("ArrowDown");
  await type.press("Home");
  await type.press("ArrowDown");
  await type.press("Enter");
  await expect(type).toHaveText("Waypoint");
  await heading(page, "Add a rotation target");
  await page.keyboard.press("Escape");
  await page
    .getByTestId("tour-leave-confirmation")
    .getByRole("button", { name: "Leave lesson", exact: true })
    .click();
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
});

test("moves rotation targets, tests both rotation modes, and shows the fast-turn limit", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "Rotation targets");
  await heading(page, "Add a rotation target");
  expect((await practice(page)).path.ranged_constraints[0].value).toBe(2);
  expect((await practice(page)).path.ranged_constraints[0].source).not.toBe(
    "auto_velocity",
  );
  await place(page, "Rotation", 10, 4.5);
  await advance(page);
  await heading(page, "Move the rotation target");
  await dragField(page, [10, 4.5], [11, 4.5]);
  await expect
    .poll(async () => {
      const target = (await practice(page)).path.path_elements.find(
        (element) => element.type === "rotation",
      );
      return target?.t_ratio ?? 0;
    })
    .toBeGreaterThan(0.55);
  await setNumber(page, "Rotation Pos (0-1)", "0.3");
  await advance(page);
  await heading(page, "Try a rotation in motion");
  await setNumber(page, "Rotation (deg)", "90");
  await playAndInspect(page);
  await advance(page);
  await heading(page, "Try Profiled Rotation");
  await page.getByLabel("Profiled Rotation", { exact: true }).uncheck();
  await playAndInspect(page);
  await advance(page);
  await heading(page, "When translation is too fast");
  const fast = (await practice(page)).path;
  expect(fast.path_elements).toHaveLength(3);
  expect(fast.path_elements[1]).toMatchObject({
    type: "rotation",
    rotation_radians: Math.PI,
    t_ratio: 0.5,
  });
  expect(fast.ranged_constraints[0].value).toBe(6);
  expect(fast.ranged_constraints[0].source).not.toBe("auto_velocity");
  await playAndInspect(page);
  await page.getByRole("button", { name: /^Path health/ }).click();
  const health = page.getByRole("dialog", { name: "Path health", exact: true });
  await expect(health).toContainText(/rotation|turn/i);
  await expect(health).not.toContainText("Preview tracking");
  await advance(page);
  await heading(page, "Give the turn enough time");
  await selectSpeed(page, 2);
  const value = page.getByLabel(/^Constraint \d+ value$/);
  await value.fill("1");
  await value.press("Enter");
  await playAndInspect(page);
  await finish(page);
});

test("slides an event and creates the requested key on a different segment @webkit-canvas", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSampleEditor(page);
  await openLesson(page, "Event triggers");
  await heading(page, "Slide an event trigger");
  await dragField(page, [6.8, 3.8], [7.4, 4.4]);
  await expect
    .poll(async () => {
      const event = (await practice(page)).path.path_elements.find(
        (element) => element.type === "event_trigger",
      );
      return event?.t_ratio ?? 0;
    })
    .toBeGreaterThan(0.55);
  await setNumber(page, "Event Pos (0-1)", "0.35");
  await advance(page);
  await heading(page, "Watch the event fire");
  const eventPulse = page.waitForFunction(
    () =>
      document
        .querySelector(".tour-event-cue")
        ?.textContent?.includes("startIntake"),
    undefined,
    { polling: "raf", timeout: 15_000 },
  );
  await page
    .getByRole("button", { name: "Play simulation", exact: true })
    .click();
  await eventPulse;
  await expect(advanceButton(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("simulation-time")).toHaveText(
    /^(\d+\.\d+) \/ \1 s$/,
  );
  await advance(page);
  await heading(page, "Add an event on the next stretch");
  // The previous step ended at End; this exercise starts from the beginning,
  // and placing an element must not jump the play bar back to End.
  await expect(page.getByTestId("simulation-time")).toHaveText(/^0\.00 \//);
  await place(page, "Event", 12.6, 3.9);
  await expect(page.getByTestId("simulation-time")).toHaveText(/^0\.00 \//);
  await setNumber(page, "Event Pos (0-1)", "0.6");
  const key = page.getByLabel("Lib Key", { exact: true });
  await key.fill("wrongKey");
  await key.press("Tab");
  await expect(advanceButton(page)).toHaveCount(0);
  await key.fill("stopIntake");
  await key.press("Tab");
  await advance(page);
  await heading(page, "Try both events");
  const elements = (await practice(page)).path.path_elements;
  expect(elements.map((element) => element.type)).toEqual([
    "waypoint",
    "event_trigger",
    "translation",
    "event_trigger",
    "waypoint",
  ]);
  expect(elements[3]).toMatchObject({ lib_key: "stopIntake", t_ratio: 0.6 });
  await playAndInspect(page);
  await finish(page);
});

test("restores the user's path, field, tab, and clean practice on reopening", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);
  const before = await practice(page);
  const fieldBefore = await activeFieldLabel(page);
  const statusBefore = await page
    .getByTestId("current-path-status")
    .innerText();
  await openLesson(page, "Rotation targets");
  expect((await practice(page)).hasPersistence).toBe(false);
  await place(page, "Rotation", 10, 4.5);
  await advance(page);
  await setNumber(page, "Rotation Pos (0-1)", "0.3");
  const editedPath = (await practice(page)).path;
  const options = page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Lesson options", exact: true });
  const restart = () => lessonOption(page, "Restart lesson");
  await restart();
  const confirmation = page.getByRole("alertdialog", {
    name: "Restart this lesson?",
    exact: true,
  });
  await expect(confirmation).toContainText("resets your practice edits");
  await expect(
    confirmation.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  expect((await practice(page)).path).toEqual(editedPath);
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await heading(page, "Move the rotation target");
  await expect(options).toBeFocused();
  await restart();
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect((await practice(page)).path).toEqual(editedPath);
  await restart();
  await page
    .getByRole("alertdialog", { name: "Restart this lesson?", exact: true })
    .getByRole("button", { name: "Restart lesson", exact: true })
    .click();
  await heading(page, "Add a rotation target");
  expect((await practice(page)).path.path_elements).toHaveLength(2);
  await exitLesson(page);
  expect((await practice(page)).path).toEqual(before.path);
  await expect(
    page.getByRole("tab", { name: "Constraints", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => activeFieldLabel(page)).toBe(fieldBefore);
  await expect(page.getByTestId("current-path-status")).toHaveText(
    statusBefore,
  );
  await openLesson(page, "Rotation targets");
  await heading(page, "Add a rotation target");
  expect((await practice(page)).path.path_elements).toHaveLength(2);
  await expect(page.getByLabel("Simulation time", { exact: true })).toHaveValue(
    "0",
  );
  await exitLesson(page);
  await page.reload();
  await dismissMobileSupportWarning(page);
  const library = await openPathLibraryDialog(page);
  await expect(
    library.getByText("Lesson practice", { exact: true }),
  ).toHaveCount(0);
});

test("exports and imports an autos folder inside the web lesson", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await disableDirectoryPicker(page);
  await gotoSampleEditor(page);
  const before = await practice(page);
  const tempRoot = await mkdtemp(join(tmpdir(), "bline-lesson-autos-"));
  try {
    await openLesson(page, "Importing and Exporting");
    await heading(page, "Export an autos folder");
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Export to Robot...", exact: true })
      .click();
    const robotExport = page.getByRole("dialog", { name: "Export to robot" });
    await expect(robotExport).toContainText("autos.zip");
    // Escape belongs to the export dialog, not the lesson.
    await page.keyboard.press("Escape");
    await expect(robotExport).toHaveCount(0);
    await expect(page.getByTestId("tour-leave-confirmation")).toHaveCount(0);
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Export to Robot...", exact: true })
      .click();
    const downloading = page.waitForEvent("download");
    await robotExport
      .getByRole("button", { name: "Download autos.zip", exact: true })
      .click();
    const download = await downloading;
    await robotExport
      .getByRole("button", { name: "Done", exact: true })
      .click();
    expect(download.suggestedFilename()).toBe("autos.zip");
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error("Expected the exported autos ZIP");
    const entries = parseStoredZip(await readFile(downloadPath));
    expect([...entries.keys()].sort()).toEqual([
      "autos/config.json",
      "autos/paths/score-to-pickup.json",
      "autos/paths/start-to-score.json",
      "autos/project.json",
    ]);
    expect(
      requiredZipText(entries, "autos/paths/start-to-score.json"),
    ).toContain("prepareScore");
    expect(
      JSON.parse(requiredZipText(entries, "autos/project.json")).path_groups,
    ).toHaveLength(1);
    for (const [relativePath, text] of entries) {
      const destination = join(tempRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, text);
    }
    await advance(page);
    await heading(page, "Import the autos folder");
    const chooseFolder = async (folder: string) => {
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "Import / Export", exact: true })
        .click();
      const choosing = page.waitForEvent("filechooser");
      await page
        .getByRole("menuitem", { name: "Import Autos Folder...", exact: true })
        .click();
      await (await choosing).setFiles(folder);
    };
    // A failed practice import is explained in the lesson card.
    const notes = join(tempRoot, "notes");
    await mkdir(notes);
    await writeFile(join(notes, "readme.txt"), "not an autos folder");
    await chooseFolder(notes);
    await expect(page.getByTestId("tour-card")).toContainText(
      "That didn’t import: The selected folder does not contain any JSON files.",
    );
    await expect(page.getByTestId("save-status")).not.toContainText(/error/i);
    // Choosing the folder that holds an unzipped "autos 3" finds it.
    await rm(notes, { recursive: true });
    await rename(join(tempRoot, "autos"), join(tempRoot, "autos 3"));
    await chooseFolder(tempRoot);
    await advance(page);
    await heading(page, "Check the imported paths");
    await selectToolbarOption(page, "Toolbar path", "Score to Pickup");
    await playAndInspect(page);
    await advance(page);
    await heading(page, "Save changes for your robot");
    await expect(page.getByTestId("tour-card")).toContainText(
      "Export to Robot again",
    );
    await finish(page);
    expect((await practice(page)).path).toEqual(before.path);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("discards a lesson folder choice after the lesson exits @webkit-canvas", async ({
  page,
}) => {
  await disableDirectoryPicker(page);
  await gotoSampleEditor(page);
  const before = await practice(page);
  const folder = await mkdtemp(join(tmpdir(), "bline-late-lesson-import-"));
  try {
    await mkdir(join(folder, "paths"));
    await writeFile(join(folder, "config.json"), "{}");
    await writeFile(
      join(folder, "paths", "late-choice.json"),
      JSON.stringify({
        path_elements: [
          { type: "translation", x_meters: 1, y_meters: 2 },
          { type: "translation", x_meters: 3, y_meters: 4 },
        ],
      }),
    );
    await openLesson(page, "Importing and Exporting");
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Import / Export", exact: true })
      .click();
    const downloading = page.waitForEvent("download");
    await page
      .getByRole("menuitem", { name: "Export Autos Folder...", exact: true })
      .click();
    await downloading;
    await advance(page);
    await heading(page, "Import the autos folder");
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Import / Export", exact: true })
      .click();
    const choosing = page.waitForEvent("filechooser");
    await page
      .getByRole("menuitem", { name: "Import Autos Folder...", exact: true })
      .click();
    const chooser = await choosing;
    await exitLesson(page);
    await chooser.setFiles(folder);
    // Import-dependent commands become available only after the handler settles.
    await page.getByRole("button", { name: "File", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "Home", exact: true }),
    ).toBeEnabled();
    expect((await practice(page)).path).toEqual(before.path);
    await expect(page.getByTestId("current-path-status")).not.toContainText(
      "late choice",
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("practice export never touches the remembered robot project", async ({
  page,
}) => {
  // Real folder handles from the origin private file system stand in for the
  // picker, so the remembered robot project survives in IndexedDB as it would.
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle(
          localStorage.getItem("bline-test-pick") ?? "robot",
          { create: true },
        ),
    });
  });
  await gotoSampleEditor(page);
  await page.evaluate(async () => {
    let folder = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("robot", { create: true });
    for (const name of ["src", "main", "deploy"])
      folder = await folder.getDirectoryHandle(name, { create: true });
  });
  const robotProjectFile = () =>
    page.evaluate(async () => {
      let folder = await navigator.storage.getDirectory();
      for (const name of ["robot", "src", "main", "deploy", "autos"])
        folder = await folder.getDirectoryHandle(name);
      return (
        await (await folder.getFileHandle("project.json")).getFile()
      ).text();
    });
  const dialog = page.getByRole("dialog", { name: "Export to robot" });
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Export to Robot...", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Choose robot project…", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const realProject = await robotProjectFile();

  await page.evaluate(() => localStorage.setItem("bline-test-pick", "spare"));
  await openLesson(page, "Importing and Exporting");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Export to Robot...", exact: true })
    .click();
  await expect(dialog).toContainText("spare folder");
  await expect(dialog).not.toContainText("deploy/autos");
  await dialog
    .getByRole("button", { name: "Choose folder…", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("tour-card")).toContainText("Autos exported.");
  expect(await robotProjectFile()).toBe(realProject);
  await exitLesson(page);

  // Outside the lesson the robot project is still the remembered one.
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Export to Robot...", exact: true })
    .click();
  await expect(dialog).toContainText("robot/src/main/deploy/autos");
});

test("keeps project commands off during the web transfer lesson", async ({
  page,
}) => {
  await disableDirectoryPicker(page);
  await gotoSampleEditor(page);
  await openLesson(page, "Importing and Exporting");
  const file = page.getByRole("button", { name: "File", exact: true });
  const item = (name: string) =>
    page.getByRole("menuitem", { name, exact: true });
  await file.click();
  await expect(item("Home")).toBeDisabled();
  await expect(item("New Path")).toBeDisabled();
  await expect(item("Export to Robot...")).toBeEnabled();
  await item("Workspace").click();
  await expect(item("New Project")).toBeDisabled();
  await expect(item("Delete Projects...")).toBeDisabled();
  await item("Import / Export").click();
  await expect(item("Import Autos Folder...")).toBeEnabled();
  await expect(item("Import Autos ZIP...")).toBeEnabled();
  await expect(item("Import Project Archive...")).toBeDisabled();
  await expect(item("Import Path...")).toBeDisabled();
  await item("Recent Projects").click();
  for (const recent of await page
    .locator('[data-testid="top-menu-project-recent"] .top-menu__project')
    .all())
    await expect(recent).toBeDisabled();
});

test("accepts autos.zip directly in the web transfer lesson", async ({
  page,
}) => {
  await disableDirectoryPicker(page);
  await gotoSampleEditor(page);
  await openLesson(page, "Importing and Exporting");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Export to Robot...", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Export to robot" });
  const downloading = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Download autos.zip", exact: true })
    .click();
  const zip = await (await downloading).path();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await advance(page);
  await heading(page, "Import the autos folder");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Import / Export", exact: true })
    .click();
  const choosing = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", { name: "Import Autos ZIP...", exact: true })
    .click();
  await (await choosing).setFiles(zip!);
  await advance(page);
  await heading(page, "Check the imported paths");
});

test("keeps the lesson card off the tool rail and most of the route", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSampleEditor(page);
  await openLesson(page, "Event triggers");
  const placement = () =>
    page.evaluate(() => {
      const card = document
        .querySelector('[data-testid="tour-card"]')!
        .getBoundingClientRect();
      const canvas = document.querySelector<HTMLElement>(
        '[data-tour="path-canvas"]',
      )!;
      const host = canvas
        .querySelector(".path-stage__canvas")!
        .getBoundingClientRect();
      const route = canvas.dataset
        .pathAnchors!.split(";")
        .map((pair) => pair.split(",").map(Number))
        .map(([x, y]) => ({ x: host.left + x, y: host.top + y }));
      let hidden = 0;
      let total = 0;
      for (let index = 1; index < route.length; index += 1) {
        const from = route[index - 1];
        const to = route[index];
        for (let step = 0; step <= 50; step += 1) {
          const x = from.x + ((to.x - from.x) * step) / 50;
          const y = from.y + ((to.y - from.y) * step) / 50;
          total += 1;
          if (
            x >= card.left &&
            x <= card.right &&
            y >= card.top &&
            y <= card.bottom
          )
            hidden += 1;
        }
      }
      const rail = document
        .querySelector(".canvas-tool-rail")!
        .getBoundingClientRect();
      return {
        mostlyVisible: hidden / total < 0.25,
        railClear:
          rail.right <= card.left ||
          rail.left >= card.right ||
          rail.bottom <= card.top ||
          rail.top >= card.bottom,
      };
    });
  await expect
    .poll(placement)
    .toEqual({ mostlyVisible: true, railClear: true });
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Lesson options", exact: true })
    .waitFor();
  // The checklist step's taller card still leaves the route visible.
  await page.evaluate(async () => {
    const { tourStore }: typeof import("../../src/ui/tours/tourStore") =
      await import(/* @vite-ignore */ "/src/ui/tours/tourStore.ts" as string);
    const state = tourStore.getState();
    state.next(4);
    state.next(4);
  });
  await heading(page, "Add an event on the next stretch");
  await expect
    .poll(placement)
    .toEqual({ mostlyVisible: true, railClear: true });
});

test("Show me points at the next action and follows progress", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?lesson=event-triggers");
  await heading(page, "Slide an event trigger");
  await page.evaluate(async () => {
    const { tourStore }: typeof import("../../src/ui/tours/tourStore") =
      await import(/* @vite-ignore */ "/src/ui/tours/tourStore.ts" as string);
    tourStore.getState().next(4);
    tourStore.getState().next(4);
  });
  await heading(page, "Add an event on the next stretch");
  const spotlight = page.getByTestId("tour-spotlight");
  await page.getByTestId("tour-show-me").click();
  await expect(spotlight).toHaveAttribute("data-show-me", "tool-event");
  await expect(page.getByTestId("tour-ghost")).toHaveCount(1);
  await page.getByRole("button", { name: "Event tool", exact: true }).click();
  // Once the tool is chosen, Show me moves on to the stretch to click.
  await expect(spotlight).toHaveAttribute("data-show-me", "lesson-segment");
  await clickField(page, 12, 4.25);
  await expect(spotlight).toHaveAttribute("data-show-me", "lesson-lib-key");
  const key = page.getByLabel("Lib Key", { exact: true });
  // Pressing Show me again replays it without taking focus from the field.
  await expect(key).toBeFocused();
  await page.getByTestId("tour-show-me").click();
  await expect(key).toBeFocused();
  await key.fill("stopIntake");
  await key.press("Tab");
  await expect(spotlight).toHaveAttribute("data-show-me", "lesson-event-pos");
  await setNumber(page, "Event Pos (0-1)", "0.6");
  await expect(advanceButton(page)).toBeVisible();
  // A finished step points at nothing, not at the tool it started with.
  await expect(page.getByTestId("tour-ghost")).toHaveCount(0);
  await expect(spotlight).toHaveCount(0);

  // A speed limit is found by the stretch it covers, outlined on the canvas.
  await page.goto("/?lesson=path-tuning");
  await heading(page, "Approach the translation");
  await page.evaluate(async () => {
    const { tourStore }: typeof import("../../src/ui/tours/tourStore") =
      await import(/* @vite-ignore */ "/src/ui/tours/tourStore.ts" as string);
    for (let step = 0; step < 5; step += 1) tourStore.getState().next(11);
  });
  await heading(page, "Find a speed limit");
  await expect(page.getByTestId("tour-show-me")).toBeVisible();
  await page.getByTestId("tour-show-me").click();
  await expect(spotlight).toHaveAttribute("data-show-me", "lesson-speed-3");
  await expect(page.getByTestId("tour-spotlight-echo")).toBeVisible();
  await selectSpeed(page, 1);
  await expect(page.getByTestId("tour-card")).toContainText(
    "The first one is the drive to Start",
  );
  await selectSpeed(page, 3);
  await expect(advanceButton(page)).toBeVisible();
  await expect(spotlight).toHaveCount(0);
});

test("Show me keeps open menus and walks multi-part steps", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const jump = async (lesson: string, steps: number) => {
    await page.goto(`/?lesson=${lesson}`);
    await expect(page.getByTestId("tour-card")).toBeVisible();
    await page.evaluate(async (steps) => {
      const { tourStore }: typeof import("../../src/ui/tours/tourStore") =
        await import(/* @vite-ignore */ "/src/ui/tours/tourStore.ts" as string);
      for (let step = 0; step < steps; step += 1) tourStore.getState().next(99);
    }, steps);
  };
  const spotlight = page.getByTestId("tour-spotlight");

  // An open submenu stays open when the learner asks for help.
  await jump("import-export", 1);
  await heading(page, "Import the autos folder");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Import / Export", exact: true })
    .hover();
  const importFolder = page.getByRole("menuitem", {
    name: "Import Autos Folder...",
  });
  await expect(importFolder).toBeVisible();
  await page.getByTestId("tour-show-me").click();
  await expect(importFolder).toBeVisible();
  await expect(spotlight).toHaveAttribute(
    "data-show-me",
    "text:Import Autos Folder...",
  );

  // Cell, then Manual, then the value.
  await jump("path-tuning", 9);
  await heading(page, "Make a speed limit Manual");
  await page.getByTestId("tour-show-me").click();
  await expect(spotlight).toHaveAttribute(
    "data-show-me",
    "label:Velocity constraint mode",
  );
  await page
    .getByRole("group", { name: "Velocity constraint mode", exact: true })
    .getByRole("button", { name: "Manual", exact: true })
    .click();
  await expect(spotlight).toHaveAttribute(
    "data-show-me",
    "label:Constraint * value",
  );
  await expect(page.getByTestId("tour-card")).toContainText(
    "It’s Manual. Now change its value.",
  );
  await expect(advanceButton(page)).toHaveCount(0);
  const value = page.getByLabel(/^Constraint \d+ value$/);
  await value.fill("1.2");
  await value.press("Enter");
  await expect(advanceButton(page)).toBeVisible();
  // A property field off screen: select the element first, then the field.
  await jump("rotation-targets", 0);
  await place(page, "Rotation", 10, 4.5);
  await page.evaluate(async () => {
    const { tourStore }: typeof import("../../src/ui/tours/tourStore") =
      await import(/* @vite-ignore */ "/src/ui/tours/tourStore.ts" as string);
    tourStore.getState().next(6);
    tourStore.getState().next(6);
  });
  await heading(page, "Try a rotation in motion");
  await page.evaluate(async () => {
    const { selectionStore }: typeof import("../../src/state/selectionStore") =
      await import(/* @vite-ignore */ "/src/state/selectionStore.ts" as string);
    selectionStore.getState().clearSelection();
  });
  await expect(page.getByLabel("Rotation (deg)", { exact: true })).toHaveCount(
    0,
  );
  await page.getByTestId("tour-show-me").click();
  // It points at the element's sidebar row, visible wherever the element is.
  await expect(spotlight).toHaveAttribute(
    "data-show-me",
    "testid:path-element-row-1",
  );
  await page.getByTestId("path-element-row-1").click();
  await expect(spotlight).toHaveAttribute(
    "data-show-me",
    "label:Rotation (deg)",
  );
});

test("docks the sidebar beside the canvas in a narrow window", async ({
  page,
}) => {
  // No drawer over the canvas at any width: the sidebar takes its own column.
  await page.setViewportSize({ width: 1028, height: 794 });
  await page.goto("/?lesson=rotation-targets");
  await heading(page, "Add a rotation target");
  const canvas = await requiredBox(page.locator('[data-tour="path-canvas"]'));
  const sidebar = await requiredBox(page.locator(".inspector-sidebar"));
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(sidebar.x + 1);
  await expect
    .poll(() =>
      page
        .locator('[data-tour="path-canvas"]')
        .getAttribute("data-path-rect")
        .then((rect) => {
          const [x, , width] = (rect ?? "").split(",").map(Number);
          return x + width;
        }),
    )
    .toBeLessThan(canvas.width);
  await page
    .getByRole("button", { name: "Rotation tool", exact: true })
    .click();
  const segment = await requiredBox(
    page.locator('[data-tour="lesson-segment"]'),
  );
  await page.mouse.click(
    segment.x + segment.width / 2,
    segment.y + segment.height / 2,
  );
  await expect(advanceButton(page)).toBeVisible();
});

test("going back after resuming a lesson restores that step's path", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "BLine Fundamentals");
  await heading(page, "See a complete path");
  expect((await practice(page)).path.path_elements).toHaveLength(6);
  await page.evaluate(async () => {
    const { tourStore }: typeof import("../../src/ui/tours/tourStore") =
      await import(/* @vite-ignore */ "/src/ui/tours/tourStore.ts" as string);
    tourStore.getState().next(6);
  });
  await heading(page, "Place Start and End");
  await exitLesson(page);
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-resume").click();
  await heading(page, "Place Start and End");
  expect((await practice(page)).path.path_elements).toHaveLength(0);
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Back", exact: true })
    .click();
  // The finished example to play is back, not the emptied later step.
  await heading(page, "See a complete path");
  expect((await practice(page)).path.path_elements).toHaveLength(6);
});

test("Fix a mistake explains a deleted Start and going back keeps the learner's route", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "BLine Fundamentals");
  await heading(page, "See a complete path");
  const next = () =>
    page.evaluate(async () => {
      const { tourStore }: typeof import("../../src/ui/tours/tourStore") =
        await import(/* @vite-ignore */ "/src/ui/tours/tourStore.ts" as string);
      tourStore.getState().next(6);
    });
  await next();
  await heading(page, "Place Start and End");
  // Stand in for the learner's own Start and End.
  await page.evaluate(async () => {
    const { projectStore }: typeof import("../../src/state/projectStore") =
      await import(/* @vite-ignore */ "/src/state/projectStore.ts" as string);
    const { createFundamentalsDemoPath } = await import(
      /* @vite-ignore */ "/src/ui/tours/courseScenarios.ts" as string
    );
    const demo = createFundamentalsDemoPath();
    const route = {
      ...demo,
      path_elements: demo.path_elements.filter(
        (element: { type: string }) => element.type === "waypoint",
      ),
    };
    const state = projectStore.getState();
    projectStore.setState({
      project: {
        ...state.project!,
        paths: state.project!.paths.map((path) =>
          path.path_id === state.activePathId ? { ...path, path: route } : path,
        ),
      },
    });
  });
  await next();
  await heading(page, "Turn a waypoint");
  await next();
  await heading(page, "Fix a mistake");
  // Start is selected so new points go after it. Deleting it by mistake
  // says how to get it back.
  await page.getByTestId("path-element-row-0").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("tour-card")).toContainText(
    "That removed Start or End.",
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await practice(page)).path.path_elements.length)
    .toBe(2);
  await expect(page.getByTestId("tour-card")).not.toContainText(
    "That removed Start or End.",
  );

  await exitLesson(page);
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-resume").click();
  await heading(page, "Fix a mistake");
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Back", exact: true })
    .click();
  // The learner's Start and End, not step 2's empty field.
  await heading(page, "Turn a waypoint");
  expect((await practice(page)).path.path_elements).toHaveLength(2);
});

test("Space after a finished lesson plays the path, not the next lesson", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openLesson(page, "Event triggers");
  await heading(page, "Slide an event trigger");
  await page.evaluate(async () => {
    const { tourStore }: typeof import("../../src/ui/tours/tourStore") =
      await import(/* @vite-ignore */ "/src/ui/tours/tourStore.ts" as string);
    for (let step = 0; step < 3; step += 1) tourStore.getState().next(4);
  });
  await heading(page, "Try both events");
  await finish(page, { keepRecap: true });
  const recap = page.getByTestId("tour-recap");
  await page.keyboard.press(" ");
  await expect(
    page.getByRole("button", { name: "Pause simulation", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
  await expect(recap).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(recap).toHaveCount(0);
});

test("walks Current-pose Starts from dragging the ghost to Play", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSampleEditor(page);
  await openLesson(page, "Current-pose Starts");
  await heading(page, "Move the preview start");
  await expect(advanceButton(page)).toHaveCount(0);
  // Show me points at the ghost itself.
  await page.getByTestId("tour-show-me").click();
  await expect(page.getByTestId("tour-spotlight")).toHaveAttribute(
    "data-show-me",
    "lesson-start-pose",
  );
  await dragField(page, [3, 3], [4.5, 2]);
  await expect(page.getByTestId("tour-card")).toContainText(
    "The preview now starts there.",
  );
  await advance(page);
  await heading(page, "Try the path");
  await playAndInspect(page);
  await advance(page);
  await heading(page, "What reaches the robot");
  await finish(page);
});

test("Escape in a lesson text field cancels the edit, not the lesson", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openLesson(page, "Lib Keys");
  await page.locator('[data-tour="settings-nav-event-triggers"]').click();
  await advance(page);
  await heading(page, "Register a Lib Key");
  await page
    .locator('[data-tour="settings-event-triggers"]')
    .getByRole("button", { name: /add/i })
    .first()
    .click();
  const field = page.getByLabel("New Lib Key", { exact: true });
  await field.fill("stop");
  await field.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(page.getByTestId("tour-leave-confirmation")).toHaveCount(0);
  await heading(page, "Register a Lib Key");
});

test("uses desktop folder menus and direct-saving guidance in the desktop lesson", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSampleEditor(page);
  // Model the shell after browser storage starts. This exercises the desktop
  // lesson UI without pretending to test the native filesystem bridge.
  await page.evaluate(async () => {
    const { tours }: typeof import("../../src/ui/tours/tours") = await import(
      /* @vite-ignore */ "/src/ui/tours/tours.ts" as string
    );
    const {
      createImportExportTour,
    }: typeof import("../../src/ui/tours/importExportLesson") = await import(
      /* @vite-ignore */ "/src/ui/tours/importExportLesson.ts" as string
    );
    Object.assign(
      tours.find((tour) => tour.id === "import-export")!,
      createImportExportTour("tauri"),
    );
    (window as Window & { isTauri?: boolean }).isTauri = true;
  });
  await openLesson(page, "Importing and Exporting");
  await heading(page, "Open an autos folder on desktop");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Folder", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Open Project Folder...", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", {
      name: "Create Project Folder...",
      exact: true,
    }),
  ).toBeVisible();
  await advance(page);
  await heading(page, "Edit a path in the folder");
  await setNumber(page, "X (m)", "11.2");
  await advance(page);
  await heading(page, "Preview before deploying");
  await expect(page.getByTestId("tour-card")).toContainText(
    "edits save straight to the open folder",
  );
  await playAndInspect(page);
  await advance(page);
  await heading(page, "Use the folder in your robot project");
  await finish(page);
});

test("keeps the docked Navigator usable in lessons without changing saved preferences @webkit-canvas", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoSampleEditor(page);
  const original = await practice(page);
  const navigator = await openPathLibraryDialog(page);
  const divider = navigator.getByRole("separator", {
    name: "Resize Project Navigator",
  });
  await divider.focus();
  await divider.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "576");
  await navigator.getByRole("button", { name: "Hide all connections" }).click();

  await page.setViewportSize({ width: 820, height: 800 });
  await openLesson(page, "Path Management");
  await expect(navigator).toBeHidden();
  await selectToolbarOption(page, "Toolbar path", "Top - Score to Pickup");
  await advance(page);
  await openPathLibraryDialog(page);
  await expect(
    navigator.getByRole("button", { name: "Hide all connections" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(navigator.locator(".fc-wire")).toHaveCount(9);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document
          .querySelector('[data-tour="path-canvas"]')!
          .getBoundingClientRect();
        return [...document.querySelectorAll(".tour-scrim-region")].some(
          (el) => {
            const box = el.getBoundingClientRect();
            return (
              box.left < canvas.right &&
              box.right > canvas.left &&
              box.top < canvas.bottom &&
              box.bottom > canvas.top
            );
          },
        );
      }),
    )
    .toBe(false);
  await page.getByRole("button", { name: "Close project navigator" }).click();
  await expect(navigator).toBeHidden();
  await openPathLibraryDialog(page);

  await divider.focus();
  await divider.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "400");
  await divider.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "416");
  await divider.press("End");
  await expect(divider).toHaveAttribute("aria-valuenow", "490");
  await expect
    .poll(async () => {
      const pane = await requiredBox(navigator);
      const card = await requiredBox(page.getByTestId("tour-card"));
      return card.x >= pane.x + pane.width + 12;
    })
    .toBe(true);
  const handle = await requiredBox(divider);
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 - 40,
    handle.y + handle.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(divider).toHaveAttribute("aria-valuenow", "450");

  const group = navigator.getByRole("button", {
    name: "Focus Top Side Auto",
    exact: true,
  });
  await group.click();
  await expect(page.getByRole("button", { name: "Toolbar path" })).toHaveText(
    "Top - Score to Pickup",
  );
  await group.dblclick();
  const name = navigator.getByRole("textbox", {
    name: "Path Group name",
    exact: true,
  });
  await name.fill("Practice rename");
  await name.press("Enter");
  await expect(
    navigator.getByRole("button", {
      name: "Focus Practice rename",
      exact: true,
    }),
  ).toBeVisible();
  await navigator.getByRole("button", { name: "Hide all connections" }).click();
  await expect(navigator.locator(".fc-wire")).toHaveCount(0);
  await navigator.getByRole("button", { name: "Show all connections" }).click();
  await expect(navigator.locator(".fc-wire")).toHaveCount(9);
  await page.setViewportSize({ width: 768, height: 800 });
  await divider.focus();
  await divider.press("End");
  await expect(divider).toHaveAttribute("aria-valuenow", "438");
  await auditLayout(page);
  await exitLesson(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await practice(page)).path).toEqual(original.path);
  await expect(navigator).toBeVisible();
  await expect(divider).toHaveAttribute("aria-valuenow", "576");
  await expect(
    navigator.getByRole("button", { name: "Show all connections" }),
  ).toHaveAttribute("aria-pressed", "false");
  await navigator.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Path inspector" }),
  ).toBeVisible();
});

test("organizes an auto and test project into a new Path Group @webkit-canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSampleEditor(page);
  await openLesson(page, "Path Management");
  await heading(page, "Choose a path");
  await selectToolbarOption(page, "Toolbar path", "Top - Score to Pickup");
  await advance(page);
  await heading(page, "Open the Project Navigator");
  const navigator = await openPathLibraryDialog(page);
  await expect(
    navigator.getByText("Top Side Auto", { exact: true }),
  ).toBeVisible();
  await expect(
    navigator.getByText("Bottom Side Auto", { exact: true }),
  ).toBeVisible();
  await expect(navigator.getByText("Testing", { exact: true })).toBeVisible();
  for (const path of [
    "Straight Line Test",
    "Turn Test",
    "Curve Test",
    "Bottom - Start to Score",
    "Bottom - Score to Pickup",
    "Bottom - Pickup to Score",
  ]) {
    await expect(
      navigator.getByRole("button", { name: "Focus " + path, exact: true }),
    ).toBeVisible();
  }
  await auditLayout(page);
  await advance(page);
  await heading(page, "Create a Path Group");
  await navigator
    .getByRole("button", { name: "Create Path Group", exact: true })
    .click();
  const name = navigator.getByRole("textbox", {
    name: "Path Group name",
    exact: true,
  });
  await name.fill("My Auto");
  await name.press("Enter");
  await advance(page);
  await heading(page, "Connect its three paths");
  await navigator
    .getByRole("button", { name: "Focus My Auto", exact: true })
    .click();
  for (const route of [
    "Top - Start to Score",
    "Top - Score to Pickup",
    "Top - Pickup to Score",
  ]) {
    await navigator
      .getByRole("button", { name: "Connect to " + route, exact: true })
      .click();
  }
  await advance(page);
  await heading(page, "Preview the group");
  await navigator
    .getByRole("button", { name: "Focus My Auto", exact: true })
    .click();
  await expect(navigator).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hide Path Group overlays", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await advance(page);
  await heading(page, "Work on one path");
  await selectToolbarOption(page, "Toolbar path", "Top - Pickup to Score");
  await advance(page);
  await heading(page, "Explore your groups");
  await playAndInspect(page);
  await finish(page);
});

test("links one shared waypoint and propagates position and heading to both paths @webkit-canvas", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoSampleEditor(page);
  await openLesson(page, "Linked Elements");
  await heading(page, "See where the paths meet");
  await previewGroup(page, "Score and Pickup");
  await advance(page);
  await heading(page, "Create a linked waypoint");
  await page.getByRole("button", { name: "Link element", exact: true }).click();
  const actions = page.getByRole("group", {
    name: "Linked element actions",
    exact: true,
  });
  await expect(actions).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(actions).toHaveCount(0);
  await heading(page, "Create a linked waypoint");
  await page.getByRole("button", { name: "Link element", exact: true }).click();
  await actions.getByRole("button", { name: /New Linked Waypoint/ }).click();
  await actions
    .getByLabel("Linked element name", { exact: true })
    .fill("Score");
  await actions
    .getByRole("button", { name: "Create & Link", exact: true })
    .click();
  await advance(page);
  await heading(page, "Link the next path's Start");
  await selectToolbarOption(page, "Toolbar path", "Score to Pickup");
  await page.getByTestId("path-element-row-0").click();
  await page.getByRole("button", { name: "Link element", exact: true }).click();
  await actions.getByRole("button", { name: /Choose Existing/ }).click();
  const picker = page.getByRole("dialog", {
    name: "Choose Linked Element",
    exact: true,
  });
  await auditLayout(page);
  await expect(
    picker.getByText("Choose Linked Element", { exact: true }),
  ).toBeVisible();
  if (process.env.BLINE_TOUR_SCREENSHOTS) {
    await page.screenshot({
      path: test.info().outputPath("Linked-element-picker.png"),
    });
  }
  await picker.getByRole("listitem").filter({ hasText: "Score" }).click();
  await picker
    .getByRole("button", { name: "Link Selected", exact: true })
    .click();
  await advance(page);
  await heading(page, "Edit once, update both paths");
  await setNumber(page, "X (m)", "11.2");
  await setNumber(page, "Rotation (deg)", "35");
  await advance(page);
  await heading(page, "Check the other path");
  await selectToolbarOption(page, "Toolbar path", "Start to Score");
  await page.getByTestId("path-element-row-2").click();
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue("11.2");
  await expect(page.getByLabel("Rotation (deg)", { exact: true })).toHaveValue(
    "35",
  );
  await playAndInspect(page);
  await advance(page);
  await heading(page, "Each path keeps its own settings");
  await finish(page);
});

test("keeps linked endpoints aligned and tunes only the final minimum velocity", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "Path Linking");
  await heading(page, "Preview both paths");
  await previewGroup(page, "Pickup and Score");
  await advance(page);
  await heading(page, "Inspect the next Start");
  await clickField(page, 14, 4.9);
  await expect(
    page.getByRole("button", { name: "Toolbar path", exact: true }),
  ).toHaveText("Pickup to Score");
  await page.getByTestId("path-element-row-0").click();
  await expect(page.getByRole("button", { name: /Pickup/ })).toBeVisible();
  await advance(page);
  await heading(page, "Set the speed near End");
  await clickField(page, 6.25, 4.4);
  await expect(
    page.getByRole("button", { name: "Toolbar path", exact: true }),
  ).toHaveText("Start to Pickup");
  await page.getByRole("tab", { name: "Constraints", exact: true }).click();
  await advance(page);
  await heading(page, "Choose the transition speed");
  await page
    .getByRole("button", { name: "Add constraint", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Min Velocity", exact: true })
    .click();
  const minimum = page.getByTestId(
    "constraint-card-min_velocity_meters_per_sec",
  );
  const range = minimum.getByRole("option", {
    name: "Select Min Velocity segment 1",
    exact: true,
  });
  const endCell = minimum.getByTestId(
    "constraint-cell-min_velocity_meters_per_sec-3",
  );
  const from = await requiredBox(range);
  const to = await requiredBox(endCell);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await minimum.getByLabel(/^Constraint \d+ value$/).fill("1.5");
  await minimum.getByLabel(/^Constraint \d+ value$/).press("Enter");
  expect(
    (await practice(page)).path.ranged_constraints.filter(
      (constraint) => constraint.key === "min_velocity_meters_per_sec",
    ),
  ).toEqual([
    expect.objectContaining({ value: 1.5, start_ordinal: 3, end_ordinal: 3 }),
  ]);
  await advance(page);
  await heading(page, "Play the first path");
  await playAndInspect(page);
  await advance(page);
  await heading(page, "Run both paths in robot code");
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Why?", exact: true })
    .click();
  await expect(page.getByTestId("tour-card")).toContainText(
    "your robot code decides which runs next",
  );
  await finish(page);
});

for (const entryPoint of ["Learn panel", "help menu"]) {
  test(`starts a lesson from the home ${entryPoint} without a project and restores home @webkit-canvas`, async ({
    page,
  }) => {
    await page.goto("/");
    await dismissMobileSupportWarning(page);
    const home = page.getByTestId("start-center");
    await expect(home).toBeVisible();
    if (entryPoint === "help menu") {
      await page.getByRole("button", { name: "Help and tutorials" }).click();
      const lessons = page.getByTestId("start-guided-tour");
      await expect(lessons).toBeEnabled();
      await lessons.click();
      await expect(page.getByTestId("help-hub")).toHaveCount(0);
    } else {
      await home.getByTestId("start-center-guided-tour").click();
    }
    await page
      .getByTestId("tour-picker")
      .getByText("Getting Started", { exact: true })
      .click();
    await heading(page, "The editor at a glance");
    await exitLesson(page);
    await expect(home).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "BLine", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("current-path-status")).toContainText(
      "No path",
    );
  });
}

test("keeps lessons available and active in a narrow window @webkit-canvas", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openLesson(page, "Rotation targets");
  await heading(page, "Add a rotation target");
  await page.setViewportSize({ width: 560, height: 720 });
  await heading(page, "Add a rotation target");
  await expect(page.getByTestId("tour-headline")).toBeVisible();
  await exitLesson(page);
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await expect(page.getByTestId("start-guided-tour")).toBeEnabled();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-robot-settings").click();
  await heading(page, "Robot size");
});

async function openLesson(page: Page, title: string) {
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  await page
    .getByTestId("tour-picker")
    .getByText(title, { exact: true })
    .click();
  await expect(page.getByTestId("tour-card")).toBeVisible();
}

async function previewGroup(page: Page, name: string) {
  const navigator = page.getByRole("complementary", {
    name: "Project Navigator",
    exact: true,
  });
  await navigator
    .getByRole("button", { name: "Focus " + name, exact: true })
    .click();
  await expect(navigator).toBeVisible();
}

async function exitLesson(page: Page) {
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Leave lesson", exact: true })
    .click();
  await page
    .getByTestId("tour-leave-confirmation")
    .getByRole("button", { name: "Leave lesson", exact: true })
    .click();
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
}

async function lessonOption(page: Page, name: string) {
  const card = page.getByTestId("tour-card");
  await card
    .getByRole("button", { name: "Lesson options", exact: true })
    .click();
  await card.getByRole("menuitem", { name, exact: true }).click();
}

function advanceButton(page: Page) {
  return page
    .getByTestId("tour-card")
    .getByRole("button", { name: /^(Continue|Next)$/ });
}

async function advance(page: Page) {
  await auditLayout(page);
  await expect(advanceButton(page)).toBeVisible({ timeout: 30_000 });
  await advanceButton(page).click();
}

async function finish(page: Page, { keepRecap = false } = {}) {
  await auditLayout(page);
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Finish", exact: true })
    .click();
  const recap = page.getByTestId("tour-recap");
  await expect(recap).toContainText("Lesson complete");
  if (keepRecap) return;
  expect(await recap.locator(".tour-recap__lines li").count()).toBeGreaterThan(
    1,
  );
  await recap.getByRole("button", { name: "All lessons", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Lessons", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tour-picker__lesson.is-done")).toHaveCount(1);
}

async function heading(page: Page, title: string) {
  await expect(page.getByTestId("tour-card")).toHaveAttribute(
    "data-step-title",
    title,
  );
}

async function setNumber(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Enter");
}

async function fieldPoint(page: Page, x: number, y: number) {
  await waitForStageSettled(page);
  const box = await requiredBox(page.getByTestId("path-stage"));
  const scale = Math.min((box.width - 48) / 18, (box.height - 48) / 9);
  return {
    x: box.x + (box.width - 18 * scale) / 2 + x * scale,
    y: box.y + (box.height - 9 * scale) / 2 + (9 - y) * scale,
  };
}

async function clickField(page: Page, x: number, y: number) {
  const point = await fieldPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function dragField(
  page: Page,
  from: [number, number],
  to: [number, number],
) {
  const start = await fieldPoint(page, ...from);
  const end = await fieldPoint(page, ...to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function place(page: Page, tool: string, x: number, y: number) {
  await page.getByRole("button", { name: tool + " tool", exact: true }).click();
  await clickField(page, x, y);
}

async function scrub(page: Page, ratio: number) {
  const box = await requiredBox(
    page.getByLabel("Simulation time", { exact: true }),
  );
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2);
}

async function playAndInspect(page: Page) {
  await page
    .getByRole("button", { name: "Play simulation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause simulation", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pause simulation", exact: true })
    .click();
  await scrub(page, 0.55);
  await expect
    .poll(async () =>
      Number(
        await page.getByLabel("Simulation time", { exact: true }).inputValue(),
      ),
    )
    .toBeGreaterThan(0);
}

async function selectSpeed(page: Page, ordinal: number) {
  const cells = page.locator(
    '[data-ranged-constraint-key="max_velocity_meters_per_sec"][data-range-start]',
  );
  for (const cell of await cells.all()) {
    const start = Number(await cell.getAttribute("data-range-start"));
    const end = Number(await cell.getAttribute("data-range-end"));
    if (start <= ordinal && end >= ordinal) {
      await cell.click();
      return;
    }
  }
  throw new Error("No velocity constraint for approach " + ordinal);
}

async function generate(page: Page) {
  const button = page.getByRole("button", {
    name: "Generate constraints",
    exact: true,
  });
  await button.click();
  await expect
    .poll(async () => hasGeneratedValues((await practice(page)).path), {
      timeout: 45_000,
    })
    .toBe(true);
  await expect(button).toBeEnabled({ timeout: 45_000 });
}

function hasGeneratedValues(path: PathModel) {
  return path.ranged_constraints.some((constraint) =>
    Boolean(constraint.auto_velocity?.input_signature),
  );
}

function elementCounts(path: PathModel) {
  const counts = { waypoint: 0, translation: 0, rotation: 0, event_trigger: 0 };
  for (const element of path.path_elements) counts[element.type]++;
  return counts;
}

function geometry(path: PathModel) {
  return path.path_elements.map((element) => {
    if (element.type === "waypoint")
      return {
        type: element.type,
        x: element.translation_target.x_meters,
        y: element.translation_target.y_meters,
        rotation: element.rotation_target.rotation_radians,
      };
    if (element.type === "translation")
      return { type: element.type, x: element.x_meters, y: element.y_meters };
    return element;
  });
}

/** Count the lesson's requests to frame the path on the canvas. */
async function countFramePathRequests(page: Page) {
  await page.evaluate(async () => {
    const {
      subscribeCanvasViewRequests,
    }: typeof import("../../src/canvas/canvasViewRequests") = await import(
      /* @vite-ignore */ "/src/canvas/canvasViewRequests.ts" as string
    );
    const counter = window as { __framePathRequests?: number };
    counter.__framePathRequests = 0;
    subscribeCanvasViewRequests((request) => {
      if (request.kind === "frame-path")
        counter.__framePathRequests = (counter.__framePathRequests ?? 0) + 1;
    });
  });
  return () =>
    page.evaluate(
      () => (window as { __framePathRequests?: number }).__framePathRequests,
    );
}

async function practice(page: Page) {
  return page.evaluate(async () => {
    const { projectStore }: typeof import("../../src/state/projectStore") =
      await import(/* @vite-ignore */ "/src/state/projectStore.ts" as string);
    const { selectionStore }: typeof import("../../src/state/selectionStore") =
      await import(/* @vite-ignore */ "/src/state/selectionStore.ts" as string);
    const state = projectStore.getState();
    const project = state.project!;
    const path = project.paths.find(
      (entry) => entry.path_id === state.activePathId,
    )!.path;
    return {
      path: structuredClone(path),
      config: structuredClone(project.config),
      session: state.projectSessionId,
      dirty: state.dirty,
      hasPersistence: state.io !== null,
      selection: selectionStore.getState().selectedRangedConstraint,
    };
  });
}

async function auditLayout(page: Page) {
  const card = page.getByTestId("tour-card");
  await expect(card).toBeVisible();
  await expect
    .poll(async () => {
      const box = await requiredBox(card);
      const viewport = page.viewportSize()!;
      return (
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height
      );
    })
    .toBe(true);
  expect(
    await card.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await card
    .getByRole("button", { name: "Leave lesson", exact: true })
    .click({ trial: true });
  if (process.env.BLINE_TOUR_SCREENSHOTS) {
    const title = (await card.getByRole("heading").innerText()).replace(
      /[^a-z0-9]+/gi,
      "-",
    );
    await page.screenshot({
      path: test.info().outputPath(title + ".png"),
      animations: "disabled",
    });
  }
}

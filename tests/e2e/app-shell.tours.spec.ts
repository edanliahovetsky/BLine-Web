import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PathModel } from "../../src/core/model/path";
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
} from "./support/app-shell-shared";

const lessonTitles = [
  "Getting Started",
  "BLine Fundamentals",
  "Path Tuning",
  "Rotation targets",
  "Event triggers",
  "Settings",
  "Importing and Exporting",
  "Path Management",
  "How to use BLine offline",
  "Advanced — Linked Elements",
  "Advanced — Path Linking",
];

test("opens help and all lessons, including offline guidance before advanced lessons", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  const hub = page.getByTestId("help-hub");
  await expect(hub.getByRole("link", { name: /Documentation/ })).toBeVisible();
  await hub.getByRole("button", { name: "Lessons", exact: true }).click();
  const picker = page.getByTestId("tour-picker");
  for (const title of lessonTitles) {
    await expect(picker.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(picker.locator(".tour-picker__copy > strong")).toHaveText(
    lessonTitles,
  );
  await expect(picker).toHaveAttribute("aria-label", "Lessons");
  await expect(picker.locator(".tour-picker__header")).toHaveText("🧭 Lessons");
  const settings = picker.getByTestId("tour-picker-settings");
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await settings.focus();
  await settings.press("Enter");
  await expect(settings).toHaveAttribute("aria-expanded", "true");
  await expect(
    picker.getByRole("group", { name: "Settings lessons" }).locator("strong"),
  ).toHaveText([
    "Robot",
    "Path Defaults",
    "Field",
    "Generator",
    "Event Triggers",
  ]);
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
  await settings.press("Space");
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await expect(
    picker.getByRole("group", { name: "Settings lessons" }),
  ).toHaveCount(0);
});

test("keeps the course reachable in a short window", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await page.getByTestId("start-guided-tour").click();
  const picker = page.getByTestId("tour-picker");
  const box = await requiredBox(picker);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  await picker.getByText("Advanced — Path Linking", { exact: true }).click();
  await auditLayout(page);
});

test("keeps lesson actions and dialogue visible on hover", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1600, height: 900 });
  await gotoSampleEditor(page);
  await openLesson(page, "Getting Started");
  const card = page.getByTestId("tour-card");
  const skip = card.getByRole("button", { name: "Skip lesson" });
  await expect(skip).toHaveCSS("border-top-style", "solid");
  await expect(skip).not.toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await skip.hover();
  await page.mouse.down();
  await expect(skip).toHaveCSS("transform", "none");
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await card.getByRole("heading", { name: "Canvas", exact: true }).hover();
  await expect(card).toHaveAttribute("data-hover-fade", "false");
  await page.clock.runFor(900);
  await expect(card).toHaveCSS("opacity", "1");
  await skip.hover();
  await expect(card).toHaveCSS("opacity", "1");
});

for (const [width, height] of [
  [1600, 900],
  [1280, 800],
]) {
  test(
    "opens each overview panel and menu at " + width + "px",
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await gotoSampleEditor(page);
      await openLesson(page, "Getting Started");
      const original = await practice(page);
      await heading(page, "Canvas");
      await advance(page);
      await heading(page, "Toolbar");
      await advance(page);
      await heading(page, "Sidebar");
      await expect(advanceButton(page)).toHaveCount(0);
      await page
        .getByRole("button", { name: "Toggle inspector", exact: true })
        .click();
      await advance(page);
      await heading(page, "Elements");
      await page.getByRole("tab", { name: "Elements", exact: true }).click();
      await advance(page);
      await heading(page, "Constraints");
      await page.getByRole("tab", { name: "Constraints", exact: true }).click();
      await advance(page);
      await heading(page, "Play bar");
      await expect(
        page.getByLabel("Simulation time", { exact: true }),
      ).toBeVisible();
      await playAndInspect(page);
      await advance(page);
      await heading(page, "File menu");
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
      await advance(page);
      await heading(page, "Edit actions");
      await expect(page.locator('[data-tour="edit-controls"]')).toBeVisible();
      await advance(page);
      await heading(page, "Edit menu");
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
      await heading(page, "Change a waypoint heading");
      await setNumber(page, "Rotation (deg)", "-90");
      await playAndInspect(page);
      if (width === 1600) {
        await page
          .getByTestId("tour-card")
          .getByRole("button", { name: "Restart step", exact: true })
          .click();
        await heading(page, "Change a waypoint heading");
        await expect(
          page.getByLabel("Rotation (deg)", { exact: true }),
        ).toHaveValue("0");
        await expect(advanceButton(page)).toHaveCount(0);
        await setNumber(page, "Rotation (deg)", "-90");
        await playAndInspect(page);
      }
      await advance(page);
      await heading(page, "Route around the obstacle");
      await place(page, "Translation", 10, 4.5);
      await expect(advanceButton(page)).toHaveCount(0);
      await expect(page.getByTestId("tour-card")).toContainText("bumpers");
      await setNumber(page, "X (m)", "10.8");
      await setNumber(page, "Y (m)", "6.8");
      await expect(page.getByTestId("tour-card")).toContainText(
        "The simulated bumpers clear the obstacle.",
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
      await expect(advanceButton(page)).toBeVisible();
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
      await advance(page);
      await heading(page, "Read the drive order");
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
      await heading(page, "Try more route points");
      await advance(page);
      await heading(page, "Read the drive order");
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
      await advance(page);
      await heading(page, "Cross the handoff radius");
      await expect(stage).toHaveAttribute(
        "data-lesson-phase",
        "handoff-crossing",
      );
      await expect
        .poll(async () => Number(await stage.getAttribute("data-lesson-zoom")))
        .toBeGreaterThan(1.5);
      await expect
        .poll(
          async () =>
            Number(await canvas.getAttribute("data-simulation-event-pulse")),
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0.1);
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
      await heading(page, "A new route to tune");
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
      if (width === 1280) {
        await page
          .getByTestId("tour-card")
          .getByRole("button", { name: "Restart step", exact: true })
          .click();
        expect(geometry((await practice(page)).path)).toEqual(
          geometry(rectangle),
        );
        expect(hasGeneratedValues((await practice(page)).path)).toBe(false);
      }
      await advance(page);
      await heading(page, "Open Constraints");
      await page.getByRole("tab", { name: "Constraints", exact: true }).click();
      await advance(page);
      await heading(page, "Select a constraint range");
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
      await heading(page, "The first slot");
      expect((await practice(page)).selection).toMatchObject({
        startOrdinal: 1,
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
      await page.getByTestId("handoff-radius-chip-1").click();
      await page
        .getByRole("group", { name: "Handoff radius mode", exact: true })
        .getByRole("button", { name: "Manual", exact: true })
        .click();
      await setNumber(page, "Handoff radius 2 value", "0.4");
      await advance(page);
      await heading(page, "Make a velocity Manual");
      await selectSpeed(page, 4);
      await page
        .getByRole("group", { name: "Velocity constraint mode", exact: true })
        .getByRole("button", { name: "Manual", exact: true })
        .click();
      const value = page.getByLabel(/^Constraint \d+ value$/);
      await value.fill("1.1");
      await value.press("Enter");
      await advance(page);
      await heading(page, "Explore radii and velocities");
      await generate(page);
      const manual = (await practice(page)).path;
      expect(manual.path_elements[1]).toMatchObject({
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
  await type.press("End");
  await type.press("Enter");
  await expect(type).toHaveText("Waypoint");
  await heading(page, "Add a rotation target");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
});

test("moves rotation targets, tests both heading modes, and shows the fast-turn limit", async ({
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
  await heading(page, "Try a heading in motion");
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
  await advance(page);
  await heading(page, "Add an event on the next segment");
  await place(page, "Event", 12.6, 3.9);
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
  const restart = page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Restart lesson", exact: true });
  await restart.click();
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
  await expect(restart).toBeFocused();
  await restart.click();
  await confirmation
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect((await practice(page)).path).toEqual(editedPath);
  await restart.click();
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
  await expect(library.getByText("Tour practice", { exact: true })).toHaveCount(
    0,
  );
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
      .getByRole("menuitem", { name: "Import / Export", exact: true })
      .click();
    const downloading = page.waitForEvent("download");
    await page
      .getByRole("menuitem", { name: "Export Autos Folder...", exact: true })
      .click();
    const download = await downloading;
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
    await page.getByRole("button", { name: "File", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Import / Export", exact: true })
      .click();
    const choosing = page.waitForEvent("filechooser");
    await page
      .getByRole("menuitem", { name: "Import Autos Folder...", exact: true })
      .click();
    await (await choosing).setFiles(join(tempRoot, "autos"));
    await advance(page);
    await heading(page, "Check the imported paths");
    await selectToolbarOption(page, "Toolbar path", "Score to Pickup");
    await playAndInspect(page);
    await advance(page);
    await heading(page, "Save changes for your robot");
    await expect(page.getByTestId("tour-card")).toContainText(
      "export the autos folder again",
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
    "edits save directly to the open folder",
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
  await openLesson(page, "Advanced — Linked Elements");
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
  await openLesson(page, "Advanced — Path Linking");
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
  await expect(page.getByTestId("tour-card")).toContainText(
    "your robot code controls the sequence",
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
    await heading(page, "Canvas");
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
  const title = await page
    .getByTestId("tour-card")
    .getByRole("heading")
    .innerText();
  await page.setViewportSize({ width: 560, height: 720 });
  await expect(page.getByTestId("tour-card").getByRole("heading")).toHaveText(
    title,
  );
  await exitLesson(page);
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await expect(page.getByTestId("start-guided-tour")).toBeEnabled();
  await page.getByTestId("start-guided-tour").click();
  await page.getByTestId("tour-picker-settings").click();
  await page.getByTestId("tour-picker-robot-settings").click();
  await expect(page.getByTestId("tour-card")).toContainText("Robot size");
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
    .getByRole("button", { name: "Skip lesson", exact: true })
    .click();
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
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

async function finish(page: Page) {
  await auditLayout(page);
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Finish", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Lessons", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tour-picker__lesson.is-done")).toHaveCount(1);
}

async function heading(page: Page, title: string) {
  await expect(page.getByTestId("tour-card").getByRole("heading")).toHaveText(
    title,
  );
}

async function setNumber(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Enter");
}

async function fieldPoint(page: Page, x: number, y: number) {
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
    .getByRole("button", { name: "Skip lesson", exact: true })
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

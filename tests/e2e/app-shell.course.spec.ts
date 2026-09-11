import { expect, test, type Page } from "@playwright/test";
import type { PathModel } from "../../src/core/model/path";
import { openConstraintsTab } from "./support/app-shell-constraints";
import { activeFieldLabel } from "./support/app-shell-fields";
import { openPathLibraryDialog } from "./support/app-shell-project-library";
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
  "Importing and Exporting",
  "Path Management",
  "Advanced — Linked Elements",
  "Advanced — Path Linking",
];

test("opens help and the nine requested lessons", async ({ page }) => {
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  const hub = page.getByTestId("help-hub");
  await expect(hub.getByRole("link", { name: /Documentation/ })).toBeVisible();
  await hub.getByTestId("start-guided-tour").click();
  const picker = page.getByTestId("tour-picker");
  for (const title of lessonTitles) {
    await expect(picker.getByText(title, { exact: true })).toBeVisible();
  }
  await expect(picker.locator(".tour-picker__copy > strong")).toHaveCount(9);
  await expect(page.getByTestId("tour-picker-progress")).toHaveText(
    "0 of 9 lessons complete",
  );
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
      await advance(page);
      await heading(page, "File menu");
      await page.locator('[data-tour="export-menu-entry"]').click();
      await expect(
        page.locator('[data-tour="export-menu-entry"]'),
      ).toHaveAttribute("aria-expanded", "true");
      await advance(page);
      await heading(page, "Edit actions");
      await expect(page.locator('[data-tour="edit-controls"]')).toBeVisible();
      await advance(page);
      await heading(page, "Path menu");
      await page.locator('[data-tour="path-menu-entry"]').click();
      await expect(
        page.locator('[data-tour="path-menu-entry"]'),
      ).toHaveAttribute("aria-expanded", "true");
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
        navigator.getByText("Example routine", { exact: true }),
      ).toBeVisible();
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
      await place(page, "Waypoint", 12.4, 6.8);
      await place(page, "Translation", 13.5, 5.4);
      expect((await practice(page)).path.path_elements).toHaveLength(5);
      await expect(advanceButton(page)).toBeVisible();
      await page.getByTestId("tour-card").focus();
      await page.keyboard.press("ControlOrMeta+z");
      expect((await practice(page)).path.path_elements).toHaveLength(4);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      expect((await practice(page)).path.path_elements).toHaveLength(5);
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
      await page.waitForTimeout(900);
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

test("slides an event and creates the requested key on a different segment", async ({
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
  await page
    .getByRole("button", { name: "Play simulation", exact: true })
    .click();
  await expect(page.locator(".tour-event-cue")).toContainText("startIntake", {
    timeout: 15_000,
  });
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
  await page
    .getByTestId("tour-card")
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

test("starts at home and restores home after exiting", async ({ page }) => {
  await page.goto("/");
  await dismissMobileSupportWarning(page);
  await page.getByTestId("start-center-guided-tour").click();
  await page
    .getByTestId("tour-picker")
    .getByText("Getting Started", { exact: true })
    .click();
  await expect(page.getByTestId("tour-card")).toBeVisible();
  await exitLesson(page);
  await expect(
    page.getByRole("heading", { name: "Simple, rapid, robust." }),
  ).toBeVisible();
});

test("closes practice below the mobile support threshold", async ({ page }) => {
  await gotoSampleEditor(page);
  await openLesson(page, "Rotation targets");
  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.getByTestId("tour-card")).toHaveCount(0);
  await dismissMobileSupportWarning(page);
  await page.getByRole("button", { name: "Help and tutorials" }).click();
  await expect(page.getByTestId("start-guided-tour")).toBeDisabled();
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

async function exitLesson(page: Page) {
  await page
    .getByTestId("tour-card")
    .getByRole("button", { name: "Skip tour", exact: true })
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
  await expect(page.getByTestId("tour-picker-progress")).toHaveText(
    /^1 of \d+ lessons complete$/,
  );
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
    .getByRole("button", { name: "Skip tour", exact: true })
    .click({ trial: true });
  if (process.env.BLINE_TOUR_SCREENSHOTS) {
    const title = (await card.getByRole("heading").innerText()).replace(
      /[^a-z0-9]+/gi,
      "-",
    );
    await page.screenshot({ path: test.info().outputPath(title + ".png") });
  }
}

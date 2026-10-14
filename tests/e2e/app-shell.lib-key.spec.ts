import { expect, test, type Page } from "@playwright/test";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";
import {
  canvasNodePosition,
  modelToCanvasPoint,
} from "./support/app-shell-canvas";
import { createNewProject } from "./support/app-shell-persistence";

async function registeredKeys(page: Page) {
  return page.evaluate(async () => {
    const { projectStore }: typeof import("../../src/state/projectStore") =
      await import(/* @vite-ignore */ "/src/state/projectStore.ts" as string);
    return projectStore.getState().project?.config.gui.event_trigger_keys ?? [];
  });
}

async function placeEvent(page: Page, x_meters: number, y_meters: number) {
  await page.getByRole("button", { name: "Event tool", exact: true }).click();
  const canvas = await requiredBox(page.getByTestId("path-stage-canvas"));
  const point = modelToCanvasPoint(canvas, { x_meters, y_meters });
  await page.mouse.click(point.x, point.y);
}

const options = (page: Page) =>
  page.getByRole("listbox", { name: "Registered event triggers" });

test("places an event, returns to Select, and names it from explicit key choices", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  // The sample's only event uses "intake"; place a second one on segment 1.
  await placeEvent(page, 6.35, 3.25);
  await expect(
    page.getByRole("button", { name: "Select tool", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const key = page.getByLabel("Lib Key", { exact: true });
  await expect(key).toBeFocused();
  await expect(key).toHaveCSS("font-family", /monospace/);
  await expect(
    page.locator(".path-element-row__detail--key").first(),
  ).toHaveCSS("font-family", /monospace/);

  // Suggestions open on focus, with how often each key is used.
  await expect(
    options(page).getByRole("option", { name: "intake", exact: true }),
  ).toHaveAccessibleDescription("used 1×");
  await expect(options(page).getByRole("option")).toHaveText(["intakeused 1×"]);

  // A unique prefix completes on Tab, whatever its case.
  await key.pressSequentially("INT");
  await key.press("Tab");
  await expect(key).toHaveValue("intake");

  // A capitalization variant is never offered for registration.
  await key.fill("Intake");
  await expect(page.getByText("Did you mean intake?")).toBeVisible();
  await expect(options(page)).not.toContainText("Register new key");
  await page.getByRole("button", { name: "Use it", exact: true }).click();
  await expect(key).toHaveValue("intake");
  await expect(page.getByText("Did you mean intake?")).toHaveCount(0);

  // Typing alone does not register; the explicit row does.
  await key.fill("dribble");
  await key.blur();
  expect(await registeredKeys(page)).not.toContain("dribble");
  await key.fill("shoot");
  await expect(options(page).getByRole("option")).toHaveText([
    "Register new key shoot ↵",
  ]);
  await expect(
    options(page).getByRole("option", { name: "Register new key shoot" }),
  ).toBeVisible();
  await key.press("Enter");
  expect(await registeredKeys(page)).toContain("shoot");
  await key.fill("spit");
  await options(page)
    .getByRole("option", { name: "Register new key spit" })
    .click();
  expect(await registeredKeys(page)).toEqual(
    expect.arrayContaining(["shoot", "spit"]),
  );

  // Several matches: Tab cycles instead of taking the first silently.
  await key.fill("s");
  await key.press("Tab");
  await expect(key).toHaveValue("shoot");
  await expect(key).toBeFocused();
  await key.press("Tab");
  await expect(key).toHaveValue("spit");
  await key.press("Tab");
  await expect(key).toHaveValue("shoot");
  await expect(
    options(page).getByRole("option", { selected: true }),
  ).toContainText("shoot");
  await key.press("Enter");
  await expect(options(page)).toHaveCount(0);
});

test("anchors the key list beneath an empty project's first Lib Key without scrolling", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await createNewProject(page);
  const canvas = await requiredBox(page.getByTestId("path-stage-canvas"));
  for (const [tool, x_meters] of [
    ["Translation", 3],
    ["Translation", 9],
  ] as const) {
    await page
      .getByRole("button", { name: `${tool} tool`, exact: true })
      .click();
    const point = modelToCanvasPoint(canvas, { x_meters, y_meters: 3 });
    await page.mouse.click(point.x, point.y);
  }
  await placeEvent(page, 6, 3);
  const key = page.getByLabel("Lib Key", { exact: true });
  await expect(key).toBeFocused();
  await expect(options(page)).toContainText(
    "No keys yet — type a name and press Enter",
  );
  await key.pressSequentially("intake");
  await expect(options(page).getByRole("option")).toHaveText([
    "Register new key intake ↵",
  ]);
  const field = await requiredBox(key);
  const list = await requiredBox(options(page));
  // At least as wide as the field and kept inside the window.
  expect(list.x).toBeLessThanOrEqual(field.x + 1);
  expect(list.x + list.width).toBeGreaterThanOrEqual(field.x + field.width - 1);
  expect(list.x + list.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(list.y).toBeGreaterThanOrEqual(field.y + field.height);
  expect(list.y).toBeLessThan(field.y + field.height + 12);
  await expect(options(page)).toHaveCSS("position", "fixed");
  expect(
    await page.evaluate(() => document.scrollingElement?.scrollTop ?? 0),
  ).toBe(0);
});

test("shows an event's live position while dragging and snaps with Shift @webkit-canvas", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const stage = await requiredBox(page.getByTestId("path-stage"));
  const node = await canvasNodePosition(page, "path-element-node-4");
  const start = { x: stage.x + node.x, y: stage.y + node.y };
  const end = await canvasNodePosition(page, "path-element-node-5");
  const target = {
    x: stage.x + node.x + (end.x - node.x) * 0.33,
    y: stage.y + node.y + (end.y - node.y) * 0.33,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  const readout = page.getByTestId("drag-ratio-readout");
  await expect(readout).toHaveText(/^Pos0\.\d\d$/);
  await page.keyboard.down("Shift");
  await page.mouse.move(target.x + 1, target.y + 1, { steps: 2 });
  await expect(readout).toHaveText(/^Pos0\.\d[05]$/);
  const shown = (await readout.innerText()).replace("Pos", "").trim();
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(readout).toHaveCount(0);
  await page.getByTestId("path-element-row-4").click();
  await expect(page.getByLabel("Event Pos (0-1)", { exact: true })).toHaveValue(
    String(Number(shown)),
  );
});

test("warns in Path Health when event keys differ only by case", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await placeEvent(page, 6.35, 3.25);
  const key = page.getByLabel("Lib Key", { exact: true });
  await key.fill("Intake");
  await key.press("Escape");
  await page.getByRole("button", { name: /^Path health/ }).click();
  const health = page.getByRole("dialog", { name: "Path health" });
  await expect(health).toContainText(
    'key "Intake" differs only by case from "intake"',
  );
});

import { expect, test, type Page } from "@playwright/test";
import { canvasNodePosition } from "./support/app-shell-canvas";
import { openConstraintsTab } from "./support/app-shell-constraints";
import { openProjectMenu } from "./support/app-shell-persistence";
import {
  gotoSampleEditor,
  openProjectSettings,
  requiredBox,
} from "./support/app-shell-shared";

/** Count painted purple runs, rather than inspecting the renderer's internal geometry. */
async function gateInk(page: Page, distance: number) {
  const a = await canvasNodePosition(page, "path-element-node-0");
  const b = await canvasNodePosition(page, "path-element-node-1");
  const scale = Math.hypot(b.x - a.x, b.y - a.y) / 3;
  const center = { x: b.x - distance * scale, y: b.y };
  const length = Math.max(30, 1.2 * scale);
  const screenshot = await page
    .getByTestId("path-stage-pixi-canvas")
    .screenshot({ scale: "css" });
  const runs = await page.evaluate(
    async ({ data, center, length }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const from = Math.floor(center.y - length / 2 - 4);
      const count = Math.ceil(length + 8);
      const pixels = ctx.getImageData(
        Math.round(center.x) - 1,
        from,
        3,
        count,
      ).data;
      const spans: number[] = [];
      let last = false;
      for (let y = 0; y < count; y++) {
        let purple = false;
        for (let x = 0; x < 3; x++) {
          const offset = (y * 3 + x) * 4;
          const [r, g, b] = pixels.slice(offset, offset + 3);
          if (r > 45 && r > g * 1.6 && b > g * 1.45) purple = true;
        }
        if (purple && !last) spans.push(0);
        if (purple) spans[spans.length - 1]++;
        last = purple;
      }
      return spans;
    },
    { data: screenshot.toString("base64"), center, length },
  );
  return { runs, scale, center, length };
}

test("progress gates keep six dashes across zoom, selection and distance edits @webkit-canvas", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoSampleEditor(page);
  await openProjectSettings(page);
  const settings = page.getByRole("dialog", { name: "Edit Config" });
  await settings.getByRole("button", { name: "Field", exact: true }).click();
  await settings
    .getByLabel("Field Image", { exact: true })
    .selectOption("blank-grid");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  const choosing = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "Import Path..." }).click();
  const anchor = (x: number, y: number) => ({
    type: "translation",
    x_meters: x,
    y_meters: y,
    intermediate_handoff_radius_meters: 0.6,
  });
  await (
    await choosing
  ).setFiles({
    name: "Progress Gates.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        handoff_mode: "progress",
        path_elements: [
          anchor(3, 3.5),
          anchor(6, 3.5),
          anchor(8, 5.5),
          { type: "event_trigger", lib_key: "intake", t_ratio: 0.5 },
          anchor(8.8, 5.5),
          anchor(9.4, 4.8),
          anchor(12, 4.8),
        ],
      }),
    ),
  });
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Progress Gates",
  );
  const canvas = page.getByTestId("path-stage-pixi-canvas");
  await expect.poll(async () => (await gateInk(page, 0.6)).runs.length).toBe(6);
  await canvas.screenshot({
    path: testInfo.outputPath("gates-diagonal-crowded-unselected.png"),
  });
  await openConstraintsTab(page);
  await page.getByTestId("handoff-radius-chip-1").click();
  const initial = await gateInk(page, 0.6);
  expect(initial.runs).toHaveLength(6);
  await canvas.screenshot({ path: testInfo.outputPath("gate-selected.png") });
  const input = page.getByLabel("Handoff distance 2 (m)");
  await input.fill("1.2");
  await input.press("Enter");
  await expect.poll(async () => (await gateInk(page, 1.2)).runs.length).toBe(6);
  const moved = await gateInk(page, 1.2);
  expect(moved.length).toBeCloseTo(initial.length);
  expect(initial.center.x - moved.center.x).toBeCloseTo(0.6 * initial.scale);
  await canvas.screenshot({
    path: testInfo.outputPath("gate-distance-moved.png"),
  });
  const box = await requiredBox(canvas);
  await page.mouse.move(box.x + moved.center.x, box.y + moved.center.y);
  // The editor starts at minimum zoom. Zoom about the gate to keep it visible.
  for (const [name, delta] of [
    ["zoom-in", -100],
    ["zoom-out", 100],
  ] as const) {
    for (let step = 0; step < 20; step++) {
      const before = await canvasNodePosition(page, "path-element-node-0");
      await page.mouse.wheel(0, delta);
      await expect
        .poll(
          async () => (await canvasNodePosition(page, "path-element-node-0")).x,
        )
        .not.toBeCloseTo(before.x);
    }
    await expect
      .poll(async () => (await gateInk(page, 1.2)).runs.length)
      .toBe(6);
    await canvas.screenshot({ path: testInfo.outputPath(`gate-${name}.png`) });
  }
  // A larger field reaches the 30px minimum at fit zoom.
  await openProjectSettings(page);
  await settings.getByRole("button", { name: "Field", exact: true }).click();
  await settings.getByLabel("Field Length (m)", { exact: true }).fill("30");
  await settings.getByLabel("Field Width (m)", { exact: true }).fill("30");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect.poll(async () => (await gateInk(page, 1.2)).length).toBe(30);
  await expect.poll(async () => (await gateInk(page, 1.2)).runs.length).toBe(6);
  await canvas.screenshot({
    path: testInfo.outputPath("gate-minimum-length.png"),
  });
  await page
    .getByRole("combobox", { name: "Handoff mode 2", exact: true })
    .click();
  await page.getByRole("option", { name: "Radius", exact: true }).click();
  await canvas.screenshot({
    path: testInfo.outputPath("radius-mode-preserved.png"),
  });
  expect((await gateInk(page, 1.2)).runs.length).not.toBe(6);
});

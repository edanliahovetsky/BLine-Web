import { expect, test, type Page } from "@playwright/test";
import { canvasNodePosition } from "./support/app-shell-canvas";
import {
  gotoSampleEditor,
  openProjectSettings,
  requiredBox,
} from "./support/app-shell-shared";

async function previewPose(page: Page) {
  return page.evaluate(async () => {
    const { projectStore, activePathForProjectStore } = await import(
      /* @vite-ignore */ "/src/state/projectStore.ts" as string
    );
    return activePathForProjectStore(projectStore.getState())?.path.preview
      ?.start_pose;
  });
}

test("ghost starts at the canvas center, uses waypoint drag/rotation and survives Undo/Redo and reload @webkit-canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await gotoSampleEditor(page);
  // A real supported structure: one destination, with no stored preview pose.
  await page.evaluate(async () => {
    const { projectStore, activePathForProjectStore } = await import(
      /* @vite-ignore */ "/src/state/projectStore.ts" as string
    );
    const { createTranslationTarget } = await import(
      /* @vite-ignore */ "/src/core/model/path.ts" as string
    );
    const path = activePathForProjectStore(projectStore.getState())!.path;
    projectStore.getState().applyPathCommand({
      description: "Single destination fixture",
      apply: () => ({
        ...path,
        path_elements: [createTranslationTarget({ x_meters: 12, y_meters: 5 })],
        constraints: [],
        preview: undefined,
      }),
      revert: () => path,
    });
  });
  const canvas = page.getByTestId("path-stage-canvas");
  const box = await requiredBox(canvas);
  const center = await canvasNodePosition(page, "path-element-node--1");
  expect(center.x).toBeCloseTo(box.width / 2, 0);
  expect(center.y).toBeCloseTo(box.height / 2, 0);
  await expect(page.getByText("Preview start", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("path-element-row-0")).toHaveAttribute(
    "aria-label",
    /end of path/,
  );
  await expect(page.getByTestId("path-element-row-1")).toHaveCount(0);
  const initial = await previewPose(page);
  await page.mouse.move(box.x + center.x, box.y + center.y);
  await page.mouse.down();
  await page.mouse.move(box.x + center.x - 70, box.y + center.y + 40, {
    steps: 6,
  });
  await page.mouse.up();
  await expect.poll(() => previewPose(page)).not.toEqual(initial);
  const moved = await previewPose(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => previewPose(page)).toEqual(initial);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(() => previewPose(page)).toEqual(moved);

  // Both appearances rotate by grabbing the same front edge as authored waypoints.
  for (const legacy of [true, false]) {
    await openProjectSettings(page);
    const dialog = page.getByRole("dialog", { name: "Edit Config" });
    await dialog
      .getByRole("switch", { name: "Legacy appearance", exact: true })
      .setChecked(legacy);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const current = await canvasNodePosition(page, "path-element-node--1");
    const front = await canvasNodePosition(page, "path-element-front--1");
    const before = await previewPose(page);
    const dx = front.x - current.x;
    const dy = front.y - current.y;
    await page.mouse.move(box.x + front.x, box.y + front.y);
    await page.mouse.down();
    await page.mouse.move(box.x + current.x + dy, box.y + current.y - dx, {
      steps: 8,
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await previewPose(page)).rotation_radians)
      .not.toBe(before.rotation_radians);
    const after = await previewPose(page);
    expect(after.x_meters).toBe(before.x_meters);
    expect(after.y_meters).toBe(before.y_meters);
  }
  const final = await previewPose(page);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await page.reload();
  await expect(page.getByTestId("path-stage")).toBeVisible();
  await expect
    .poll(() => previewPose(page))
    .toMatchObject({
      x_meters: expect.closeTo(final.x_meters, 4),
      y_meters: expect.closeTo(final.y_meters, 4),
      rotation_radians: expect.closeTo(final.rotation_radians, 4),
    });
  await expect(page.getByTestId("path-element-row-1")).toHaveCount(0);

  // Adding a second anchor reuses the edited ghost rather than the old +x/+y
  // offset. Undo must bring back the same private preview pose.
  for (const type of ["Translation", "Waypoint"]) {
    const ghost = await previewPose(page);
    const ghostPosition = await canvasNodePosition(
      page,
      "path-element-node--1",
    );
    await page
      .getByRole("button", { name: "Add element", exact: true })
      .click();
    await page.getByRole("menuitem", { name: type, exact: true }).click();
    await expect(page.getByTestId("path-element-row-1")).toContainText(type);
    await expect
      .poll(() => canvasNodePosition(page, "path-element-node-1"))
      .toMatchObject({
        x: expect.closeTo(ghostPosition.x, 3),
        y: expect.closeTo(ghostPosition.y, 3),
      });
    await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue(
      String(Number(ghost.x_meters.toFixed(2))),
    );
    await expect(page.getByLabel("Y (m)", { exact: true })).toHaveValue(
      String(Number(ghost.y_meters.toFixed(2))),
    );
    if (type === "Waypoint") {
      const radians = await page.evaluate(async () => {
        const { projectStore, activePathForProjectStore } = await import(
          /* @vite-ignore */ "/src/state/projectStore.ts" as string
        );
        return activePathForProjectStore(projectStore.getState())!.path
          .path_elements[1].rotation_target.rotation_radians;
      });
      expect(radians).toBe(ghost.rotation_radians);
    }
    await expect.poll(() => previewPose(page)).toEqual(ghost);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByTestId("path-element-row-1")).toHaveCount(0);
    await expect
      .poll(() => canvasNodePosition(page, "path-element-node--1"))
      .toMatchObject({
        x: expect.closeTo(ghostPosition.x, 3),
        y: expect.closeTo(ghostPosition.y, 3),
      });
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.getByTestId("path-element-row-1")).toContainText(type);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
  }
});

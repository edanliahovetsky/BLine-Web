import { expect, test, type Page } from "@playwright/test";
import {
  canvasNodePosition,
  canvasNodePositionOrNull,
} from "./support/app-shell-canvas";
import { openConstraintsTab } from "./support/app-shell-constraints";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";

async function hoverCanvasNode(page: Page, index: number): Promise<void> {
  const box = await requiredBox(page.getByTestId("path-stage-canvas"));
  const node = await canvasNodePosition(page, `path-element-node-${index}`);
  await page.mouse.move(box.x + node.x, box.y + node.y, { steps: 3 });
}

/** The canvas node outlined because the sidebar points at it, if any. */
async function linkedCanvasNode(page: Page): Promise<number | null> {
  const highlighted = await canvasNodePositionOrNull(page, "linked-hover-node");
  if (!highlighted) return null;
  for (let index = 0; index < 6; index += 1) {
    const node = await canvasNodePositionOrNull(
      page,
      `path-element-node-${index}`,
    );
    if (node && node.x === highlighted.x && node.y === highlighted.y) {
      return index;
    }
  }
  return null;
}

test("links element rows and canvas elements on hover in both directions", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await page.getByTestId("path-element-item-3").hover();
  await expect.poll(() => linkedCanvasNode(page)).toBe(3);
  // Highlight only: hovering never selects.
  await expect(page.getByTestId("path-element-row-3")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await hoverCanvasNode(page, 5);
  const endRow = page.getByTestId("path-element-item-5");
  await expect(endRow).toHaveClass(/is-linked-hover/);
  await expect.poll(() => linkedCanvasNode(page)).toBeNull();
  await expect(page.locator(".is-linked-hover")).toHaveCount(1);

  const stage = await requiredBox(page.getByTestId("path-stage-canvas"));
  await page.mouse.move(stage.x + 8, stage.y + stage.height - 8);
  await expect(endRow).not.toHaveClass(/is-linked-hover/);
});

test("links handoff radius chips and their anchors on hover", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await openConstraintsTab(page);

  const chip = page.getByTestId("handoff-radius-chip-1");
  await chip.hover();
  await expect.poll(() => linkedCanvasNode(page)).toBe(1);

  await hoverCanvasNode(page, 3);
  await expect(page.getByTestId("handoff-radius-chip-3")).toHaveClass(
    /is-linked-hover/,
  );
  await expect(chip).not.toHaveClass(/is-linked-hover/);
});

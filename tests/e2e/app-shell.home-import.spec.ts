import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBLineProjectArchive } from "../../src/core/io/blineProject";
import { createNamedProject } from "../../src/ui/app/initialProject";

test("Home import pickers reopen after cancellation @webkit-canvas", async ({
  page,
}) => {
  await page.goto("/");
  const start = page.getByTestId("start-center");
  const imports = start.getByRole("button", { name: "Import", exact: true });

  for (const name of [
    "Import project archive",
    "Import autos folder",
    "Import project archive",
  ]) {
    await test.step(name, async () => {
      await imports.click();
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 5000 }),
        start.getByRole("button", { name, exact: true }).click(),
      ]);
      expect(chooser.isMultiple()).toBe(name === "Import autos folder");
      // A native picker reports Cancel even when the browser window never loses focus.
      await chooser.element().dispatchEvent("cancel");
      await expect(
        start.getByRole("group", { name: "Import options" }),
      ).toBeHidden();
    });
  }
});

test("imports a project archive from Home @webkit-canvas", async ({ page }) => {
  await page.goto("/");
  const start = page.getByTestId("start-center");
  await start.getByRole("button", { name: "Import", exact: true }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    start
      .getByRole("button", { name: "Import project archive", exact: true })
      .click(),
  ]);
  await chooser.setFiles({
    name: "home-import.bline-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify(
        createBLineProjectArchive(
          createNamedProject("Imported project", "Opening move"),
          new Date().toISOString(),
        ),
      ),
    ),
  });
  await expect(start).toHaveCount(0);
  await expect(page.getByTestId("current-project-status")).not.toHaveText(
    "Project: No project",
  );
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Opening move",
  );
  await expect(page.getByTestId("path-stage")).toBeVisible();
});

test("imports an autos folder from Home @webkit-canvas", async ({ page }) => {
  const folder = await mkdtemp(join(tmpdir(), "bline-home-import-"));
  try {
    await mkdir(join(folder, "paths"));
    await writeFile(join(folder, "config.json"), "{}");
    await writeFile(
      join(folder, "paths", "opening_move.json"),
      JSON.stringify({
        path_elements: [
          { type: "translation", x_meters: 1, y_meters: 2 },
          { type: "translation", x_meters: 3, y_meters: 4 },
        ],
      }),
    );
    await page.goto("/");
    const start = page.getByTestId("start-center");
    await start.getByRole("button", { name: "Import", exact: true }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      start
        .getByRole("button", { name: "Import autos folder", exact: true })
        .click(),
    ]);
    await chooser.setFiles(folder);
    await expect(start).toHaveCount(0);
    await expect(page.getByTestId("current-path-status")).toContainText(
      "opening_move",
    );
    await expect(page.getByTestId("path-stage")).toBeVisible();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

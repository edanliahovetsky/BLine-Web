import { expect, type Locator, type Page } from "@playwright/test";
import { openPathLibraryDialog } from "./app-shell-project-library";
import { gotoSampleEditor, requiredBox } from "./app-shell-shared";

export const focusCount = (nav: Locator) =>
  nav.getByTestId("path-library-focus-count");
export const row = (nav: Locator, name: string) =>
  nav.locator(".fc-row").filter({
    has: nav.page().getByRole("button", { name: `Focus ${name}`, exact: true }),
  });
export const port = (nav: Locator, name: string) =>
  row(nav, name).locator(".fc-port");

export async function startDrag(
  page: Page,
  source: Locator,
  destination: Locator,
) {
  const a = await requiredBox(source),
    b = await requiredBox(destination);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
}

export async function seedLongLibrary(page: Page, longSide: "path" | "group") {
  await page.setViewportSize({ width: 1200, height: 580 });
  await gotoSampleEditor(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toHaveAttribute("title", /Saved/);
  // Seed a saved project with real path files, then load it through normal startup.
  await page.evaluate((side) => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("bline-web:workspace:"),
    )!;
    const record = JSON.parse(localStorage.getItem(key)!);
    const metadataFile = record.files.find(
      (file: { relativePath: string }) => file.relativePath === "project.json",
    );
    const metadata = JSON.parse(metadataFile.text);
    const original = metadata.paths[0];
    const pathText = record.files.find(
      (file: { relativePath: string }) =>
        file.relativePath === `paths/${original.file_name}`,
    ).text;
    const neighbors = [0, 12, 14, 18, 22];
    metadata.paths = Array.from(
      { length: side === "path" ? 24 : 4 },
      (_, i) => ({
        ...original,
        path_id: `p${i}`,
        display_name: `Path ${String(i).padStart(2, "0")}`,
        file_name: `path_${i}.json`,
      }),
    );
    metadata.path_groups = Array.from(
      { length: side === "group" ? 24 : 3 },
      (_, i) => ({
        group_id: `g${i}`,
        display_name: `Group ${String(i).padStart(2, "0")}`,
        path_ids:
          side === "path"
            ? i === 0
              ? neighbors.map((n) => `p${n}`)
              : i === 1
                ? ["p0"]
                : []
            : neighbors.includes(i)
              ? ["p0"]
              : [],
      }),
    );
    record.files = [
      ...record.files.filter(
        (file: { relativePath: string }) =>
          !file.relativePath.startsWith("paths/") &&
          file.relativePath !== "project.json",
      ),
      { relativePath: "project.json", text: JSON.stringify(metadata) },
      ...metadata.paths.map((path: { file_name: string }) => ({
        relativePath: `paths/${path.file_name}`,
        text: pathText,
      })),
    ];
    localStorage.setItem(key, JSON.stringify(record));
  }, longSide);
  await page.reload();
  await expect(page.getByTestId("path-stage")).toBeVisible();
  const nav = await openPathLibraryDialog(page);
  await nav
    .getByRole("button", {
      name: `Focus ${longSide === "path" ? "Group" : "Path"} 00`,
      exact: true,
    })
    .click();
  return nav;
}

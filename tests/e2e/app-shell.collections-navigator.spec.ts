import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";
import { openPathLibraryDialog } from "./support/app-shell-project-library";

const sample = "Phase 1 Canvas Draft";
const focusName = (nav: Locator) => nav.getByTestId("collection-focus-name");
const focusCount = (nav: Locator) => nav.getByTestId("collection-focus-count");
const row = (nav: Locator, name: string) =>
  nav.locator(".fc-row").filter({
    has: nav.page().getByRole("button", { name: `Focus ${name}`, exact: true }),
  });
const port = (nav: Locator, name: string) => row(nav, name).locator(".fc-port");
async function nameInline(
  nav: Locator,
  kind: "Collection" | "Path",
  name: string,
) {
  const input = nav.getByRole("textbox", { name: `${kind} name`, exact: true });
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press("Enter");
  await expect(input).toHaveCount(0);
}
async function createCollection(nav: Locator, name: string) {
  await nav
    .getByRole("button", { name: "Create Collection", exact: true })
    .click();
  await nameInline(nav, "Collection", name);
}
async function action(
  nav: Locator,
  kind: "Collection" | "Path",
  name: string,
  command: "Rename" | "Duplicate" | "Delete",
) {
  await nav
    .getByRole("button", { name: `${kind} actions for ${name}`, exact: true })
    .click();
  await nav
    .getByRole("menuitem", { name: `${command} ${kind}`, exact: true })
    .click();
}
async function link(nav: Locator, collection: string, path: string) {
  await nav
    .getByRole("button", { name: `Focus ${collection}`, exact: true })
    .click();
  await port(nav, collection).click();
  await port(nav, path).click();
  await expect(port(nav, path)).toHaveAccessibleName(
    `Disconnect ${path} from ${collection}`,
  );
}
async function startDrag(page: Page, source: Locator, destination: Locator) {
  const a = await requiredBox(source),
    b = await requiredBox(destination);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
}

test("inspects connections without switching the canvas and disconnects endpoints in either direction", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const nav = await openPathLibraryDialog(page);
  await expect.poll(async () => (await requiredBox(nav)).x).toBe(0);
  await expect(nav.getByRole("button", { name: /Undo/ })).toHaveCount(0);
  await createCollection(nav, "Competition");
  await link(nav, "Competition", sample);
  await expect(focusCount(nav)).toHaveText("1 Path connected");
  await port(nav, sample).click();
  await expect(focusName(nav)).toHaveText("Competition");
  await expect(focusCount(nav)).toHaveText("0 Paths connected");
  await expect(page.getByTestId("current-path-status")).toHaveText(
    `Current Path: ${sample}`,
  );
  await nav
    .getByRole("button", { name: "Focus Competition", exact: true })
    .press("ControlOrMeta+z");
  await expect(focusCount(nav)).toHaveText("1 Path connected");
  await nav
    .getByRole("button", { name: `Focus ${sample}`, exact: true })
    .click();
  await port(nav, "Competition").press("Enter");
  await expect(focusName(nav)).toHaveText(sample);
  await expect(focusCount(nav)).toHaveText("0 Collections connected");
  await action(nav, "Path", sample, "Duplicate");
  await nameInline(nav, "Path", "Backup");
  await expect(page.getByTestId("current-path-status")).toHaveText(
    `Current Path: ${sample}`,
  );
  await nav.getByRole("button", { name: "Open Path", exact: true }).click();
  await expect(nav).toHaveCount(0);
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: Backup",
  );
});

test("drags links both ways, previews the target, and cancels safely", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const nav = await openPathLibraryDialog(page);
  await createCollection(nav, "Competition");
  await createCollection(nav, "Testing");
  await startDrag(page, port(nav, "Competition"), port(nav, sample));
  await expect(nav.locator(".fc-wire-preview.is-snapped")).toHaveCount(1);
  await expect(row(nav, sample)).toHaveClass(/is-drop-target/);
  await page.mouse.up();
  await expect(focusCount(nav)).toHaveText("1 Path connected");
  await startDrag(page, port(nav, sample), port(nav, "Testing"));
  await page.mouse.up();
  await expect(focusName(nav)).toHaveText(sample);
  await expect(focusCount(nav)).toHaveText("2 Collections connected");
  await startDrag(page, port(nav, sample), port(nav, "Testing"));
  await page.mouse.up();
  await expect(focusCount(nav)).toHaveText("2 Collections connected");
  await nav
    .getByRole("button", { name: `Focus ${sample}`, exact: true })
    .press("ControlOrMeta+z");
  await expect(focusCount(nav)).toHaveText("1 Collection connected");
  await nav.getByRole("searchbox", { name: "Search paths" }).focus();
  await startDrag(page, port(nav, sample), port(nav, "Testing"));
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(nav).toBeVisible();
  await expect(nav.locator(".fc-wire-preview")).toHaveCount(0);
  await expect(focusCount(nav)).toHaveText("1 Collection connected");
  await startDrag(page, port(nav, "Competition"), port(nav, "Testing"));
  await page.mouse.up();
  await expect(nav.locator(".fc-wire-preview")).toHaveCount(0);
  await expect(focusCount(nav)).toHaveText("1 Path connected");
});

test("duplicates shared Collections and independent Paths, renames inline, and saves memberships", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  let nav = await openPathLibraryDialog(page);
  await createCollection(nav, "Competition");
  await link(nav, "Competition", sample);
  await action(nav, "Collection", "Competition", "Duplicate");
  await nameInline(nav, "Collection", "Testing");
  await expect(nav.locator(".fc-paths .fc-row")).toHaveCount(1);
  await expect(focusCount(nav)).toHaveText("1 Path connected");
  await action(nav, "Path", sample, "Duplicate");
  await nameInline(nav, "Path", "Backup");
  await expect(focusCount(nav)).toHaveText("2 Collections connected");
  await expect(nav.locator(".fc-paths .fc-row")).toHaveCount(2);
  await action(nav, "Path", "Backup", "Rename");
  const input = nav.getByRole("textbox", { name: "Path name", exact: true });
  await input.fill("Cancelled");
  await input.press("Escape");
  await expect(focusName(nav)).toHaveText("Backup");
  await action(nav, "Path", "Backup", "Rename");
  await input.fill("Backup renamed");
  await nav.getByRole("searchbox", { name: "Search paths" }).click();
  await expect(input).toHaveCount(0);
  await expect(focusName(nav)).toHaveText("Backup renamed");
  await action(nav, "Path", "Backup renamed", "Rename");
  await nameInline(nav, "Path", "Backup");
  await port(nav, "Testing").click();
  await expect(focusCount(nav)).toHaveText("1 Collection connected");
  await nav
    .getByRole("button", { name: `Focus ${sample}`, exact: true })
    .click();
  await expect(focusCount(nav)).toHaveText("2 Collections connected");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  // Explicitly flush through the app's existing save action before reloading.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toHaveAttribute("title", /Saved/);
  await page.reload();
  await expect(page.getByTestId("path-stage")).toBeVisible();
  nav = await openPathLibraryDialog(page);
  await nav.getByRole("button", { name: "Focus Backup", exact: true }).click();
  await expect(focusCount(nav)).toHaveText("1 Collection connected");
  await nav
    .getByRole("button", { name: `Focus ${sample}`, exact: true })
    .click();
  await expect(focusCount(nav)).toHaveText("2 Collections connected");
});

test("deletes Collections without deleting Paths and uses the existing Path deletion flow", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const nav = await openPathLibraryDialog(page);
  await createCollection(nav, "Competition");
  await link(nav, "Competition", sample);
  await action(nav, "Path", sample, "Duplicate");
  await nameInline(nav, "Path", "Backup");
  await action(nav, "Collection", "Competition", "Delete");
  await expect(nav.locator(".fc-collections .fc-row")).toHaveCount(0);
  await expect(nav.locator(".fc-paths .fc-row")).toHaveCount(2);
  await action(nav, "Path", "Backup", "Delete");
  const confirm = page.getByRole("dialog", {
    name: "Delete Paths",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await expect(confirm.locator("input[type=checkbox]:checked")).toHaveCount(1);
  await confirm
    .getByRole("button", { name: "Delete Selected", exact: true })
    .click();
  await expect(nav.locator(".fc-paths .fc-row")).toHaveCount(1);
  await nav
    .getByRole("button", { name: `Focus ${sample}`, exact: true })
    .press("ControlOrMeta+z");
  await expect(nav.locator(".fc-paths .fc-row")).toHaveCount(2);
});

test("filters connections, keeps row order stable, and aligns links after resizing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await gotoSampleEditor(page);
  const nav = await openPathLibraryDialog(page);
  await createCollection(nav, "Competition");
  await link(nav, "Competition", sample);
  await action(nav, "Collection", "Competition", "Duplicate");
  await nameInline(nav, "Collection", "Testing");
  const order = await nav.locator(".fc-paths .fc-name").allTextContents();
  await action(nav, "Path", sample, "Duplicate");
  await nameInline(nav, "Path", "Backup");
  await nav
    .getByRole("searchbox", { name: "Find a Collection" })
    .fill("Competition");
  await expect(focusCount(nav)).toContainText("1 hidden by search");
  await expect(nav.locator(".fc-wire")).toHaveCount(1);
  await nav.getByRole("searchbox", { name: "Find a Collection" }).fill("");
  await nav.getByRole("checkbox", { name: "Show all connections" }).check();
  await expect(nav.locator(".fc-wire")).toHaveCount(4);
  await port(nav, "Testing").click();
  await expect(nav.locator(".fc-paths .fc-name")).toHaveText([
    "Backup",
    ...order,
  ]);
  await page.setViewportSize({ width: 780, height: 600 });
  await expect
    .poll(async () =>
      nav.evaluate((element) => {
        const board = element
          .querySelector(".fc-board")!
          .getBoundingClientRect();
        const wire = element.querySelector<SVGPathElement>(".fc-wire")!;
        const point = wire.getPointAtLength(0);
        const port = element
          .querySelector<HTMLElement>(".fc-collections .fc-port")!
          .getBoundingClientRect();
        return Math.abs(point.x + board.x - (port.x + port.width / 2));
      }),
    )
    .toBeLessThan(1);
  await action(nav, "Path", "Backup", "Rename");
  await expect(
    nav.getByRole("textbox", { name: "Path name", exact: true }),
  ).toBeVisible();
});

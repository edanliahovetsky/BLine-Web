import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";
import { openPathLibraryDialog } from "./support/app-shell-project-library";

const sample = "Phase 1 Canvas Draft";
const focusName = (nav: Locator) => nav.getByTestId("path-library-focus-name");
const focusCount = (nav: Locator) =>
  nav.getByTestId("path-library-focus-count");
const row = (nav: Locator, name: string) =>
  nav.locator(".fc-row").filter({
    has: nav.page().getByRole("button", { name: `Focus ${name}`, exact: true }),
  });
const port = (nav: Locator, name: string) => row(nav, name).locator(".fc-port");
async function nameInline(
  nav: Locator,
  kind: "Path Group" | "Path",
  name: string,
) {
  const input = nav.getByRole("textbox", { name: `${kind} name`, exact: true });
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press("Enter");
  await expect(input).toHaveCount(0);
}
async function createGroup(nav: Locator, name: string) {
  await nav
    .getByRole("button", { name: "Create Path Group", exact: true })
    .click();
  await nameInline(nav, "Path Group", name);
}
async function action(
  nav: Locator,
  kind: "Path Group" | "Path",
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
  await createGroup(nav, "Competition");
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
  await expect(focusCount(nav)).toHaveText("0 Path Groups connected");
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
  await createGroup(nav, "Competition");
  await createGroup(nav, "Testing");
  await nav
    .getByRole("button", { name: "Focus Competition", exact: true })
    .click();
  await startDrag(page, port(nav, "Competition"), port(nav, sample));
  await expect(nav.locator(".fc-wire-preview.is-snapped")).toHaveCount(1);
  await expect(row(nav, sample)).toHaveClass(/is-drop-target/);
  await page.mouse.up();
  await expect(focusCount(nav)).toHaveText("1 Path connected");
  await nav
    .getByRole("button", { name: `Focus ${sample}`, exact: true })
    .click();
  await startDrag(page, port(nav, sample), port(nav, "Testing"));
  await page.mouse.up();
  await expect(focusName(nav)).toHaveText(sample);
  await expect(focusCount(nav)).toHaveText("2 Path Groups connected");
  await startDrag(page, port(nav, sample), port(nav, "Testing"));
  await page.mouse.up();
  await expect(focusCount(nav)).toHaveText("2 Path Groups connected");
  await nav
    .getByRole("button", { name: `Focus ${sample}`, exact: true })
    .press("ControlOrMeta+z");
  await expect(focusCount(nav)).toHaveText("1 Path Group connected");
  await nav.getByRole("searchbox", { name: "Search paths" }).focus();
  await startDrag(page, port(nav, sample), port(nav, "Testing"));
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(nav).toBeVisible();
  await expect(nav.locator(".fc-wire-preview")).toHaveCount(0);
  await expect(focusCount(nav)).toHaveText("1 Path Group connected");
  await startDrag(page, port(nav, "Competition"), port(nav, "Testing"));
  await page.mouse.up();
  await expect(nav.locator(".fc-wire-preview")).toHaveCount(0);
  await expect(focusName(nav)).toHaveText(sample);
  await expect(focusCount(nav)).toHaveText("1 Path Group connected");
});

test("undo and redo work immediately after renaming, dragging, toggling, and deleting", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const nav = await openPathLibraryDialog(page);
  await createGroup(nav, "Competition");
  // Use the keyboard as-is: no test locator should repair lost UI focus.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(focusName(nav)).toHaveText("New Path Group");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(focusName(nav)).toHaveText("Competition");

  await nav.getByRole("searchbox", { name: "Search paths" }).focus();
  await startDrag(page, port(nav, "Competition"), port(nav, sample));
  await page.mouse.up();
  await expect(focusCount(nav)).toHaveText("1 Path connected");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(focusCount(nav)).toHaveText("0 Paths connected");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(focusCount(nav)).toHaveText("1 Path connected");

  await nav.getByRole("checkbox", { name: "Show all connections" }).check();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(focusCount(nav)).toHaveText("0 Paths connected");
  await page.keyboard.press("ControlOrMeta+y");
  await expect(focusCount(nav)).toHaveText("1 Path connected");

  await action(nav, "Path Group", "Competition", "Delete");
  await page
    .getByRole("dialog", { name: "Delete Path Groups", exact: true })
    .getByRole("button", { name: "Delete Selected", exact: true })
    .click();
  await expect(nav.locator(".fc-groups .fc-row")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nav.locator(".fc-groups .fc-row")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(nav.locator(".fc-groups .fc-row")).toHaveCount(0);
});

test("duplicates shared Path Groups and independent Paths, renames inline, and saves memberships", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  let nav = await openPathLibraryDialog(page);
  await createGroup(nav, "Competition");
  await link(nav, "Competition", sample);
  await action(nav, "Path Group", "Competition", "Duplicate");
  await nameInline(nav, "Path Group", "Testing");
  await expect(nav.locator(".fc-paths .fc-row")).toHaveCount(1);
  await expect(focusCount(nav)).toHaveText("1 Path connected");
  await action(nav, "Path", sample, "Duplicate");
  await nameInline(nav, "Path", "Backup");
  await expect(focusCount(nav)).toHaveText("2 Path Groups connected");
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
  await expect(focusCount(nav)).toHaveText("1 Path Group connected");
  await nav
    .getByRole("button", { name: `Focus ${sample}`, exact: true })
    .click();
  await expect(focusCount(nav)).toHaveText("2 Path Groups connected");
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
  await expect(focusCount(nav)).toHaveText("1 Path Group connected");
  await nav
    .getByRole("button", { name: `Focus ${sample}`, exact: true })
    .click();
  await expect(focusCount(nav)).toHaveText("2 Path Groups connected");
});

test("deletes Path Groups without deleting Paths and uses the existing Path deletion flow", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const nav = await openPathLibraryDialog(page);
  await createGroup(nav, "Competition");
  await link(nav, "Competition", sample);
  await action(nav, "Path", sample, "Duplicate");
  await nameInline(nav, "Path", "Backup");
  await action(nav, "Path Group", "Competition", "Delete");
  await page
    .getByRole("dialog", { name: "Delete Path Groups", exact: true })
    .getByRole("button", { name: "Delete Selected", exact: true })
    .click();
  await expect(nav.locator(".fc-groups .fc-row")).toHaveCount(0);
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

test("selects Path Groups for bulk deletion from row and top menus, with cancel and one-step undo", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const nav = await openPathLibraryDialog(page);
  await createGroup(nav, "Competition");
  await link(nav, "Competition", sample);
  await createGroup(nav, "Testing");
  await link(nav, "Testing", sample);
  await createGroup(nav, "Keep");
  await action(nav, "Path Group", "Competition", "Delete");
  const dialog = page.getByRole("dialog", {
    name: "Delete Path Groups",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: "Competition", exact: true }),
  ).toBeChecked();
  await expect(dialog.getByRole("status")).toHaveText("1 of 3 selected");
  await dialog.getByRole("button", { name: "Select All", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("3 of 3 selected");
  await dialog
    .getByRole("button", { name: "Select None", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Delete Selected", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(nav.locator(".fc-groups .fc-row")).toHaveCount(3);
  await nav.getByRole("button", { name: "Close", exact: true }).click();

  const openFromTopMenu = async () => {
    await page.getByRole("button", { name: "Path", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Manage Paths", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Delete Path Groups...", exact: true })
      .click();
  };
  await openFromTopMenu();
  await expect(dialog.getByRole("status")).toHaveText("0 of 3 selected");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await openFromTopMenu();
  await dialog
    .getByRole("checkbox", { name: "Competition", exact: true })
    .check();
  await dialog.getByRole("checkbox", { name: "Testing", exact: true }).check();
  const deleteButton = dialog.getByRole("button", {
    name: "Delete Selected",
    exact: true,
  });
  await deleteButton.focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", {
      name: "Close delete path groups",
      exact: true,
    }),
  ).toBeFocused();
  await deleteButton.click();
  await expect(dialog).toHaveCount(0);
  await openPathLibraryDialog(page);
  await expect(nav.locator(".fc-groups .fc-name")).toHaveText(["Keep"]);
  await expect(nav.locator(".fc-paths .fc-row")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nav.locator(".fc-groups .fc-row")).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(nav.locator(".fc-groups .fc-name")).toHaveText(["Keep"]);
  await expect(nav.locator(".fc-paths .fc-row")).toHaveCount(1);
});

test("filters connections, keeps row order stable, and aligns links after resizing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await gotoSampleEditor(page);
  const nav = await openPathLibraryDialog(page);
  await createGroup(nav, "Competition");
  await link(nav, "Competition", sample);
  await action(nav, "Path Group", "Competition", "Duplicate");
  await nameInline(nav, "Path Group", "Testing");
  const order = await nav.locator(".fc-paths .fc-name").allTextContents();
  await action(nav, "Path", sample, "Duplicate");
  await nameInline(nav, "Path", "Backup");
  await nav
    .getByRole("searchbox", { name: "Find a Path Group" })
    .fill("Competition");
  await expect(focusCount(nav)).toContainText("1 hidden by search");
  await expect(nav.locator(".fc-wire")).toHaveCount(1);
  await nav.getByRole("searchbox", { name: "Find a Path Group" }).fill("");
  await nav.getByRole("checkbox", { name: "Show all connections" }).check();
  await expect(nav.locator(".fc-wire")).toHaveCount(4);
  await port(nav, "Testing").click();
  await expect(nav.locator(".fc-paths .fc-name")).toHaveText([
    ...order,
    "Backup",
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
          .querySelector<HTMLElement>(".fc-groups .fc-port")!
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

async function seedLongLibrary(page: Page, longSide: "path" | "group") {
  await page.setViewportSize({ width: 1200, height: 650 });
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

for (const longSide of ["path", "group"] as const) {
  test(`keeps the selected ${longSide} row in place and sorts only its neighbors`, async ({
    page,
  }) => {
    const nav = await seedLongLibrary(page, longSide);
    const label = longSide === "path" ? "Path" : "Group";
    const opposite = longSide === "path" ? "Group" : "Path";
    const ownList = nav.locator(`.fc-list-scroll[data-kind="${longSide}"]`);
    const originalOrder = await ownList.locator(".fc-name").allTextContents();
    // Add a connection to a lower-ranked neighbor without changing focus.
    await port(nav, `${opposite} 02`).click();
    await port(nav, `${label} 23`).click();
    await expect(ownList.locator(".fc-name")).toHaveText(originalOrder);
    const selectedRow = row(nav, `${label} 23`);
    const beforeSelection = await requiredBox(selectedRow);
    const beforeScroll = await ownList.evaluate((el) => el.scrollTop);
    await nav
      .getByRole("button", { name: `Focus ${label} 23`, exact: true })
      .click();
    await expect(ownList.locator(".fc-name")).toHaveText(originalOrder);
    await expect(selectedRow).toHaveClass(/is-focused/);
    expect((await requiredBox(selectedRow)).y).toBe(beforeSelection.y);
    expect(await ownList.evaluate((el) => el.scrollTop)).toBe(beforeScroll);
    await expect
      .poll(() => ownList.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    const neighbors = nav.locator(
      `.fc-list-scroll[data-kind="${longSide === "path" ? "group" : "path"}"] .fc-name`,
    );
    await expect(neighbors.first()).toHaveText(`${opposite} 02`);
    const nextChoice = nav.getByRole("button", {
      name: `Focus ${label} 22`,
      exact: true,
    });
    await nextChoice.scrollIntoViewIfNeeded();
    const nextPosition = await requiredBox(row(nav, `${label} 22`));
    await nextChoice.click();
    await expect(ownList.locator(".fc-name")).toHaveText(originalOrder);
    expect((await requiredBox(row(nav, `${label} 22`))).y).toBe(nextPosition.y);
    await expect(neighbors.first()).toHaveText(`${opposite} 00`);
    const scrollBefore = await ownList.evaluate((el) => el.scrollTop);
    await ownList.hover();
    await page.mouse.wheel(0, -2200);
    await expect.poll(() => ownList.evaluate((el) => el.scrollTop)).toBe(0);
    expect((await requiredBox(row(nav, `${label} 22`))).y).toBe(
      nextPosition.y + scrollBefore,
    );
    await expect(ownList.locator(".fc-row.is-focused")).toHaveCount(1);
  });

  test(`scrolls the long ${longSide} list independently and displays clean connection stacks`, async ({
    page,
  }, testInfo) => {
    const nav = await seedLongLibrary(page, longSide);
    const oppositeName = longSide === "path" ? "Path" : "Group";
    const sourceName = longSide === "path" ? "Group 00" : "Path 00";
    const selection = row(nav, sourceName);
    const list = nav.locator(`.fc-list-scroll[data-kind="${longSide}"]`);
    const names = list.locator(".fc-name");
    await expect(names).toHaveCount(24);
    expect((await names.allTextContents()).slice(0, 5)).toEqual(
      [0, 12, 14, 18, 22].map(
        (i) => `${oppositeName} ${String(i).padStart(2, "0")}`,
      ),
    );
    await expect(row(nav, sourceName)).toHaveCount(1);
    const anchor = await requiredBox(selection);
    const order = await names.allTextContents();
    await list.hover();
    await page.mouse.wheel(0, 2200);
    await expect
      .poll(() => list.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(700);
    expect((await requiredBox(selection)).y).toBe(anchor.y);
    const stack = nav.getByRole("button", { name: /connected above/ });
    await expect(stack).toBeVisible();
    await expect(stack.locator(".fc-stack-layer")).toHaveCount(2);
    const stackBox = await requiredBox(stack);
    const cardBox = await requiredBox(row(nav, `${oppositeName} 23`));
    expect(stackBox.height).toBe(cardBox.height);
    expect(Math.abs(stackBox.width - cardBox.width)).toBeLessThan(2);
    // Hidden rows must not show or receive clicks through the stack's layers.
    expect(
      await page.evaluate(
        ({ x, y }) =>
          Boolean(document.elementFromPoint(x, y)?.closest(".fc-row")),
        { x: stackBox.x + stackBox.width / 2, y: stackBox.y - 8 },
      ),
    ).toBe(false);
    expect(
      await page.evaluate(
        ({ x, y }) =>
          Boolean(document.elementFromPoint(x, y)?.closest(".fc-row")),
        { x: stackBox.x, y: stackBox.y + stackBox.height / 2 },
      ),
    ).toBe(false);
    await nav.screenshot({ path: testInfo.outputPath("offscreen-stacks.png") });

    await startDrag(
      page,
      port(nav, sourceName),
      port(nav, `${oppositeName} 23`),
    );
    await page.mouse.up();
    await expect(focusName(nav)).toHaveText(sourceName);
    await expect(focusCount(nav)).toHaveText(
      longSide === "path" ? "6 Paths connected" : "6 Path Groups connected",
    );
    await expect(names).toHaveText(order);
    expect((await requiredBox(selection)).y).toBe(anchor.y);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(focusCount(nav)).toHaveText(
      longSide === "path" ? "5 Paths connected" : "5 Path Groups connected",
    );
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(focusCount(nav)).toHaveText(
      longSide === "path" ? "6 Paths connected" : "6 Path Groups connected",
    );
    await expect(names).toHaveText(order);

    await nav
      .getByRole("button", { name: "Re-sort connected first", exact: true })
      .click();
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
    expect((await names.allTextContents()).slice(0, 6)).toEqual(
      [0, 12, 14, 18, 22, 23].map(
        (i) => `${oppositeName} ${String(i).padStart(2, "0")}`,
      ),
    );
    await nav.getByRole("button", { name: /connected below/ }).click();
    await expect
      .poll(() => list.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    expect((await requiredBox(selection)).y).toBe(anchor.y);
    await nav
      .getByRole("searchbox", {
        name: longSide === "path" ? "Search paths" : "Find a Path Group",
        exact: true,
      })
      .fill(`${oppositeName} 23`);
    await expect(names).toHaveText([`${oppositeName} 23`]);
    await expect(focusCount(nav)).toContainText("5 hidden by search");
    await expect(selection).toBeVisible();
    await expect(nav.locator(".fc-edge-cap")).toHaveCount(0);
    await expect(nav.locator(".fc-wire")).toHaveCount(1);
  });
}

test("scrolls the destination list during a drag without reordering or moving the source", async ({
  page,
}) => {
  const nav = await seedLongLibrary(page, "path");
  const list = nav.locator('.fc-list-scroll[data-kind="path"]');
  const order = await list.locator(".fc-name").allTextContents();
  const source = await requiredBox(port(nav, "Group 00")),
    viewport = await requiredBox(list);
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    viewport.x + viewport.width / 2,
    viewport.y + viewport.height - 8,
    { steps: 5 },
  );
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(400);
  await expect(row(nav, "Group 00")).toBeVisible();
  await expect(list.locator(".fc-name")).toHaveText(order);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(nav.locator(".fc-wire-preview")).toHaveCount(0);
  const stopped = await list.evaluate((el) => el.scrollTop);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await list.evaluate((el) => el.scrollTop)).toBe(stopped);
  await expect(focusCount(nav)).toHaveText("5 Paths connected");
});

test("click-to-connect from another group preserves the focused group's existing link", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const nav = await openPathLibraryDialog(page);
  await createGroup(nav, "Competition");
  await link(nav, "Competition", sample);
  await createGroup(nav, "Testing");
  await nav
    .getByRole("button", { name: "Focus Competition", exact: true })
    .click();
  await port(nav, "Testing").click();
  await port(nav, sample).click();
  await expect(focusName(nav)).toHaveText("Competition");
  await expect(focusCount(nav)).toHaveText("1 Path connected");
  await nav
    .getByRole("button", { name: `Focus ${sample}`, exact: true })
    .click();
  await expect(focusCount(nav)).toHaveText("2 Path Groups connected");
});

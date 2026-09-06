import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { modelToCanvasPoint } from "./support/app-shell-canvas";
import {
  disableDirectoryPicker,
  installSaveFilePickerSpy,
  openProjectMenu,
  openProjectPanelFromTopMenu,
  parseStoredZip,
  releaseSaveFilePicker,
  requiredZipText,
  savedFile,
  savedFileCount,
} from "./support/app-shell-persistence";
import {
  addPathToGroupFromLibrary,
  createNewPathFromTopMenu,
  createPathGroupFromTopMenu,
  openPathLibraryDialog,
  openPathMenu,
  pointBetweenFlyoutAndTrigger,
  selectToolbarOption,
  submitNameDialog,
} from "./support/app-shell-project-library";
import { gotoSampleEditor, requiredBox } from "./support/app-shell-shared";

test("creates a Path inline from the File menu", async ({ page }) => {
  await gotoSampleEditor(page);

  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "New Path", exact: true }).click();

  const navigator = page.getByRole("dialog", { name: "Project Navigator" });
  await expect(navigator).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Create New Path", exact: true }),
  ).toHaveCount(0);
  const name = navigator.getByRole("textbox", {
    name: "Path name",
    exact: true,
  });
  await expect(name).toBeFocused();
  await name.fill("File Menu Path");
  await name.press("Enter");
  await expect(navigator.getByTestId("path-library-focus-name")).toHaveText(
    "File Menu Path",
  );
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );
  await navigator
    .getByRole("button", { name: "Open Path", exact: true })
    .click();
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: File Menu Path",
  );
});

test("creates Path Groups and new Paths from the Project Navigator", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await createPathGroupFromTopMenu(page, "Score Autos");
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Score Autos / Phase 1 Canvas Draft",
  );

  const navigator = await openPathLibraryDialog(page);
  await navigator.getByRole("button", { name: "Create new path" }).click();
  const newPathDialog = page.getByRole("dialog", { name: "Create New Path" });
  await expect(newPathDialog).toHaveCount(0);
  const name = navigator.getByRole("textbox", {
    name: "Path name",
    exact: true,
  });
  await expect(name).toBeFocused();
  await name.fill("Group Blank");
  await name.press("Enter");
  await expect(navigator.getByTestId("path-library-focus-name")).toHaveText(
    "Group Blank",
  );
  await expect(navigator.getByTestId("path-library-focus-count")).toHaveText(
    "1 Path Group connected",
  );

  await expect(page.getByTestId("current-path-status")).toContainText(
    "Score Autos / Phase 1 Canvas Draft",
  );

  await navigator
    .getByRole("button", { name: "Path Group actions for Score Autos" })
    .click();
  await navigator.getByRole("menuitem", { name: "Delete Path Group" }).click();
  await page
    .getByRole("dialog", { name: "Delete Path Groups", exact: true })
    .getByRole("button", { name: "Delete Selected", exact: true })
    .click();
  await expect(
    navigator.locator(".all-paths__row").filter({ hasText: "Group Blank" }),
  ).toBeVisible();
  await navigator
    .getByRole("button", { name: "Open Path", exact: true })
    .click();

  await expect(page.getByTestId("current-path-status")).toContainText(
    "Current Path: Group Blank",
  );
  await expect(page.getByLabel("Toolbar path")).toContainText("Group Blank");
});

test("switches collected Paths and toggles Path Group canvas overlays", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await createPathGroupFromTopMenu(page, "Score Autos");

  await page.getByRole("button", { name: "Path", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage Paths" }).click();
  await page.getByRole("menuitem", { name: "Save Path As..." }).click();
  await submitNameDialog(page, "Save Path As", "Ghost Copy", "Save Copy");

  await addPathToGroupFromLibrary(page, "Score Autos", "Ghost Copy");

  await page.getByTestId("path-element-row-0").click();
  await page.getByLabel("X (m)").fill("6.8");
  await page.getByLabel("Y (m)").fill("2.8");
  await selectToolbarOption(page, "Toolbar path", "Phase 1 Canvas Draft");
  const navigator = await openPathLibraryDialog(page);
  await navigator
    .getByRole("button", { name: "Focus Score Autos", exact: true })
    .click();
  await navigator
    .getByRole("button", { name: "Preview Path Group", exact: true })
    .click();
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Score Autos / Phase 1 Canvas Draft",
  );

  const compareToggle = page.getByRole("button", {
    name: "Hide Path Group overlays",
  });
  await expect(compareToggle).toHaveAttribute("aria-pressed", "true");
  await compareToggle.click();

  const canvas = page.getByTestId("path-stage-canvas");
  const ghostPoint = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 6.8,
    y_meters: 2.8,
  });
  await page.mouse.move(ghostPoint.x, ghostPoint.y);
  await expect(page.getByTestId("path-stage-ghost-label")).toHaveCount(0);

  await page.getByRole("button", { name: "Show Path Group overlays" }).click();
  await page.mouse.move(ghostPoint.x, ghostPoint.y);
  await expect(page.getByTestId("path-stage-ghost-label")).toHaveText(
    "Ghost Copy",
  );
  await page.mouse.click(ghostPoint.x, ghostPoint.y);

  await expect(page.getByTestId("current-path-status")).toContainText(
    "Score Autos / Ghost Copy",
  );
});

test("uses the linked-elements layout across desktop and narrow viewports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoSampleEditor(page);

  const pathMenu = await openPathMenu(page);
  await pathMenu.getByRole("menuitem", { name: "Linked Elements..." }).click();

  const dialog = page.getByRole("dialog", { name: "Linked Elements" });
  await expect(dialog).toBeVisible();
  const desktopViewport = page.viewportSize();
  expect(desktopViewport?.width).toBeGreaterThan(980);
  const desktopDialogBox = await requiredBox(dialog);
  expect(desktopDialogBox.x).toBeGreaterThanOrEqual(24);
  expect(desktopDialogBox.x + desktopDialogBox.width).toBeLessThanOrEqual(
    (desktopViewport?.width ?? 0) - 24,
  );

  const body = dialog.locator(".linked-targets-dialog__body");
  await expect
    .poll(() =>
      body.evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
            .length,
      ),
    )
    .toBe(3);

  await page.setViewportSize({ width: 900, height: 720 });

  const narrowViewport = page.viewportSize();
  expect(narrowViewport?.width).toBeLessThanOrEqual(980);
  const narrowDialogBox = await requiredBox(dialog);
  expect(narrowDialogBox.x).toBeGreaterThanOrEqual(16);
  expect(narrowDialogBox.x + narrowDialogBox.width).toBeLessThanOrEqual(
    (narrowViewport?.width ?? 0) - 16,
  );
  expect(narrowDialogBox.width).toBeLessThanOrEqual(760);
  const sections = body.locator(":scope > *");
  await expect
    .poll(async () => {
      const boxes = await sections.evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { left: bounds.left, top: bounds.top };
        }),
      );
      return {
        columnCount: await body.evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/)
              .length,
        ),
        aligned: boxes.every(
          (box) => Math.abs(box.left - (boxes[0]?.left ?? box.left)) < 1,
        ),
        stacked: boxes.every(
          (box, index) => index === 0 || box.top > boxes[index - 1].top,
        ),
      };
    })
    .toEqual({ columnCount: 1, aligned: true, stacked: true });
});

test("exposes PySide-equivalent top menu commands", async ({ page }) => {
  await gotoSampleEditor(page);

  await openProjectMenu(page);
  await expect(page.getByTestId("top-menu-project")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "New Path", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Workspace" })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import / Export" }),
  ).toBeVisible();
  const configMenuItem = page.getByRole("menuitem", { name: "Config" });
  await expect(configMenuItem).toBeVisible();
  const configLabelMetrics = await configMenuItem.evaluate((element) => {
    const label = element.querySelector(".top-menu__item-label");
    const labelStyle = label ? window.getComputedStyle(label) : null;

    return {
      itemHeight: element.getBoundingClientRect().height,
      labelHeight: label?.getBoundingClientRect().height ?? 0,
      lineHeight: labelStyle ? Number.parseFloat(labelStyle.lineHeight) : 0,
    };
  });
  expect(configLabelMetrics.itemHeight).toBeGreaterThanOrEqual(32);
  expect(configLabelMetrics.labelHeight).toBeGreaterThanOrEqual(18);
  expect(configLabelMetrics.lineHeight).toBeGreaterThanOrEqual(17);
  await expect(
    page.getByRole("menuitem", { name: "Recent Projects" }),
  ).toBeVisible();

  await page.getByRole("menuitem", { name: "Workspace" }).click();
  await expect(page.getByTestId("top-menu-project-workspace")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "New Project" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Open Project..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Delete Projects..." }),
  ).toBeVisible();

  await page.getByRole("menuitem", { name: "Delete Projects..." }).click();
  await expect(
    page.getByRole("dialog", { name: "Delete Projects" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Select All" }).click();
  await page
    .getByRole("button", { name: "Delete Selected", exact: true })
    .click();
  await expect(page.getByText("Delete 1 selected project?")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm Delete" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(page.getByTestId("top-menu-project-transfer")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Autos Folder..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Export Autos Folder..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Project Archive..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Export Project Archive..." }),
  ).toBeVisible();

  await page.getByRole("menuitem", { name: "Config" }).click();
  await expect(page.getByTestId("top-menu-project-config")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Config..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Export Config..." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Path", exact: true }).click();
  await expect(page.getByTestId("top-menu-path")).toBeVisible();
  await expect(page.getByText("Current: Phase 1 Canvas Draft")).toBeVisible();
  await expect(page.getByText("Path Group: None")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Linked Elements..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Project Navigator...", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Manage Paths" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import / Export" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Manage Paths" }).click();
  await expect(page.getByTestId("top-menu-path-manage")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Create New Path" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Save Path As..." }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(page.getByTestId("top-menu-path-transfer")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Path..." }),
  ).toBeVisible();

  // The menu bar is limited to File and Path; Edit/View/Help were removed
  // and their actions moved to the toolbar, command palette, and shortcuts.
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Help", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Config" })).toBeVisible();
  await expect(page.getByLabel("Robot Length (m)")).toBeVisible();
  await page.getByRole("button", { name: "Close config" }).click();
});

test("keeps top dropdowns streamlined with condensed path side menus", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await openProjectMenu(page);
  const projectMenu = page.getByTestId("top-menu-project");
  await expect(projectMenu).toBeVisible();
  expect((await requiredBox(projectMenu)).width).toBeLessThanOrEqual(260);

  await page.getByRole("menuitem", { name: "Recent Projects" }).click();
  const recentMenu = page.getByTestId("top-menu-project-recent");
  await expect(recentMenu).toBeVisible();
  const projectMenuBox = await requiredBox(projectMenu);
  const recentMenuBox = await requiredBox(recentMenu);
  expect(recentMenuBox.width).toBeLessThanOrEqual(285);
  expect(recentMenuBox.x).toBeGreaterThanOrEqual(
    projectMenuBox.x + projectMenuBox.width,
  );

  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(recentMenu).toHaveCount(0);
  await expect(page.getByTestId("top-menu-project-transfer")).toBeVisible();

  await page.getByRole("button", { name: "Path", exact: true }).click();
  const pathMenu = page.getByTestId("top-menu-path");
  await expect(pathMenu).toBeVisible();
  expect((await requiredBox(pathMenu)).width).toBeLessThanOrEqual(270);

  await page.getByRole("menuitem", { name: "Manage Paths" }).click();
  const managePathMenu = page.getByTestId("top-menu-path-manage");
  await expect(managePathMenu).toBeVisible();
  const pathMenuBox = await requiredBox(pathMenu);
  const managePathMenuBox = await requiredBox(managePathMenu);
  expect(managePathMenuBox.width).toBeLessThanOrEqual(285);
  expect(managePathMenuBox.x).toBeGreaterThanOrEqual(
    pathMenuBox.x + pathMenuBox.width,
  );

  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(managePathMenu).toHaveCount(0);
  const transferMenu = page.getByTestId("top-menu-path-transfer");
  await expect(transferMenu).toBeVisible();
  const transferMenuBox = await requiredBox(transferMenu);
  expect(transferMenuBox.width).toBeLessThanOrEqual(285);
  expect(transferMenuBox.x).toBeGreaterThanOrEqual(
    pathMenuBox.x + pathMenuBox.width,
  );
  await expect(
    transferMenu.getByRole("menuitem", { name: "Import Path..." }),
  ).toBeVisible();
});

test("keeps project flyouts stable while hovering between choices", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Workspace" }).hover();
  await expect(page.getByTestId("top-menu-project-workspace")).toBeVisible();

  await page.getByRole("menuitem", { name: "Import / Export" }).hover();
  const transferMenu = page.getByTestId("top-menu-project-transfer");
  await expect(page.getByTestId("top-menu-project-workspace")).toHaveCount(0);
  await expect(transferMenu).toBeVisible();

  const transferBox = await requiredBox(transferMenu);
  await page.mouse.move(
    transferBox.x + transferBox.width / 2,
    transferBox.y + 12,
  );
  await expect(transferMenu).toBeVisible();
  await page.waitForTimeout(350);
  await expect(transferMenu).toBeVisible();

  await page.mouse.move(16, 16);
  await expect(transferMenu).toHaveCount(0);

  await page.getByRole("menuitem", { name: "Import / Export" }).hover();
  await expect(transferMenu).toBeVisible();
  await page.getByRole("menuitem", { name: "Config" }).hover();
  await expect(transferMenu).toHaveCount(0);
  await expect(page.getByTestId("top-menu-project-config")).toBeVisible();
});

test("switches paths from the toolbar path selector", async ({ page }) => {
  await gotoSampleEditor(page);

  await createNewPathFromTopMenu(page, "Second Path");

  await selectToolbarOption(page, "Toolbar path", "Phase 1 Canvas Draft");
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Phase 1 Canvas Draft",
  );
  await selectToolbarOption(page, "Toolbar path", "Second Path");
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Second Path",
  );
});

test("keeps actions flyouts stable and closes them after leaving", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await gotoSampleEditor(page);

  await page.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Import" }).hover();
  const importMenu = page.getByTestId("top-menu-actions-import");
  await expect(importMenu).toBeVisible();

  const importBox = await requiredBox(importMenu);
  await page.mouse.move(importBox.x + importBox.width / 2, importBox.y + 12);
  await expect(importMenu).toBeVisible();
  await page.waitForTimeout(350);
  await expect(importMenu).toBeVisible();

  const actionsMenu = page.getByTestId("top-menu-actions");
  const importTriggerBox = await requiredBox(
    actionsMenu.getByRole("menuitem", { name: "Import" }),
  );
  const importBridgePoint = pointBetweenFlyoutAndTrigger(
    importTriggerBox,
    importBox,
  );
  await page.mouse.move(importBridgePoint.x, importBridgePoint.y);
  await expect(importMenu).toHaveCount(0, { timeout: 500 });

  await page.getByRole("menuitem", { name: "Import" }).hover();
  await expect(importMenu).toBeVisible();
  await page.mouse.move(16, 16);
  await expect(importMenu).toHaveCount(0);

  await page.getByRole("menuitem", { name: "Import" }).hover();
  await expect(importMenu).toBeVisible();
  await page.getByRole("menuitem", { name: "Save" }).hover();
  await expect(importMenu).toHaveCount(0);
});

test("closes the open-project panel when using top menus", async ({ page }) => {
  await gotoSampleEditor(page);

  await openProjectPanelFromTopMenu(page);
  await expect(page.getByTestId("open-project-panel")).toBeVisible();

  await page.getByRole("button", { name: "Path", exact: true }).click();
  await expect(page.getByTestId("open-project-panel")).toHaveCount(0);
  await expect(page.getByTestId("top-menu-path")).toBeVisible();

  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByTestId("top-menu-path")).toHaveCount(0);
  await expect(page.getByTestId("top-menu-project")).toBeVisible();
});

test("project and path menus expose import modes without toolbar clutter", async ({
  page,
}) => {
  await gotoSampleEditor(page);

  await openProjectPanelFromTopMenu(page);
  await expect(page.getByTestId("open-project-panel")).toBeVisible();

  await openProjectMenu(page);
  await expect(page.getByTestId("open-project-panel")).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(page.getByTestId("top-menu-project-transfer")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Autos Folder..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Project Archive..." }),
  ).toBeVisible();

  await openPathMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(page.getByTestId("top-menu-path-transfer")).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Import Path..." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Export", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Import", exact: true }),
  ).toHaveCount(0);
});

test("browser autos folder export downloads one zip preserving the autos tree", async ({
  page,
}) => {
  await disableDirectoryPicker(page);
  await gotoSampleEditor(page);

  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await expect(page.getByTestId("top-menu-project-transfer")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export Autos Folder..." }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("autos.zip");
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Expected autos.zip to be available on disk");
  }

  const entries = parseStoredZip(await readFile(downloadPath));
  expect([...entries.keys()].sort()).toEqual([
    "autos/config.json",
    "autos/paths/phase-1-canvas-draft.json",
    "autos/project.json",
  ]);
  expect(JSON.parse(requiredZipText(entries, "autos/config.json"))).toEqual({
    kinematic_constraints: expect.any(Object),
  });
  expect(requiredZipText(entries, "autos/config.json")).not.toContain("gui");
  expect(
    JSON.parse(requiredZipText(entries, "autos/project.json")),
  ).toMatchObject({
    schema_version: 1,
    path_groups: [],
  });
  const exportedPath = JSON.parse(
    requiredZipText(entries, "autos/paths/phase-1-canvas-draft.json"),
  ) as { path_elements?: unknown[] };
  expect(exportedPath).toMatchObject({
    path_elements: expect.any(Array),
  });
  expect(exportedPath.path_elements?.length).toBeGreaterThan(0);
});

test("browser legacy autos folder import re-exports the clean sidecar tree", async ({
  page,
}) => {
  await disableDirectoryPicker(page);
  const tempRoot = await mkdtemp(join(tmpdir(), "bline-web-legacy-autos-"));
  const autosDir = join(tempRoot, "autos");

  try {
    await mkdir(join(autosDir, "paths"), { recursive: true });
    await mkdir(join(autosDir, ".bline-web"), { recursive: true });
    await writeFile(
      join(autosDir, "config.json"),
      JSON.stringify({
        gui: {
          robot: {
            length_meters: 0.71,
            width_meters: 0.92,
          },
        },
        kinematic_constraints: {
          default_max_velocity_meters_per_sec: 5.1,
          default_max_acceleration_meters_per_sec2: 10.5,
          default_intermediate_handoff_radius_meters: 0.28,
          default_max_velocity_deg_per_sec: 650,
          default_max_acceleration_deg_per_sec2: 1700,
          default_end_translation_tolerance_meters: 0.04,
          default_end_rotation_tolerance_deg: 3,
        },
      }),
      "utf8",
    );
    await writeFile(
      join(autosDir, "pathgroups.json"),
      JSON.stringify({
        schema_version: 1,
        groups: [
          {
            group_id: "legacy",
            display_name: "Legacy Group",
            path_file_names: ["legacy_auto.json"],
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      join(autosDir, ".bline-web", "path-metadata.json"),
      JSON.stringify({
        paths: {
          "legacy_auto.json": {
            editor_metadata: {
              ranged_constraints: [
                {
                  key: "max_velocity_meters_per_sec",
                  value: 2.2,
                  start_ordinal: 1,
                  end_ordinal: 2,
                  source: "auto_velocity",
                  auto_velocity: {
                    velocity_safety_factor: 0.7,
                    acceleration_safety_factor: 0.6,
                    merge_tolerance_meters_per_sec: 0.2,
                  },
                },
              ],
            },
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      join(autosDir, "paths", "legacy_auto.json"),
      JSON.stringify({
        path: {
          path_elements: [
            { type: "translation", x_meters: 1, y_meters: 2 },
            { type: "translation", x_meters: 3, y_meters: 4 },
          ],
          constraints: {
            max_velocity_meters_per_sec: [
              { value: 2.2, start_ordinal: 0, end_ordinal: 1 },
            ],
          },
        },
      }),
      "utf8",
    );

    await gotoSampleEditor(page);
    const chooserPromise = page.waitForEvent("filechooser");
    await openProjectMenu(page);
    await page.getByRole("menuitem", { name: "Import / Export" }).click();
    await page
      .getByRole("menuitem", { name: "Import Autos Folder..." })
      .click();
    const chooser = await chooserPromise;
    await chooser.setFiles(autosDir);

    await expect(page.getByTestId("current-path-status")).toContainText(
      "legacy auto",
    );

    await openProjectMenu(page);
    await page.getByRole("menuitem", { name: "Import / Export" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("menuitem", { name: "Export Autos Folder..." })
      .click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    if (!downloadPath) {
      throw new Error("Expected autos.zip to be available on disk");
    }

    const entries = parseStoredZip(await readFile(downloadPath));
    expect([...entries.keys()].sort()).toEqual([
      "autos/config.json",
      "autos/paths/legacy_auto.json",
      "autos/project.json",
    ]);
    expect(requiredZipText(entries, "autos/config.json")).not.toContain("gui");
    expect(
      JSON.parse(requiredZipText(entries, "autos/config.json")),
    ).toMatchObject({
      kinematic_constraints: {
        default_max_velocity_meters_per_sec: 5.1,
        default_intermediate_handoff_radius_meters: 0.28,
      },
    });
    expect(
      JSON.parse(requiredZipText(entries, "autos/project.json")),
    ).toMatchObject({
      path_groups: [
        {
          group_id: "legacy",
          display_name: "Legacy Group",
          path_ids: [expect.any(String)],
        },
      ],
      paths: [
        {
          file_name: "legacy_auto.json",
        },
      ],
    });
    expect(
      JSON.parse(requiredZipText(entries, "autos/paths/legacy_auto.json")),
    ).toMatchObject({
      constraints: {
        max_velocity_meters_per_sec: [
          {
            source: "auto_velocity",
          },
        ],
      },
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("path menu export saves the active path and import path round-trips it", async ({
  page,
}) => {
  await installSaveFilePickerSpy(page, { waitForRelease: true });
  await gotoSampleEditor(page);

  await openPathMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await page.getByRole("menuitem", { name: "Export Path..." }).click();

  await releaseSaveFilePicker(page);
  await expect.poll(() => savedFileCount(page)).toBe(1);
  const saved = await savedFile(page, 0);
  expect(saved.suggestedName).toBe("phase-1-canvas-draft.json");
  expect(JSON.parse(saved.text)).toMatchObject({
    path_elements: expect.any(Array),
  });

  const chooserPromise = page.waitForEvent("filechooser");
  await openPathMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await page.getByRole("menuitem", { name: "Import Path..." }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    buffer: Buffer.from(saved.text),
    mimeType: "application/json",
    name: "roundtrip-path.json",
  });

  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: roundtrip path",
  );
});

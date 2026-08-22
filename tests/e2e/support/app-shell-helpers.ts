import { expect, type Locator, type Page } from "@playwright/test";

export async function expectGlobalShortcutsBlockedByDialog(
  page: Page,
  dialog: Locator,
  focusTarget: Locator,
): Promise<void> {
  await expect(dialog).toBeVisible();
  await expect(focusTarget).toBeFocused();

  const inspectorToggle = page.getByRole("button", {
    name: "Toggle inspector",
  });
  const inspectorExpanded = await inspectorToggle.getAttribute("aria-expanded");
  const useMetaKey = process.platform === "darwin";
  const results = await page.evaluate(
    ({ metaKey }) => {
      const target = document.activeElement;
      if (!(target instanceof HTMLElement)) {
        throw new Error("Expected the blocking surface to own focus");
      }

      return ["b", "s", "k", "F1"].map((key) => {
        const event = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: key === "F1" ? false : !metaKey,
          key,
          metaKey: key === "F1" ? false : metaKey,
        });
        target.dispatchEvent(event);
        return { defaultPrevented: event.defaultPrevented, key };
      });
    },
    { metaKey: useMetaKey },
  );

  expect(results).toEqual([
    { defaultPrevented: false, key: "b" },
    { defaultPrevented: false, key: "s" },
    { defaultPrevented: false, key: "k" },
    { defaultPrevented: false, key: "F1" },
  ]);
  await expect(inspectorToggle).toHaveAttribute(
    "aria-expanded",
    inspectorExpanded ?? "false",
  );
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(focusTarget).toBeFocused();
}

export async function gotoSampleEditor(page: Page): Promise<void> {
  await page.goto("/");

  const pathStage = page.getByTestId("path-stage");
  const mobileWarning = page.getByRole("dialog", {
    name: "Mobile support warning",
  });
  const startHeading = page.getByRole("heading", {
    name: "Simple, rapid, robust.",
  });
  const initializationError = page.getByRole("alert");
  await expect(
    pathStage
      .or(mobileWarning)
      .or(startHeading)
      .or(initializationError)
      .first(),
  ).toBeVisible();

  if (await mobileWarning.isVisible()) {
    await mobileWarning.getByRole("button", { name: "Continue" }).click();
    await expect(
      pathStage.or(startHeading).or(initializationError).first(),
    ).toBeVisible();
  }

  if (await initializationError.isVisible()) {
    throw new Error(
      `BLine initialization failed: ${await initializationError.innerText()}`,
    );
  }
  if (await startHeading.isVisible()) {
    await page.getByRole("button", { name: "Open sample" }).click();
  }

  await expect(pathStage).toBeVisible();
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PointMeters {
  x_meters: number;
  y_meters: number;
}

type WorkspaceWriteSpyWindow = Window & {
  __blineWorkspaceWrites?: Array<{ key: string; at: number }>;
};

type SavedFilePickerWindow = Window & {
  __blineReleaseSaveFilePicker?: () => void;
  __blineSavedFiles?: Array<{ suggestedName: string; text: string }>;
  showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<{
    createWritable(): Promise<{
      close(): Promise<void>;
      write(data: Blob | string): Promise<void>;
    }>;
  }>;
};

type PixiDebugWindow = Window & {
  __blinePixiDebug?: {
    canvasMetrics(): {
      canvasHeight: number;
      canvasWidth: number;
      cssHeight: number;
      cssWidth: number;
      ratio: number;
      renderer: string;
      renderCount: number;
    };
    nodePosition(testId: string): { x: number; y: number } | null;
    fieldState(): {
      id: string;
      label: string;
      kind: string;
      imageLoaded: boolean;
    };
  };
};

export async function requiredBox(locator: Locator): Promise<Bounds> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Expected locator to have a bounding box");
  }

  return box;
}

export async function expectDialogOverPathLibrary(
  page: Page,
  dialogName: string,
): Promise<void> {
  const libraryBox = await requiredBox(
    page.getByRole("dialog", { name: "Project Navigator" }),
  );
  const dialogBox = await requiredBox(
    page.getByRole("dialog", { name: dialogName }),
  );
  const center = {
    x: dialogBox.x + dialogBox.width / 2,
    y: dialogBox.y + dialogBox.height / 2,
  };

  expect(center.x).toBeGreaterThan(libraryBox.x);
  expect(center.x).toBeLessThan(libraryBox.x + libraryBox.width);
  expect(center.y).toBeGreaterThan(libraryBox.y);
  expect(center.y).toBeLessThan(libraryBox.y + libraryBox.height);

  await expect
    .poll(() =>
      page.evaluate(({ x, y }) => {
        return (
          document
            .elementFromPoint(x, y)
            ?.closest("[role='dialog']")
            ?.getAttribute("aria-label") ?? null
        );
      }, center),
    )
    .toBe(dialogName);
}

export function pointBetweenFlyoutAndTrigger(
  triggerBox: Bounds,
  flyoutBox: Bounds,
): { x: number; y: number } {
  const triggerLeft = triggerBox.x;
  const triggerRight = triggerBox.x + triggerBox.width;
  const flyoutLeft = flyoutBox.x;
  const flyoutRight = flyoutBox.x + flyoutBox.width;
  const x =
    flyoutLeft >= triggerRight
      ? (triggerRight + flyoutLeft) / 2
      : triggerLeft >= flyoutRight
        ? (flyoutRight + triggerLeft) / 2
        : (Math.max(triggerLeft, flyoutLeft) +
            Math.min(triggerRight, flyoutRight)) /
          2;

  return {
    x,
    y: triggerBox.y + triggerBox.height / 2,
  };
}

export async function canvasNodePosition(
  page: Page,
  testId: string,
): Promise<{ x: number; y: number }> {
  let position: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        position = await page.evaluate((nodeTestId) => {
          return (
            (window as PixiDebugWindow).__blinePixiDebug?.nodePosition(
              nodeTestId,
            ) ?? null
          );
        }, testId);
        return position;
      },
      {
        message: `Expected canvas node "${testId}" to exist`,
      },
    )
    .not.toBeNull();

  if (!position) {
    throw new Error(`Expected canvas node "${testId}" to exist`);
  }

  return position;
}

export function pointDistance(
  first: { x: number; y: number },
  second: { x: number; y: number },
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export async function canvasSceneMetrics(page: Page): Promise<{
  count: number;
  ratios: number[];
  renderer: string;
}> {
  return page.evaluate(() => {
    const ratios = Array.from(
      document.querySelectorAll<HTMLCanvasElement>(".path-stage canvas"),
    ).map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return Number((canvas.width / rect.width).toFixed(2));
    });
    const debugMetrics = (
      window as PixiDebugWindow
    ).__blinePixiDebug?.canvasMetrics();

    return {
      count: ratios.length,
      ratios,
      renderer: debugMetrics?.renderer ?? "",
    };
  });
}

export async function activeFieldLabel(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      (window as PixiDebugWindow).__blinePixiDebug?.fieldState().label ?? null,
  );
}

export async function activeFieldImageLoaded(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as PixiDebugWindow).__blinePixiDebug?.fieldState().imageLoaded ??
      false,
  );
}

export function tinyPngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );
}

export async function simulationProgress(page: Page): Promise<{
  atEnd: boolean;
  current: number;
  total: number;
}> {
  const text = await page.getByTestId("simulation-time").innerText();
  const values = text.match(/\d+\.\d+/g)?.map(Number) ?? [];
  const [current = 0, total = 0] = values;

  return {
    atEnd: total > 0 && Math.abs(total - current) < 0.011,
    current,
    total,
  };
}

export async function installWorkspaceWriteSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    const spyWindow = window as WorkspaceWriteSpyWindow;

    spyWindow.__blineWorkspaceWrites = [];
    Storage.prototype.setItem = function setItemWithWorkspaceWriteSpy(
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.startsWith("bline-web:workspace:")) {
        spyWindow.__blineWorkspaceWrites?.push({
          key,
          at: performance.now(),
        });
      }

      return originalSetItem.call(this, key, value);
    };
  });
}

export async function resetWorkspaceWriteSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as WorkspaceWriteSpyWindow).__blineWorkspaceWrites = [];
  });
}

export async function workspaceWriteCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as WorkspaceWriteSpyWindow).__blineWorkspaceWrites?.length ?? 0,
  );
}

export async function disableDirectoryPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: undefined,
    });
  });
}

export async function installSaveFilePickerSpy(
  page: Page,
  { waitForRelease = false }: { waitForRelease?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    ({ shouldWait }) => {
      const spyWindow = window as SavedFilePickerWindow;
      spyWindow.__blineSavedFiles = [];

      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: async (options?: { suggestedName?: string }) => {
          if (shouldWait) {
            await new Promise<void>((resolve) => {
              spyWindow.__blineReleaseSaveFilePicker = resolve;
            });
          }

          return {
            createWritable: async () => ({
              close: async () => undefined,
              write: async (data: Blob | string) => {
                spyWindow.__blineSavedFiles?.push({
                  suggestedName: options?.suggestedName ?? "",
                  text: data instanceof Blob ? await data.text() : String(data),
                });
              },
            }),
          };
        },
      });
    },
    { shouldWait: waitForRelease },
  );
}

export async function releaseSaveFilePicker(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as SavedFilePickerWindow).__blineReleaseSaveFilePicker?.();
  });
}

export async function savedFileCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as SavedFilePickerWindow).__blineSavedFiles?.length ?? 0,
  );
}

export async function savedFile(
  page: Page,
  index: number,
): Promise<{ suggestedName: string; text: string }> {
  return page.evaluate((fileIndex) => {
    const file = (window as SavedFilePickerWindow).__blineSavedFiles?.[
      fileIndex
    ];
    if (!file) {
      throw new Error(`Expected saved file at index ${fileIndex}`);
    }
    return file;
  }, index);
}

export function parseStoredZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let offset = 0;

  while (offset < bytes.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) {
      break;
    }

    expect(signature).toBe(0x04034b50);
    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);
    expect(compressionMethod).toBe(0);
    expect(compressedSize).toBe(uncompressedSize);

    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;
    entries.set(
      decoder.decode(bytes.subarray(fileNameStart, fileNameEnd)),
      decoder.decode(bytes.subarray(dataStart, dataEnd)),
    );
    offset = dataEnd;
  }

  return entries;
}

export function requiredZipText(
  entries: Map<string, string>,
  name: string,
): string {
  const text = entries.get(name);
  if (text === undefined) {
    throw new Error(`Expected ZIP entry ${name}`);
  }
  return text;
}

export async function currentPathName(page: {
  getByTestId(testId: string): Locator;
}): Promise<string> {
  const currentPath = await page
    .getByTestId("current-path-status")
    .textContent();
  if (!currentPath?.startsWith("Current Path: ")) {
    throw new Error("Expected current path status to include a project name");
  }

  return currentPath.replace("Current Path: ", "");
}

export async function openProjectMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "File", exact: true }).click();
}

export async function openProjectPanelFromTopMenu(page: Page): Promise<void> {
  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Workspace" }).click();
  await page.getByRole("menuitem", { name: "Open Project..." }).click();
}

export async function runEditMenuAction(
  page: Page,
  action: "Undo" | "Redo",
): Promise<void> {
  // Undo/Redo now live on the toolbar rather than an Edit menu.
  await page.getByRole("button", { name: action, exact: true }).click();
}

export async function openPathMenu(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Path", exact: true }).click();
  const menu = page.getByTestId("top-menu-path");
  await expect(menu).toBeVisible();
  return menu;
}

export async function openPathManageMenu(page: Page): Promise<Locator> {
  await openPathMenu(page);
  await page.getByRole("menuitem", { name: "Manage Paths" }).click();
  const menu = page.getByTestId("top-menu-path-manage");
  await expect(menu).toBeVisible();
  return menu;
}

export async function openPathLibraryDialog(page: Page): Promise<Locator> {
  await page
    .getByRole("button", { name: "Open project navigator", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Project Navigator" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function selectToolbarOption(
  page: Page,
  label: "Toolbar collection" | "Toolbar path",
  optionName: string,
): Promise<void> {
  await page.getByLabel(label).click();
  await page
    .getByRole("listbox", { name: `${label} options` })
    .getByRole("option", { name: optionName, exact: true })
    .click();
}

export async function createPathGroupFromTopMenu(
  page: Page,
  groupName: string,
): Promise<void> {
  const dialog = await openPathLibraryDialog(page);
  await dialog.getByRole("button", { name: "Create collection" }).click();
  await page.getByTestId("path-collection-new-name").fill(groupName);
  await page.getByTestId("create-path-collection").click();
  await expect(page.getByTestId("current-path-status")).toContainText(
    `${groupName} /`,
  );
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
}

export async function addPathToGroupFromLibrary(
  page: Page,
  groupName: string,
  pathName: string,
): Promise<void> {
  const dialog = await openPathLibraryDialog(page);
  await dialog
    .locator(".path-library-dialog__group")
    .filter({ hasText: "All Paths" })
    .click();
  await dialog
    .locator(".path-library-dialog__path")
    .filter({ hasText: pathName })
    .click();
  const membershipRow = dialog
    .locator(".path-library-dialog__membership-row")
    .filter({ hasText: groupName });
  await membershipRow.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
}

export async function duplicateSelectedLibraryPath(
  page: Page,
  pathHeaderActions: Locator,
  displayName: string,
): Promise<void> {
  await pathHeaderActions.getByRole("button", { name: "Save path as" }).click();
  await submitNameDialog(page, "Save Path As", displayName, "Save Copy");
  await expect(
    page
      .getByRole("dialog", { name: "Project Navigator" })
      .locator(".path-library-dialog__path")
      .filter({ hasText: displayName }),
  ).toBeVisible();
}

export async function submitNameDialog(
  page: Page,
  dialogName: "Rename Collection" | "Rename Path" | "Save Path As",
  displayName: string,
  submitLabel: "Rename" | "Save Copy",
): Promise<void> {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").fill(displayName);
  await dialog.getByRole("button", { name: submitLabel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

export async function createNewProject(
  page: Page,
): Promise<{ pathName: string; projectName: string }> {
  await openProjectMenu(page);
  await page.getByRole("menuitem", { name: "Workspace" }).click();
  await page.getByRole("menuitem", { name: "New Project" }).click();
  createdProjectSequence += 1;
  const projectName = `Test Project ${createdProjectSequence}`;
  const pathName = `Test Path ${createdProjectSequence}`;
  const dialog = page.getByRole("dialog", { name: "Create project" });
  await dialog.getByRole("textbox", { name: "Project name" }).fill(projectName);
  await dialog.getByRole("textbox", { name: "First path name" }).fill(pathName);
  await dialog
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  return { pathName, projectName };
}

let createdProjectSequence = 0;

export async function openConstraintsTab(page: Page): Promise<void> {
  const constraintsTab = page.getByRole("tab", { name: /Constraints/ });
  if (!(await constraintsTab.isVisible())) {
    await page.getByRole("button", { name: "Toggle inspector" }).click();
  }
  await constraintsTab.click();
}

export async function createNewPathFromTopMenu(
  page: Page,
  pathName: string,
): Promise<void> {
  await openPathManageMenu(page);
  await page.getByRole("menuitem", { name: "Create New Path" }).click();
  const dialog = page.getByRole("dialog", { name: "Create New Path" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Path name").fill(pathName);
  await dialog.getByRole("button", { name: "Create Path" }).click();
}

export async function dismissMobileSupportWarning(page: Page): Promise<void> {
  const warning = page.getByRole("dialog", { name: "Mobile support warning" });
  if (await warning.isVisible()) {
    await warning.getByRole("button", { name: "Continue" }).click();
    await expect(warning).toHaveCount(0);
  }
}

export function modelToCanvasPoint(box: Bounds, point: PointMeters) {
  const fieldLengthMeters = 17.54;
  const fieldWidthMeters = 9.07;
  const fieldCoordinateOffsetMeters = 0.5;
  const padding = Math.min(24, box.width / 12, box.height / 12);
  const availableWidth = Math.max(1, box.width - padding * 2);
  const availableHeight = Math.max(1, box.height - padding * 2);
  const scale = Math.max(
    1,
    Math.min(
      availableWidth / fieldLengthMeters,
      availableHeight / fieldWidthMeters,
    ),
  );
  const viewportWidth = fieldLengthMeters * scale;
  const viewportHeight = fieldWidthMeters * scale;
  const viewportX = box.x + (box.width - viewportWidth) / 2;
  const viewportY = box.y + (box.height - viewportHeight) / 2;

  return {
    x: viewportX + (point.x_meters + fieldCoordinateOffsetMeters) * scale,
    y:
      viewportY +
      (fieldWidthMeters - point.y_meters - fieldCoordinateOffsetMeters) * scale,
  };
}

export async function expectPathElementTypes(
  page: Page,
  expectedTypes: readonly string[],
): Promise<void> {
  const rows = page.locator('[data-testid^="path-element-row-"]');
  await expect(rows).toHaveCount(expectedTypes.length);
  for (const [index, type] of expectedTypes.entries()) {
    await expect(rows.nth(index)).toContainText(`${index + 1}. ${type}`);
  }
}

interface LegacyFieldSeed {
  assetId: string;
  projectId: string;
}

export async function seedLegacyFieldProject(
  page: Page,
  bytes: readonly number[],
  includeAsset: boolean,
): Promise<LegacyFieldSeed> {
  const seeded = await page.evaluate(
    async ({ bytes, includeAsset }) => {
      const storageKey = Object.keys(window.localStorage).find((key) =>
        key.startsWith("bline-web:workspace:"),
      );
      if (!storageKey) {
        throw new Error("Expected a saved browser Project");
      }
      const record = JSON.parse(window.localStorage.getItem(storageKey) ?? "");
      const projectMetadata = JSON.parse(
        record.files.find(
          (file: { relativePath: string }) =>
            file.relativePath === "project.json",
        ).text,
      );
      const projectId = String(projectMetadata.project_id);
      const assetId = "legacy-practice.png";
      const fieldId = "custom:legacy-practice";
      const paths = projectMetadata.paths.map(
        (path: {
          path_id: string;
          display_name: string;
          file_name: string;
        }) => ({
          ...path,
          path: JSON.parse(
            record.files.find(
              (file: { relativePath: string }) =>
                file.relativePath === `paths/${path.file_name}`,
            ).text,
          ),
        }),
      );
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          document: {
            schema_version: 1,
            project_id: projectId,
            display_name: projectMetadata.display_name,
            config: {
              gui: {
                field: {
                  selected_field_id: fieldId,
                  custom_fields: [
                    {
                      id: fieldId,
                      name: "Legacy Practice Field",
                      asset_id: assetId,
                      file_name: assetId,
                      mime_type: "image/png",
                      size_bytes: bytes.length,
                      created_at: "2026-08-21T12:00:00.000Z",
                      geometry: {
                        length_meters: 8,
                        width_meters: 4,
                        coordinate_offset_meters: 0,
                      },
                    },
                  ],
                },
              },
            },
            paths,
            path_groups: projectMetadata.path_groups,
            ...(projectMetadata.linked_targets?.length
              ? { linked_targets: projectMetadata.linked_targets }
              : {}),
            active_path_id: paths[0]?.path_id ?? null,
            active_path_group_id: null,
          },
          version: record.version,
          updatedAt: record.updatedAt,
        }),
      );
      window.localStorage.removeItem("bline-web:user-data");
      if (includeAsset) {
        await putAsset(projectId, assetId, bytes);
      }
      return { assetId, projectId };

      async function putAsset(
        workspaceId: string,
        legacyAssetId: string,
        assetBytes: readonly number[],
      ): Promise<void> {
        const database = await openDatabase();
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("field-assets", "readwrite");
          transaction.objectStore("field-assets").put({
            key: `${encodeURIComponent(workspaceId)}:${encodeURIComponent(legacyAssetId)}`,
            workspaceId,
            assetId: legacyAssetId,
            fileName: legacyAssetId,
            mimeType: "image/png",
            bytes: new Uint8Array(assetBytes).buffer,
            updatedAt: new Date().toISOString(),
          });
          transaction.addEventListener("complete", () => resolve());
          transaction.addEventListener("error", () =>
            reject(transaction.error),
          );
        });
        database.close();
      }

      function openDatabase(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open("bline-web-field-assets", 1);
          request.addEventListener("upgradeneeded", () => {
            request.result.createObjectStore("field-assets", {
              keyPath: "key",
            });
          });
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () => reject(request.error));
        });
      }
    },
    { bytes: [...bytes], includeAsset },
  );
  return seeded;
}

export async function putLegacyFieldAsset(
  page: Page,
  seed: LegacyFieldSeed,
  bytes: readonly number[],
): Promise<void> {
  await page.evaluate(
    async ({ assetId, projectId, bytes }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("bline-web-field-assets", 1);
        request.addEventListener("upgradeneeded", () => {
          request.result.createObjectStore("field-assets", { keyPath: "key" });
        });
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error));
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("field-assets", "readwrite");
        transaction.objectStore("field-assets").put({
          key: `${encodeURIComponent(projectId)}:${encodeURIComponent(assetId)}`,
          workspaceId: projectId,
          assetId,
          fileName: assetId,
          mimeType: "image/png",
          bytes: new Uint8Array(bytes).buffer,
          updatedAt: new Date().toISOString(),
        });
        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("error", () => reject(transaction.error));
      });
      database.close();
    },
    { ...seed, bytes: [...bytes] },
  );
}

export async function waitForSavedProject(page: Page): Promise<void> {
  await gotoSampleEditor(page);
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("mobile-support-warning")).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
}

// Simulate another tab / external writer advancing the stored version so the
// app's cached version becomes stale. The browser adapter then throws a
// StorageConflictError on the next versioned write.
export async function bumpStoredWorkspaceVersion(page: Page): Promise<void> {
  await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((entry) =>
      entry.startsWith("bline-web:workspace:"),
    );
    if (!key) {
      throw new Error("no workspace record in localStorage");
    }
    const record = JSON.parse(window.localStorage.getItem(key) as string);
    record.version = `${record.version}-external-edit`;
    window.localStorage.setItem(key, JSON.stringify(record));
  });
}

export async function makeDirtyEdit(page: Page): Promise<void> {
  await page.getByTestId("path-element-row-1").click();
  await page.keyboard.press("ArrowRight");
}

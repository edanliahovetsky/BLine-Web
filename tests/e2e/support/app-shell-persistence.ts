import { expect, type Locator, type Page } from "@playwright/test";

import { gotoSampleEditor } from "./app-shell-shared";

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

let createdProjectSequence = 0;

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

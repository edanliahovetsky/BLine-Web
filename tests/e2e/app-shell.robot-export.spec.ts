import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { disableDirectoryPicker } from "./support/app-shell-persistence";
import { gotoSampleEditor } from "./support/app-shell-shared";

interface RobotPickerWindow extends Window {
  __robotPickerCalls?: number;
}

/**
 * Stands in for the folder picker with a real directory handle from the
 * origin-private file system, which (unlike a mock) can be remembered in
 * IndexedDB exactly as a picked folder is.
 */
async function installRobotProjectPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pickerWindow = window as RobotPickerWindow;
    pickerWindow.__robotPickerCalls = 0;
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: async () => {
        pickerWindow.__robotPickerCalls! += 1;
        const root = await navigator.storage.getDirectory();
        const robot = await root.getDirectoryHandle("RobotCode", {
          create: true,
        });
        let current = robot;
        for (const name of ["src", "main", "deploy"]) {
          current = await current.getDirectoryHandle(name, { create: true });
        }
        return robot;
      },
    });
  });
}

async function robotFileNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    let autos = await root.getDirectoryHandle("RobotCode");
    for (const name of ["src", "main", "deploy", "autos", "paths"]) {
      autos = await autos.getDirectoryHandle(name);
    }
    const names: string[] = [];
    for await (const name of (
      autos as unknown as { keys(): AsyncIterable<string> }
    ).keys()) {
      names.push(name);
    }
    return names.sort();
  });
}

async function openExportToRobot(page: Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export to Robot..." }).click();
  const dialog = page.getByRole("dialog", { name: "Export to robot" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test(
  "exports to the robot project's deploy autos and remembers the folder",
  { tag: "@smoke" },
  async ({ page }) => {
    await installRobotProjectPicker(page);
    await gotoSampleEditor(page);

    let dialog = await openExportToRobot(page);
    await expect(dialog).toContainText("src/main/deploy/autos");
    await dialog.getByRole("button", { name: "Choose robot project…" }).click();
    await expect(dialog.getByRole("status")).toContainText(
      "Saved 1 path to RobotCode/src/main/deploy/autos",
    );
    expect(await robotFileNames(page)).toEqual([
      expect.stringMatching(/\.json$/),
    ]);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);

    // The next export goes straight to the remembered robot project.
    dialog = await openExportToRobot(page);
    await expect(dialog).toContainText(
      "Saves this project’s paths to RobotCode/src/main/deploy/autos",
    );
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("Saved 1 path");
    expect(
      await page.evaluate(
        () => (window as RobotPickerWindow).__robotPickerCalls,
      ),
    ).toBe(1);

    await dialog.getByRole("button", { name: "Done" }).click();
    await page.keyboard.press("F1");
    await page
      .getByRole("searchbox", { name: "Search commands and paths" })
      .fill("export to robot");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Export to robot" }),
    ).toBeVisible();
  },
);

test("says upfront that browsers without folder access download autos.zip, which imports directly", async ({
  page,
}) => {
  await disableDirectoryPicker(page);
  await gotoSampleEditor(page);

  const dialog = await openExportToRobot(page);
  await expect(dialog).toContainText("downloads autos.zip");
  await expect(dialog).toContainText("src/main/deploy");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download autos.zip" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("autos.zip");
  await expect(dialog.getByRole("status")).toContainText(
    "Downloaded autos.zip with 1 path",
  );
  await dialog.getByRole("button", { name: "Done" }).click();

  // The same zip imports without unzipping it first.
  const zip = await readFile((await download.path())!);
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("menuitem", { name: "Import Autos ZIP..." }).click(),
  ]);
  expect(chooser.isMultiple()).toBe(false);
  await chooser.setFiles({
    name: "autos.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  const decision = page.getByRole("dialog", { name: /already/i });
  if (await decision.isVisible().catch(() => false)) {
    await decision.getByRole("button").first().click();
  }
  await expect(page.getByTestId("current-path-status")).toContainText(
    "Sample Path",
  );
});

test("explains a file that is not a usable autos zip", async ({ page }) => {
  await page.goto("/");
  const start = page.getByTestId("start-center");
  await start.getByRole("button", { name: "Import", exact: true }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    start
      .getByRole("button", { name: "Import autos ZIP", exact: true })
      .click(),
  ]);
  await chooser.setFiles({
    name: "autos.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("definitely not a zip"),
  });
  await expect(
    page.getByRole("dialog", { name: "Could not import" }),
  ).toContainText("isn't a ZIP archive");
});

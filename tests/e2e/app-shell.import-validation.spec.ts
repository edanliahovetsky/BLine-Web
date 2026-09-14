import { expect, test, type Page } from "@playwright/test";
import { gotoSampleEditor } from "./support/app-shell-shared";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deserializeBLineProjectArchive } from "../../src/core/io/blineProject";
import { serializeBLineProjectFolder } from "../../src/core/io/projectFolder";

async function importJson(
  page: Page,
  kind: "Archive" | "Path",
  input: unknown,
) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Import / Export", exact: true })
    .click();
  await page
    .getByRole("menuitem", {
      name: kind === "Archive" ? "Import Project Archive..." : "Import Path...",
      exact: true,
    })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "import.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(input)),
  });
}

function archive(name: string, projectId?: string) {
  return {
    bline_project_schema_version: 1,
    ...(projectId ? { project_id: projectId, display_name: name } : {}),
    config: {},
    paths: [
      {
        file_name: `${name}.json`,
        display_name: name,
        path: {
          path_elements: [{ type: "translation", x_meters: 1, y_meters: 2 }],
        },
      },
    ],
  };
}

async function storedProject(page: Page) {
  return page.evaluate(() => {
    const id = localStorage.getItem("bline-web:current-workspace")!;
    return { id, text: localStorage.getItem(`bline-web:workspace:${id}`) };
  });
}

test("imports two legacy archives and keeps both plus the original saved project", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const original = await storedProject(page);
  await importJson(page, "Archive", archive("First"));
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: First",
  );
  const first = await storedProject(page);
  await importJson(page, "Archive", archive("Second"));
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: Second",
  );
  const second = await storedProject(page);
  expect(new Set([original.id, first.id, second.id]).size).toBe(3);
  for (const saved of [original, first]) {
    expect(
      await page.evaluate(
        (id) => localStorage.getItem(`bline-web:workspace:${id}`),
        saved.id,
      ),
    ).toBe(saved.text);
  }
  await page.reload();
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: Second",
  );
});

test("cancelling a duplicate import keeps the existing project without a disk conflict", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const input = archive("Competition", "competition-id");
  await importJson(page, "Archive", input);
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: Competition",
  );
  const before = await storedProject(page);
  await importJson(page, "Archive", input);
  await expect(
    page.getByText(/already saved in this browser/).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: /changed on disk/i }),
  ).toHaveCount(0);
  expect(await storedProject(page)).toEqual(before);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
});

test("rejects unrelated JSON and then accepts an intentionally empty path", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  const before = await storedProject(page);
  await importJson(page, "Path", { unexpected: "not a path" });
  await expect(
    page.getByText(/does not contain a supported BLine path/).first(),
  ).toBeVisible();
  expect(await storedProject(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Could not import" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await importJson(page, "Path", { path_elements: [] });
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: import",
  );
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await page.reload();
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: import",
  );
});

test("reimports an edited archive by replacement, or keeps a separate copy", async ({
  page,
}, testInfo) => {
  await gotoSampleEditor(page);
  const original = archive("Competition", "competition-id");
  await importJson(page, "Archive", original);
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: Competition",
  );
  const updated = structuredClone(original);
  updated.paths[0].display_name = "Updated path";
  updated.paths[0].path.path_elements[0].x_meters = 7.25;
  await importJson(page, "Archive", updated);
  const dialog = page.getByRole("dialog", {
    name: "Project already saved",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("reimport-dialog.png") });
  await dialog
    .getByRole("button", { name: "Replace saved project", exact: true })
    .click();
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: Updated path",
  );
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  const replaced = await storedProject(page);
  expect(replaced.id).toBe("competition-id");
  await page.reload();
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: Updated path",
  );

  await importJson(page, "Archive", original);
  await dialog
    .getByRole("button", { name: "Import as copy", exact: true })
    .click();
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: Competition",
  );
  expect((await storedProject(page)).id).not.toBe(replaced.id);
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`bline-web:workspace:${id}`),
      replaced.id,
    ),
  ).toBe(replaced.text);
});

test("round-trips an updated autos folder into both original and separate browser storage", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const folderPath = testInfo.outputPath("autos");
  const source = archive("Opening Move", "roundtrip-id");
  async function writeFolder(input: ReturnType<typeof archive>) {
    const folder = serializeBLineProjectFolder(
      deserializeBLineProjectArchive(input),
    );
    for (const file of folder.files) {
      const target = path.join(folderPath, file.relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(await file.blob.arrayBuffer()));
    }
  }
  async function importFolder(target: Page) {
    const chooser = target.waitForEvent("filechooser");
    await target.getByRole("button", { name: "File", exact: true }).click();
    await target
      .getByRole("menuitem", { name: "Import / Export", exact: true })
      .click();
    await target
      .getByRole("menuitem", { name: "Import Autos Folder...", exact: true })
      .click();
    await (await chooser).setFiles(folderPath);
  }

  await writeFolder(source);
  await gotoSampleEditor(page);
  await importFolder(page);
  await expect(page.getByTestId("current-path-status")).toHaveText(
    "Current Path: Opening Move",
  );
  const separate = await browser.newContext({ baseURL });
  try {
    const second = await separate.newPage();
    await gotoSampleEditor(second);
    await importFolder(second);
    await expect(second.getByTestId("current-path-status")).toHaveText(
      "Current Path: Opening Move",
    );
    const changed = structuredClone(source);
    changed.paths[0].display_name = "Changed in second tab";
    changed.paths[0].path.path_elements[0].x_meters = 7.25;
    await writeFolder(changed);
    for (const target of [page, second]) {
      await importFolder(target);
      const dialog = target.getByRole("dialog", {
        name: "Project already saved",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", { name: "Replace saved project", exact: true })
        .click();
      await expect(target.getByTestId("current-path-status")).toHaveText(
        "Current Path: Changed in second tab",
      );
      expect((await storedProject(target)).id).toBe("roundtrip-id");
      await target.reload();
      await expect(target.getByTestId("current-path-status")).toHaveText(
        "Current Path: Changed in second tab",
      );
    }
  } finally {
    await separate.close();
  }
});

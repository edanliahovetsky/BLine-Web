import { expect, test, type Page } from "@playwright/test";
import { gotoSampleEditor } from "./support/app-shell-shared";

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

test("a real duplicate import explains the existing project without a disk conflict", async ({
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
  await page.getByRole("button", { name: "OK", exact: true }).click();
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

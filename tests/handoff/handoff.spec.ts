import { expect, type Page } from "@playwright/test";
import {
  activeFieldImageLoaded,
  activeFieldLabel,
  seedLegacyFieldProject,
  tinyPngBuffer,
} from "../e2e/support/app-shell-fields";
import {
  createNewProject,
  currentPathName,
} from "../e2e/support/app-shell-persistence";
import { gotoSampleEditor } from "../e2e/support/app-shell-shared";
import { test as serverTest } from "./handoffServer";

const test = serverTest.extend({
  baseURL: async ({ handoff }, provide) => provide(handoff.source),
});

/** Every saved BLine record, as the browser holds it for this origin. */
async function savedRecords(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter(
          (key) =>
            key.startsWith("bline-web:workspace:") ||
            key === "bline-web:current-workspace",
        )
        .map((key) => [key, localStorage.getItem(key)!]),
    ),
  );
}

async function saveProjectWork(page: Page): Promise<string> {
  await gotoSampleEditor(page);
  await createNewProject(page);
  await expect(page.getByTestId("path-stage")).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  return currentPathName(page);
}

async function expectArrival(page: Page, target: string, from: string) {
  await expect(page).toHaveURL(`${target}/`);
  const notice = page.getByTestId("handoff-notice");
  await expect(notice).toHaveAttribute("data-outcome", "arrived");
  await expect(notice).toContainText("BLine moved to bline.run");
  await expect(notice).toContainText(new URL(from).host);
  await notice.getByRole("button", { name: "Continue" }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId("path-stage")).toBeVisible();
}

test("a beta tester's projects follow them to bline.run", async ({
  page,
  handoff,
}) => {
  const pathName = await saveProjectWork(page);
  const before = await savedRecords(page);
  expect(Object.keys(before).length).toBeGreaterThan(2);

  handoff.publishHandoff();
  await page.goto("/");

  await expectArrival(page, handoff.target, handoff.source);
  expect(await currentPathName(page)).toBe(pathName);
  const after = await savedRecords(page);
  for (const key of Object.keys(before)) expect(after).toHaveProperty(key);

  // The old address remembers the move and sends later visits straight on.
  await page.goto("/");
  await expect(page).toHaveURL(`${handoff.target}/`);
  await expect(page.getByTestId("path-stage")).toBeVisible();
  await expect(page.getByTestId("handoff-notice")).toHaveCount(0);
  expect(handoff.uploads).toBe(1);
});

test("a stable user's older project and custom field image arrive", async ({
  page,
  handoff,
}) => {
  await gotoSampleEditor(page);
  await seedLegacyFieldProject(page, [...tinyPngBuffer()], true);

  handoff.publishHandoff();
  await page.goto("/");

  await expectArrival(page, handoff.target, handoff.source);
  await expect.poll(() => activeFieldLabel(page)).toBe("Legacy Practice Field");
  await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);
});

test("a visitor with nothing saved goes straight on, keeping the link", async ({
  page,
  handoff,
}) => {
  handoff.publishHandoff();
  await page.goto("/?lesson=handoff-modes");

  await expect(page).toHaveURL(new RegExp(`^${handoff.target}/`));
  expect(handoff.targetRequests).toContain("/?lesson=handoff-modes");
  expect(handoff.uploads).toBe(0);
  await expect(page.getByTestId("handoff-notice")).toHaveCount(0);
});

test("a failed move keeps projects on the old address until a retry works", async ({
  page,
  handoff,
}) => {
  const pathName = await saveProjectWork(page);

  handoff.publishHandoff();
  handoff.failUploads(true);
  await page.goto("/");
  const notice = page.getByTestId("handoff-notice");
  await expect(notice).toHaveAttribute("data-outcome", "source-failed");
  await expect(page).toHaveURL(`${handoff.source}/`);
  await notice.getByRole("button", { name: "Keep working here" }).click();
  await expect(page.getByTestId("path-stage")).toBeVisible();
  expect(await currentPathName(page)).toBe(pathName);

  // The next visit tries again; this time bline.run accepts the projects.
  await page.reload();
  await expect(notice).toHaveAttribute("data-outcome", "source-failed");
  handoff.failUploads(false);
  await notice.getByRole("button", { name: "Try again" }).click();

  await expectArrival(page, handoff.target, handoff.source);
  expect(await currentPathName(page)).toBe(pathName);
});

test("projects already on bline.run are kept when others arrive", async ({
  page,
  handoff,
}) => {
  await page.goto(`${handoff.target}/`);
  await page.getByRole("button", { name: "Sample path" }).click();
  await createNewProject(page);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  const targetPath = await currentPathName(page);
  const targetRecords = await savedRecords(page);

  await saveProjectWork(page);
  const sourceRecords = await savedRecords(page);
  handoff.publishHandoff();
  await page.goto("/");

  await expectArrival(page, handoff.target, handoff.source);
  expect(await currentPathName(page)).toBe(targetPath);
  const merged = await savedRecords(page);
  for (const [key, value] of Object.entries(targetRecords)) {
    if (key.startsWith("bline-web:workspace:")) expect(merged[key]).toBe(value);
  }
  for (const key of Object.keys(sourceRecords)) {
    expect(merged).toHaveProperty(key);
  }
});

test("an expired pickup offers to send the projects again", async ({
  page,
  handoff,
}) => {
  const pathName = await saveProjectWork(page);

  handoff.publishHandoff();
  handoff.expireUploads(true);
  await page.goto("/");
  const notice = page.getByTestId("handoff-notice");
  await expect(notice).toHaveAttribute("data-outcome", "arrival-failed");
  await expect(notice).toContainText(new URL(handoff.source).host);

  handoff.expireUploads(false);
  await notice.getByRole("link", { name: "Try again" }).click();

  await expectArrival(page, handoff.target, handoff.source);
  expect(await currentPathName(page)).toBe(pathName);
  expect(handoff.uploads).toBe(2);
});

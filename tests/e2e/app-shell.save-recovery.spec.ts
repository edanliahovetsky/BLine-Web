import { expect, test, type Page } from "@playwright/test";
import { gotoSampleEditor } from "./support/app-shell-shared";

// Only the IO seam is faked; all edits, autosave, dialog actions and persistence
// run through the real application. Native filesystem behavior has Rust tests.
type RecoveryFixture = {
  missing: boolean;
  recreations: number;
  release?: () => void;
};
type RecoveryWindow = Window & { __recoveryFixture?: RecoveryFixture };

async function missingFolder(page: Page) {
  await page.evaluate(async () => {
    const { projectStore }: typeof import("../../src/state/projectStore") =
      await import(/* @vite-ignore */ "/src/state/projectStore.ts" as string);
    const io = projectStore.getState().io!;
    const save = io.saveWorkspace.bind(io);
    const fixture: RecoveryFixture = { missing: true, recreations: 0 };
    (window as RecoveryWindow).__recoveryFixture = fixture;
    io.capabilities.directFileAutosave = true;
    io.saveWorkspace = async (...args) => {
      if (fixture.missing)
        throw new Error(
          "Desktop project directory does not exist: /example/robot/src/main/deploy/autos",
        );
      return save(...args);
    };
    io.recreateProjectFolder = async (current, project) => {
      fixture.recreations += 1;
      await new Promise<void>((resolve) => {
        fixture.release = resolve;
      });
      fixture.missing = false;
      return save(current, project);
    };
  });
}

async function editEvent(page: Page, key: string) {
  const row = page.getByTestId("path-element-row-4");
  if (!(await row.isVisible())) {
    await page.getByRole("button", { name: "Toggle inspector" }).click();
  }
  await row.click();
  const input = page.getByLabel("Lib Key", { exact: true });
  await input.fill(key);
  await input.press("Tab");
}

for (const width of [1280, 390]) {
  test(`immediately offers folder recovery at ${width}px @webkit-canvas`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await gotoSampleEditor(page);
    await missingFolder(page);
    await editEvent(page, "recoverThisEvent");
    const dialog = page.getByRole("dialog", {
      name: "Project folder is missing",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Leave without saving", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Recreate folder", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      )
      .toBe(true);
    await expect
      .poll(async () => (await dialog.boundingBox())!.height)
      .toBeLessThan(768);
    await dialog.screenshot({
      path: testInfo.outputPath(`recovery-${width}.png`),
    });
    // Retry on an unavailable folder keeps both the project and recovery open.
    await dialog
      .getByRole("button", { name: "Retry save", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Recreate folder", exact: true }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "Recreate folder", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Recreating…", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Keep editing", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.evaluate(() =>
      (window as RecoveryWindow).__recoveryFixture!.release!(),
    );
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("save-status")).toContainText("Saved");
    await expect(page.getByLabel("Lib Key", { exact: true })).toHaveValue(
      "recoverThisEvent",
    );
    expect(
      await page.evaluate(
        () => (window as RecoveryWindow).__recoveryFixture!.recreations,
      ),
    ).toBe(1);
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const {
            projectStore,
          }: typeof import("../../src/state/projectStore") = await import(
            /* @vite-ignore */ "/src/state/projectStore.ts" as string
          );
          return projectStore.getState().dirty;
        }),
      )
      .toBe(false);
    // Recovery returns to normal autosave, and a later outage is surfaced again.
    await editEvent(page, "afterRecovery");
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const {
            projectStore,
          }: typeof import("../../src/state/projectStore") = await import(
            /* @vite-ignore */ "/src/state/projectStore.ts" as string
          );
          return projectStore.getState().dirty;
        }),
      )
      .toBe(false);
    await page.evaluate(() => {
      (window as RecoveryWindow).__recoveryFixture!.missing = true;
    });
    await editEvent(page, "anotherOutage");
    await expect(dialog).toBeVisible();
  });
}

test("retry succeeds after the folder is restored @webkit-canvas", async ({
  page,
}) => {
  await gotoSampleEditor(page);
  await missingFolder(page);
  await editEvent(page, "retryThisEvent");
  const dialog = page.getByRole("dialog", {
    name: "Project folder is missing",
  });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("Save failed");
  // Restore the IO seam and retry in the same turn: an already queued autosave
  // may otherwise recover first and close the dialog before the click arrives.
  await dialog
    .getByRole("button", { name: "Retry save", exact: true })
    .evaluate((button) => {
      (window as RecoveryWindow).__recoveryFixture!.missing = false;
      (button as HTMLButtonElement).click();
    });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  expect(
    await page.evaluate(
      () => (window as RecoveryWindow).__recoveryFixture!.recreations,
    ),
  ).toBe(0);
  await page.reload();
  await page.getByTestId("path-element-row-4").click();
  await expect(page.getByLabel("Lib Key", { exact: true })).toHaveValue(
    "retryThisEvent",
  );
});

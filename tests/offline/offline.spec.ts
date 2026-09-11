import { expect, type Page } from "@playwright/test";
import { openConstraintsTab } from "../e2e/support/app-shell-constraints";
import {
  activeFieldImageLoaded,
  activeFieldLabel,
  tinyPngBuffer,
} from "../e2e/support/app-shell-fields";
import { gotoSampleEditor } from "../e2e/support/app-shell-shared";
import {
  installSaveFilePickerSpy,
  savedFile,
  savedFileCount,
} from "../e2e/support/app-shell-persistence";
import { openPathMenu } from "../e2e/support/app-shell-project-library";
import { test } from "./productionServer";

async function prepareOffline(page: Page): Promise<void> {
  await gotoSampleEditor(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // The first page is not claimed mid-session. Its next navigation is served
  // by the fully installed worker, just like a return visit by a user.
  await page.reload();
  await expect(page.getByTestId("path-stage")).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(
    true,
  );
}

async function editAndSave(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await page.getByTestId("path-element-row-0").click();
  await page.getByLabel("X (m)", { exact: true }).fill("6.25");
  await page.getByLabel("X (m)", { exact: true }).press("Tab");
  await expect(page.getByTestId("save-status")).toContainText("Saved");
}

async function fieldBytes(page: Page): Promise<number[]> {
  return page.evaluate(async () =>
    Array.from(
      new Uint8Array(
        await (await fetch("/assets/fields/field26.png")).arrayBuffer(),
      ),
    ),
  );
}

test("reopens, edits, simulates, and starts the optimizer offline", async ({
  page,
  context,
  production,
}) => {
  await installSaveFilePickerSpy(page);
  await prepareOffline(page);
  expect(page.workers()).toHaveLength(0);
  await context.setOffline(true);
  const response = await page.reload();
  expect(response?.fromServiceWorker()).toBe(true);
  await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);

  // Includes every field, optional chunk, icon and the not-yet-run solver.
  const assets = [...production.release.keys()].filter(
    (path) =>
      path !== "/sw.js" &&
      !path.startsWith("/workbox-") &&
      /\.(?:html|js|css|png|webmanifest)$/.test(path),
  );
  const loaded = await page.evaluate(
    async (paths) =>
      Promise.all(
        paths.map(async (path) => {
          const response = await fetch(path);
          return {
            path,
            ok: response.ok,
            size: (await response.arrayBuffer()).byteLength,
          };
        }),
      ),
    assets,
  );
  for (const result of loaded) {
    expect(result.ok, result.path).toBe(true);
    expect(result.size, result.path).toBe(
      production.release.get(result.path)!.length,
    );
  }

  await editAndSave(page);
  await page.reload();
  await page.getByTestId("path-element-row-0").click();
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue("6.25");
  await openPathMenu(page);
  await page.getByRole("menuitem", { name: "Import / Export" }).click();
  await page.getByRole("menuitem", { name: "Export Path..." }).click();
  await expect.poll(() => savedFileCount(page)).toBe(1);
  const exported = JSON.parse((await savedFile(page, 0)).text);
  expect(exported.path_elements[0].translation_target.x_meters).toBe(6.25);
  await page
    .getByRole("button", { name: "Play simulation", exact: true })
    .click();
  await expect
    .poll(() => page.getByTestId("simulation-time").innerText())
    .not.toMatch(/^0\.00/);
  await page
    .getByRole("button", { name: "Pause simulation", exact: true })
    .click();

  await openConstraintsTab(page);
  const card = page.getByTestId("constraint-card-max_velocity_meters_per_sec");
  await page
    .getByTestId("constraint-range-max_velocity_meters_per_sec-0")
    .click();
  await page.getByLabel("Delete constraint 1").click();
  const workerStarted = page.waitForEvent("worker");
  await card.getByRole("button", { name: "Generate constraints" }).click();
  expect((await workerStarted).url()).toContain("autoVelocity.worker-");
  await expect(card.getByRole("status")).toHaveText("Up to date");
});

test("preserves custom field images and User Data across offline reloads", async ({
  page,
  context,
}) => {
  await prepareOffline(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByRole("button", { name: "Field", exact: true }).click();
  await dialog
    .getByLabel("Field Image", { exact: true })
    .selectOption("frc2022-rapid-react");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => activeFieldLabel(page)).toBe("Rapid React 2022");
  await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByRole("button", { name: "Field", exact: true }).click();
  await dialog.getByLabel("Upload field image").setInputFiles({
    name: "practice.png",
    mimeType: "image/png",
    buffer: tinyPngBuffer(),
  });
  await dialog.getByLabel("Field Name").fill("Offline practice field");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => activeFieldLabel(page))
    .toBe("Offline practice field");
  await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);
  await page.reload();
  await expect
    .poll(() => activeFieldLabel(page))
    .toBe("Offline practice field");
  await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);
});

test("retains the working release after an interrupted update, then updates after all tabs close", async ({
  page,
  context,
  production,
}) => {
  await prepareOffline(page);
  const oldField = await fieldBytes(page);
  const otherTab = await context.newPage();
  await otherTab.goto(production.url);
  production.publishUpdate();
  production.fail("/assets/fields/field26.png");
  await page.evaluate(async () =>
    (await navigator.serviceWorker.ready).update(),
  );
  await expect.poll(() => production.failedRequests.length).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return !registration.installing && !registration.waiting;
      }),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("path-stage")).toBeVisible();
  expect(await fieldBytes(page)).toEqual(oldField);
  await expect(page.locator('meta[name="offline-test-release"]')).toHaveCount(
    0,
  );
  await editAndSave(page);

  production.fail(null);
  await context.setOffline(false);
  await page.evaluate(async () =>
    (await navigator.serviceWorker.ready).update(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        async () => !!(await navigator.serviceWorker.ready).waiting,
      ),
    )
    .toBe(true);
  // A complete update also leaves the active editor and its stable PNG alone.
  await page.reload();
  await expect(page.locator('meta[name="offline-test-release"]')).toHaveCount(
    0,
  );
  expect(await fieldBytes(page)).toEqual(oldField);
  await page.close();
  expect(
    await otherTab.evaluate(
      async () => !!(await navigator.serviceWorker.ready).waiting,
    ),
  ).toBe(true);
  await otherTab.close();
  await context.setOffline(true);
  // Activation is asynchronous after the final client closes. A probe that
  // catches the old version closes too, so it cannot hold that version open.
  let reopened!: Page;
  await expect
    .poll(async () => {
      const probe = await context.newPage();
      await probe.goto(production.url);
      if (await probe.locator('meta[name="offline-test-release"]').count()) {
        reopened = probe;
        return true;
      }
      await probe.close();
      return false;
    })
    .toBe(true);
  expect(await fieldBytes(reopened)).toEqual(
    Array.from(production.release.get("/assets/fields/field22.png")!),
  );
  await reopened.getByTestId("path-element-row-0").click();
  await expect(reopened.getByLabel("X (m)", { exact: true })).toHaveValue(
    "6.25",
  );
});

test("retries an incomplete first download when the connection returns", async ({
  page,
  context,
  production,
}) => {
  production.fail("/assets/fields/field22.png");
  await gotoSampleEditor(page);
  await expect.poll(() => production.failedRequests.length).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        return registrations.every(
          (entry) => !entry.installing && !entry.active,
        );
      }),
    )
    .toBe(true);
  await context.setOffline(true);
  await editAndSave(page);
  production.fail(null);
  await context.setOffline(false);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await context.setOffline(true);
  await page.reload();
  await page.getByTestId("path-element-row-0").click();
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue("6.25");
});

test("opens saved work offline after the browser restarts", async ({
  playwright,
  production,
}, testInfo) => {
  const profile = testInfo.outputPath("browser-profile");
  const options = {
    baseURL: production.url,
    viewport: { width: 1280, height: 720 },
  };
  const first = await playwright.chromium.launchPersistentContext(
    profile,
    options,
  );
  try {
    const page = first.pages()[0]!;
    await prepareOffline(page);
    await editAndSave(page);
  } finally {
    await first.close();
  }
  const reopened = await playwright.chromium.launchPersistentContext(profile, {
    ...options,
    offline: true,
  });
  try {
    const page = reopened.pages()[0]!;
    const response = await page.goto(production.url);
    expect(response?.fromServiceWorker()).toBe(true);
    await page.getByTestId("path-element-row-0").click();
    await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue("6.25");
    await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);
  } finally {
    await reopened.close();
  }
});

test("keeps editing available when service-worker registration is denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.serviceWorker.register = () =>
      Promise.reject(new DOMException("Storage disabled", "SecurityError"));
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await gotoSampleEditor(page);
  await editAndSave(page);
  expect(errors).toEqual([]);
});

test("does not register a browser service worker inside Tauri", async ({
  page,
  production,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(globalThis, "isTauri", { value: true }),
  );
  await page.goto(production.url);
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker
        .getRegistrations()
        .then((entries) => entries.length),
    ),
  ).toBe(0);
  expect(production.requests).not.toContain("/sw.js");
});

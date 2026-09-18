import { expect, type Page } from "@playwright/test";
import { openConstraintsTab } from "../e2e/support/app-shell-constraints";
import {
  activeFieldImageLoaded,
  activeFieldLabel,
  tinyPngBuffer,
} from "../e2e/support/app-shell-fields";
import {
  gotoSampleEditor,
  openProjectSettings,
  requiredBox,
} from "../e2e/support/app-shell-shared";
import { modelToCanvasPoint } from "../e2e/support/app-shell-canvas";
import {
  installSaveFilePickerSpy,
  openProjectMenu,
  savedFile,
  savedFileCount,
} from "../e2e/support/app-shell-persistence";
import { test } from "./productionServer";
import type { ProjectStore } from "../../src/state/projectStore";

declare global {
  interface Window {
    __offlineTest: {
      store: ProjectStore;
      releaseSave?: () => void;
      saveStarted?: boolean;
    };
  }
}

async function prepareOffline(page: Page): Promise<void> {
  await gotoSampleEditor(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // Exercise a return visit through the completely installed worker.
  await page.reload();
  await expect(page.getByTestId("path-stage")).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(
    true,
  );
}

test("offline fallback survives hosting analytics injection into HTML", async ({
  page,
  production,
}) => {
  production.injectAnalytics(true);
  await prepareOffline(page);
  expect(await page.locator("html").getAttribute("data-host-analytics")).toBe(
    "injected",
  );
  await production.stopServing();
  await page.reload();
  await expect(page.getByTestId("path-stage")).toBeVisible();
  await expect(page.locator('meta[name="bline-offline"]')).toHaveAttribute(
    "content",
    "true",
  );
  expect(
    await page.locator("html").getAttribute("data-host-analytics"),
  ).toBeNull();
  await editAndSave(page);
  await page.reload();
  await page.getByTestId("path-element-row-0").click();
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue("6.25");
});

for (const varyOrigin of [false, true]) {
  for (const disconnect of ["browser-offline", "server-stopped"] as const) {
    test(`offline asset loading with Vary: Origin ${varyOrigin ? "enabled" : "disabled"}, ${disconnect}`, async ({
      page,
      context,
      production,
    }, testInfo) => {
      production.varyOrigin(varyOrigin);
      const firstResponse = await page.goto("/");
      expect(firstResponse?.headers().vary ?? null).toBe(
        varyOrigin ? "Origin" : null,
      );
      await prepareOffline(page);
      const cacheComparison = await page.evaluate(async () => {
        const mainScript = document.querySelector<HTMLScriptElement>(
          'script[type="module"][src]',
        )!.src;
        const cacheName = (await caches.keys()).find(
          (name) =>
            name.startsWith("bline-offline-v2:") && !name.endsWith(":metadata"),
        )!;
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        const stored = keys.find((key) => key.url === mainScript)!;
        return {
          mainScript,
          cacheName,
          storedOrigin: stored.headers.get("Origin"),
          varyingHeader: (await cache.match(stored))?.headers.get("Vary"),
          assetPresent: !!(await cache.match(stored)),
        };
      });
      await testInfo.attach("header-comparison", {
        body: JSON.stringify(
          {
            varyOrigin,
            disconnect,
            cacheComparison,
            networkOrigins: production.requestOrigins,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
      expect(cacheComparison.assetPresent).toBe(true);
      if (disconnect === "browser-offline") await context.setOffline(true);
      else await production.stopServing();
      await page.reload();
      await expect(page.getByTestId("path-stage")).toBeVisible();
      await editAndSave(page);
      await page.reload();
      await page.getByTestId("path-element-row-0").click();
      await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue(
        "6.25",
      );
    });
  }
}

async function editAndSave(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await page.getByTestId("path-element-row-0").click();
  await page.getByLabel("X (m)", { exact: true }).fill("6.25");
  await page.getByLabel("X (m)", { exact: true }).press("Tab");
  await expect(page.getByTestId("save-status")).toContainText("Saved");
}

test("upgrades the previous worker and preserves its Vary-bearing cached release", async ({
  page,
  context,
  production,
}) => {
  production.publishPrevious();
  await prepareOffline(page);
  await editAndSave(page);
  const before = await page.evaluate(async () => ({
    caches: (await caches.keys()).sort(),
    projects: Object.fromEntries(
      Object.entries(localStorage).filter(([key]) =>
        key.startsWith("bline-web:workspace:"),
      ),
    ),
  }));
  production.publishCurrent();
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const changed = new Promise<void>((resolve) =>
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => resolve(),
        { once: true },
      ),
    );
    await registration.update();
    await changed;
  });
  const after = await page.evaluate(async () => ({
    caches: (await caches.keys()).sort(),
    projects: Object.fromEntries(
      Object.entries(localStorage).filter(([key]) =>
        key.startsWith("bline-web:workspace:"),
      ),
    ),
  }));
  expect(after).toEqual(before);
  await production.stopServing();
  await page.reload();
  await expect(page.getByTestId("path-stage")).toBeVisible();
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await page.getByTestId("path-element-row-0").click();
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue("6.25");
  await editAndSave(page);
  const reopened = await context.newPage();
  await reopened.goto(production.url);
  await expect(reopened.getByTestId("path-stage")).toBeVisible();
  await reopened.getByRole("tab", { name: "Elements", exact: true }).click();
  await reopened.getByTestId("path-element-row-0").click();
  await expect(reopened.getByLabel("X (m)", { exact: true })).toHaveValue(
    "6.25",
  );
});

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
      path !== "/index.html" &&
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
  await openProjectMenu(page);
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
  production,
}) => {
  await prepareOffline(page);
  await context.setOffline(true);
  await openProjectSettings(page);
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByRole("button", { name: "Field", exact: true }).click();
  await dialog
    .getByLabel("Field Image", { exact: true })
    .selectOption("frc2022-rapid-react");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => activeFieldLabel(page)).toBe("Rapid React 2022");
  await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);

  await openProjectSettings(page);
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
  await context.setOffline(false);
  production.publishUpdate();
  await updateWorker(page);
  await awaitOfflineRelease(page, releaseId(production.nextRelease));
  await context.setOffline(true);
  await page.reload();
  expect(await pageRelease(page)).toBe(releaseId(production.nextRelease));
  await expect
    .poll(() => activeFieldLabel(page))
    .toBe("Offline practice field");
  await expect.poll(() => activeFieldImageLoaded(page)).toBe(true);
});

function releaseId(files: Map<string, Buffer>): string {
  return files
    .get("/index.html")!
    .toString()
    .match(/name="bline-release" content="([a-f0-9]+)"/)![1]!;
}

async function pageRelease(page: Page): Promise<string | null> {
  return page.locator('meta[name="bline-release"]').getAttribute("content");
}

async function awaitOfflineRelease(page: Page, id: string): Promise<void> {
  await expect
    .poll(() =>
      page
        .evaluate(async () => {
          const name = (await caches.keys()).find((name) =>
            name.endsWith(":metadata"),
          );
          if (!name) return null;
          const latest = await (
            await caches.open(name)
          ).match(new URL(".bline-latest", location.origin).href);
          return latest ? (await latest.json()).id : null;
        })
        .catch((error: unknown) => {
          if (
            error instanceof Error &&
            error.message.includes("Execution context was destroyed")
          )
            return null;
          throw error;
        }),
    )
    .toBe(id);
}

async function updateWorker(page: Page): Promise<void> {
  await page
    .evaluate(async () => (await navigator.serviceWorker.ready).update())
    .catch((error: unknown) => {
      if (
        !(
          error instanceof Error &&
          error.message.includes("Execution context was destroyed")
        )
      )
        throw error;
    });
}

test("online refresh opens the new release while an editing tab waits, then updates offline", async ({
  page,
  context,
  production,
}) => {
  await prepareOffline(page);
  await editAndSave(page);
  const original = releaseId(production.release);
  const next = releaseId(production.nextRelease);
  const oldTab = await context.newPage();
  await oldTab.goto(production.url);
  await oldTab.getByTestId("path-element-row-0").click();
  await oldTab.getByLabel("X (m)", { exact: true }).focus();
  production.publishUpdate();
  await page.reload();
  await expect.poll(() => pageRelease(page)).toBe(next);
  expect(await pageRelease(oldTab)).toBe(original);
  await expect(page.locator("html")).toHaveAttribute(
    "data-offline-test-build",
    "next",
  );
  await awaitOfflineRelease(page, next);
  await oldTab.waitForTimeout(1500);
  expect(await pageRelease(oldTab)).toBe(original);
  await context.setOffline(true);
  // Old pages still get their exact unexecuted worker and lazy chunks.
  for (const path of [...production.release.keys()].filter(
    (path) => path.startsWith("/assets/") && /\.(js|css|png)$/.test(path),
  )) {
    const bytes = await oldTab.evaluate(
      async (path) =>
        Array.from(new Uint8Array(await (await fetch(path)).arrayBuffer())),
      path,
    );
    expect(bytes, path).toEqual(Array.from(production.release.get(path)!));
  }
  await page.reload();
  expect(await pageRelease(page)).toBe(next);
  await page.getByTestId("path-element-row-0").click();
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue("6.25");
  production.fail("/index.html");
  await oldTab.getByRole("tab", { name: "Elements", exact: true }).click();
  await expect.poll(() => pageRelease(oldTab)).toBe(next);
  await expect(oldTab.getByTestId("offline-indicator")).toBeVisible();
});

test("failed updates preserve the complete fallback while the new online page can open", async ({
  page,
  context,
  production,
}) => {
  await prepareOffline(page);
  const original = releaseId(production.release);
  const next = releaseId(production.nextRelease);
  const worker = [...production.nextRelease.keys()].find((path) =>
    path.includes("autoVelocity.worker-"),
  )!;
  expect(production.release.has(worker)).toBe(false);
  production.publishUpdate();
  production.fail(worker);
  await page.reload();
  expect(await pageRelease(page)).toBe(next);
  await expect
    .poll(() => production.failedRequests.includes(worker))
    .toBe(true);
  await page.waitForTimeout(1500);
  expect(await pageRelease(page)).toBe(next);
  await context.setOffline(true);
  await page.reload();
  expect(await pageRelease(page)).toBe(original);
  await editAndSave(page);
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  production.fail(null);
  await context.setOffline(false);
  await updateWorker(page);
  await awaitOfflineRelease(page, next);
  await expect.poll(() => pageRelease(page)).toBe(next);
  await context.setOffline(true);
  await page.reload();
  expect(await pageRelease(page)).toBe(next);
});

test("rejects incorrect resource bytes and reuses unchanged assets", async ({
  page,
  context,
  production,
}) => {
  await prepareOffline(page);
  const worker = [...production.nextRelease.keys()].find((path) =>
    path.includes("autoVelocity.worker-"),
  )!;
  const start = production.requests.length;
  production.publishUpdate();
  production.corrupt(worker);
  await updateWorker(page);
  await expect
    .poll(() => production.requests.slice(start).includes(worker))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        async () => !(await navigator.serviceWorker.ready).installing,
      ),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  expect(await pageRelease(page)).toBe(releaseId(production.release));
  production.corrupt(null);
  await context.setOffline(false);
  await updateWorker(page);
  await awaitOfflineRelease(page, releaseId(production.nextRelease));
  const unchangedImage = [...production.nextRelease.keys()].find((path) =>
    path.startsWith("/assets/field23-"),
  )!;
  expect(production.requests.slice(start)).not.toContain(unchangedImage);
});

test("updates an online editor even when its own offline download never completed", async ({
  page,
  production,
}) => {
  await prepareOffline(page);
  const worker = [...production.nextRelease.keys()].find((path) =>
    path.includes("autoVelocity.worker-"),
  )!;
  production.publishUpdate();
  production.fail(worker);
  await page.reload();
  await expect
    .poll(() => production.failedRequests.includes(worker))
    .toBe(true);
  await page.waitForTimeout(1500);
  expect(await pageRelease(page)).toBe(releaseId(production.nextRelease));
  production.fail(null);
  production.publishThird();
  await updateWorker(page);
  await expect
    .poll(() => pageRelease(page))
    .toBe(releaseId(production.thirdRelease));
  await editAndSave(page);
});

test("waits for slow HTML but falls back after 25 seconds even when Wi-Fi reports online", async ({
  page,
  production,
}) => {
  await prepareOffline(page);
  production.publishUpdate();
  production.delay("/index.html", 3500);
  await page.reload();
  expect(await pageRelease(page)).toBe(releaseId(production.nextRelease));
  await awaitOfflineRelease(page, releaseId(production.nextRelease));
  production.delay("/index.html", 60_000, true);
  const start = Date.now();
  await page.reload();
  expect(Date.now() - start).toBeGreaterThanOrEqual(24_000);
  expect(Date.now() - start).toBeLessThan(35_000);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(page.locator('meta[name="bline-offline"]')).toHaveAttribute(
    "content",
    "true",
  );
});

test("HTTP failures fall back without waiting for the deadline", async ({
  page,
  production,
}) => {
  await prepareOffline(page);
  production.fail("/index.html");
  const start = Date.now();
  await page.reload();
  expect(Date.now() - start).toBeLessThan(10_000);
  await expect(page.locator('meta[name="bline-offline"]')).toHaveAttribute(
    "content",
    "true",
  );
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
});

test("migrates the legacy cache-first worker without closing other tabs or clearing saved work", async ({
  page,
  context,
  production,
}) => {
  production.publishLegacy();
  await prepareOffline(page);
  await editAndSave(page);
  const other = await context.newPage();
  await other.goto(production.url);
  production.publishUpdate();
  await updateWorker(page);
  await awaitOfflineRelease(page, releaseId(production.nextRelease));
  // Neither legacy page was forced to reload during migration.
  await expect(page.locator('meta[name="bline-release"]')).toHaveCount(0);
  await expect(other.locator('meta[name="bline-release"]')).toHaveCount(0);
  await page.reload();
  expect(await pageRelease(page)).toBe(releaseId(production.nextRelease));
  await context.setOffline(true);
  expect(await fieldBytes(other)).toEqual(
    Array.from(production.release.get("/assets/fields/field26.png")!),
  );
  await page.reload();
  await page.getByTestId("path-element-row-0").click();
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue("6.25");
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
    production.publishUpdate();
    await updateWorker(page);
    await awaitOfflineRelease(page, releaseId(production.nextRelease));
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
    expect(await pageRelease(page)).toBe(releaseId(production.nextRelease));
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

for (const legacy of [false, true]) {
  test(`recovers a ${legacy ? "legacy" : "current"} production worker when the same origin starts Vite`, async ({
    page,
    production,
  }) => {
    if (legacy) production.publishLegacy();
    await prepareOffline(page);
    await editAndSave(page);
    await production.serveDevelopment();
    // The old application's registration/update path reaches the server's /sw.js
    // even though the old worker can still intercept HTML.
    await updateWorker(page);
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistrations()).length,
        ),
      )
      .toBe(0);
    await page.reload();
    await expect(page.locator('script[src="/src/main.tsx"]')).toHaveCount(1);
    await expect(page.locator('meta[name="bline-release"]')).toHaveCount(0);
    await page.getByTestId("path-element-row-0").click();
    await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue("6.25");
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    ).toBe(0);
  });
}

test("keeps online navigation available if cache access is revoked after installation", async ({
  page,
  context,
  production,
}) => {
  await prepareOffline(page);
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(() => {
    caches.open = () =>
      Promise.reject(new DOMException("Storage disabled", "SecurityError"));
  });
  production.publishUpdate();
  await page.reload();
  expect(await pageRelease(page)).toBe(releaseId(production.nextRelease));
  await editAndSave(page);
});

test("each tab reloads after its own save finishes, including edits queued during a save", async ({
  page,
  context,
  production,
}) => {
  await prepareOffline(page);
  const other = await context.newPage();
  await other.goto(production.url);
  await expect(other.getByTestId("path-stage")).toBeVisible();
  await page.evaluate(() => {
    const controls = window.__offlineTest;
    const io = controls.store.getState().io!;
    const save = io.saveWorkspace.bind(io);
    const gate = new Promise<void>((resolve) => {
      controls.releaseSave = resolve;
    });
    io.saveWorkspace = async (...args) => {
      controls.saveStarted = true;
      await gate;
      return save(...args);
    };
  });
  await page.getByTestId("path-element-row-0").click();
  await page.getByLabel("X (m)", { exact: true }).fill("7.25");
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__offlineTest.saveStarted))
    .toBe(true);
  production.publishUpdate();
  await updateWorker(other);
  await expect
    .poll(() => pageRelease(other))
    .toBe(releaseId(production.nextRelease));
  expect(await pageRelease(page)).toBe(releaseId(production.release));
  await expect(page.getByTestId("save-status")).toContainText("Saving");
  await page.getByLabel("X (m)", { exact: true }).fill("7.75");
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await page.evaluate(() => window.__offlineTest.releaseSave!());
  await expect
    .poll(() => pageRelease(page))
    .toBe(releaseId(production.nextRelease));
  await page.getByTestId("path-element-row-0").click();
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue("7.75");
});

test("a failed save holds the old editor until a successful retry", async ({
  page,
  production,
}) => {
  await prepareOffline(page);
  await page.evaluate(() => {
    const controls = window.__offlineTest;
    const io = controls.store.getState().io!;
    const save = io.saveWorkspace.bind(io);
    io.saveWorkspace = () =>
      Promise.reject(new Error("Offline update test save failed"));
    controls.releaseSave = () => {
      io.saveWorkspace = save;
    };
  });
  await page.getByTestId("path-element-row-0").click();
  await page.getByLabel("X (m)", { exact: true }).fill("7.25");
  await page.getByLabel("X (m)", { exact: true }).blur();
  await expect(page.getByTestId("save-status")).toContainText("Save failed");
  const recovery = page.getByRole("dialog", {
    name: "Unable to save this project",
  });
  await expect(recovery).toBeVisible();
  production.publishUpdate();
  await updateWorker(page);
  await awaitOfflineRelease(page, releaseId(production.nextRelease));
  await page.waitForTimeout(1600);
  expect(await pageRelease(page)).toBe(releaseId(production.release));
  await recovery
    .getByRole("button", { name: "Retry save", exact: true })
    .evaluate((button) => {
      window.__offlineTest.releaseSave!();
      (button as HTMLButtonElement).click();
    });
  await expect(recovery).toHaveCount(0);
  await expect(page.getByTestId("save-status")).toContainText("Saved");
  await expect
    .poll(() => pageRelease(page))
    .toBe(releaseId(production.nextRelease));
  await page.getByTestId("path-element-row-0").click();
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue("7.25");
});

test("an open settings draft postpones an update until the dialog closes", async ({
  page,
  production,
}) => {
  await prepareOffline(page);
  await openProjectSettings(page);
  const dialog = page.getByRole("dialog", { name: "Edit Config" });
  await dialog.getByLabel("Robot Length (m)").fill("0.95");
  await dialog.getByRole("heading", { name: "Robot", exact: true }).click();
  production.publishUpdate();
  await updateWorker(page);
  await awaitOfflineRelease(page, releaseId(production.nextRelease));
  await page.waitForTimeout(1600);
  expect(await pageRelease(page)).toBe(releaseId(production.release));
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Robot Length (m)")).toHaveValue("0.95");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(() => pageRelease(page))
    .toBe(releaseId(production.nextRelease));
});

test("does not repeatedly reload if the server returns an older page", async ({
  page,
  production,
}) => {
  await prepareOffline(page);
  await page.getByTestId("path-element-row-0").click();
  await page.getByLabel("X (m)", { exact: true }).focus();
  production.publishUpdate();
  await updateWorker(page);
  await awaitOfflineRelease(page, releaseId(production.nextRelease));
  production.publishCurrent();
  production.fail("/sw.js");
  let reloads = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) reloads += 1;
  });
  await page.getByRole("tab", { name: "Elements", exact: true }).click();
  await expect.poll(() => reloads).toBe(1);
  await expect(page.getByTestId("path-stage")).toBeVisible();
  await page.waitForTimeout(2500);
  expect(reloads).toBe(1);
  expect(await pageRelease(page)).toBe(releaseId(production.release));
  await editAndSave(page);
});

test("an active canvas drag finishes and saves before the tab updates", async ({
  page,
  production,
}) => {
  await prepareOffline(page);
  const canvas = page.getByTestId("path-stage-canvas");
  const anchor = modelToCanvasPoint(await requiredBox(canvas), {
    x_meters: 5.7,
    y_meters: 2.5,
  });
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 60, anchor.y - 24, { steps: 4 });
  production.publishUpdate();
  await updateWorker(page);
  await awaitOfflineRelease(page, releaseId(production.nextRelease));
  await page.waitForTimeout(1600);
  expect(await pageRelease(page)).toBe(releaseId(production.release));
  await page.mouse.up();
  const x = await page.getByLabel("X (m)", { exact: true }).inputValue();
  expect(Number(x)).not.toBeCloseTo(5.7, 2);
  await expect
    .poll(() => pageRelease(page))
    .toBe(releaseId(production.nextRelease));
  await page.getByTestId("path-element-row-0").click();
  await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue(x);
});

test("shows the offline indicator beside Save until an online refresh, with an accessible tooltip", async ({
  page,
  production,
}, testInfo) => {
  await prepareOffline(page);
  const indicator = page.getByTestId("offline-indicator");
  await expect(indicator).toHaveCount(0);
  production.fail("/index.html");
  await page.reload();
  await expect(indicator).toBeVisible();
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expect
    .poll(async () => {
      const save = await page.getByTestId("save-status").boundingBox();
      const badge = await indicator.boundingBox();
      return Math.abs(
        save!.y + save!.height / 2 - (badge!.y + badge!.height / 2),
      );
    })
    .toBeLessThan(3);
  const save = await page.getByTestId("save-status").boundingBox();
  const badge = await indicator.boundingBox();
  expect(badge!.x).toBeGreaterThanOrEqual(save!.x + save!.width);
  await indicator.hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "BLine is running from this browser’s offline copy.",
  );
  await page.screenshot({ path: testInfo.outputPath("offline-indicator.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  production.fail(null);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(indicator).toBeVisible();
  await page.reload();
  await expect(indicator).toHaveCount(0);
});

test("keeps a live editor's assets through more than one subsequent release", async ({
  page,
  context,
  production,
}) => {
  await prepareOffline(page);
  await page.getByTestId("path-element-row-0").click();
  await page.getByLabel("X (m)", { exact: true }).focus();
  const old = releaseId(production.release);
  production.publishUpdate();
  await updateWorker(page);
  await awaitOfflineRelease(page, releaseId(production.nextRelease));
  const newer = await context.newPage();
  await newer.goto(production.url);
  production.publishThird();
  await updateWorker(newer);
  await awaitOfflineRelease(newer, releaseId(production.thirdRelease));
  await expect
    .poll(() => pageRelease(newer))
    .toBe(releaseId(production.thirdRelease));
  expect(await pageRelease(page)).toBe(old);
  await context.setOffline(true);
  const oldWorker = [...production.release.keys()].find((path) =>
    path.includes("autoVelocity.worker-"),
  )!;
  const bytes = await page.evaluate(
    async (url) =>
      Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),
    oldWorker,
  );
  expect(bytes).toEqual(Array.from(production.release.get(oldWorker)!));
  await editAndSave(page);
});

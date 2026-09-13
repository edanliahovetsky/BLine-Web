import { expect, test } from "@playwright/test";
import path from "node:path";
import { preview } from "vite";
import { fixtureRoot } from "./buildFixtures";
import { recordCacheLookups } from "./cacheDiagnostics";

for (const disconnect of ["browser-offline", "server-stopped"] as const) {
  test(`Vite preview reopens and saves with ${disconnect}`, async ({
    page,
    context,
  }, testInfo) => {
    const server = await preview({
      preview: { host: "127.0.0.1", port: 0, strictPort: true },
      build: { outDir: path.join(fixtureRoot, "current") },
      logLevel: "silent",
    });
    const stop = async () => {
      if ("closeAllConnections" in server.httpServer)
        server.httpServer.closeAllConnections();
      if (server.httpServer.listening)
        await new Promise<void>((resolve, reject) =>
          server.httpServer.close((error) =>
            error ? reject(error) : resolve(),
          ),
        );
    };
    const address = server.httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("No preview address");
    const url = `http://127.0.0.1:${address.port}/`;
    const failures: { url: string; error: string | undefined }[] = [];
    page.on("requestfailed", (request) =>
      failures.push({
        url: request.url(),
        error: request.failure()?.errorText,
      }),
    );
    let readLookups: (() => Promise<unknown[]>) | undefined;
    try {
      await page.goto(url);
      await page
        .getByRole("button", { name: "Sample path", exact: true })
        .click();
      await expect(page.getByTestId("path-stage")).toBeVisible();
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.reload();
      await expect(page.getByTestId("path-stage")).toBeVisible();
      const script = await page
        .locator('script[type="module"][src]')
        .getAttribute("src");
      readLookups = await recordCacheLookups(
        context
          .serviceWorkers()
          .find((worker) => worker.url() === `${url}sw.js`)!,
      );
      const response = await context.request.get(new URL(script!, url).href);
      expect(response.headers().vary).toBe("Origin");
      if (disconnect === "browser-offline") await context.setOffline(true);
      else await stop();
      await page.reload();
      await expect(page.getByTestId("path-stage")).toBeVisible();
      await page.getByRole("tab", { name: "Elements", exact: true }).click();
      await page.getByTestId("path-element-row-0").click();
      await page.getByLabel("X (m)", { exact: true }).fill("6.25");
      await page.getByLabel("X (m)", { exact: true }).press("Tab");
      await expect(page.getByTestId("save-status")).toContainText("Saved");
      await page.reload();
      await expect(page.getByTestId("path-stage")).toBeVisible();
      await page.getByRole("tab", { name: "Elements", exact: true }).click();
      await page.getByTestId("path-element-row-0").click();
      await expect(page.getByLabel("X (m)", { exact: true })).toHaveValue(
        "6.25",
      );
    } finally {
      await testInfo.attach("preview-failed-requests", {
        body: JSON.stringify(
          { disconnect, failures, cacheLookups: await readLookups?.() },
          null,
          2,
        ),
        contentType: "application/json",
      });
      await stop();
    }
  });
}

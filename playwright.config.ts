import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Each checkout gets its own deterministic port so a Playwright run can only
// ever reuse a dev server serving THIS checkout's code. Sharing the manual
// 1420 dev server (or any other worktree's server) silently tests foreign
// code; opt back in explicitly with PLAYWRIGHT_PORT if that is really wanted.
const checkoutDir = path.dirname(fileURLToPath(import.meta.url));
const derivedPort =
  24200 +
  (parseInt(
    createHash("sha256").update(checkoutDir).digest("hex").slice(0, 8),
    16,
  ) %
    600);
const port = Number(process.env.PLAYWRIGHT_PORT ?? derivedPort);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Hosted macOS runners take longer to paint and complete multi-step flows.
  // Keep every assertion; allow those same operations to finish on CI.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: {
    timeout: process.env.CI ? 15_000 : 5_000,
  },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_PORT,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit-canvas",
      grep: /@webkit-canvas/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
});

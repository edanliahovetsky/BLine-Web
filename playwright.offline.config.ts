import { defineConfig, devices } from "@playwright/test";

// Each test serves the production bundle on its own ephemeral loopback port.
// These checks must exercise real service workers, not Vite's dev server.
export default defineConfig({
  testDir: "./tests/offline",
  globalSetup: "./tests/offline/buildFixtures.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  reporter: [["list"]],
  use: {
    trace: {
      mode: "retain-on-failure",
      screenshots: false,
      snapshots: true,
      sources: false,
    },
    screenshot: "only-on-failure",
  },
  // Playwright service-worker testing is supported on Chromium only:
  // https://playwright.dev/docs/service-workers
  // The normal E2E config still covers WebKit editor rendering.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

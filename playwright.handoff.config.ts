import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The retired origin is 127.0.0.1 and bline.run is localhost on one port: two
// origins with separate storage, like bline-web.pages.dev and bline.run. The
// bundles bake that port in, so every test reuses it one at a time.
const checkoutDir = path.dirname(fileURLToPath(import.meta.url));
process.env.HANDOFF_TEST_PORT ??= String(
  24900 +
    (parseInt(
      createHash("sha256").update(checkoutDir).digest("hex").slice(0, 8),
      16,
    ) %
      600),
);

export default defineConfig({
  testDir: "./tests/handoff",
  globalSetup: "./tests/handoff/buildFixtures.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

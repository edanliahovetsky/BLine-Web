import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "tests/e2e/app-shell.bug-report.spec.ts",
    "tests/e2e/app-shell.toolbar-centering.spec.ts",
    "tests/e2e/app-shell.startup-layout.spec.ts",
    ...process.argv.slice(2),
  ],
  {
    env: {
      ...process.env,
      // Never reuse a dev server started without the beta flags.
      CI: "true",
      VITE_RELEASE_CHANNEL: "beta",
      VITE_ENABLE_BUG_REPORT: "true",
    },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);

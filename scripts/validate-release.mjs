import { spawnSync } from "node:child_process";
import { releaseMetadata } from "./release-config.ts";
import { readFileSync } from "node:fs";

const channel = process.argv[2] ?? "stable";
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
releaseMetadata(version, channel);
const env = {
  ...process.env,
  CI: "true",
  BLINE_RELEASE_CHANNEL: channel,
  VITE_RELEASE_CHANNEL: "stable",
  VITE_ENABLE_BUG_REPORT: "false",
};
const npm = (name, overrides = {}) => [
  process.execPath,
  [process.env.npm_execpath, "run", name],
  overrides,
];
const cargo = (args) => [
  "cargo",
  [...args, "--manifest-path", "src-tauri/Cargo.toml"],
];
const checks = [
  npm("release:check"),
  npm("test:release"),
  npm("format:check"),
  npm("lint"),
  npm("typecheck"),
  npm("test", { BLINE_RUN_JOINT_PARITY_CORPUS: "1" }),
  npm("parity"),
  npm("validate:bline-lib-io"),
  npm("build"),
  npm("test:e2e"),
  npm("test:e2e:beta"),
  npm("test:offline", {
    VITE_RELEASE_CHANNEL: channel,
    VITE_ENABLE_BUG_REPORT: String(channel === "beta"),
  }),
  [
    "cargo",
    [
      "fmt",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--all",
      "--",
      "--check",
    ],
  ],
  [
    "cargo",
    [
      "clippy",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--locked",
      "--all-targets",
      "--all-features",
      "--",
      "-D",
      "warnings",
    ],
  ],
  cargo(["test", "--locked"]),
  npm(channel === "beta" ? "tauri:build:beta" : "tauri:build"),
];
for (const [command, args, overrides] of checks) {
  console.log(`\nRelease validation: ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    env: { ...env, ...overrides },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  "\nAll local release checks passed. No changes were pushed or published.",
);

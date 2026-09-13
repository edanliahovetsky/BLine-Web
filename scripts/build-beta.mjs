import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { releaseMetadata } from "./release-config.ts";
import { deriveWindowsMsiVersion } from "./release-version.mjs";

const [target, ...args] = process.argv.slice(2);
if (target !== "web" && target !== "desktop") {
  throw new Error(
    "Usage: node scripts/build-beta.mjs <web|desktop> [build options]",
  );
}
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const metadata = releaseMetadata(version, "beta");
const env = {
  ...process.env,
  VITE_RELEASE_CHANNEL: "beta",
  VITE_ENABLE_BUG_REPORT: "true",
};

let command;
if (target === "desktop") {
  const base = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const beta = JSON.parse(
    readFileSync("src-tauri/tauri.beta.conf.json", "utf8"),
  );
  const configPath = "src-tauri/target/generated/tauri.beta.json";
  // Tauri replaces arrays when merging config. Preserve every base window
  // property while changing only its title for the beta build.
  beta.app = {
    windows: base.app.windows.map((window) => ({
      ...window,
      title: metadata.appName,
    })),
  };
  beta.bundle.windows.wix.version = deriveWindowsMsiVersion(version);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(beta, null, 2)}\n`);
  command = [
    "node_modules/@tauri-apps/cli/tauri.js",
    "build",
    "--config",
    configPath,
    ...args,
  ];
} else {
  if (!process.env.npm_execpath)
    throw new Error("Run this build through npm run build:beta");
  command = [process.env.npm_execpath, "run", "build", "--", ...args];
}

console.log(`Building ${metadata.releaseName} (${target})`);
const result = spawnSync(process.execPath, command, { env, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);

import { readFileSync } from "node:fs";
import { releaseMetadata } from "./release-config.ts";
import {
  deriveWindowsMsiVersion,
  isReleaseVersion,
} from "./release-version.mjs";

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const cargoToml = readText("src-tauri/Cargo.toml");
const cargoLock = readText("src-tauri/Cargo.lock");

const packageVersion = assertString(
  packageJson.version,
  "package.json version",
);
const tauriVersion = assertString(
  tauriConfig.version,
  "src-tauri/tauri.conf.json version",
);
const cargoVersion = readCargoPackageVersion(cargoToml);
const expectedTag = `v${packageVersion}`;
const suppliedTag = process.argv[2];

const failures = [];
let windowsMsiVersion;

for (const [label, version] of [
  ["package-lock.json", packageLock.version],
  ["package-lock.json root package", packageLock.packages?.[""]?.version],
  [
    "Cargo.lock bline-web package",
    cargoLock.match(
      /\[\[package\]\]\s+name = "bline-web"\s+version = "([^"]+)"/,
    )?.[1],
  ],
]) {
  if (version !== packageVersion)
    failures.push(
      `${label} version ${version} does not match package.json ${packageVersion}`,
    );
}

if (!isReleaseVersion(packageVersion)) {
  failures.push(`package.json version is not valid semver: ${packageVersion}`);
} else {
  try {
    windowsMsiVersion = deriveWindowsMsiVersion(
      packageVersion,
      process.env.BLINE_RELEASE_CHANNEL ?? "stable",
    );
    releaseMetadata(
      packageVersion,
      process.env.BLINE_RELEASE_CHANNEL ?? "stable",
    );
  } catch (error) {
    failures.push(error.message);
  }
}

if (tauriVersion !== packageVersion) {
  failures.push(
    `src-tauri/tauri.conf.json version ${tauriVersion} does not match package.json ${packageVersion}`,
  );
}

if (cargoVersion !== packageVersion) {
  failures.push(
    `src-tauri/Cargo.toml version ${cargoVersion} does not match package.json ${packageVersion}`,
  );
}

if (suppliedTag && suppliedTag !== expectedTag) {
  failures.push(
    `release tag ${suppliedTag} does not match expected ${expectedTag}`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`release-check: ${failure}`);
  }
  process.exit(1);
}

console.log(
  `release-check: ${packageVersion} (${expectedTag}); windows-msi ${windowsMsiVersion}`,
);

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function readCargoPackageVersion(toml) {
  const lines = toml.split(/\r?\n/);
  const packageStart = lines.findIndex((line) => line.trim() === "[package]");

  if (packageStart === -1) {
    throw new Error("src-tauri/Cargo.toml is missing a [package] section");
  }

  const packageLines = [];
  for (const line of lines.slice(packageStart + 1)) {
    if (line.trim().startsWith("[")) {
      break;
    }
    packageLines.push(line);
  }

  const version = packageLines.join("\n").match(/^version\s*=\s*"([^"]+)"$/m);

  if (!version) {
    throw new Error("src-tauri/Cargo.toml [package] is missing a version");
  }

  return version[1];
}

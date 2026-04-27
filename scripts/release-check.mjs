import { readFileSync } from "node:fs";

const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const cargoToml = readText("src-tauri/Cargo.toml");

const packageVersion = assertString(packageJson.version, "package.json version");
const tauriVersion = assertString(
  tauriConfig.version,
  "src-tauri/tauri.conf.json version"
);
const cargoVersion = readCargoPackageVersion(cargoToml);
const expectedTag = `v${packageVersion}`;
const suppliedTag = process.argv[2];

const semverPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;

const failures = [];

if (!semverPattern.test(packageVersion)) {
  failures.push(`package.json version is not valid semver: ${packageVersion}`);
}

if (tauriVersion !== packageVersion) {
  failures.push(
    `src-tauri/tauri.conf.json version ${tauriVersion} does not match package.json ${packageVersion}`
  );
}

if (cargoVersion !== packageVersion) {
  failures.push(
    `src-tauri/Cargo.toml version ${cargoVersion} does not match package.json ${packageVersion}`
  );
}

if (suppliedTag && suppliedTag !== expectedTag) {
  failures.push(`release tag ${suppliedTag} does not match expected ${expectedTag}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`release-check: ${failure}`);
  }
  process.exit(1);
}

console.log(`release-check: ${packageVersion} (${expectedTag})`);

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

  const version = packageLines
    .join("\n")
    .match(/^version\s*=\s*"([^"]+)"$/m);

  if (!version) {
    throw new Error("src-tauri/Cargo.toml [package] is missing a version");
  }

  return version[1];
}

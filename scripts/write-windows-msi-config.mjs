import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deriveWindowsMsiVersion } from "./release-version.mjs";

const outputPath = readOutputPath(process.argv.slice(2));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageVersion = assertString(packageJson.version, "package.json version");
const windowsMsiVersion = deriveWindowsMsiVersion(packageVersion);

const config = {
  bundle: {
    windows: {
      wix: {
        version: windowsMsiVersion,
      },
    },
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(
  `windows-msi-config: ${packageVersion} -> ${windowsMsiVersion} (${outputPath})`
);

function readOutputPath(args) {
  if (args.length === 0) {
    return "src-tauri/target/generated/tauri.windows-msi-version.json";
  }

  if (args.length === 2 && args[0] === "--output") {
    return args[1];
  }

  throw new Error("Usage: node scripts/write-windows-msi-config.mjs [--output PATH]");
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

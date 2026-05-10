import { readFileSync, writeFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

const releaseVersion = readEnv("RELEASE_VERSION") ?? packageJson.version;
const releaseTag = readEnv("RELEASE_TAG") ?? `v${releaseVersion}`;
const notesPath = readEnv("RELEASE_NOTES_PATH") ?? "release-notes.md";
const redirectBaseUrl = trimTrailingSlash(
  readEnv("DOWNLOAD_REDIRECT_BASE_URL") ??
    "https://bline-metrics.edan-liahovetsky.workers.dev",
);

const releaseTagPattern =
  /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/u;

if (!releaseTagPattern.test(releaseTag)) {
  throw new Error(
    `release tag must look like v1.2.3 or v1.2.3-alpha.1: ${releaseTag}`,
  );
}

const platforms = [
  { id: "windows-x64", label: "Windows x64", assetPrefix: "windows-x64-*" },
  {
    id: "macos-aarch64",
    label: "macOS Apple Silicon",
    assetPrefix: "macos-aarch64-*",
  },
  { id: "macos-x64", label: "macOS Intel", assetPrefix: "macos-x64-*" },
  { id: "linux-x64", label: "Linux x64", assetPrefix: "linux-x64-*" },
];

const notes = `Draft release generated from the \`web-deploy\` branch.

Cloudflare Pages deploys this same commit as the production web build.

## Desktop Download Redirects

These links go through the BLine Metrics Worker so download clicks are counted without public-user cookies. The version-pinned links start resolving to the attached GitHub Release assets after this draft is published.

### This Release (${releaseTag})

${downloadTable(releaseTag, "github-release-version")}

### Stable Channel

${downloadTable("stable", "github-release-stable")}

### Pre-release Channel

${downloadTable("prerelease", "github-release-prerelease")}

## Attached Assets

- Web static bundle: \`bline-web-web-${releaseVersion}.zip\`
- Desktop artifact prefixes:
${platforms.map((platform) => `  - ${platform.label}: \`${platform.assetPrefix}\``).join("\n")}

Direct GitHub Release assets remain the fallback if a redirect is temporarily unavailable.
`;

writeFileSync(notesPath, notes);
console.log(`wrote ${notesPath} for ${releaseTag}`);

function downloadTable(release, source) {
  const rows = platforms.map(
    (platform) =>
      `| ${platform.label} | [${platform.label}](${downloadUrl(release, platform.id, source)}) |`,
  );

  return ["| Platform | Download |", "|---|---|", ...rows].join("\n");
}

function downloadUrl(release, platform, source) {
  return `${redirectBaseUrl}/d/web/${encodeURIComponent(release)}/${platform}?source=${encodeURIComponent(source)}`;
}

function readEnv(name) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/u, "");
}

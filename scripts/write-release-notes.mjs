import { readFileSync, writeFileSync } from "node:fs";
import { betaWebsite, releaseMetadata } from "./release-config.ts";

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

const metadata = releaseMetadata(
  releaseVersion,
  readEnv("BLINE_RELEASE_CHANNEL") ?? "stable",
);
if (releaseTag !== metadata.tag) {
  throw new Error(
    `Release tag ${releaseTag} does not match version ${releaseVersion}`,
  );
}

const betaNotes = `${metadata.releaseName} is an opt-in preview of the redesigned editor for the 2027 season.

Try the [beta website](${betaWebsite}) or install **BLine Web Beta** below. The [current website](https://bline-web.pages.dev/) remains available.

## Try the beta

${downloadTable(releaseTag, "github-release-beta")}

These version-specific links become available when this draft is published. The attached GitHub assets are a direct-download fallback.

- **Windows:** download the x64 installer and run it.
- **macOS:** choose Apple Silicon or Intel, open the DMG, and drag **BLine Web Beta** into Applications. Current builds are ad-hoc signed and are not notarized; macOS may require approval in System Settings → Privacy & Security.
- **Linux:** use the x64 AppImage or the attached package for your distribution. Make the AppImage executable before opening it.

## Using your projects

The beta has its own saved settings and browser workspace. It can be installed alongside the current desktop editor. To try an existing project, copy its autos folder first, then open the copy on desktop or import it into the beta website. Opening the same folder in either desktop app edits the same files.

Use **File → Import / Export → Export Project Archive** to transfer a browser project to the beta. Keep the original archive or folder while testing.

## Report a problem

Click the **bug icon to the right of the path selector**. It opens a GitHub issue draft with the release, version, and browser/desktop details filled in. Add what happened, steps to repeat it, and any screenshots or files you want to share. You review and submit the issue yourself; a GitHub account is required.

For offline browser use, first load the beta online and let its offline copy download. Bookmark the beta address and return to it in the same browser. A Wi-Fi-off icon beside Save indicates that the offline copy is in use. Desktop builds include the editor and can start without an internet connection. Opening GitHub to report a bug requires a connection.

---

Version: \`${releaseVersion}\`. Built from the \`web-beta\` candidate. Web bundle: \`bline-web-web-${releaseVersion}.zip\`.
`;

const notes =
  metadata.channel === "beta"
    ? betaNotes
    : `Draft release generated from the \`web-deploy\` branch.

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

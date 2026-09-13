import { appendFileSync, readFileSync } from "node:fs";
import { releaseMetadata } from "./release-config.ts";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const metadata = releaseMetadata(
  version,
  process.env.BLINE_RELEASE_CHANNEL ?? "stable",
);
console.log(JSON.stringify(metadata, null, 2));
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(metadata)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
}

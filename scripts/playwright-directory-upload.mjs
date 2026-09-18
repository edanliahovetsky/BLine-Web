import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Playwright 1.59.1 starts listener registration and the native directory upload
// concurrently. WebKit can emit input first, leaving setFiles waiting forever
// even though the app imported the folder. Register before issuing the upload.
// Upstream implementation: packages/playwright-core/src/server/dom.ts,
// ElementHandle._setInputFiles. Remove/review this workaround when upgrading.
const original = `      const waitForInputEvent = localDirectory ? this.evaluate((node) => new Promise((fulfill) => {
        node.addEventListener("input", fulfill, { once: true });
      })).catch(() => {
      }) : Promise.resolve();
      await progress.race(this._page.delegate.setInputFilePaths(retargeted, localPathsOrDirectory));
      await progress.race(waitForInputEvent);`;

export const directoryUpload = `      // BLine test driver: acknowledge input listener registration before upload.
      const inputEvent = localDirectory ? await progress.race(this.evaluateHandle((node) => ({
        promise: new Promise((fulfill) => {
          node.addEventListener("input", () => fulfill(), { once: true });
        })
      }))) : null;
      try {
        await progress.race(this._page.delegate.setInputFilePaths(retargeted, localPathsOrDirectory));
        if (inputEvent)
          await progress.race(inputEvent.evaluate((event) => event.promise));
      } finally {
        await inputEvent?.dispose();
      }`;

export function patchDirectoryUpload(source, version) {
  if (version !== "1.59.1") {
    throw new Error(
      "Review the directory-upload workaround for this Playwright version.",
    );
  }
  if (source.includes(directoryUpload)) return source;
  if (source.split(original).length !== 2) {
    throw new Error(
      "Unrecognized Playwright directory-upload implementation; refusing to patch.",
    );
  }
  return source.replace(original, directoryUpload);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("playwright-core/package.json"));
  const { version } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const target = join(root, "lib/server/dom.js");
  const source = readFileSync(target, "utf8");
  const patched = patchDirectoryUpload(source, version);
  if (patched !== source) writeFileSync(target, patched);
}

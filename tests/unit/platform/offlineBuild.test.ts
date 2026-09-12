import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareOfflineRelease,
  retainOfflineAssets,
  verifyManifest,
} from "../../../scripts/offline-build";

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "bline-offline-build-"));
  directories.push(directory);
  await mkdir(path.join(directory, "assets"));
  await writeFile(
    path.join(directory, "index.html"),
    "<html><head></head><body>Editor</body></html>",
  );
  await writeFile(
    path.join(directory, "assets/editor-12345678.js"),
    "export const editor = true;",
  );
  await writeFile(
    path.join(directory, "assets/optimizer-abcdefgh.js"),
    "self.onmessage = () => {};",
  );
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("complete offline release generation", () => {
  it("creates a deterministic snapshot and verifies the bytes of every required file", async () => {
    const first = await fixture();
    const second = await fixture();
    await prepareOfflineRelease(first);
    await prepareOfflineRelease(second);
    const html = await readFile(path.join(first, "index.html"), "utf8");
    expect(await readFile(path.join(second, "index.html"), "utf8")).toBe(html);
    const snapshots = await readdir(path.join(first, "offline"));
    expect(snapshots).toHaveLength(1);
    expect(
      await readFile(path.join(first, "offline", snapshots[0]!), "utf8"),
    ).toBe(html);
    const paths = [
      "index.html",
      `offline/${snapshots[0]}`,
      "assets/editor-12345678.js",
      "assets/optimizer-abcdefgh.js",
    ];
    const entries = paths.map((url) => ({ url, revision: null, size: 1 }));
    const { manifest } = await verifyManifest(entries, first);
    expect(manifest.map((entry) => entry.url)).not.toContain("index.html");
    for (const entry of manifest) {
      const bytes = await readFile(path.join(first, entry.url));
      expect(entry.integrity).toBe(
        `sha256-${createHash("sha256").update(bytes).digest("base64")}`,
      );
    }
    await expect(
      verifyManifest(
        entries.filter((entry) => !entry.url.includes("optimizer")),
        first,
      ),
    ).rejects.toThrow("Incomplete offline manifest");
  });

  it("retains old immutable assets without overwriting the new entry page or worker", async () => {
    const previous = await fixture();
    const next = await fixture();
    await prepareOfflineRelease(previous);
    await writeFile(
      path.join(previous, "assets/lazy-old12345.js"),
      "old lazy chunk",
    );
    await writeFile(path.join(previous, "sw.js"), "old worker");
    await writeFile(path.join(next, "index.html"), "new entry");
    await writeFile(path.join(next, "sw.js"), "new worker");
    await retainOfflineAssets(previous, next);
    expect(
      await readFile(path.join(next, "assets/lazy-old12345.js"), "utf8"),
    ).toBe("old lazy chunk");
    expect(await readFile(path.join(next, "index.html"), "utf8")).toBe(
      "new entry",
    );
    expect(await readFile(path.join(next, "sw.js"), "utf8")).toBe("new worker");
    expect(await readdir(path.join(next, "offline"))).toEqual(
      await readdir(path.join(previous, "offline")),
    );
  });

  it("refuses different bytes at the same immutable URL", async () => {
    const previous = await fixture();
    const next = await fixture();
    await writeFile(
      path.join(next, "assets/editor-12345678.js"),
      "unexpected bytes",
    );
    await expect(retainOfflineAssets(previous, next)).rejects.toThrow(
      "Immutable asset collision",
    );
    expect(
      await readFile(path.join(next, "assets/editor-12345678.js"), "utf8"),
    ).toBe("unexpected bytes");
  });
});

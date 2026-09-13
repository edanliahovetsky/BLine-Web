import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
function run(script, env = {}, cwd = root) {
  return spawnSync(process.execPath, [path.join(root, "scripts", script)], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, BLINE_RELEASE_CHANNEL: "beta", ...env },
  });
}

test("release scripts agree on beta identity, installer version, and pinned downloads", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bline-release-"));
  try {
    const metadataPath = path.join(dir, "metadata.txt");
    const notesPath = path.join(dir, "notes.md");
    const version = "1.0.0-beta.1";
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }));
    const metadata = run(
      "release-metadata.mjs",
      {
        GITHUB_OUTPUT: metadataPath,
      },
      dir,
    );
    assert.equal(metadata.status, 0, metadata.stderr);
    const details = JSON.parse(metadata.stdout);
    assert.match(details.releaseName, /^BLine Web 2027 Beta \d+$/);
    assert.equal(details.tag, `v${version}`);
    assert.match(readFileSync(metadataPath, "utf8"), /prerelease=true\n/);

    const notes = run(
      "write-release-notes.mjs",
      {
        RELEASE_VERSION: version,
        RELEASE_TAG: details.tag,
        RELEASE_NOTES_PATH: notesPath,
      },
      dir,
    );
    assert.equal(notes.status, 0, notes.stderr);
    const body = readFileSync(notesPath, "utf8");
    assert.ok(body.startsWith(details.releaseName));
    assert.match(body, /https:\/\/web-beta\.bline-web\.pages\.dev\//);
    assert.equal(
      (
        body.match(
          new RegExp(`/d/web/${details.tag.replaceAll(".", "\\.")}/`, "g"),
        ) ?? []
      ).length,
      4,
    );
    assert.doesNotMatch(body, /\/d\/web\/(?:stable|prerelease|latest)\//);
    assert.doesNotMatch(body, /production web build|`web-deploy`/);

    const mismatch = run(
      "write-release-notes.mjs",
      {
        RELEASE_VERSION: version,
        RELEASE_TAG: "v9.0.0-beta.1",
        RELEASE_NOTES_PATH: notesPath,
      },
      dir,
    );
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /does not match version/);

    for (const sequence of [1, 2]) {
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ version: `1.0.0-beta.${sequence}` }),
      );
      const installer = run("write-windows-msi-config.mjs", {}, dir);
      assert.equal(installer.status, 0, installer.stderr);
      const config = JSON.parse(
        readFileSync(
          path.join(
            dir,
            "src-tauri/target/generated/tauri.windows-msi-version.json",
          ),
          "utf8",
        ),
      );
      assert.equal(config.bundle.windows.wix.version, `1.0.${sequence}`);
    }

    const stable = run(
      "write-release-notes.mjs",
      {
        BLINE_RELEASE_CHANNEL: "stable",
        RELEASE_VERSION: "0.1.0-alpha.12",
        RELEASE_TAG: "v0.1.0-alpha.12",
        RELEASE_NOTES_PATH: notesPath,
      },
      dir,
    );
    assert.equal(stable.status, 0, stable.stderr);
    assert.match(readFileSync(notesPath, "utf8"), /production web build/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release checks reject drift in either lockfile", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bline-release-locks-"));
  try {
    mkdirSync(path.join(dir, "src-tauri"));
    for (const name of [
      "package.json",
      "package-lock.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
    ]) {
      copyFileSync(path.join(root, name), path.join(dir, name));
    }
    const good = run(
      "release-check.mjs",
      { BLINE_RELEASE_CHANNEL: "stable" },
      dir,
    );
    assert.equal(good.status, 0, good.stderr);
    for (const filename of ["package-lock.json", "src-tauri/Cargo.lock"]) {
      const file = path.join(dir, filename);
      const original = readFileSync(file, "utf8");
      const version = JSON.parse(readFileSync("package.json", "utf8")).version;
      writeFileSync(file, original.replaceAll(version, "0.0.0"));
      const bad = run(
        "release-check.mjs",
        { BLINE_RELEASE_CHANNEL: "stable" },
        dir,
      );
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr + bad.stdout, /does not match package.json/);
      writeFileSync(file, original);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

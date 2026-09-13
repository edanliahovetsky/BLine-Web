import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { releaseMetadata } from "../../scripts/release-config.ts";
import { deriveWindowsMsiVersion } from "../../scripts/release-version.mjs";

test("beta releases have season titles and monotonically increasing MSI versions", () => {
  const first = releaseMetadata("1.0.0-beta.1", "beta");
  assert.equal(first.releaseName, "BLine Web 2027 Beta 1");
  assert.equal(first.tag, "v1.0.0-beta.1");
  assert.equal(first.prerelease, true);
  assert.equal(
    releaseMetadata("1.0.0-beta.2", "beta").releaseName,
    "BLine Web 2027 Beta 2",
  );
  assert.equal(deriveWindowsMsiVersion(first.version), "1.0.0.1");
  assert.equal(deriveWindowsMsiVersion("1.0.0-beta.2"), "1.0.0.2");
});

test("beta builds reject stable, alpha, and malformed versions", () => {
  for (const version of [
    "1.0.0",
    "0.1.0-alpha.12",
    "1.0.0-beta",
    "1.0.0-beta.0",
    "1.0.0-beta.01",
  ]) {
    assert.throws(
      () => releaseMetadata(version, "beta"),
      /Beta builds require/,
    );
  }
  assert.throws(
    () => releaseMetadata("1.0.0", "betaa"),
    /Unknown release channel/,
  );
});

test("the current release channel keeps its existing title and app identity", () => {
  assert.equal(
    releaseMetadata("0.1.0-alpha.12").releaseName,
    "BLine Web v0.1.0-alpha.12",
  );
  assert.equal(releaseMetadata("1.0.0").appName, "BLine Web");
  assert.equal(releaseMetadata("1.0.0").prerelease, false);
  const base = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const beta = JSON.parse(
    readFileSync("src-tauri/tauri.beta.conf.json", "utf8"),
  );
  assert.equal(base.identifier, "org.bline.web");
  assert.notEqual(base.identifier, beta.identifier);
  assert.notEqual(base.productName, beta.productName);
  assert.equal(beta.mainBinaryName, "bline-web-beta");
  assert.match(beta.bundle.windows.wix.upgradeCode, /^[\da-f-]{36}$/);
});

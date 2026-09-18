import assert from "node:assert/strict";
import test from "node:test";
import {
  directoryUpload,
  patchDirectoryUpload,
} from "../../scripts/playwright-directory-upload.mjs";

// Exercise the actual replacement with a driver that delivers input immediately.
// A registration command must finish before the native upload starts, regardless
// of how long the command takes to reach the browser.
const runUpload = new Function(
  "progress",
  "localDirectory",
  "retargeted",
  "localPathsOrDirectory",
  `return (async () => {${directoryUpload}}).call(this);`,
);

for (const directory of [true, false]) {
  test(`upload waits for listener registration (directory=${directory})`, async () => {
    let onInput;
    let disposed = false;
    let registered = false;
    const page = {
      async evaluateHandle(callback) {
        await new Promise((resolve) => setImmediate(resolve));
        const value = callback({
          addEventListener(_name, listener) {
            onInput = listener;
          },
        });
        registered = true;
        return {
          evaluate: (callback) => callback(value),
          dispose: async () => {
            disposed = true;
          },
        };
      },
      _page: {
        delegate: {
          async setInputFilePaths() {
            assert.equal(registered, directory);
            onInput?.();
          },
        },
      },
    };
    await runUpload.call(
      page,
      { race: (promise) => promise },
      directory,
      {},
      [],
    );
    assert.equal(disposed, directory);
  });
}

test("native upload errors fail the test and release the event handle", async () => {
  let disposed = false;
  const page = {
    evaluateHandle: async () => ({
      dispose: async () => {
        disposed = true;
      },
    }),
    _page: {
      delegate: {
        setInputFilePaths: async () => {
          throw new Error("upload failed");
        },
      },
    },
  };
  await assert.rejects(
    runUpload.call(page, { race: (promise) => promise }, true, {}, []),
    /upload failed/,
  );
  assert.equal(disposed, true);
});

test("driver patch is idempotent and refuses unsupported implementations", () => {
  assert.equal(
    patchDirectoryUpload(directoryUpload, "1.59.1"),
    directoryUpload,
  );
  assert.throws(
    () => patchDirectoryUpload("changed implementation", "1.59.1"),
    /Unrecognized/,
  );
  assert.throws(() => patchDirectoryUpload(directoryUpload, "2.0.0"), /Review/);
});

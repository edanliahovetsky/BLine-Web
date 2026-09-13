import { cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import ts from "typescript";
import path from "node:path";
import { build, type Plugin } from "vite";
import { generateSW } from "workbox-build";

export const fixtureRoot = path.resolve("node_modules/.tmp/offline-fixtures");

// Only production test fixtures expose the store, so tests can hold/fail a real
// storage write without adding a test API to the shipped application.
function editorTestControls(): Plugin {
  return {
    name: "offline-editor-test-controls",
    transform(code, id) {
      if (id.endsWith("/src/state/projectStore.ts"))
        return `${code}\nglobalThis.__offlineTest = { store: projectStore };`;
    },
  };
}

function nextReleasePlugin(marker = "next"): Plugin {
  return {
    name: "offline-update-test-fixture",
    enforce: "pre",
    transform(code, id) {
      if (id.endsWith("/src/main.tsx")) {
        return `document.documentElement.dataset.offlineTestBuild = "${marker}";\n${code}`;
      }
      if (id.endsWith("/src/platform/fieldImageUrl.ts")) {
        return code.replace(
          "field26.png?url&no-inline",
          marker === "next"
            ? "field22.png?url&no-inline"
            : "field23.png?url&no-inline",
        );
      }
      if (id.endsWith("/src/platform/autoVelocity.worker.ts")) {
        return `globalThis.name = "offline-test-${marker}-worker";\n${code}`;
      }
      if (id.endsWith("/src/platform/fileExport.ts")) {
        return `${code}\nexport const offlineTestExportVersion = "${marker}";`;
      }
      if (id.endsWith("/src/styles.css"))
        return `${code}\n:root { --offline-test-build: ${marker}; }`;
    },
  };
}

export default async function buildFixtures(): Promise<void> {
  await build({
    plugins: [editorTestControls()],
    build: { outDir: path.join(fixtureRoot, "current"), emptyOutDir: true },
    logLevel: "warn",
  });
  const previous = path.join(fixtureRoot, "previous");
  await rm(previous, { recursive: true, force: true });
  await cp(path.join(fixtureRoot, "current"), previous, { recursive: true });
  const manifest = await Promise.all(
    (await readdir(previous, { recursive: true }))
      .filter(
        (file) =>
          /\.(html|js|css|png|svg|ico|woff2?|json|wasm|webmanifest)$/.test(
            file,
          ) &&
          file !== "index.html" &&
          file !== "sw.js",
      )
      .map(async (url) => ({
        url,
        integrity: `sha256-${createHash("sha256")
          .update(await readFile(path.join(previous, url)))
          .digest("base64")}`,
      })),
  );
  const previousSource = await readFile(
    "tests/offline/fixtures/worker-before-vary.ts.txt",
    "utf8",
  );
  await writeFile(
    path.join(previous, "sw.js"),
    ts.transpileModule(
      previousSource
        .replace("self.__WB_MANIFEST", JSON.stringify(manifest))
        .replace("export {};", ""),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleDetection: ts.ModuleDetectionKind.Legacy,
        },
      },
    ).outputText,
  );
  await build({
    plugins: [editorTestControls(), nextReleasePlugin()],
    worker: { plugins: () => [nextReleasePlugin()] },
    build: { outDir: path.join(fixtureRoot, "next"), emptyOutDir: true },
    logLevel: "warn",
  });
  await build({
    plugins: [editorTestControls(), nextReleasePlugin("third")],
    worker: { plugins: () => [nextReleasePlugin("third")] },
    build: { outDir: path.join(fixtureRoot, "third"), emptyOutDir: true },
    logLevel: "warn",
  });
  const legacy = path.join(fixtureRoot, "legacy");
  await rm(legacy, { recursive: true, force: true });
  await cp(path.join(fixtureRoot, "current"), legacy, { recursive: true });
  const index = path.join(legacy, "index.html");
  await writeFile(
    index,
    (await readFile(index, "utf8")).replace(
      /<meta name="bline-(?:release|offline)" content="[^"]+">/g,
      "",
    ),
  );
  // The original generated worker, including its cache-first navigation and
  // wait-for-all-tabs lifecycle. Never derive it from the new custom worker.
  await generateSW({
    swDest: path.join(legacy, "sw.js"),
    globDirectory: legacy,
    globPatterns: ["**/*.{html,js,css,png,svg,ico,woff,woff2}"],
    globIgnores: ["offline/**", "sw.js", "workbox-*.js"],
    cacheId: "bline-web",
    navigateFallback: "index.html",
    dontCacheBustURLsMatching: /-[\w-]{8}\.(?:js|css)$/,
    cleanupOutdatedCaches: true,
    skipWaiting: false,
    clientsClaim: false,
  });
}

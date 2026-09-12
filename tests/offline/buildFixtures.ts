import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build, type Plugin } from "vite";
import { generateSW } from "workbox-build";

export const fixtureRoot = path.resolve("node_modules/.tmp/offline-fixtures");

function nextReleasePlugin(): Plugin {
  return {
    name: "offline-update-test-fixture",
    enforce: "pre",
    transform(code, id) {
      if (id.endsWith("/src/main.tsx")) {
        return `document.documentElement.dataset.offlineTestBuild = "next";\n${code}`;
      }
      if (id.endsWith("/src/core/field/fieldConfig.ts")) {
        return code.replace(
          "field26.png?url&no-inline",
          "field22.png?url&no-inline",
        );
      }
      if (id.endsWith("/src/platform/autoVelocity.worker.ts")) {
        return `globalThis.name = "offline-test-next-worker";\n${code}`;
      }
      if (id.endsWith("/src/platform/fileExport.ts")) {
        return `${code}\nexport const offlineTestExportVersion = "next";`;
      }
      if (id.endsWith("/src/styles.css"))
        return `${code}\n:root { --offline-test-build: next; }`;
    },
  };
}

export default async function buildFixtures(): Promise<void> {
  await build({
    build: { outDir: path.join(fixtureRoot, "current"), emptyOutDir: true },
    logLevel: "warn",
  });
  await build({
    plugins: [nextReleasePlugin()],
    worker: { plugins: () => [nextReleasePlugin()] },
    build: { outDir: path.join(fixtureRoot, "next"), emptyOutDir: true },
    logLevel: "warn",
  });
  const legacy = path.join(fixtureRoot, "legacy");
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

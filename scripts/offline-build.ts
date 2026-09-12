import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

/** Runs on the finished bundle, before Workbox discovers the offline files. */
export async function prepareOfflineRelease(directory: string): Promise<void> {
  const files = (await readdir(directory, { recursive: true }))
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => path.extname(file) && file !== "sw.js")
    .sort();
  const hashes = await Promise.all(
    files.map(
      async (file) =>
        `${file}:${digest(await readFile(path.join(directory, file)))}`,
    ),
  );
  const release = digest(hashes.join("\n"));
  const indexPath = path.join(directory, "index.html");
  const html = (await readFile(indexPath, "utf8")).replace(
    "<head>",
    `<head><meta name="bline-release" content="${release}"><meta name="bline-offline" content="false">`,
  );
  await mkdir(path.join(directory, "offline"), { recursive: true });
  await writeFile(indexPath, html);
  await writeFile(path.join(directory, "offline", `${release}.html`), html);
}

export async function verifyManifest(
  entries: {
    url: string;
    revision: string | null;
    integrity?: string;
    size: number;
  }[],
  directory: string,
) {
  const manifest = await Promise.all(
    entries
      .filter((entry) => entry.url !== "index.html")
      .map(async (entry) => ({
        ...entry,
        integrity: `sha256-${createHash("sha256")
          .update(await readFile(path.join(directory, entry.url)))
          .digest("base64")}`,
      })),
  );
  const files = (await readdir(directory, { recursive: true })).map((file) =>
    file.split(path.sep).join("/"),
  );
  const required = files.filter(
    (file) =>
      /\.(html|js|css|png|svg|ico|woff2?|json|wasm|webmanifest)$/.test(file) &&
      file !== "index.html" &&
      file !== "sw.js",
  );
  const present = new Set(manifest.map((entry) => entry.url));
  const missing = required.filter((file) => !present.has(file));
  if (missing.length)
    throw new Error(`Incomplete offline manifest: ${missing.join(", ")}`);
  if (!manifest.some((entry) => /^offline\/[a-f0-9]+\.html$/.test(entry.url))) {
    throw new Error("Missing immutable offline HTML snapshot");
  }
  return { manifest, warnings: [] };
}

export const developmentRecoveryWorker = `
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  await self.registration.unregister();
})()));
// Existing clients can remain controlled after unregistering: always pass through.
self.addEventListener('fetch', event => event.respondWith(fetch(event.request)));
`;

export function offlineDevelopmentRecovery(): Plugin {
  return {
    name: "bline-offline-development-recovery",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(
          request.url ?? "/",
          `http://${request.headers.host ?? "localhost"}`,
        );
        if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
          return next();
        response.setHeader("X-BLine-Development", "true");
        if (url.pathname !== `${server.config.base}sw.js`) return next();
        response.setHeader("Content-Type", "text/javascript");
        response.setHeader("Cache-Control", "no-store");
        response.end(developmentRecoveryWorker);
      });
    },
  };
}

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { test as base } from "@playwright/test";

const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

async function readRelease(): Promise<Map<string, Buffer>> {
  const root = new URL("../../dist/", import.meta.url);
  const release = new Map<string, Buffer>();
  for (const path of await readdir(root, { recursive: true })) {
    if (extname(path)) {
      release.set(`/${path}`, await readFile(new URL(path, root)));
    }
  }
  return release;
}

function nextRelease(current: Map<string, Buffer>): Map<string, Buffer> {
  const next = new Map(current);
  next.set(
    "/index.html",
    Buffer.from(
      current
        .get("/index.html")!
        .toString()
        .replace(
          "<head>",
          '<head><meta name="offline-test-release" content="next">',
        ),
    ),
  );
  // A stable public asset name changes between releases too. Replacing its
  // contents must not damage the still-active version during installation.
  next.set(
    "/assets/fields/field26.png",
    current.get("/assets/fields/field22.png")!,
  );
  let worker = current.get("/sw.js")!.toString();
  for (const path of ["/index.html", "/assets/fields/field26.png"]) {
    const revision = createHash("md5").update(current.get(path)!).digest("hex");
    const updated = createHash("md5").update(next.get(path)!).digest("hex");
    if (!worker.includes(revision)) {
      throw new Error(`${path} is missing a content revision in the precache`);
    }
    worker = worker.replaceAll(revision, updated);
  }
  next.set("/sw.js", Buffer.from(worker));
  return next;
}

interface ProductionServer {
  url: string;
  requests: string[];
  failedRequests: string[];
  release: Map<string, Buffer>;
  publishUpdate(): void;
  fail(path: string | null): void;
}

export const test = base.extend<{ production: ProductionServer }>({
  baseURL: async ({ production }, provide) => provide(production.url),
  production: async ({}, provide) => {
    let release = await readRelease();
    const original = release;
    let failure: string | null = null;
    const requests: string[] = [];
    const failedRequests: string[] = [];
    const server = createServer((request, response) => {
      const pathname = new URL(request.url!, "http://localhost").pathname;
      const path = pathname === "/" ? "/index.html" : pathname;
      requests.push(path);
      response.setHeader("Cache-Control", "no-store");
      if (failure === path) {
        failedRequests.push(path);
        response.writeHead(503).end("Download interrupted");
        return;
      }
      const body = release.get(path);
      if (!body) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader(
        "Content-Type",
        contentTypes[extname(path)] ?? "application/octet-stream",
      );
      response.end(body);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a loopback server address");
    }
    try {
      await provide({
        url: `http://127.0.0.1:${address.port}/`,
        requests,
        failedRequests,
        release: original,
        publishUpdate: () => {
          release = nextRelease(original);
        },
        fail: (path) => {
          failure = path;
        },
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
});

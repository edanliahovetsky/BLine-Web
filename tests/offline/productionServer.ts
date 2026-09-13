import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { test as base } from "@playwright/test";
import { fixtureRoot } from "./buildFixtures";
import { createServer as createViteServer, type ViteDevServer } from "vite";

const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

async function readRelease(name: string): Promise<Map<string, Buffer>> {
  const root = join(fixtureRoot, name);
  const release = new Map<string, Buffer>();
  for (const path of await readdir(root, { recursive: true })) {
    if (extname(path)) {
      release.set(`/${path}`, await readFile(join(root, path)));
    }
  }
  return release;
}

interface ProductionServer {
  url: string;
  requests: string[];
  failedRequests: string[];
  requestOrigins: { path: string; origin: string | null }[];
  varyOrigin(enabled: boolean): void;
  stopServing(): Promise<void>;
  release: Map<string, Buffer>;
  nextRelease: Map<string, Buffer>;
  thirdRelease: Map<string, Buffer>;
  publishUpdate(): void;
  publishThird(): void;
  publishLegacy(): void;
  publishPrevious(): void;
  publishCurrent(): void;
  fail(path: string | null): void;
  delay(
    path: string | null,
    milliseconds?: number,
    afterHeaders?: boolean,
  ): void;
  corrupt(path: string | null): void;
  serveDevelopment(): Promise<void>;
}

export const test = base.extend<{ production: ProductionServer }>({
  baseURL: async ({ production }, provide) => provide(production.url),
  production: async ({}, provide) => {
    let release = await readRelease("current");
    const original = release;
    const next = await readRelease("next");
    const third = await readRelease("third");
    const legacy = await readRelease("legacy");
    const previous = await readRelease("previous");
    let development: ViteDevServer | undefined;
    let failure: string | null = null;
    let corrupted: string | null = null;
    let delayed: {
      path: string | null;
      milliseconds: number;
      afterHeaders: boolean;
    } = { path: null, milliseconds: 0, afterHeaders: false };
    const requests: string[] = [];
    const failedRequests: string[] = [];
    const requestOrigins: { path: string; origin: string | null }[] = [];
    let varyOrigin = true;
    const server = createServer((request, response) => {
      if (development) {
        development.middlewares(request, response, () =>
          response.writeHead(404).end(),
        );
        return;
      }
      const pathname = new URL(request.url!, "http://localhost").pathname;
      const path = pathname === "/" ? "/index.html" : pathname;
      requests.push(path);
      requestOrigins.push({ path, origin: request.headers.origin ?? null });
      response.setHeader("Cache-Control", "no-store");
      if (varyOrigin) response.setHeader("Vary", "Origin");
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
      const send = () =>
        response.end(
          corrupted === path ? Buffer.from("incorrect release bytes") : body,
        );
      if (delayed.path === path) {
        if (delayed.afterHeaders) response.flushHeaders();
        const timer = setTimeout(send, delayed.milliseconds);
        response.on("close", () => clearTimeout(timer));
      } else send();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a loopback server address");
    }
    const stopServing = async () => {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    };
    try {
      await provide({
        url: `http://127.0.0.1:${address.port}/`,
        requests,
        failedRequests,
        requestOrigins,
        stopServing,
        varyOrigin: (enabled) => {
          varyOrigin = enabled;
        },
        release: original,
        nextRelease: next,
        thirdRelease: third,
        publishThird: () => {
          release = third;
        },
        publishUpdate: () => {
          // Deployments replace the previous bundle; old URLs really disappear.
          release = next;
        },
        publishLegacy: () => {
          release = legacy;
        },
        publishPrevious: () => {
          release = previous;
        },
        publishCurrent: () => {
          release = original;
        },
        fail: (path) => {
          failure = path;
        },
        delay: (path, milliseconds = 0, afterHeaders = false) => {
          delayed = { path, milliseconds, afterHeaders };
        },
        corrupt: (path) => {
          corrupted = path;
        },
        serveDevelopment: async () => {
          development = await createViteServer({
            server: {
              middlewareMode: true,
              hmr: false,
              ws: false,
              watch: null,
            },
            logLevel: "error",
          });
        },
      });
    } finally {
      await development?.close();
      await stopServing();
    }
  },
});

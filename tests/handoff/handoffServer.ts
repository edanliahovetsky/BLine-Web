import { readFile, readdir } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { extname, join } from "node:path";
import { test as base } from "@playwright/test";
import { handleHandoffRequest } from "../../service/handoff/relay";
import { localD1 } from "../unit/support/localD1";
import { handoffFixtureRoot, handoffOrigins } from "./buildFixtures";

const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

async function readRelease(name: string): Promise<Map<string, Buffer>> {
  const root = join(handoffFixtureRoot, name);
  const release = new Map<string, Buffer>();
  for (const path of await readdir(root, { recursive: true })) {
    if (extname(path)) {
      release.set(
        `/${path.replaceAll("\\", "/")}`,
        await readFile(join(root, path)),
      );
    }
  }
  return release;
}

interface HandoffServer {
  source: string;
  target: string;
  /** Requests bline.run received, as path plus query. */
  targetRequests: string[];
  uploads: number;
  /** Deploys the handoff release to the retired origin. */
  publishHandoff(): void;
  failUploads(enabled: boolean): void;
  expireUploads(enabled: boolean): void;
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export const test = base.extend<{ handoff: HandoffServer }>({
  handoff: async ({}, provide) => {
    const { source, target } = handoffOrigins();
    const previous = await readRelease("previous");
    const current = await readRelease("current");
    const db = localD1();
    let sourceRelease = previous;
    let failUploads = false;
    let expireUploads = false;
    const state: HandoffServer = {
      source,
      target,
      targetRequests: [],
      uploads: 0,
      publishHandoff: () => {
        sourceRelease = current;
      },
      failUploads: (enabled) => {
        failUploads = enabled;
      },
      expireUploads: (enabled) => {
        expireUploads = enabled;
      },
    };

    const server = createServer(async (request, response) => {
      const host = request.headers.host ?? "";
      const atTarget = `http://${host}` === target;
      const url = new URL(request.url!, `http://${host}`);
      response.setHeader("Cache-Control", "no-store");

      if (atTarget && url.pathname.startsWith("/api/handoff")) {
        if (request.method === "POST") state.uploads += 1;
        if (request.method === "POST" && failUploads) {
          response
            .writeHead(503, { "Access-Control-Allow-Origin": source })
            .end();
          return;
        }
        const id = url.pathname.slice("/api/handoff/".length) || undefined;
        const payload =
          request.method === "GET" || request.method === "OPTIONS"
            ? undefined
            : new Uint8Array(await body(request));
        const relayed = await handleHandoffRequest(
          new Request(url, {
            method: request.method,
            headers: Object.entries(request.headers).flatMap(([name, value]) =>
              typeof value === "string" &&
              !["connection", "host", "content-length"].includes(name)
                ? [[name, value] as [string, string]]
                : [],
            ),
            body: payload,
          }),
          db,
          id,
          {
            allowedSourceOrigins: [source],
            // Expire at pickup only, as if bline.run opened too late.
            now: () =>
              Date.now() +
              (expireUploads && request.method === "GET" ? 60 * 60 * 1000 : 0),
          },
        );
        response.writeHead(
          relayed.status,
          Object.fromEntries(relayed.headers.entries()),
        );
        response.end(Buffer.from(await relayed.arrayBuffer()));
        return;
      }

      if (atTarget) state.targetRequests.push(url.pathname + url.search);
      const release = atTarget ? current : sourceRelease;
      const path = url.pathname === "/" ? "/index.html" : url.pathname;
      const file = release.get(path);
      if (!file) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader(
        "Content-Type",
        contentTypes[extname(path)] ?? "application/octet-stream",
      );
      response.end(file);
    });
    await new Promise<void>((resolve) =>
      server.listen(Number(new URL(target).port), resolve),
    );
    try {
      await provide(state);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});

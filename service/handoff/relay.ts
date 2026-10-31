// One-time drop-off that carries browser projects from a retired BLine origin
// to bline.run. Browsers keep storage per origin, so the old site uploads its
// copy here and bline.run collects it once; nothing is kept after pickup.

/** The D1 surface the relay uses, so tests can run the same SQL locally. */
export interface HandoffDatabase {
  prepare(query: string): HandoffStatement;
  batch(statements: HandoffStatement[]): Promise<unknown>;
}

export interface HandoffStatement {
  bind(...values: unknown[]): HandoffStatement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
}

export interface HandoffRelayOptions {
  allowedSourceOrigins: readonly string[];
  now?: () => number;
  maxBytes?: number;
  ttlMs?: number;
}

export const retiredBLineOrigins = [
  "https://bline-web.pages.dev",
  "https://web-beta.bline-web.pages.dev",
] as const;

// The production Function handled 20 MB uploads and failed at 25 MB (error
// 1101); larger uploads get a clear 413 and the editor suggests exporting.
const defaultMaxBytes = 16 * 1024 * 1024;
const defaultTtlMs = 15 * 60 * 1000;
// D1 rows hold at most 2 MB; base64 grows each chunk by a third.
const chunkBytes = 1_200_000;
const idPattern = /^[a-f0-9]{64}$/;

const schema = `CREATE TABLE IF NOT EXISTS handoff_chunks (
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  total INTEGER NOT NULL,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (id, seq)
)`;

export async function handleHandoffRequest(
  request: Request,
  db: HandoffDatabase | undefined,
  id: string | undefined,
  options: HandoffRelayOptions,
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const allowedOrigin =
    origin && options.allowedSourceOrigins.includes(origin) ? origin : null;

  if (request.method === "OPTIONS") {
    return allowedOrigin && id === undefined
      ? new Response(null, { status: 204, headers: cors(allowedOrigin) })
      : new Response(null, { status: 403 });
  }
  if (!db) return json({ error: "Handoff storage is unavailable" }, 503);
  const now = (options.now ?? Date.now)();

  if (request.method === "POST" && id === undefined) {
    if (!allowedOrigin) return json({ error: "Unknown source" }, 403);
    const headers = cors(allowedOrigin);
    const maxBytes = options.maxBytes ?? defaultMaxBytes;
    if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) {
      return json({ error: "Too large" }, 413, headers);
    }
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength === 0) return json({ error: "Empty" }, 400, headers);
    if (body.byteLength > maxBytes) {
      return json({ error: "Too large" }, 413, headers);
    }

    const newId = randomId();
    const expiresAt = now + (options.ttlMs ?? defaultTtlMs);
    const total = Math.ceil(body.byteLength / chunkBytes);
    await db.prepare(schema).run();
    const insert = db.prepare(
      "INSERT INTO handoff_chunks (id, seq, total, data, expires_at) VALUES (?, ?, ?, ?, ?)",
    );
    await db.batch([
      db.prepare("DELETE FROM handoff_chunks WHERE expires_at <= ?").bind(now),
      ...Array.from({ length: total }, (_, seq) =>
        insert.bind(
          newId,
          seq,
          total,
          toBase64(body.subarray(seq * chunkBytes, (seq + 1) * chunkBytes)),
          expiresAt,
        ),
      ),
    ]);
    return json({ id: newId }, 201, headers);
  }

  if (request.method === "GET" && id !== undefined) {
    // Only the bline.run page itself collects; other sites cannot read it.
    const site = request.headers.get("Sec-Fetch-Site");
    if (
      (site && site !== "same-origin") ||
      (origin && origin !== new URL(request.url).origin)
    ) {
      return json({ error: "Cross-site pickup" }, 403);
    }
    if (!idPattern.test(id)) return json({ error: "Not found" }, 404);
    await db.prepare(schema).run();
    const { results } = await db
      .prepare(
        "SELECT seq, total, data FROM handoff_chunks WHERE id = ? AND expires_at > ? ORDER BY seq",
      )
      .bind(id, now)
      .all<{ seq: number; total: number; data: string }>();
    await db.prepare("DELETE FROM handoff_chunks WHERE id = ?").bind(id).run();
    if (
      results.length === 0 ||
      results.length !== results[0].total ||
      results.some((row, index) => row.seq !== index)
    ) {
      return json({ error: "Not found" }, 404);
    }
    const parts = results.map((row) => fromBase64(row.data));
    const body = new Uint8Array(
      parts.reduce((size, part) => size + part.byteLength, 0),
    );
    let offset = 0;
    for (const part of parts) {
      body.set(part, offset);
      offset += part.byteLength;
    }
    return new Response(body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  }

  return json({ error: "Not allowed" }, 405);
}

function cors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

import { describe, expect, it } from "vitest";
import {
  handleHandoffRequest,
  retiredBLineOrigins,
} from "../../../service/handoff/relay";
import { localD1 } from "../support/localD1";

const source = retiredBLineOrigins[0];
const target = "https://bline.run";

function upload(body: Uint8Array<ArrayBuffer>, origin: string = source) {
  return new Request(`${target}/api/handoff`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/octet-stream" },
    body,
  });
}

function pickup(id: string, site = "same-origin") {
  return new Request(`${target}/api/handoff/${id}`, {
    headers: { "Sec-Fetch-Site": site },
  });
}

describe("handoff relay", () => {
  const options = { allowedSourceOrigins: retiredBLineOrigins };

  it("hands a retired origin's upload to bline.run exactly once", async () => {
    const db = localD1();
    // Larger than one D1 row, so the upload is split and rejoined.
    const large = Uint8Array.from({ length: 3_000_000 }, (_, i) => i % 251);

    const stored = await handleHandoffRequest(
      upload(large),
      db,
      undefined,
      options,
    );
    expect(stored.status).toBe(201);
    expect(stored.headers.get("Access-Control-Allow-Origin")).toBe(source);
    const { id } = (await stored.json()) as { id: string };
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(db.rows()).toBe(3);

    const collected = await handleHandoffRequest(pickup(id), db, id, options);
    expect(collected.status).toBe(200);
    expect(collected.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await collected.arrayBuffer())).toEqual(large);
    expect(db.rows()).toBe(0);

    const again = await handleHandoffRequest(pickup(id), db, id, options);
    expect(again.status).toBe(404);
  });

  it("accepts uploads only from the retired BLine origins", async () => {
    const db = localD1();
    const body = new Uint8Array([1, 2, 3]);
    const stranger = await handleHandoffRequest(
      upload(body, "https://example.com"),
      db,
      undefined,
      options,
    );
    expect(stranger.status).toBe(403);
    expect(stranger.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const preflight = await handleHandoffRequest(
      new Request(`${target}/api/handoff`, {
        method: "OPTIONS",
        headers: { Origin: retiredBLineOrigins[1] },
      }),
      db,
      undefined,
      options,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
      retiredBLineOrigins[1],
    );
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("POST");
  });

  it("lets only bline.run itself collect", async () => {
    const db = localD1();
    const stored = await handleHandoffRequest(
      upload(new Uint8Array([9])),
      db,
      undefined,
      options,
    );
    const { id } = (await stored.json()) as { id: string };

    const crossSite = await handleHandoffRequest(
      pickup(id, "cross-site"),
      db,
      id,
      options,
    );
    expect(crossSite.status).toBe(403);
    // A refused pickup leaves the projects for the real one.
    expect(db.rows()).toBe(1);
    expect(
      (
        await handleHandoffRequest(
          pickup("not-an-id"),
          db,
          "not-an-id",
          options,
        )
      ).status,
    ).toBe(404);
  });

  it("forgets uploads that were not collected in time", async () => {
    const db = localD1();
    let now = 1_000_000;
    const timed = { ...options, now: () => now, ttlMs: 60_000 };
    const stored = await handleHandoffRequest(
      upload(new Uint8Array([1])),
      db,
      undefined,
      timed,
    );
    const { id } = (await stored.json()) as { id: string };

    now += 60_000;
    expect((await handleHandoffRequest(pickup(id), db, id, timed)).status).toBe(
      404,
    );

    await handleHandoffRequest(
      upload(new Uint8Array([2])),
      db,
      undefined,
      timed,
    );
    const stale = await handleHandoffRequest(
      upload(new Uint8Array([3])),
      db,
      undefined,
      { ...timed, now: () => now + 120_000 },
    );
    expect(stale.status).toBe(201);
    // Each upload first clears anything already expired.
    expect(db.rows()).toBe(1);
  });

  it("refuses oversized or empty uploads and missing storage", async () => {
    const db = localD1();
    const limited = { ...options, maxBytes: 4 };
    expect(
      (
        await handleHandoffRequest(
          upload(new Uint8Array(5)),
          db,
          undefined,
          limited,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await handleHandoffRequest(
          upload(new Uint8Array(0)),
          db,
          undefined,
          options,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleHandoffRequest(
          upload(new Uint8Array([1])),
          undefined,
          undefined,
          options,
        )
      ).status,
    ).toBe(503);
  });
});

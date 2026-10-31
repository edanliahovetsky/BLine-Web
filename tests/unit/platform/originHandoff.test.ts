import { describe, expect, it } from "vitest";
import {
  collectSnapshot,
  decodeValue,
  encodeValue,
  handoffMovedKey,
  mergeLocalStorage,
  packSnapshot,
  unpackSnapshot,
  type HandoffSnapshot,
} from "../../../src/platform/originHandoff";

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, String(value)),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
  };
}

describe("origin handoff", () => {
  it("packs every BLine record but not unrelated site data", async () => {
    const snapshot = await collectSnapshot(
      memoryStorage({
        "bline-web:workspace:abc": '{"files":[]}',
        "bline-web:current-workspace": "abc",
        "bline.autoVelocity.autoSync": "true",
        [handoffMovedKey]: "2026-10-31T00:00:00.000Z",
        "cf-analytics": "x",
      }),
    );

    expect(snapshot.localStorage).toEqual([
      ["bline-web:workspace:abc", '{"files":[]}'],
      ["bline-web:current-workspace", "abc"],
      ["bline.autoVelocity.autoSync", "true"],
    ]);
  });

  it("round-trips field images and dates through the packed upload", async () => {
    const image = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) % 256);
    const snapshot: HandoffSnapshot = {
      format: "bline-origin-handoff/1",
      localStorage: [["bline-web:workspace:abc", "{}"]],
      databases: [
        {
          name: "bline-web-field-assets",
          version: 1,
          stores: [
            {
              name: "field-assets",
              keyPath: "key",
              autoIncrement: false,
              records: [
                {
                  key: null,
                  value: {
                    key: "abc:field",
                    bytes: image.buffer,
                    preview: image.subarray(0, 4),
                    updatedAt: new Date("2026-10-31T12:00:00Z"),
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const packed = await packSnapshot(snapshot);
    const restored = await unpackSnapshot(
      new Uint8Array(await packed.arrayBuffer()),
    );
    const value = restored.databases[0].stores[0].records[0].value as {
      bytes: ArrayBuffer;
      preview: Uint8Array;
      updatedAt: Date;
    };

    expect(restored.localStorage).toEqual(snapshot.localStorage);
    expect(new Uint8Array(value.bytes)).toEqual(image);
    expect(value.preview).toEqual(image.subarray(0, 4));
    expect(value.updatedAt.toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });

  it("leaves already decoded bytes and dates untouched", () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const decoded = decodeValue(
      decodeValue(encodeValue({ bytes, at: new Date(0) })),
    ) as { bytes: ArrayBuffer; at: Date };

    expect(new Uint8Array(decoded.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(decoded.at.getTime()).toBe(0);
  });

  it("decodes field images stored as Blobs", async () => {
    const decoded = decodeValue(
      encodeValue({
        image: { "$bline:blob": btoa("png!"), type: "image/png" },
      }),
    ) as { image: Blob };

    expect(decoded.image.type).toBe("image/png");
    expect(await decoded.image.text()).toBe("png!");
  });

  it("adds moved records without replacing anything bline.run already has", () => {
    const storage = memoryStorage({
      "bline-web:current-workspace": "kept",
      "bline-web:workspace:kept": "newer",
    });

    const added = mergeLocalStorage(storage, [
      ["bline-web:current-workspace", "moved"],
      ["bline-web:workspace:kept", "older"],
      ["bline-web:workspace:moved", "moved project"],
    ]);

    expect(added).toBe(1);
    expect(storage.getItem("bline-web:current-workspace")).toBe("kept");
    expect(storage.getItem("bline-web:workspace:kept")).toBe("newer");
    expect(storage.getItem("bline-web:workspace:moved")).toBe("moved project");
  });

  it("rejects uploads in an unknown format", async () => {
    const bytes = new TextEncoder().encode('\u0000{"format":"other"}');
    await expect(unpackSnapshot(new Uint8Array(bytes))).rejects.toThrow(
      "Unknown handoff format",
    );
  });
});

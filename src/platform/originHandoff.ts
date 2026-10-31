import { detectEnvironmentCapabilities } from "../env/capabilities";

// BLine moved from *.pages.dev to bline.run. Browsers keep storage per origin,
// so a retired origin packs its projects, leaves them at bline.run's one-time
// drop-off and sends the visitor on; bline.run collects them before startup.

export const handoffTargetOrigin =
  import.meta.env.VITE_HANDOFF_TARGET_ORIGIN ?? "https://bline.run";
export const handoffSourceHosts = (
  import.meta.env.VITE_HANDOFF_SOURCE_HOSTS ??
  "bline-web.pages.dev,web-beta.bline-web.pages.dev"
).split(",");

/** Remembers on the retired origin that its projects already moved. */
export const handoffMovedKey = "bline-web:handoff-moved";
const fragmentKey = "bline-handoff";
const retryParam = "bline-handoff-retry";
const format = "bline-origin-handoff/1";
const databaseNames = [
  "bline-web-user-field-assets",
  "bline-web-field-assets",
] as const;

export type HandoffOutcome =
  | { kind: "none" }
  | { kind: "source-failed"; reason: string }
  | { kind: "arrived"; from: string }
  | { kind: "arrival-failed"; from: string | null; reason: string };

export interface HandoffSnapshot {
  format: typeof format;
  localStorage: [string, string][];
  databases: DatabaseDump[];
}

interface DatabaseDump {
  name: string;
  version: number;
  stores: StoreDump[];
}

interface StoreDump {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  records: { key: unknown; value: unknown }[];
}

/** Runs before the editor starts. Resolves only when the editor should load. */
export async function runOriginHandoff(): Promise<HandoffOutcome> {
  if (detectEnvironmentCapabilities().shell !== "browser-web") {
    return { kind: "none" };
  }
  if (handoffSourceHosts.includes(location.host)) return leaveRetiredOrigin();
  if (location.origin === handoffTargetOrigin) return collectArrival();
  return { kind: "none" };
}

async function leaveRetiredOrigin(): Promise<HandoffOutcome> {
  const url = new URL(location.href);
  const retry = url.searchParams.has(retryParam);
  url.searchParams.delete(retryParam);
  const destination = `${handoffTargetOrigin}${url.pathname}${url.search}`;
  if (!retry && readStorage(handoffMovedKey) !== null) {
    return redirect(destination);
  }

  try {
    const snapshot = await collectSnapshot(window.localStorage);
    if (
      snapshot.localStorage.length === 0 &&
      snapshot.databases.every((database) =>
        database.stores.every((store) => store.records.length === 0),
      )
    ) {
      writeStorage(handoffMovedKey, new Date().toISOString());
      return redirect(destination);
    }
    const response = await fetch(`${handoffTargetOrigin}/api/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: await packSnapshot(snapshot),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 413
          ? "Your projects are too large to move automatically."
          : `bline.run answered ${response.status}.`,
      );
    }
    const { id } = (await response.json()) as { id: string };
    writeStorage(handoffMovedKey, new Date().toISOString());
    const fragment = new URLSearchParams({
      [fragmentKey]: id,
      from: location.host,
    });
    return redirect(`${destination}#${fragment}`);
  } catch (error) {
    return {
      kind: "source-failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectArrival(): Promise<HandoffOutcome> {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const id = fragment.get(fragmentKey);
  if (!id) return { kind: "none" };
  const fromHost = fragment.get("from");
  const from =
    fromHost && handoffSourceHosts.includes(fromHost) ? fromHost : null;
  history.replaceState(history.state, "", location.pathname + location.search);

  try {
    const response = await fetch(`/api/handoff/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? "The moved projects expired before they arrived."
          : `bline.run answered ${response.status}.`,
      );
    }
    const snapshot = await unpackSnapshot(
      new Uint8Array(await response.arrayBuffer()),
    );
    await restoreDatabases(snapshot.databases);
    mergeLocalStorage(window.localStorage, snapshot.localStorage);
    return { kind: "arrived", from: from ?? "the previous BLine address" };
  } catch (error) {
    return {
      kind: "arrival-failed",
      from,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Link back to a retired origin so it can send its projects again. */
export function retryHandoffUrl(from: string): string {
  return `https://${from}/?${retryParam}`;
}

function redirect(url: string): Promise<never> {
  location.replace(url);
  // The page is navigating away; never start the editor here.
  return new Promise(() => {});
}

export async function collectSnapshot(
  storage: Storage,
): Promise<HandoffSnapshot> {
  const entries: [string, string][] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    const value = key === null ? null : storage.getItem(key);
    if (key?.startsWith("bline") && key !== handoffMovedKey && value !== null) {
      entries.push([key, value]);
    }
  }
  const databases: DatabaseDump[] = [];
  for (const name of databaseNames) {
    const dump = await dumpDatabase(name);
    if (dump) databases.push(dump);
  }
  return { format, localStorage: entries, databases };
}

/** Keeps anything bline.run already has; moved Projects never overwrite it. */
export function mergeLocalStorage(
  storage: Storage,
  entries: readonly [string, string][],
): number {
  let added = 0;
  for (const [key, value] of entries) {
    if (storage.getItem(key) === null) {
      storage.setItem(key, value);
      added += 1;
    }
  }
  return added;
}

export async function packSnapshot(snapshot: HandoffSnapshot): Promise<Blob> {
  const json = new Blob([JSON.stringify(encodeValue(snapshot))]);
  if (typeof CompressionStream === "undefined") {
    return new Blob([new Uint8Array([0]), json]);
  }
  const gzip = await new Response(
    json.stream().pipeThrough(new CompressionStream("gzip")),
  ).blob();
  return new Blob([new Uint8Array([1]), gzip]);
}

export async function unpackSnapshot(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<HandoffSnapshot> {
  const body = new Blob([bytes.subarray(1)]);
  const text =
    bytes[0] === 1
      ? await new Response(
          body.stream().pipeThrough(new DecompressionStream("gzip")),
        ).text()
      : await body.text();
  const snapshot = decodeValue(JSON.parse(text)) as HandoffSnapshot;
  if (snapshot?.format !== format) throw new Error("Unknown handoff format");
  return snapshot;
}

// IndexedDB values hold binary field images; JSON carries them as base64.
const bytesTag = "$bline:bytes";
const blobTag = "$bline:blob";
const dateTag = "$bline:date";

export function encodeValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) {
    return { [bytesTag]: toBase64(new Uint8Array(value)) };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      [bytesTag]: toBase64(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      ),
      view: value.constructor.name,
    };
  }
  if (value instanceof Date) return { [dateTag]: value.toISOString() };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, encodeValue(entry)]),
    );
  }
  return value;
}

export function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record[bytesTag] === "string") {
    const bytes = fromBase64(record[bytesTag]);
    return record.view === "Uint8Array" ? bytes : bytes.buffer;
  }
  if (typeof record[blobTag] === "string") {
    return new Blob([fromBase64(record[blobTag])], {
      type: typeof record.type === "string" ? record.type : "",
    });
  }
  if (typeof record[dateTag] === "string") return new Date(record[dateTag]);
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, decodeValue(entry)]),
  );
}

async function encodeBlobs(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    return {
      [blobTag]: toBase64(new Uint8Array(await value.arrayBuffer())),
      type: value.type,
    };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encodeBlobs));
  if (value && typeof value === "object" && !ArrayBuffer.isView(value)) {
    if (value instanceof ArrayBuffer || value instanceof Date) return value;
    const entries = await Promise.all(
      Object.entries(value).map(
        async ([key, entry]) => [key, await encodeBlobs(entry)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

async function databaseExists(name: string): Promise<boolean> {
  if (typeof indexedDB.databases === "function") {
    return (await indexedDB.databases()).some(
      (database) => database.name === name,
    );
  }
  // Without a listing, opening must not create an empty database.
  return new Promise((resolve) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) request.transaction?.abort();
    };
    request.onsuccess = () => {
      request.result.close();
      resolve(true);
    };
    request.onerror = () => {
      indexedDB.deleteDatabase(name);
      resolve(false);
    };
  });
}

function openDatabase(
  name: string,
  version?: number,
  upgrade?: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error(`Close other BLine tabs, then try again (${name})`));
  });
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dumpDatabase(name: string): Promise<DatabaseDump | null> {
  if (typeof indexedDB === "undefined" || !(await databaseExists(name))) {
    return null;
  }
  const db = await openDatabase(name);
  try {
    const stores: StoreDump[] = [];
    for (const storeName of Array.from(db.objectStoreNames)) {
      const store = db.transaction(storeName).objectStore(storeName);
      const [keys, values] = await Promise.all([
        settle(store.getAllKeys()),
        settle(store.getAll()),
      ]);
      stores.push({
        name: storeName,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        records: await Promise.all(
          values.map(async (value, index) => ({
            key: store.keyPath === null ? keys[index] : null,
            value: await encodeBlobs(value),
          })),
        ),
      });
    }
    return { name, version: db.version, stores };
  } finally {
    db.close();
  }
}

async function restoreDatabases(dumps: readonly DatabaseDump[]): Promise<void> {
  for (const dump of dumps) {
    const create = (db: IDBDatabase) => {
      for (const store of dump.stores) {
        if (!db.objectStoreNames.contains(store.name)) {
          db.createObjectStore(store.name, {
            keyPath: store.keyPath ?? undefined,
            autoIncrement: store.autoIncrement,
          });
        }
      }
    };
    const exists = await databaseExists(dump.name);
    let db = await openDatabase(
      dump.name,
      exists ? undefined : dump.version,
      create,
    );
    if (
      dump.stores.some((store) => !db.objectStoreNames.contains(store.name))
    ) {
      const version = db.version + 1;
      db.close();
      db = await openDatabase(dump.name, version, create);
    }
    try {
      for (const store of dump.stores) {
        if (store.records.length === 0) continue;
        const transaction = db.transaction(store.name, "readwrite");
        const target = transaction.objectStore(store.name);
        for (const record of store.records) {
          const value = decodeValue(record.value);
          // Keep what bline.run already has: add() refuses existing keys.
          const request =
            store.keyPath === null
              ? target.add(value, decodeValue(record.key) as IDBValidKey)
              : target.add(value);
          request.onerror = (event) => {
            event.preventDefault();
            event.stopPropagation();
          };
        }
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      }
    } finally {
      db.close();
    }
  }
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Without storage the next visit packs again; the editor still moves.
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

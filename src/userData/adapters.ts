import { invoke } from "@tauri-apps/api/core";
import type { UserData } from "./model";

export const BROWSER_USER_DATA_KEY = "bline-web:user-data";
export const BROWSER_USER_FIELD_ASSET_DB_NAME = "bline-web-user-field-assets";

const userFieldAssetStoreName = "user-field-assets";
const userDataStoreName = "user-data";
const userDataRecordKey = "global";

export interface UserDataStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface VersionedUserData {
  revision: number;
  data: unknown;
}

export type UserDataCompareAndSwapResult =
  | { status: "written"; revision: number }
  | { status: "conflict"; document: VersionedUserData };

export interface UserDataAdapter {
  read(): Promise<VersionedUserData | null>;
  compareAndSwap(
    expectedRevision: number,
    data: UserData,
  ): Promise<UserDataCompareAndSwapResult>;
  writeFieldAsset(entryId: string, bytes: Uint8Array): Promise<void>;
  readFieldAsset(entryId: string): Promise<Uint8Array | null>;
  deleteFieldAsset(entryId: string): Promise<void>;
}

export interface BrowserUserDataAdapterOptions {
  storage?: UserDataStorage;
  key?: string;
  assetDbName?: string;
}

export class BrowserUserDataAdapter implements UserDataAdapter {
  readonly storage: UserDataStorage;
  private readonly keyName: string;
  private readonly assetDbName: string;
  private readonly useStorageFallback: boolean;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: BrowserUserDataAdapterOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.keyName = options.key ?? BROWSER_USER_DATA_KEY;
    this.assetDbName = options.assetDbName ?? BROWSER_USER_FIELD_ASSET_DB_NAME;
    // Explicit storage injection is retained for non-browser hosts and unit
    // tests. Normal browser persistence uses an IndexedDB transaction so the
    // revision check and replacement are indivisible across tabs.
    this.useStorageFallback = options.storage !== undefined;
  }

  async read(): Promise<VersionedUserData | null> {
    if (this.useStorageFallback) {
      return this.readStorageDocument();
    }
    const db = await this.openDb();
    const record = await runStoreRequest<BrowserUserDataRecord | null>(
      db,
      userDataStoreName,
      "readonly",
      (store) => store.get(userDataRecordKey),
    );
    return record
      ? { revision: record.revision, data: structuredClone(record.data) }
      : this.readStorageDocument();
  }

  async compareAndSwap(
    expectedRevision: number,
    data: UserData,
  ): Promise<UserDataCompareAndSwapResult> {
    if (this.useStorageFallback) {
      const current = this.readStorageDocument();
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        if (!current) {
          throw new Error("User Data revision is missing");
        }
        return { status: "conflict", document: current };
      }
      const revision = expectedRevision + 1;
      this.storage.setItem(this.keyName, JSON.stringify(data));
      this.storage.setItem(this.revisionKeyName, String(revision));
      return { status: "written", revision };
    }

    const db = await this.openDb();
    return new Promise<UserDataCompareAndSwapResult>((resolve, reject) => {
      const transaction = db.transaction(userDataStoreName, "readwrite");
      const store = transaction.objectStore(userDataStoreName);
      const request = store.get(userDataRecordKey);
      let result: UserDataCompareAndSwapResult | undefined;
      request.addEventListener("success", () => {
        const record = (request.result ?? null) as BrowserUserDataRecord | null;
        const legacy = record ? null : this.readStorageDocument();
        const currentRevision = record?.revision ?? legacy?.revision ?? 0;
        const currentData = record?.data ?? legacy?.data;
        if (currentRevision !== expectedRevision) {
          if (currentData === undefined) {
            transaction.abort();
            return;
          }
          result = {
            status: "conflict",
            document: {
              revision: currentRevision,
              data: structuredClone(currentData),
            },
          };
          return;
        }
        const revision = expectedRevision + 1;
        store.put({
          key: userDataRecordKey,
          revision,
          data: structuredClone(data),
        } satisfies BrowserUserDataRecord);
        result = { status: "written", revision };
      });
      request.addEventListener("error", () => {
        reject(request.error ?? new Error("Failed to read User Data"));
      });
      transaction.addEventListener("complete", () => {
        if (!result) {
          reject(new Error("User Data compare-and-swap did not complete"));
          return;
        }
        resolve(result);
      });
      transaction.addEventListener("abort", () => {
        reject(transaction.error ?? new Error("User Data transaction aborted"));
      });
      transaction.addEventListener("error", () => {
        reject(transaction.error ?? new Error("User Data transaction failed"));
      });
    });
  }

  async writeFieldAsset(entryId: string, bytes: Uint8Array): Promise<void> {
    const db = await this.openDb();
    await runStoreRequest(db, userFieldAssetStoreName, "readwrite", (store) =>
      store.put({
        entryId,
        bytes: new Uint8Array(bytes).buffer,
      } satisfies BrowserUserFieldAssetRecord),
    );
  }

  async readFieldAsset(entryId: string): Promise<Uint8Array | null> {
    const db = await this.openDb();
    const record = await runStoreRequest<BrowserUserFieldAssetRecord | null>(
      db,
      userFieldAssetStoreName,
      "readonly",
      (store) => store.get(entryId),
    );
    return record ? new Uint8Array(record.bytes.slice(0)) : null;
  }

  async deleteFieldAsset(entryId: string): Promise<void> {
    const db = await this.openDb();
    await runStoreRequest(db, userFieldAssetStoreName, "readwrite", (store) =>
      store.delete(entryId),
    );
  }

  private get revisionKeyName(): string {
    return `${this.keyName}:revision`;
  }

  private readStorageDocument(): VersionedUserData | null {
    const raw = this.storage.getItem(this.keyName);
    if (raw === null) {
      return null;
    }
    const revision = Number(this.storage.getItem(this.revisionKeyName) ?? "0");
    return {
      revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
      data: JSON.parse(raw) as unknown,
    };
  }

  private openDb(): Promise<IDBDatabase> {
    if (!("indexedDB" in globalThis)) {
      throw new Error("User Field Background storage is unavailable");
    }
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.assetDbName, 2);
      request.addEventListener("error", () => {
        reject(request.error ?? new Error("Failed to open User Field storage"));
      });
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(userFieldAssetStoreName)) {
          db.createObjectStore(userFieldAssetStoreName, {
            keyPath: "entryId",
          });
        }
        if (!db.objectStoreNames.contains(userDataStoreName)) {
          db.createObjectStore(userDataStoreName, { keyPath: "key" });
        }
      });
      request.addEventListener("success", () => resolve(request.result));
    });
    return this.dbPromise;
  }
}

export type UserDataInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export class TauriUserDataAdapter implements UserDataAdapter {
  constructor(private readonly commandInvoke: UserDataInvoke = invoke) {}

  read(): Promise<VersionedUserData | null> {
    return this.commandInvoke<VersionedUserData | null>(
      "storage_read_user_data",
    );
  }

  compareAndSwap(
    expectedRevision: number,
    data: UserData,
  ): Promise<UserDataCompareAndSwapResult> {
    return this.commandInvoke<UserDataCompareAndSwapResult>(
      "storage_compare_and_swap_user_data",
      { expectedRevision, data },
    );
  }

  async writeFieldAsset(entryId: string, bytes: Uint8Array): Promise<void> {
    await this.commandInvoke("storage_write_user_field_asset", {
      entryId,
      bytes: Array.from(bytes),
    });
  }

  async readFieldAsset(entryId: string): Promise<Uint8Array | null> {
    const bytes = await this.commandInvoke<number[] | null>(
      "storage_read_user_field_asset",
      { entryId },
    );
    return bytes ? new Uint8Array(bytes) : null;
  }

  async deleteFieldAsset(entryId: string): Promise<void> {
    await this.commandInvoke("storage_delete_user_field_asset", { entryId });
  }
}

interface BrowserUserDataRecord {
  key: typeof userDataRecordKey;
  revision: number;
  data: unknown;
}

interface BrowserUserFieldAssetRecord {
  entryId: string;
  bytes: ArrayBuffer;
}

function runStoreRequest<T = undefined>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  requestFor: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = requestFor(transaction.objectStore(storeName));
    let result: T;
    request.addEventListener("success", () => {
      result = (request.result ?? null) as T;
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("User Data request failed"));
    });
    transaction.addEventListener("complete", () => resolve(result));
    transaction.addEventListener("abort", () => {
      reject(transaction.error ?? new Error("User Data transaction aborted"));
    });
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error("User Data transaction failed"));
    });
  });
}

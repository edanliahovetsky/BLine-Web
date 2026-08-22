import { invoke } from "@tauri-apps/api/core";
import type { UserData } from "./model";

export const BROWSER_USER_DATA_KEY = "bline-web:user-data";
export const BROWSER_USER_FIELD_ASSET_DB_NAME = "bline-web-user-field-assets";

const userFieldAssetStoreName = "user-field-assets";

export interface UserDataStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface UserDataAdapter {
  read(): Promise<unknown | null>;
  write(data: UserData): Promise<void>;
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
  private assetDbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: BrowserUserDataAdapterOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.keyName = options.key ?? BROWSER_USER_DATA_KEY;
    this.assetDbName = options.assetDbName ?? BROWSER_USER_FIELD_ASSET_DB_NAME;
  }

  async read(): Promise<unknown | null> {
    const raw = this.storage.getItem(this.keyName);
    if (raw === null) {
      return null;
    }
    return JSON.parse(raw) as unknown;
  }

  async write(data: UserData): Promise<void> {
    this.storage.setItem(this.keyName, JSON.stringify(data));
  }

  async writeFieldAsset(entryId: string, bytes: Uint8Array): Promise<void> {
    const db = await this.openAssetDb();
    await runAssetRequest(db, "readwrite", (store) =>
      store.put({
        entryId,
        bytes: new Uint8Array(bytes).buffer,
      } satisfies BrowserUserFieldAssetRecord),
    );
  }

  async readFieldAsset(entryId: string): Promise<Uint8Array | null> {
    const db = await this.openAssetDb();
    const record = await runAssetRequest<BrowserUserFieldAssetRecord | null>(
      db,
      "readonly",
      (store) => store.get(entryId),
    );
    return record ? new Uint8Array(record.bytes.slice(0)) : null;
  }

  async deleteFieldAsset(entryId: string): Promise<void> {
    const db = await this.openAssetDb();
    await runAssetRequest(db, "readwrite", (store) => store.delete(entryId));
  }

  private openAssetDb(): Promise<IDBDatabase> {
    if (!("indexedDB" in globalThis)) {
      throw new Error("User Field Background storage is unavailable");
    }
    this.assetDbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.assetDbName, 1);
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
      });
      request.addEventListener("success", () => resolve(request.result));
    });
    return this.assetDbPromise;
  }
}

export type UserDataInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export class TauriUserDataAdapter implements UserDataAdapter {
  constructor(private readonly commandInvoke: UserDataInvoke = invoke) {}

  read(): Promise<unknown | null> {
    return this.commandInvoke<unknown | null>("storage_read_user_data");
  }

  async write(data: UserData): Promise<void> {
    await this.commandInvoke("storage_write_user_data", { data });
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

interface BrowserUserFieldAssetRecord {
  entryId: string;
  bytes: ArrayBuffer;
}

function runAssetRequest<T = undefined>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  requestFor: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(userFieldAssetStoreName, mode);
    const request = requestFor(
      transaction.objectStore(userFieldAssetStoreName),
    );
    let result: T;
    request.addEventListener("success", () => {
      result = (request.result ?? null) as T;
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("User Field asset request failed"));
    });
    transaction.addEventListener("complete", () => resolve(result));
    transaction.addEventListener("abort", () => {
      reject(
        transaction.error ?? new Error("User Field asset transaction aborted"),
      );
    });
    transaction.addEventListener("error", () => {
      reject(
        transaction.error ?? new Error("User Field asset transaction failed"),
      );
    });
  });
}

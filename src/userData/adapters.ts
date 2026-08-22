import { invoke } from "@tauri-apps/api/core";
import type { UserData } from "./model";

export const BROWSER_USER_DATA_KEY = "bline-web:user-data";

export interface UserDataStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface UserDataAdapter {
  read(): Promise<unknown | null>;
  write(data: UserData): Promise<void>;
}

export interface BrowserUserDataAdapterOptions {
  storage?: UserDataStorage;
  key?: string;
}

export class BrowserUserDataAdapter implements UserDataAdapter {
  readonly storage: UserDataStorage;
  private readonly keyName: string;

  constructor(options: BrowserUserDataAdapterOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.keyName = options.key ?? BROWSER_USER_DATA_KEY;
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
}

import type { EnvironmentCapabilities } from "../env/capabilities";
import { BrowserStorage, type BrowserStorageOptions } from "./browser";
import { TauriStorage, type TauriStorageOptions } from "./tauri";
import type { StorageAdapter } from "./adapter";

export interface CreateStorageAdapterOptions {
  browser?: BrowserStorageOptions;
  tauri?: TauriStorageOptions;
}

export function createStorageAdapter(
  capabilities: EnvironmentCapabilities,
  options: CreateStorageAdapterOptions = {}
): StorageAdapter {
  if (capabilities.shell === "tauri") {
    return new TauriStorage(options.tauri);
  }

  return new BrowserStorage(options.browser);
}

export * from "./adapter";
export * from "./browser";
export * from "./tauri";

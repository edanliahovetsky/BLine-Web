import type { EnvironmentCapabilities } from "../../env/capabilities";
import {
  BrowserStorage,
  TauriStorage,
  type BrowserStorageOptions,
  type StorageAdapter,
  type TauriStorageOptions
} from "../../storage";
import {
  StorageProjectIoService,
  createBrowserProjectIoCapabilities,
  createDesktopProjectIoCapabilities
} from "./service";
import type { ProjectIoService } from "./types";

export interface CreateProjectIoServiceOptions {
  storage?: StorageAdapter;
  browser?: BrowserStorageOptions;
  tauri?: TauriStorageOptions;
}

export function createProjectIoService(
  environment: EnvironmentCapabilities,
  options: CreateProjectIoServiceOptions = {}
): ProjectIoService {
  if (options.storage) {
    return new StorageProjectIoService(
      options.storage,
      environment.canWriteRealFiles
        ? createDesktopProjectIoCapabilities()
        : createBrowserProjectIoCapabilities()
    );
  }

  if (environment.canWriteRealFiles) {
    return new StorageProjectIoService(
      new TauriStorage(options.tauri),
      createDesktopProjectIoCapabilities()
    );
  }

  return new StorageProjectIoService(
    new BrowserStorage(options.browser),
    createBrowserProjectIoCapabilities()
  );
}

export * from "./types";

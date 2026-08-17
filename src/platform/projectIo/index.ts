import type { EnvironmentCapabilities } from "../../env/capabilities";
import {
  BrowserStorage,
  TauriStorage,
  type BrowserStorageOptions,
  type StorageAdapter,
  type TauriStorageOptions,
} from "../../storage";
import {
  StorageProjectIoService,
  createBrowserProjectIoCapabilities,
  createDesktopProjectIoCapabilities,
} from "./service";
import type { ProjectIoService } from "./types";

export interface CreateProjectIoServiceOptions {
  storage?: StorageAdapter;
  browser?: BrowserStorageOptions;
  tauri?: TauriStorageOptions;
}

export function createProjectIoService(
  environment: EnvironmentCapabilities,
  options: CreateProjectIoServiceOptions = {},
): ProjectIoService {
  const desktop = environment.shell === "tauri";
  if (options.storage) {
    return new StorageProjectIoService(
      options.storage,
      desktop
        ? createDesktopProjectIoCapabilities()
        : createBrowserProjectIoCapabilities(),
    );
  }

  if (desktop) {
    return new StorageProjectIoService(
      new TauriStorage(options.tauri),
      createDesktopProjectIoCapabilities(),
    );
  }

  return new StorageProjectIoService(
    new BrowserStorage(options.browser),
    createBrowserProjectIoCapabilities(),
  );
}

export * from "./types";

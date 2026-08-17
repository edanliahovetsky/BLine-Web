import { isTauri } from "@tauri-apps/api/core";

export type ShellKind = "browser-web" | "tauri";

export interface EnvironmentCapabilities {
  shell: ShellKind;
}

export const browserWebCapabilities: EnvironmentCapabilities = {
  shell: "browser-web",
};

export const tauriCapabilities: EnvironmentCapabilities = {
  shell: "tauri",
};

export function detectEnvironmentCapabilities(): EnvironmentCapabilities {
  return isTauri() ? tauriCapabilities : browserWebCapabilities;
}

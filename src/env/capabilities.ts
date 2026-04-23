export type ShellKind = "browser-web" | "tauri" | "systemcore-browser";

export interface EnvironmentCapabilities {
  shell: ShellKind;
  canUseNativeDialogs: boolean;
  canWriteRealFiles: boolean;
  canUseSharedProjectStore: boolean;
  canUseUrlSharing: boolean;
  canAttemptRobotNTConnection: boolean;
}

export const browserWebCapabilities: EnvironmentCapabilities = {
  shell: "browser-web",
  canUseNativeDialogs: false,
  canWriteRealFiles: false,
  canUseSharedProjectStore: false,
  canUseUrlSharing: false,
  canAttemptRobotNTConnection: false
};

export const tauriCapabilities: EnvironmentCapabilities = {
  shell: "tauri",
  canUseNativeDialogs: true,
  canWriteRealFiles: true,
  canUseSharedProjectStore: false,
  canUseUrlSharing: false,
  canAttemptRobotNTConnection: false
};

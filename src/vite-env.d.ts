/// <reference types="vite/client" />

declare const __BLINE_BUILD__: {
  version: string;
  releaseName: string;
  appName: string;
  channel: "stable" | "beta";
};

interface ImportMetaEnv {
  readonly VITE_ENABLE_BUG_REPORT?: string;
  readonly VITE_RELEASE_CHANNEL?: "stable" | "beta";
  readonly VITE_HANDOFF_TARGET_ORIGIN?: string;
  readonly VITE_HANDOFF_SOURCE_HOSTS?: string;
}

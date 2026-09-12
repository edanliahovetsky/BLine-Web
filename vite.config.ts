import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import {
  offlineDevelopmentRecovery,
  offlineAssetRetention,
  prepareOfflineRelease,
  verifyManifest,
} from "./scripts/offline-build";

const tauriDevHost = process.env.TAURI_DEV_HOST;
let offlineDirectory = path.resolve("dist");

export default defineConfig({
  plugins: [
    react(),
    offlineDevelopmentRecovery(),
    offlineAssetRetention(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "worker",
      filename: "sw.ts",
      // Registration is owned by the browser shell; Tauri and development
      // builds must never install a service worker.
      injectRegister: false,
      includeManifestIcons: false,
      manifest: {
        name: "BLine Web",
        short_name: "BLine",
        description: "Create, tune, and simulate autonomous robot paths.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#1f2a35",
        background_color: "#1f2a35",
        icons: [
          { src: "icons/bline-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/bline-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      integration: {
        async beforeBuildServiceWorker(options) {
          offlineDirectory = path.resolve(options.outDir);
          await prepareOfflineRelease(offlineDirectory);
          // VitePWA adds an unverified manifest entry after Workbox transforms.
          // Our glob already includes it, with the same integrity checks as every file.
          options.injectManifest.additionalManifestEntries = [];
        },
      },
      injectManifest: {
        rollupFormat: "iife",
        globPatterns: [
          "**/*.{html,js,css,png,svg,ico,woff,woff2,json,wasm,webmanifest}",
        ],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        manifestTransforms: [
          (entries) => verifyManifest(entries, offlineDirectory),
        ],
      },
    }),
  ],
  clearScreen: false,
  server: {
    host: tauriDevHost ?? "127.0.0.1",
    port: 1420,
    strictPort: true,
    hmr: tauriDevHost
      ? {
          protocol: "ws",
          host: tauriDevHost,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
});

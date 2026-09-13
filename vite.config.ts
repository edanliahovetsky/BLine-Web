import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { readFileSync } from "node:fs";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import {
  offlineDevelopmentRecovery,
  prepareOfflineRelease,
  verifyManifest,
} from "./scripts/offline-build";
import { releaseMetadata } from "./scripts/release-config";

const tauriDevHost = process.env.TAURI_DEV_HOST;
let offlineDirectory = path.resolve("dist");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const version = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ).version as string;
  const build = releaseMetadata(version, env.VITE_RELEASE_CHANNEL ?? "stable");
  return {
    define: { __BLINE_BUILD__: JSON.stringify(build) },
    plugins: [
      react(),
      {
        name: "bline-release-branding",
        transformIndexHtml: (html) =>
          html.replace(
            "<title>BLine Web</title>",
            `<title>${build.appName}</title>`,
          ),
      },
      offlineDevelopmentRecovery(),
      VitePWA({
        strategies: "injectManifest",
        srcDir: "worker",
        filename: "sw.ts",
        // Registration is owned by the browser shell; Tauri and development
        // builds must never install a service worker.
        injectRegister: false,
        includeManifestIcons: false,
        manifest: {
          name: build.appName,
          short_name: build.channel === "beta" ? "BLine Beta" : "BLine",
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
  };
});

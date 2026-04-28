import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const tauriDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: tauriDevHost ?? "127.0.0.1",
    port: 1420,
    strictPort: true,
    hmr: tauriDevHost
      ? {
          protocol: "ws",
          host: tauriDevHost,
          port: 1421
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"]
    }
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "parity-harness/parity.test.ts"
    ]
  }
});

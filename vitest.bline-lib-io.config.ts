import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["parity-harness/bline-lib-io.test.ts"],
    testTimeout: 360_000,
  },
});

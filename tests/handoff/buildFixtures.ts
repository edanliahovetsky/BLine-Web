import path from "node:path";
import { build } from "vite";

export const handoffFixtureRoot = path.resolve(
  "node_modules/.tmp/handoff-fixtures",
);

export function handoffOrigins(): { source: string; target: string } {
  const port = process.env.HANDOFF_TEST_PORT;
  if (!port) throw new Error("HANDOFF_TEST_PORT is set by the handoff config");
  return {
    source: `http://127.0.0.1:${port}`,
    target: `http://localhost:${port}`,
  };
}

/** Builds today's release (no handoff) and the release that moves Projects. */
export default async function buildFixtures(): Promise<void> {
  const { source, target } = handoffOrigins();
  for (const [name, sourceHosts] of [
    ["previous", "retired.invalid"],
    ["current", new URL(source).host],
  ] as const) {
    process.env.VITE_HANDOFF_TARGET_ORIGIN = target;
    process.env.VITE_HANDOFF_SOURCE_HOSTS = sourceHosts;
    await build({
      build: {
        outDir: path.join(handoffFixtureRoot, name),
        emptyOutDir: true,
      },
      logLevel: "warn",
    });
  }
  delete process.env.VITE_HANDOFF_TARGET_ORIGIN;
  delete process.env.VITE_HANDOFF_SOURCE_HOSTS;
}

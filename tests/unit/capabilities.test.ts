import { describe, expect, it } from "vitest";
import {
  browserWebCapabilities,
  tauriCapabilities,
} from "../../src/env/capabilities";

describe("Phase 1 shell capabilities", () => {
  it("keeps browser-hosted web local and backend-free", () => {
    expect(browserWebCapabilities).toEqual({ shell: "browser-web" });
  });

  it("keeps Tauri as the real-file-capable desktop shell", () => {
    expect(tauriCapabilities).toEqual({ shell: "tauri" });
  });
});

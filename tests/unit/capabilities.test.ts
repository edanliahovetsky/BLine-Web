import { describe, expect, it } from "vitest";
import {
  browserWebCapabilities,
  tauriCapabilities
} from "../../src/env/capabilities";

describe("Phase 1 shell capabilities", () => {
  it("keeps browser-hosted web local and backend-free", () => {
    expect(browserWebCapabilities).toMatchObject({
      shell: "browser-web",
      canUseNativeDialogs: false,
      canWriteRealFiles: false,
      canUseSharedProjectStore: false
    });
  });

  it("keeps Tauri as the real-file-capable desktop shell", () => {
    expect(tauriCapabilities).toMatchObject({
      shell: "tauri",
      canUseNativeDialogs: true,
      canWriteRealFiles: true,
      canUseSharedProjectStore: false
    });
  });
});

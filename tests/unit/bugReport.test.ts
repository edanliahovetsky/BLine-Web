import { describe, expect, it, vi } from "vitest";
import {
  createBugReportUrl,
  openDesktopBugReport,
} from "../../src/platform/bugReport";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("bug reporting", () => {
  it.each(["tauri", "browser-web"] as const)(
    "prefills version and %s context without losing URL punctuation",
    (shell) => {
      const url = new URL(
        createBugReportUrl({
          releaseName: "BLine Web 2027 Beta 1",
          version: "1.0.0-beta.1",
          shell,
          userAgent: "Example Browser/1.0 (OS; x64) & Special+Value#test",
        }),
      );
      expect(url.origin + url.pathname).toBe(
        "https://github.com/edanliahovetsky/BLine-Web/issues/new",
      );
      expect(url.searchParams.get("title")).toBe("[1.0.0-beta.1] ");
      const body = url.searchParams.get("body");
      expect(body).toContain("Release: BLine Web 2027 Beta 1");
      expect(body).toContain("Version: 1.0.0-beta.1");
      expect(body).toContain(
        `App: ${shell === "tauri" ? "Desktop" : "Browser"}`,
      );
      expect(body).toContain(
        "Example Browser/1.0 (OS; x64) & Special+Value#test",
      );
      expect(body).toContain("### Steps to reproduce\n\n1. ");
      expect(url.hash).toBe("");
    },
  );

  it("opens desktop reports in the system browser and propagates failures", async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    const url = createBugReportUrl({
      releaseName: "Beta",
      version: "1.0.0-beta.1",
      shell: "tauri",
      userAgent: "System",
    });
    await openDesktopBugReport(url);
    expect(openUrl).toHaveBeenCalledWith(url);
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("No browser"));
    await expect(openDesktopBugReport(url)).rejects.toThrow("No browser");
  });
});

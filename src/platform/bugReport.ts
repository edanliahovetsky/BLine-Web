import type { ShellKind } from "../env/capabilities";

export function createBugReportUrl({
  releaseName,
  version,
  shell,
  userAgent,
}: {
  releaseName: string;
  version: string;
  shell: ShellKind;
  userAgent: string;
}): string {
  const url = new URL(
    "https://github.com/edanliahovetsky/BLine-Web/issues/new",
  );
  url.searchParams.set("title", `[${version}] `);
  url.searchParams.set(
    "body",
    `### What happened?\n\nDescribe the problem and what you expected.\n\n### Steps to reproduce\n\n1. \n2. \n3. \n\n### Screenshots or files (optional)\n\nAttach anything that helps explain the problem.\n\n### App details\n\n- Release: ${releaseName}\n- Version: ${version}\n- App: ${shell === "tauri" ? "Desktop" : "Browser"}\n- Browser / system: ${userAgent}\n`,
  );
  return url.toString();
}

export async function openDesktopBugReport(url: string): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

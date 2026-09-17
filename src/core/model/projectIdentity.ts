/** Stable IDs for durable Project entities. */
export function createWorkspaceId(): string {
  return `workspace-${randomId()}`;
}

export function createPathId(): string {
  return `path-${randomId()}`;
}

export function createPathGroupId(): string {
  return `group-${randomId()}`;
}

/**
 * Normalize an explicit Path filename without changing an already-safe spelling.
 * Imports use this so existing Git-visible filenames do not churn unnecessarily.
 */
export function normalizePathFileName(value: string): string {
  const cleaned = safeExplicitFileStem(value.replace(/\.json$/i, ""));
  return `${cleaned || "untitled-path"}.json`;
}

/** One naming policy for Paths created, renamed, or duplicated in the editor. */
export function pathFileNameFromDisplayName(value: string): string {
  const stem = value.trim().replace(/\.json$/i, "") || "Untitled Path";
  if (
    /[<>:"/\\|?*]/.test(stem) ||
    [...stem].some((char) => char.charCodeAt(0) < 32) ||
    /[. ]$/.test(stem) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)
  ) {
    throw new Error(
      'Use a filename without < > : " / \\ | ? *, trailing dots, or reserved device names.',
    );
  }
  return `${stem}.json`;
}

export function pathDisplayNameFromFileName(fileName: string): string {
  return fileName.replace(/\.json$/i, "");
}

function safeExplicitFileStem(value: string): string {
  let stem =
    value.trim().replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "";
  stem = [...stem]
    .map((char) =>
      char.charCodeAt(0) < 32 || /[<>:"|?*]/.test(char) ? "_" : char,
    )
    .join("")
    .replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))
    stem = `_${stem}`;
  return stem;
}

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

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
  const stem = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem || "untitled-path"}.json`;
}

export function pathDisplayNameFromFileName(fileName: string): string {
  return fileName.replace(/\.json$/i, "").replace(/[-_]+/g, " ");
}

function safeExplicitFileStem(value: string): string {
  return (
    value
      .trim()
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/[^a-zA-Z0-9_.-]+/g, "_")
      .replace(/^_+|_+$/g, "") ?? ""
  );
}

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

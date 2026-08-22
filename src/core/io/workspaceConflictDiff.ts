import type { Project, ProjectPath } from "../model/project";

/**
 * A human-readable summary of how the on-disk project differs from the user's
 * in-memory (unsaved) workspace, shown when a save conflict is surfaced so the user
 * can make an informed choice between reloading and overwriting.
 */
export interface WorkspaceConflictDiff {
  /** Paths present in memory but not on disk (the user added them). */
  addedPaths: string[];
  /** Paths present on disk but not in memory (removed locally or added on disk). */
  removedPaths: string[];
  /** Paths present on both sides whose contents differ. */
  changedPaths: string[];
  /** The project configuration differs. */
  configChanged: boolean;
  /** Linked-target definitions differ. */
  linkedTargetsChanged: boolean;
  /** Whether there is any difference at all. */
  hasChanges: boolean;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortKeysDeep(
          (value as Record<string, unknown>)[key],
        );
        return accumulator;
      }, {});
  }
  return value;
}

function pathKey(path: ProjectPath): string {
  return path.file_name || path.path_id;
}

function pathLabel(path: ProjectPath): string {
  return path.display_name || path.file_name || path.path_id;
}

/**
 * Compare the user's in-memory workspace (`mine`) against the on-disk workspace
 * (`theirs`) and describe the differences at path/config granularity.
 */
export function diffWorkspaceConflict(
  mine: Project,
  theirs: Project | null,
): WorkspaceConflictDiff {
  const empty: WorkspaceConflictDiff = {
    addedPaths: [],
    removedPaths: [],
    changedPaths: [],
    configChanged: false,
    linkedTargetsChanged: false,
    hasChanges: false,
  };

  if (!theirs) {
    return empty;
  }

  const mineByKey = new Map(mine.paths.map((path) => [pathKey(path), path]));
  const theirsByKey = new Map(
    theirs.paths.map((path) => [pathKey(path), path]),
  );

  const addedPaths: string[] = [];
  const changedPaths: string[] = [];
  for (const [key, minePath] of mineByKey) {
    const theirsPath = theirsByKey.get(key);
    if (!theirsPath) {
      addedPaths.push(pathLabel(minePath));
    } else if (
      stableStringify(minePath.path) !== stableStringify(theirsPath.path)
    ) {
      changedPaths.push(pathLabel(minePath));
    }
  }

  const removedPaths: string[] = [];
  for (const [key, theirsPath] of theirsByKey) {
    if (!mineByKey.has(key)) {
      removedPaths.push(pathLabel(theirsPath));
    }
  }

  const configChanged =
    stableStringify(mine.config) !== stableStringify(theirs.config);
  const linkedTargetsChanged =
    stableStringify(mine.linked_targets) !==
    stableStringify(theirs.linked_targets);

  addedPaths.sort();
  removedPaths.sort();
  changedPaths.sort();

  const hasChanges =
    addedPaths.length > 0 ||
    removedPaths.length > 0 ||
    changedPaths.length > 0 ||
    configChanged ||
    linkedTargetsChanged;

  return {
    addedPaths,
    removedPaths,
    changedPaths,
    configChanged,
    linkedTargetsChanged,
    hasChanges,
  };
}

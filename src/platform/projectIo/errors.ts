/** A rejected file has not changed the current project or its saved data. */
export class ProjectImportValidationError extends Error {
  override name = "ProjectImportValidationError";
}

export function isRejectedProjectImport(error: unknown): boolean {
  return (
    error instanceof Error &&
    ["ProjectImportValidationError", "ProjectAlreadyExistsError"].includes(
      error.name,
    )
  );
}

/** Project IO adapters normalize backend-specific compare-and-swap failures. */
export function isProjectIoConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "StorageConflictError"
  );
}

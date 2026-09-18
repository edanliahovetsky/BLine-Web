/** A rejected file has not changed the current project or its saved data. */
export class ProjectImportValidationError extends Error {
  override name = "ProjectImportValidationError";
}

export class ProjectImportCancelledError extends Error {
  override name = "ProjectImportCancelledError";

  constructor() {
    super("Project import cancelled.");
  }
}

export function isRejectedProjectImport(error: unknown): boolean {
  return (
    error instanceof Error &&
    [
      "ProjectImportValidationError",
      "ProjectAlreadyExistsError",
      "ProjectImportCancelledError",
    ].includes(error.name)
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

export { missingProjectDirectoryPath } from "../../storage/adapter";

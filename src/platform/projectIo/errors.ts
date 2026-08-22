/** Project IO adapters normalize backend-specific compare-and-swap failures. */
export function isProjectIoConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "StorageConflictError"
  );
}

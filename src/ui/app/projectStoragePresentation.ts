import type { Project } from "../../core/model/project";
import type {
  ProjectIoCapabilities,
  ProjectWorkspaceSummary,
} from "../../platform/projectIo";

export function ensureCurrentWorkspaceSummary(
  summaries: ProjectWorkspaceSummary[],
  project: Project | null,
  currentSummary: ProjectWorkspaceSummary | null,
  version: string | undefined,
  lastSavedAt: string | null,
): ProjectWorkspaceSummary[] {
  const currentId = currentSummary?.id ?? project?.project_id;
  if (
    !project ||
    !currentId ||
    summaries.some((summary) => summary.id === currentId)
  ) {
    return summaries;
  }

  return [
    {
      ...currentSummary,
      id: currentId,
      displayName: currentSummary?.displayName ?? project.display_name,
      updatedAt:
        currentSummary?.updatedAt ?? lastSavedAt ?? new Date().toISOString(),
      version: currentSummary?.version ?? version ?? "",
    },
    ...summaries,
  ];
}

export function formatStorageLabel(
  currentSummary: ProjectWorkspaceSummary | null,
  capabilities: ProjectIoCapabilities | undefined,
): string {
  if (!capabilities) {
    return "Storage: unavailable";
  }

  if (capabilities.directFileAutosave) {
    return `Autosave: ${currentSummary?.directoryPath ?? currentSummary?.id ?? "No folder"}`;
  }

  return `Autosave: ${capabilities.autosaveTargetLabel}`;
}

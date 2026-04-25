import type { ProjectConfig, ProjectDocument } from "../../core/io/projectSchema";
import type { HistoryCommand } from "../../state/historyStore";

export function createUpdateProjectConfigCommand(
  previousConfig: ProjectConfig,
  nextConfig: ProjectConfig
): HistoryCommand<ProjectDocument> {
  return {
    description: "Update project config",
    apply: (project) => ({
      ...project,
      config: structuredClone(nextConfig)
    }),
    revert: (project) => ({
      ...project,
      config: structuredClone(previousConfig)
    })
  };
}

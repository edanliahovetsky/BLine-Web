import type { ProjectConfig } from "../../core/io/projectSchema";
import type { HistoryCommand } from "../../state/historyStore";

export function createUpdateProjectConfigCommand(
  previousConfig: ProjectConfig,
  nextConfig: ProjectConfig,
): HistoryCommand<ProjectConfig> {
  return {
    description: "Update project config",
    apply: () => structuredClone(nextConfig),
    revert: () => structuredClone(previousConfig),
  };
}

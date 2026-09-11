import { projectConfigDefaultLookup } from "../../core/config/projectConfig";
import { stringifyBLineJson } from "../../core/io/blineJson";
import { deserializePath, serializePath } from "../../core/io/projectSerde";
import type { PathModel } from "../../core/model/path";
import type { ProjectConfig } from "../../core/model/project";

/** Use the normal robot-path format while keeping lesson imports in memory. */
export function exportPracticePath(path: PathModel) {
  return new Blob([stringifyBLineJson(serializePath(path))], {
    type: "application/json",
  });
}
export function parsePracticePath(text: string, config: ProjectConfig) {
  return deserializePath(
    JSON.parse(text) as unknown,
    projectConfigDefaultLookup(config),
  );
}

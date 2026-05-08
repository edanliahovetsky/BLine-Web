import { projectConfigDefaultLookup } from "../config/projectConfig";
import type {
  ProjectPathDocument,
  ProjectWorkspaceDocument,
} from "./projectSchema";
import {
  createProjectPathDocument,
  createProjectWorkspaceDocument,
} from "./projectSchema";
import {
  deserializeProjectConfig,
  serializeProjectConfig,
} from "./blineProject";
import { stringifyBLineJson } from "./blineJson";
import { deserializePath, serializePath } from "./projectSerde";
import {
  createWorkspaceId,
  displayNameFromFileName,
  ensureJsonFileName,
} from "./workspaceSerde";

export interface ProjectFolderExportFile {
  relativePath: string;
  blob: Blob;
}

export interface ProjectFolderExport {
  folderName: string;
  files: ProjectFolderExportFile[];
}

export interface ProjectFolderImportFile {
  name: string;
  webkitRelativePath?: string;
  text(): Promise<string>;
}

interface ImportRecord {
  file: ProjectFolderImportFile;
  rawPath: string;
  strippedPath: string;
  autosPath: string;
}

export function serializeBLineProjectFolder(
  workspace: ProjectWorkspaceDocument,
): ProjectFolderExport {
  return {
    folderName: "autos",
    files: [
      jsonFile("config.json", serializeProjectConfig(workspace.config)),
      ...workspace.paths.map((path) =>
        jsonFile(
          `paths/${ensureJsonFileName(path.file_name)}`,
          serializePath(path.path),
        ),
      ),
    ],
  };
}

export async function deserializeBLineProjectFolder(
  files: readonly ProjectFolderImportFile[],
): Promise<ProjectWorkspaceDocument> {
  const records = createImportRecords(files).filter((record) =>
    record.rawPath.toLowerCase().endsWith(".json"),
  );

  if (records.length === 0) {
    throw new Error("The selected folder does not contain any JSON files");
  }

  const configRecord = records.find(
    (record) => record.autosPath.toLowerCase() === "config.json",
  );
  const config = deserializeProjectConfig(
    configRecord ? JSON.parse(await configRecord.file.text()) : undefined,
  );
  const defaultLookup = projectConfigDefaultLookup(config);
  const pathRecords = records
    .filter((record) => /^paths\/[^/]+\.json$/i.test(record.autosPath))
    .sort((a, b) => a.autosPath.localeCompare(b.autosPath));

  if (pathRecords.length === 0) {
    throw new Error("The selected folder must contain paths/*.json files");
  }

  const paths: ProjectPathDocument[] = await Promise.all(
    pathRecords.map(async (record) => {
      const parsed = JSON.parse(await record.file.text()) as unknown;
      const fileName = ensureJsonFileName(
        record.autosPath.split("/").at(-1) ?? record.file.name,
      );
      const pathObject =
        isObject(parsed) && "path" in parsed ? parsed.path : parsed;

      return createProjectPathDocument({
        path_id: fileName,
        display_name: displayNameFromFileName(fileName),
        file_name: fileName,
        path: deserializePath(pathObject, defaultLookup),
      });
    }),
  );

  return createProjectWorkspaceDocument({
    project_id: createWorkspaceId(),
    display_name: inferDisplayName(records),
    config,
    paths,
    active_path_id: paths[0]?.path_id ?? null,
  });
}

function jsonFile(
  relativePath: string,
  value: unknown,
): ProjectFolderExportFile {
  return {
    relativePath,
    blob: new Blob([stringifyBLineJson(value)], {
      type: "application/json",
    }),
  };
}

function createImportRecords(
  files: readonly ProjectFolderImportFile[],
): ImportRecord[] {
  const rawPaths = files.map((file) => normalizeImportPath(file));
  const strippedPaths = stripCommonRoot(rawPaths);
  const selectedRoot = commonRootSegment(rawPaths);
  const selectedPathsFolder = selectedRoot?.toLowerCase() === "paths";

  return files.map((file, index) => {
    const rawPath = rawPaths[index] ?? file.name;
    const strippedPath = strippedPaths[index] ?? rawPath;

    return {
      file,
      rawPath,
      strippedPath,
      autosPath: normalizeAutosPath(strippedPath, selectedPathsFolder),
    };
  });
}

function normalizeImportPath(file: ProjectFolderImportFile): string {
  return (file.webkitRelativePath || file.name)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
}

function stripCommonRoot(paths: readonly string[]): string[] {
  const commonRoot = commonRootSegment(paths);

  if (
    !commonRoot ||
    paths.some(
      (path) => !path.includes("/") || path.split("/")[0] !== commonRoot,
    )
  ) {
    return [...paths];
  }

  return paths.map((path) => path.split("/").slice(1).join("/") || path);
}

function commonRootSegment(paths: readonly string[]): string | null {
  const firstSegments = paths.map((path) => path.split("/")[0]).filter(Boolean);
  return firstSegments[0] ?? null;
}

function normalizeAutosPath(
  path: string,
  selectedPathsFolder: boolean,
): string {
  if (selectedPathsFolder) {
    return `paths/${path}`;
  }

  const parts = path.split("/").filter(Boolean);
  let autosIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.toLowerCase() === "autos") {
      autosIndex = index;
      break;
    }
  }

  return autosIndex >= 0
    ? parts.slice(autosIndex + 1).join("/")
    : parts.join("/");
}

function inferDisplayName(records: readonly ImportRecord[]): string {
  const firstPath = records[0]?.rawPath;
  const root = firstPath?.split("/").find(Boolean);

  return root ? displayNameFromFileName(root) : "Imported Autos";
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

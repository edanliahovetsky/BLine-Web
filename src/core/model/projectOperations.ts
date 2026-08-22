import { createPathModel, type PathModel } from "./path";
import { syncLinkedTargetElementsInProject } from "../linkedTargets";
import {
  createPathGroupId,
  createPathId,
  normalizePathFileName,
  pathDisplayNameFromFileName,
  pathFileNameFromDisplayName,
} from "./projectIdentity";
import {
  cloneProject,
  type Project,
  type ProjectPath,
  type ProjectPathGroup,
} from "./project";

export interface AddProjectPathInput {
  display_name: string;
  file_name?: string;
  path?: PathModel;
  path_id?: string;
  addToGroupId?: string | null;
}

/** Durable Project operations. Editor navigation is intentionally handled by the session store. */
export function addPathToProject(
  project: Project,
  input: AddProjectPathInput,
): { project: Project; createdPathId: string } {
  const path: ProjectPath = {
    path_id: input.path_id ?? createPathId(),
    display_name: input.display_name,
    file_name: uniquePathFileName(
      project.paths,
      input.file_name
        ? normalizePathFileName(input.file_name)
        : pathFileNameFromDisplayName(input.display_name),
    ),
    path: structuredClone(input.path ?? createPathModel()),
  };
  path.display_name ||= pathDisplayNameFromFileName(path.file_name);
  const pathGroups = project.path_groups.map((group) =>
    input.addToGroupId && group.group_id === input.addToGroupId
      ? { ...group, path_ids: uniqueStrings([...group.path_ids, path.path_id]) }
      : structuredClone(group),
  );

  return {
    project: syncLinkedTargetElementsInProject({
      ...cloneProject(project),
      paths: [...structuredClone(project.paths), path],
      path_groups: pathGroups,
    }),
    createdPathId: path.path_id,
  };
}

export function renamePathInProject(
  project: Project,
  pathId: string,
  name: string,
): Project {
  const nextFileName = uniquePathFileName(
    project.paths.filter((path) => path.path_id !== pathId),
    pathFileNameFromDisplayName(name),
  );
  return {
    ...cloneProject(project),
    paths: project.paths.map((path) =>
      path.path_id === pathId
        ? {
            ...structuredClone(path),
            display_name: name || pathDisplayNameFromFileName(nextFileName),
            file_name: nextFileName,
          }
        : structuredClone(path),
    ),
  };
}

export function duplicatePathInProject(
  project: Project,
  pathId: string,
  name: string,
  addToGroupId?: string | null,
): { project: Project; createdPathId: string | null } {
  const source = project.paths.find((path) => path.path_id === pathId);
  if (!source) {
    return { project, createdPathId: null };
  }
  const added = addPathToProject(project, {
    display_name: name,
    path: source.path,
    addToGroupId,
  });
  return added;
}

export function deletePathsFromProject(
  project: Project,
  pathIds: readonly string[],
): Project {
  const deleted = new Set(pathIds);
  const paths = project.paths.filter((path) => !deleted.has(path.path_id));
  const nextPaths =
    paths.length > 0 ? structuredClone(paths) : [createBlankPath()];
  return {
    ...cloneProject(project),
    paths: nextPaths,
    path_groups: project.path_groups.map((group) => ({
      ...structuredClone(group),
      path_ids: group.path_ids.filter((pathId) => !deleted.has(pathId)),
    })),
  };
}

export function createPathGroupInProject(
  project: Project,
  input: {
    display_name: string;
    path_ids?: readonly string[];
    group_id?: string;
  },
): { project: Project; createdGroupId: string } {
  const pathIds = new Set(project.paths.map((path) => path.path_id));
  const group: ProjectPathGroup = {
    group_id: input.group_id ?? createPathGroupId(),
    display_name:
      input.display_name.trim() ||
      `Path Group ${project.path_groups.length + 1}`,
    path_ids: uniqueStrings(input.path_ids ?? []).filter((id) =>
      pathIds.has(id),
    ),
  };
  return {
    project: {
      ...cloneProject(project),
      path_groups: [...structuredClone(project.path_groups), group],
    },
    createdGroupId: group.group_id,
  };
}

export function renamePathGroupInProject(
  project: Project,
  groupId: string,
  name: string,
): Project {
  return {
    ...cloneProject(project),
    path_groups: project.path_groups.map((group, index) =>
      group.group_id === groupId
        ? {
            ...structuredClone(group),
            display_name: name.trim() || `Path Group ${index + 1}`,
          }
        : structuredClone(group),
    ),
  };
}

export function deletePathGroupFromProject(
  project: Project,
  groupId: string,
  options: { deleteMemberPaths?: boolean } = {},
): Project {
  const group = project.path_groups.find(
    (candidate) => candidate.group_id === groupId,
  );
  if (!group) {
    return cloneProject(project);
  }
  const withoutGroup: Project = {
    ...cloneProject(project),
    path_groups: project.path_groups
      .filter((candidate) => candidate.group_id !== groupId)
      .map((candidate) => structuredClone(candidate)),
  };
  return options.deleteMemberPaths
    ? deletePathsFromProject(withoutGroup, group.path_ids)
    : withoutGroup;
}

export function addPathsToGroupInProject(
  project: Project,
  groupId: string,
  pathIds: readonly string[],
): Project {
  const existingPathIds = new Set(project.paths.map((path) => path.path_id));
  const additions = pathIds.filter((pathId) => existingPathIds.has(pathId));
  return {
    ...cloneProject(project),
    path_groups: project.path_groups.map((group) =>
      group.group_id === groupId
        ? {
            ...structuredClone(group),
            path_ids: uniqueStrings([...group.path_ids, ...additions]),
          }
        : structuredClone(group),
    ),
  };
}

export function removePathsFromGroupInProject(
  project: Project,
  groupId: string,
  pathIds: readonly string[],
): Project {
  const removed = new Set(pathIds);
  return {
    ...cloneProject(project),
    path_groups: project.path_groups.map((group) =>
      group.group_id === groupId
        ? {
            ...structuredClone(group),
            path_ids: group.path_ids.filter((pathId) => !removed.has(pathId)),
          }
        : structuredClone(group),
    ),
  };
}

function createBlankPath(): ProjectPath {
  return {
    path_id: createPathId(),
    display_name: "new path",
    file_name: pathFileNameFromDisplayName("new path"),
    path: createPathModel(),
  };
}

function uniquePathFileName(
  paths: readonly ProjectPath[],
  requestedFileName: string,
): string {
  const existing = new Set(paths.map((path) => path.file_name.toLowerCase()));
  if (!existing.has(requestedFileName.toLowerCase())) {
    return requestedFileName;
  }
  const stem = requestedFileName.replace(/\.json$/i, "");
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${stem}-${index}.json`;
    if (!existing.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${stem}-${randomId()}.json`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
}

import { cloneProject, type Project } from "../model/project";
import type { ProjectWorkspaceDocument } from "./projectSchema";

export interface EditorNavigation {
  activePathId: string | null;
  activePathGroupId: string | null;
}

export interface OpenProject {
  project: Project;
  navigation: EditorNavigation;
}

export function openProjectFromLegacyWorkspace(
  workspace: ProjectWorkspaceDocument,
): OpenProject {
  const { active_path_id, active_path_group_id, ...project } = workspace;
  return {
    project: cloneProject(project),
    navigation: normalizeEditorNavigation(project, {
      activePathId: active_path_id,
      activePathGroupId: active_path_group_id,
    }),
  };
}

export function legacyWorkspaceFromOpenProject(
  project: Project,
  navigation: EditorNavigation,
): ProjectWorkspaceDocument {
  const normalized = normalizeEditorNavigation(project, navigation);
  return {
    ...cloneProject(project),
    active_path_id: normalized.activePathId,
    active_path_group_id: normalized.activePathGroupId,
  };
}

export function normalizeEditorNavigation(
  project: Project,
  navigation: Partial<EditorNavigation> = {},
): EditorNavigation {
  const activePathId = project.paths.some(
    (path) => path.path_id === navigation.activePathId,
  )
    ? (navigation.activePathId ?? null)
    : (project.paths[0]?.path_id ?? null);
  const activePathGroupId = project.path_groups.some(
    (group) => group.group_id === navigation.activePathGroupId,
  )
    ? (navigation.activePathGroupId ?? null)
    : null;

  return { activePathId, activePathGroupId };
}

export function activeProjectPath(
  project: Project | null,
  activePathId: string | null,
) {
  if (!project) {
    return null;
  }
  return (
    project.paths.find((path) => path.path_id === activePathId) ??
    project.paths[0] ??
    null
  );
}

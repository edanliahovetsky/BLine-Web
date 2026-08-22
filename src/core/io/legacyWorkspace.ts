import { cloneProject, type Project } from "../model/project";
import {
  normalizeEditorNavigation,
  type EditorNavigation,
} from "../model/editorNavigation";
import type { ProjectWorkspaceDocument } from "./projectSchema";

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

/** Compatibility shell for legacy archives. Navigation is never repository data. */
export function legacyWorkspaceForArchive(
  project: Project,
): ProjectWorkspaceDocument {
  return {
    ...cloneProject(project),
    active_path_id: null,
    active_path_group_id: null,
  };
}

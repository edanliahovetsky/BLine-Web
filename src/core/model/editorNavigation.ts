import type { Project } from "./project";

export interface EditorNavigation {
  activePathId: string | null;
  activePathGroupId: string | null;
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

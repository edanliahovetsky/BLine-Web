import { isEventTrigger } from "./path";
import { cloneProject, type Project } from "./project";

export interface EventKeyEdit {
  from: string;
  /** An empty replacement clears the key without removing its elements. */
  to: string;
}

export function projectEventKeys(project: Project): string[] {
  return [
    ...new Set(
      [
        ...(project.config.gui.event_trigger_keys ?? []),
        ...project.config.gui.protrusions.show_on_event_keys,
        ...project.config.gui.protrusions.hide_on_event_keys,
        ...project.paths.flatMap(({ path }) =>
          path.path_elements.flatMap((element) =>
            isEventTrigger(element) && element.lib_key ? [element.lib_key] : [],
          ),
        ),
      ].filter((key) => key.trim().length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export function applyEventKeyEdits(
  project: Project,
  edits: readonly EventKeyEdit[],
): Project {
  const next = cloneProject(project);
  for (const { from, to } of edits) {
    for (const { path } of next.paths) {
      for (const element of path.path_elements) {
        if (isEventTrigger(element) && element.lib_key === from)
          element.lib_key = to;
      }
    }
    const replace = (keys: readonly string[]) => [
      ...new Set(keys.map((key) => (key === from ? to : key)).filter(Boolean)),
    ];
    next.config.gui.event_trigger_keys = replace(
      next.config.gui.event_trigger_keys ?? [],
    );
    next.config.gui.protrusions.show_on_event_keys = replace(
      next.config.gui.protrusions.show_on_event_keys,
    );
    next.config.gui.protrusions.hide_on_event_keys = replace(
      next.config.gui.protrusions.hide_on_event_keys,
    );
  }
  return next;
}

export function eventKeyUsage(project: Project, key: string): number {
  return project.paths.reduce(
    (count, { path }) =>
      count +
      path.path_elements.filter(
        (element) => isEventTrigger(element) && element.lib_key === key,
      ).length,
    0,
  );
}

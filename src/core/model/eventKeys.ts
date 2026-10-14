import { isEventTrigger } from "./path";
import { cloneProject, type Project } from "./project";

export interface EventKeyEdit {
  from: string;
  /** An empty replacement clears the key without removing its elements. */
  to: string;
}

/**
 * The field a key is being typed into. Its own text is left out so a
 * half-typed or mistyped key is never offered back as an existing one.
 */
export interface EventKeyOwner {
  pathId?: string | null;
  elementIndexes?: readonly number[];
  protrusion?: { list: "show" | "hide"; key: string };
}

export function projectEventKeys(
  project: Pick<Project, "config" | "paths">,
  owner: EventKeyOwner = {},
): string[] {
  const protrusions = project.config.gui.protrusions;
  const listKeys = (list: "show" | "hide", keys: readonly string[]) =>
    owner.protrusion?.list === list
      ? keys.filter((key) => key !== owner.protrusion?.key)
      : keys;
  return [
    ...new Set(
      [
        ...(project.config.gui.event_trigger_keys ?? []),
        ...listKeys("show", protrusions.show_on_event_keys),
        ...listKeys("hide", protrusions.hide_on_event_keys),
        ...project.paths.flatMap(({ path, path_id }) =>
          path.path_elements.flatMap((element, index) =>
            isEventTrigger(element) &&
            element.lib_key &&
            !(path_id === owner.pathId && owner.elementIndexes?.includes(index))
              ? [element.lib_key]
              : [],
          ),
        ),
      ].filter((key) => key.trim().length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/** An existing key that differs from `key` only by capitalization. */
export function eventKeyCaseVariant(
  key: string,
  keys: readonly string[],
): string | null {
  const typed = key.trim();
  if (!typed || keys.includes(typed)) return null;
  const folded = typed.toLocaleLowerCase();
  return (
    keys.find((candidate) => candidate.toLocaleLowerCase() === folded) ?? null
  );
}

/** Keys that would collide in robot code that ignores case, grouped. */
export function eventKeyCaseCollisions(keys: Iterable<string>): string[][] {
  const groups = new Map<string, Set<string>>();
  for (const raw of keys) {
    const key = raw.trim();
    if (!key) continue;
    const folded = key.toLocaleLowerCase();
    groups.set(folded, (groups.get(folded) ?? new Set()).add(key));
  }
  return [...groups.values()]
    .filter((group) => group.size > 1)
    .map((group) => [...group].sort((a, b) => a.localeCompare(b)));
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

export function eventKeyUsage(
  project: Pick<Project, "paths">,
  key: string,
): number {
  return project.paths.reduce(
    (count, { path }) =>
      count +
      path.path_elements.filter(
        (element) => isEventTrigger(element) && element.lib_key === key,
      ).length,
    0,
  );
}

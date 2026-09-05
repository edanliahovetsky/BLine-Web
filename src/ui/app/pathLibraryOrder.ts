import type { Project } from "../../core/model/project";
import type { LibraryNode } from "./usePathGroupLinkDrag";

export const libraryNodeKey = (node: LibraryNode | null) =>
  node ? `${node.kind}:${node.id}` : "";

export function connectedNodeIds(project: Project, focus: LibraryNode | null) {
  if (!focus) return [];
  return focus.kind === "group"
    ? (project.path_groups.find((group) => group.group_id === focus.id)
        ?.path_ids ?? [])
    : project.path_groups
        .filter((group) => group.path_ids.includes(focus.id))
        .map((group) => group.group_id);
}

/** Capture order at selection time so membership edits never move a target. */
export function captureLibraryOrder(
  project: Project,
  focus: LibraryNode | null,
) {
  const connectedIds = connectedNodeIds(project, focus);
  const neighbors = new Set(connectedIds);
  const order = (
    kind: LibraryNode["kind"],
    nodes: { id: string; name: string }[],
  ) =>
    nodes
      .sort((a, b) => {
        const priority = (id: string) =>
          Number(focus?.kind !== kind && neighbors.has(id));
        return (
          priority(b.id) - priority(a.id) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
          a.id.localeCompare(b.id)
        );
      })
      .map((node) => node.id);
  return {
    focusKey: libraryNodeKey(focus),
    connectedIds,
    group: order(
      "group",
      project.path_groups.map((group) => ({
        id: group.group_id,
        name: group.display_name,
      })),
    ),
    path: order(
      "path",
      project.paths.map((path) => ({
        id: path.path_id,
        name: path.display_name,
      })),
    ),
  };
}

export function applyLibraryOrder<T extends LibraryNode>(
  nodes: T[],
  ids: string[],
) {
  const rank = new Map(ids.map((id, index) => [id, index]));
  return nodes
    .slice()
    .sort(
      (a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length),
    );
}

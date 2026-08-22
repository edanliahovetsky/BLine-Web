import type {
  LinkedTarget,
  LinkedTargetKind,
  ProjectWorkspaceDocument,
} from "./io/projectSchema";
import type { Project } from "./model/project";
import {
  isTranslationTarget,
  isWaypoint,
  type PathElement,
  type Waypoint,
} from "./model/path";

export interface PathElementReference {
  pathId: string;
  elementIndex: number;
}

export interface CreateLinkedTargetInput {
  target_id?: string;
  display_name: string;
  kind: LinkedTargetKind;
  x_meters: number;
  y_meters: number;
  rotation_radians?: number | null;
  locked?: boolean;
  link?: PathElementReference;
}

export interface UpdateLinkedTargetInput {
  display_name?: string;
  kind?: LinkedTargetKind;
  x_meters?: number;
  y_meters?: number;
  rotation_radians?: number | null;
  locked?: boolean;
}

type LinkedTargetContainer = Pick<Project, "paths" | "linked_targets">;

interface LinkedTargetInputLike {
  target_id?: unknown;
  display_name?: unknown;
  kind?: unknown;
  x_meters?: unknown;
  y_meters?: unknown;
  rotation_radians?: unknown;
  locked?: unknown;
}

export function createLinkedTargetId(): string {
  return `target-${randomId()}`;
}

export function nextLinkedTargetName(
  project: Pick<Project, "linked_targets">,
  kind: LinkedTargetKind,
): string {
  const base = kind === "waypoint" ? "Linked Waypoint" : "Linked Translation";
  const existing = new Set(
    project.linked_targets.map((target) => target.display_name),
  );
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `${base} ${project.linked_targets.length + 1}`;
}

export function getPathElementLinkedTargetId(
  element: PathElement | undefined,
): string | null {
  if (!element) {
    return null;
  }

  if (isTranslationTarget(element) || isWaypoint(element)) {
    return element.linked_target_id ?? null;
  }

  return null;
}

export function setPathElementLinkedTargetId(
  element: PathElement,
  targetId: string | null,
): PathElement {
  const nextElement = structuredClone(element);
  if (!isTranslationTarget(nextElement) && !isWaypoint(nextElement)) {
    return nextElement;
  }

  if (targetId) {
    nextElement.linked_target_id = targetId;
  } else {
    delete nextElement.linked_target_id;
  }
  return nextElement;
}

export function isElementCompatibleWithLinkedTarget(
  element: PathElement,
  target: LinkedTarget,
): boolean {
  if (isTranslationTarget(element)) {
    return target.kind === "translation";
  }

  return isWaypoint(element);
}

export function linkedTargetForPathElement(
  project: Pick<Project, "linked_targets">,
  element: PathElement | undefined,
): LinkedTarget | null {
  const targetId = getPathElementLinkedTargetId(element);
  if (!element || !targetId) {
    return null;
  }

  const target =
    project.linked_targets.find(
      (candidate) => candidate.target_id === targetId,
    ) ?? null;
  if (!target || !isElementCompatibleWithLinkedTarget(element, target)) {
    return null;
  }

  return target;
}

export function linkedTargetControlsElementRotation(
  element: PathElement,
  target: LinkedTarget,
): boolean {
  return isWaypoint(element) && target.kind === "waypoint";
}

export function syncLinkedTargetElements(
  workspace: ProjectWorkspaceDocument,
): ProjectWorkspaceDocument {
  return syncLinkedTargetElementsIn(workspace);
}

export function syncLinkedTargetElementsInProject(project: Project): Project {
  return syncLinkedTargetElementsIn(project);
}

function syncLinkedTargetElementsIn<T extends LinkedTargetContainer>(
  container: T,
): T {
  const targetsById = new Map(
    container.linked_targets.map((target) => [target.target_id, target]),
  );
  const nextContainer = structuredClone(container);

  for (const path of nextContainer.paths) {
    path.path.path_elements = path.path.path_elements.map((element) => {
      const targetId = getPathElementLinkedTargetId(element);
      if (!targetId) {
        return element;
      }

      const target = targetsById.get(targetId);
      if (!target || !isElementCompatibleWithLinkedTarget(element, target)) {
        return setPathElementLinkedTargetId(element, null);
      }

      return applyLinkedTargetToElement(element, target);
    });
  }

  return nextContainer;
}

export function addLinkedTargetToWorkspace(
  workspace: ProjectWorkspaceDocument,
  input: CreateLinkedTargetInput,
): ProjectWorkspaceDocument {
  return addLinkedTarget(workspace, input);
}

export function addLinkedTargetToProject(
  project: Project,
  input: CreateLinkedTargetInput,
): Project {
  return addLinkedTarget(project, input);
}

function addLinkedTarget<T extends LinkedTargetContainer>(
  container: T,
  input: CreateLinkedTargetInput,
): T {
  const target: LinkedTarget = normalizeLinkedTarget({
    target_id: input.target_id ?? createLinkedTargetId(),
    display_name: input.display_name,
    kind: input.kind,
    x_meters: input.x_meters,
    y_meters: input.y_meters,
    rotation_radians: input.rotation_radians,
    locked: input.locked,
  });
  const nextContainer: T = {
    ...structuredClone(container),
    linked_targets: [...container.linked_targets, target],
  };

  if (input.link) {
    return linkPathElementToTarget(
      nextContainer,
      input.link.pathId,
      input.link.elementIndex,
      target.target_id,
    );
  }

  return syncLinkedTargetElementsIn(nextContainer);
}

export function updateLinkedTargetInWorkspace(
  workspace: ProjectWorkspaceDocument,
  targetId: string,
  update: UpdateLinkedTargetInput,
): ProjectWorkspaceDocument {
  return updateLinkedTarget(workspace, targetId, update);
}

export function updateLinkedTargetInProject(
  project: Project,
  targetId: string,
  update: UpdateLinkedTargetInput,
): Project {
  return updateLinkedTarget(project, targetId, update);
}

function updateLinkedTarget<T extends LinkedTargetContainer>(
  container: T,
  targetId: string,
  update: UpdateLinkedTargetInput,
): T {
  const nextContainer: T = {
    ...structuredClone(container),
    linked_targets: container.linked_targets.map((target) =>
      target.target_id === targetId
        ? normalizeLinkedTarget({ ...target, ...update })
        : structuredClone(target),
    ),
  };
  return syncLinkedTargetElementsIn(nextContainer);
}

export function deleteLinkedTargetFromWorkspace(
  workspace: ProjectWorkspaceDocument,
  targetId: string,
): ProjectWorkspaceDocument {
  return deleteLinkedTarget(workspace, targetId);
}

export function deleteLinkedTargetFromProject(
  project: Project,
  targetId: string,
): Project {
  return deleteLinkedTarget(project, targetId);
}

function deleteLinkedTarget<T extends LinkedTargetContainer>(
  container: T,
  targetId: string,
): T {
  const nextContainer: T = {
    ...structuredClone(container),
    linked_targets: container.linked_targets.filter(
      (target) => target.target_id !== targetId,
    ),
  };

  for (const path of nextContainer.paths) {
    path.path.path_elements = path.path.path_elements.map((element) =>
      getPathElementLinkedTargetId(element) === targetId
        ? setPathElementLinkedTargetId(element, null)
        : element,
    );
  }

  return nextContainer;
}

export function linkPathElementToTargetInWorkspace(
  workspace: ProjectWorkspaceDocument,
  pathId: string,
  elementIndex: number,
  targetId: string,
): ProjectWorkspaceDocument {
  return linkPathElementToTarget(workspace, pathId, elementIndex, targetId);
}

export function linkPathElementToTargetInProject(
  project: Project,
  pathId: string,
  elementIndex: number,
  targetId: string,
): Project {
  return linkPathElementToTarget(project, pathId, elementIndex, targetId);
}

function linkPathElementToTarget<T extends LinkedTargetContainer>(
  container: T,
  pathId: string,
  elementIndex: number,
  targetId: string,
): T {
  const target = container.linked_targets.find(
    (candidate) => candidate.target_id === targetId,
  );
  if (!target) {
    return container;
  }

  const nextContainer = structuredClone(container);
  const path = nextContainer.paths.find(
    (candidate) => candidate.path_id === pathId,
  );
  const element = path?.path.path_elements[elementIndex];
  if (
    !path ||
    !element ||
    !isElementCompatibleWithLinkedTarget(element, target)
  ) {
    return container;
  }

  path.path.path_elements[elementIndex] = applyLinkedTargetToElement(
    setPathElementLinkedTargetId(element, target.target_id),
    target,
  );
  return syncLinkedTargetElementsIn(nextContainer);
}

export function unlinkPathElementInWorkspace(
  workspace: ProjectWorkspaceDocument,
  pathId: string,
  elementIndex: number,
): ProjectWorkspaceDocument {
  return unlinkPathElement(workspace, pathId, elementIndex);
}

export function unlinkPathElementInProject(
  project: Project,
  pathId: string,
  elementIndex: number,
): Project {
  return unlinkPathElement(project, pathId, elementIndex);
}

function unlinkPathElement<T extends LinkedTargetContainer>(
  container: T,
  pathId: string,
  elementIndex: number,
): T {
  const nextContainer = structuredClone(container);
  const path = nextContainer.paths.find(
    (candidate) => candidate.path_id === pathId,
  );
  const element = path?.path.path_elements[elementIndex];
  if (!path || !element) {
    return container;
  }

  path.path.path_elements[elementIndex] = setPathElementLinkedTargetId(
    element,
    null,
  );
  return nextContainer;
}

export function linkedTargetUseCount(
  project: Pick<Project, "paths">,
  targetId: string,
): number {
  return project.paths.reduce(
    (total, path) =>
      total +
      path.path.path_elements.filter(
        (element) => getPathElementLinkedTargetId(element) === targetId,
      ).length,
    0,
  );
}

export function normalizeLinkedTargets(
  input: readonly LinkedTargetInputLike[] | undefined,
): LinkedTarget[] {
  const seen = new Set<string>();
  return (input ?? []).flatMap((target, index) => {
    const normalized = normalizeLinkedTarget(target, index);
    if (seen.has(normalized.target_id)) {
      return [];
    }
    seen.add(normalized.target_id);
    return [normalized];
  });
}

function applyLinkedTargetToElement(
  element: PathElement,
  target: LinkedTarget,
): PathElement {
  if (isTranslationTarget(element)) {
    return {
      ...element,
      x_meters: target.x_meters,
      y_meters: target.y_meters,
      linked_target_id: target.target_id,
    };
  }

  if (isWaypoint(element)) {
    const waypoint: Waypoint = {
      ...element,
      linked_target_id: target.target_id,
      translation_target: {
        ...element.translation_target,
        x_meters: target.x_meters,
        y_meters: target.y_meters,
      },
    };
    if (target.kind === "waypoint") {
      waypoint.rotation_target = {
        ...waypoint.rotation_target,
        rotation_radians: target.rotation_radians ?? 0,
      };
    }
    return waypoint;
  }

  return element;
}

function normalizeLinkedTarget(
  target: LinkedTargetInputLike,
  index = 0,
): LinkedTarget {
  const kind = normalizeLinkedTargetKind(target.kind);
  const normalized: LinkedTarget = {
    target_id:
      typeof target.target_id === "string" && target.target_id.trim()
        ? target.target_id
        : `target-${index + 1}`,
    display_name: normalizeLinkedTargetDisplayName(target.display_name, kind),
    kind,
    x_meters: finiteNumber(target.x_meters),
    y_meters: finiteNumber(target.y_meters),
  };
  if (kind === "waypoint") {
    normalized.rotation_radians = finiteNumber(target.rotation_radians ?? 0);
  }
  if (target.locked) {
    normalized.locked = true;
  }
  return normalized;
}

function normalizeLinkedTargetKind(kind: unknown): LinkedTargetKind {
  return kind === "waypoint" || kind === "pose" ? "waypoint" : "translation";
}

function normalizeLinkedTargetDisplayName(
  displayName: unknown,
  kind: LinkedTargetKind,
): string {
  const fallback =
    kind === "waypoint" ? "Linked Waypoint" : "Linked Translation";
  if (typeof displayName !== "string" || !displayName.trim()) {
    return fallback;
  }

  const trimmed = displayName.trim();
  const legacyMatch = /^Linked (Point|Pose)( \d+)?$/.exec(trimmed);
  if (!legacyMatch) {
    return trimmed;
  }

  return `${fallback}${legacyMatch[2] ?? ""}`;
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

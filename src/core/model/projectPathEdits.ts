import { applyAutoVelocityConstraintsToOrdinals } from "../constraints/autoVelocityApply";
import { clearGeneratedAutoConstraints } from "../constraints/autoConstraintGeneration";
import { remapRangedConstraints } from "../constraints/rangedConstraints";
import {
  getPathElementLinkedTargetId,
  linkedTargetControlsElementRotation,
  linkedTargetForPathElement,
  setPathElementLinkedTargetId,
  syncLinkedTargetElementsInProject,
  updateLinkedTargetInProject,
} from "../linkedTargets";
import type { Project, ProjectConfig } from "./project";
import {
  isAnchorElement,
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement,
  type PathModel,
} from "./path";

export type PathElementEdit =
  | {
      kind: "replace";
      index: number;
      element: PathElement;
      description?: string;
    }
  | {
      kind: "position";
      index: number;
      position: { x_meters: number; y_meters: number };
    }
  | { kind: "rotation"; index: number; rotationRadians: number }
  | { kind: "ratio"; index: number; ratio: number };

export type PathElementEditResult =
  | {
      status: "applied";
      project: Project;
      description: string;
      consequences: { focusPathId: string };
    }
  | {
      status: "noop" | "rejected";
      project: Project;
      reason: string;
      consequences: { focusPathId: string };
    };

export type PathStructureEdit =
  | { kind: "insert"; index: number; element: PathElement }
  | {
      kind: "insert-many";
      index: number;
      elements: readonly PathElement[];
      applyAutoVelocityToInsertedRange?: boolean;
    }
  | { kind: "remove"; index: number }
  | { kind: "duplicate"; index: number }
  | { kind: "reorder"; fromIndex: number; toIndex: number }
  | { kind: "convert"; index: number; element: PathElement };

export interface PathStructureEditConsequences {
  focusPathId: string;
  selectedElementIndex: number | null;
}

export type PathStructureEditResult =
  | {
      status: "applied";
      project: Project;
      description: string;
      consequences: PathStructureEditConsequences;
    }
  | {
      status: "noop" | "rejected";
      project: Project;
      reason: string;
      consequences: PathStructureEditConsequences;
    };

export interface ApplyPathStructureEditOptions {
  selectedElementIndex?: number | null;
}

/**
 * The semantic authority for non-structural Path-element edits. Linked-target
 * geometry is promoted to its canonical target while element-local properties
 * remain local, and the complete Project is returned for atomic history.
 */
export function applyPathElementEdit(
  project: Project,
  pathId: string,
  edit: PathElementEdit,
): PathElementEditResult {
  const consequences = { focusPathId: pathId };
  const projectPath = project.paths.find(
    (candidate) => candidate.path_id === pathId,
  );
  if (!projectPath) {
    return elementEditRejected(project, consequences, "Path does not exist");
  }

  const previous = projectPath.path.path_elements[edit.index];
  if (!previous) {
    return elementEditRejected(
      project,
      consequences,
      "Element index is out of range",
    );
  }

  const next = elementAfterEdit(previous, edit);
  if (!next) {
    return elementEditRejected(
      project,
      consequences,
      "Element does not support that edit",
    );
  }
  if (next.type !== previous.type) {
    return elementEditRejected(
      project,
      consequences,
      "Element type changes must use a structural edit",
    );
  }
  if (
    getPathElementLinkedTargetId(next) !==
    getPathElementLinkedTargetId(previous)
  ) {
    return elementEditRejected(
      project,
      consequences,
      "Link changes must use a linked-target edit",
    );
  }

  let nextProject: Project = {
    ...structuredClone(project),
    paths: project.paths.map((candidate) =>
      candidate.path_id === pathId
        ? {
            ...structuredClone(candidate),
            path: {
              ...structuredClone(candidate.path),
              path_elements: candidate.path.path_elements.map(
                (element, index) =>
                  index === edit.index
                    ? structuredClone(next)
                    : structuredClone(element),
              ),
            },
          }
        : structuredClone(candidate),
    ),
  };

  const linkedTarget = linkedTargetForPathElement(project, previous);
  if (linkedTarget && !linkedTarget.locked) {
    const targetUpdate: {
      x_meters?: number;
      y_meters?: number;
      rotation_radians?: number;
    } = {};
    const previousPosition = editablePosition(previous);
    const position = editablePosition(next);
    if (
      position &&
      previousPosition &&
      (position.x_meters !== previousPosition.x_meters ||
        position.y_meters !== previousPosition.y_meters)
    ) {
      targetUpdate.x_meters = position.x_meters;
      targetUpdate.y_meters = position.y_meters;
    }
    if (linkedTargetControlsElementRotation(next, linkedTarget)) {
      const previousRotation = editableRotation(previous);
      const rotation = editableRotation(next);
      if (rotation !== null && rotation !== previousRotation) {
        targetUpdate.rotation_radians = rotation;
      }
    }
    nextProject =
      Object.keys(targetUpdate).length > 0
        ? updateLinkedTargetInProject(
            nextProject,
            linkedTarget.target_id,
            targetUpdate,
          )
        : syncLinkedTargetElementsInProject(nextProject);
  } else {
    // For a locked target this restores only target-controlled geometry while
    // preserving local changes. It also repairs broken/incompatible links.
    nextProject = syncLinkedTargetElementsInProject(nextProject);
  }

  if (sameProject(project, nextProject)) {
    return elementEditNoop(project, consequences, "Element is unchanged");
  }

  return {
    status: "applied",
    project: nextProject,
    description: elementEditDescription(edit),
    consequences,
  };
}

/**
 * The single semantic authority for structural Path edits. It updates the
 * canonical Project, repairs ordinal constraints, invalidates generated
 * output, and synchronizes linked targets as one atomic result.
 */
export function applyPathStructureEdit(
  project: Project,
  pathId: string,
  edit: PathStructureEdit,
  options: ApplyPathStructureEditOptions = {},
): PathStructureEditResult {
  const selectedElementIndex = options.selectedElementIndex ?? null;
  const projectPath = project.paths.find(
    (candidate) => candidate.path_id === pathId,
  );
  const unchangedConsequences = {
    focusPathId: pathId,
    selectedElementIndex,
  };

  if (!projectPath) {
    return rejected(project, unchangedConsequences, "Path does not exist");
  }

  // Invalidate generated output from the existing Path before the edit. New
  // elements may intentionally arrive with generated defaults of their own.
  const path = clearGeneratedAutoConstraints(structuredClone(projectPath.path));
  const previousElements = path.path_elements.slice();
  let description: string;
  let nextSelection = selectedElementIndex;

  switch (edit.kind) {
    case "insert": {
      if (!isInsertionIndex(edit.index, path.path_elements.length)) {
        return rejected(
          project,
          unchangedConsequences,
          "Insertion index is out of range",
        );
      }
      path.path_elements.splice(edit.index, 0, structuredClone(edit.element));
      description = `Insert ${edit.element.type} element`;
      nextSelection = edit.index;
      break;
    }
    case "insert-many": {
      if (edit.elements.length === 0) {
        return noop(project, unchangedConsequences, "No elements to insert");
      }
      if (!isInsertionIndex(edit.index, path.path_elements.length)) {
        return rejected(
          project,
          unchangedConsequences,
          "Insertion index is out of range",
        );
      }
      path.path_elements.splice(
        edit.index,
        0,
        ...edit.elements.map((element) => structuredClone(element)),
      );
      description = `Insert ${edit.elements.length} path elements`;
      nextSelection = edit.index;
      break;
    }
    case "remove": {
      if (!isElementIndex(edit.index, path.path_elements.length)) {
        return rejected(
          project,
          unchangedConsequences,
          "Removal index is out of range",
        );
      }
      const [removed] = path.path_elements.splice(edit.index, 1);
      description = `Remove ${removed.type} element`;
      nextSelection = selectionAfterRemoval(
        selectedElementIndex,
        edit.index,
        path.path_elements.length,
      );
      break;
    }
    case "duplicate": {
      if (!isElementIndex(edit.index, path.path_elements.length)) {
        return rejected(
          project,
          unchangedConsequences,
          "Duplicate index is out of range",
        );
      }
      const duplicate = setPathElementLinkedTargetId(
        structuredClone(path.path_elements[edit.index]),
        null,
      );
      path.path_elements.splice(edit.index + 1, 0, duplicate);
      description = `Duplicate ${duplicate.type} element`;
      nextSelection = edit.index + 1;
      break;
    }
    case "reorder": {
      if (edit.fromIndex === edit.toIndex) {
        return noop(
          project,
          unchangedConsequences,
          "Element is already at that position",
        );
      }
      if (
        !isElementIndex(edit.fromIndex, path.path_elements.length) ||
        !isElementIndex(edit.toIndex, path.path_elements.length)
      ) {
        return rejected(
          project,
          unchangedConsequences,
          "Reorder index is out of range",
        );
      }
      const [moved] = path.path_elements.splice(edit.fromIndex, 1);
      path.path_elements.splice(edit.toIndex, 0, moved);
      description = `Reorder element ${edit.fromIndex + 1}`;
      nextSelection = selectionAfterMove(
        selectedElementIndex,
        edit.fromIndex,
        edit.toIndex,
      );
      break;
    }
    case "convert": {
      if (!isElementIndex(edit.index, path.path_elements.length)) {
        return rejected(
          project,
          unchangedConsequences,
          "Conversion index is out of range",
        );
      }
      const previous = path.path_elements[edit.index];
      if (sameElement(previous, edit.element)) {
        return noop(
          project,
          unchangedConsequences,
          "Element already has that value",
        );
      }
      path.path_elements[edit.index] = structuredClone(edit.element);
      description = `Change element ${edit.index + 1} type`;
      nextSelection = edit.index;
      break;
    }
  }

  if (!isValidPathElementOrder(path.path_elements)) {
    return rejected(
      project,
      unchangedConsequences,
      "Edit would create an invalid Path element order",
    );
  }

  remapRangedConstraints(path, previousElements);
  const finalizedPath = path;
  if (edit.kind === "insert-many") {
    applyInsertedAutoVelocity(finalizedPath, project.config, edit);
  }

  const nextProject = syncLinkedTargetElementsInProject({
    ...structuredClone(project),
    paths: project.paths.map((candidate) =>
      candidate.path_id === pathId
        ? { ...structuredClone(candidate), path: finalizedPath }
        : structuredClone(candidate),
    ),
  });

  return {
    status: "applied",
    project: nextProject,
    description,
    consequences: {
      focusPathId: pathId,
      selectedElementIndex: normalizeSelection(
        nextSelection,
        finalizedPath.path_elements.length,
      ),
    },
  };
}

export function canMovePathElement(
  path: PathModel,
  fromIndex: number,
  toIndex: number,
): boolean {
  if (
    fromIndex === toIndex ||
    !isElementIndex(fromIndex, path.path_elements.length) ||
    !isElementIndex(toIndex, path.path_elements.length)
  ) {
    return false;
  }
  const elements = path.path_elements.slice();
  const [element] = elements.splice(fromIndex, 1);
  elements.splice(toIndex, 0, element);
  return isValidPathElementOrder(elements);
}

function applyInsertedAutoVelocity(
  path: PathModel,
  config: ProjectConfig,
  edit: Extract<PathStructureEdit, { kind: "insert-many" }>,
): void {
  let nextPath = path;
  if (edit.applyAutoVelocityToInsertedRange) {
    nextPath = applyAutoVelocityConstraintsToOrdinals(
      path,
      config,
      autoVelocityOrdinalsForInsertedRange(
        path.path_elements,
        edit.index,
        edit.elements.length,
      ),
    );
  }
  path.path_elements = nextPath.path_elements;
  path.constraints = nextPath.constraints;
  path.ranged_constraints = nextPath.ranged_constraints;
}

function autoVelocityOrdinalsForInsertedRange(
  elements: readonly PathElement[],
  insertionIndex: number,
  insertedLength: number,
): number[] {
  const insertedEnd = insertionIndex + insertedLength;
  const ordinals: number[] = [];
  let anchorOrdinal = 0;
  let foundInsertedAnchor = false;
  for (let index = 0; index < elements.length; index += 1) {
    if (!isAnchorElement(elements[index])) continue;
    anchorOrdinal += 1;
    if (index >= insertionIndex && index < insertedEnd) {
      ordinals.push(anchorOrdinal);
      foundInsertedAnchor = true;
    } else if (foundInsertedAnchor && index >= insertedEnd) {
      ordinals.push(anchorOrdinal);
      break;
    }
  }
  return ordinals;
}

function isValidPathElementOrder(elements: readonly PathElement[]): boolean {
  if (elements.filter(isAnchorElement).length < 2) {
    return elements.every(isAnchorElement);
  }
  return elements.every(
    (element, index) =>
      isAnchorElement(element) ||
      (elements.slice(0, index).some(isAnchorElement) &&
        elements.slice(index + 1).some(isAnchorElement)),
  );
}

function selectionAfterRemoval(
  selected: number | null,
  removed: number,
  nextLength: number,
): number | null {
  if (selected === null) return null;
  return normalizeSelection(
    selected > removed ? selected - 1 : selected,
    nextLength,
  );
}

function selectionAfterMove(
  selected: number | null,
  fromIndex: number,
  toIndex: number,
): number | null {
  if (selected === null) return null;
  if (selected === fromIndex) return toIndex;
  if (fromIndex < selected && selected <= toIndex) return selected - 1;
  if (toIndex <= selected && selected < fromIndex) return selected + 1;
  return selected;
}

function normalizeSelection(
  index: number | null,
  length: number,
): number | null {
  if (index === null || length === 0) return null;
  return Math.min(Math.max(0, index), length - 1);
}

function isInsertionIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index <= length;
}

function isElementIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

function sameElement(left: PathElement, right: PathElement): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function elementAfterEdit(
  previous: PathElement,
  edit: PathElementEdit,
): PathElement | null {
  if (edit.kind === "replace") {
    return structuredClone(edit.element);
  }

  const next = structuredClone(previous);
  if (edit.kind === "position") {
    if (isTranslationTarget(next)) {
      next.x_meters = edit.position.x_meters;
      next.y_meters = edit.position.y_meters;
      return next;
    }
    if (isWaypoint(next)) {
      next.translation_target.x_meters = edit.position.x_meters;
      next.translation_target.y_meters = edit.position.y_meters;
      return next;
    }
    return null;
  }

  if (edit.kind === "rotation") {
    const rotation = normalizeRadians(edit.rotationRadians);
    if (isRotationTarget(next)) {
      next.rotation_radians = rotation;
      return next;
    }
    if (isWaypoint(next)) {
      next.rotation_target.rotation_radians = rotation;
      return next;
    }
    return null;
  }

  if (isRotationTarget(next) || isEventTrigger(next)) {
    next.t_ratio = Math.max(0, Math.min(1, edit.ratio));
    return next;
  }
  return null;
}

function editablePosition(
  element: PathElement,
): { x_meters: number; y_meters: number } | null {
  if (isTranslationTarget(element)) {
    return { x_meters: element.x_meters, y_meters: element.y_meters };
  }
  if (isWaypoint(element)) {
    return {
      x_meters: element.translation_target.x_meters,
      y_meters: element.translation_target.y_meters,
    };
  }
  return null;
}

function editableRotation(element: PathElement): number | null {
  if (isRotationTarget(element)) {
    return element.rotation_radians;
  }
  if (isWaypoint(element)) {
    return element.rotation_target.rotation_radians;
  }
  return null;
}

function normalizeRadians(radians: number): number {
  if (!Number.isFinite(radians)) {
    return 0;
  }

  let normalized = radians;
  while (normalized <= -Math.PI) normalized += Math.PI * 2;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  return normalized;
}

function elementEditDescription(edit: PathElementEdit): string {
  if (edit.kind === "replace") {
    return edit.description ?? `Update element ${edit.index + 1}`;
  }
  if (edit.kind === "position") {
    return `Move element ${edit.index + 1}`;
  }
  if (edit.kind === "rotation") {
    return `Rotate element ${edit.index + 1}`;
  }
  return `Move projected element ${edit.index + 1}`;
}

function sameProject(left: Project, right: Project): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function elementEditRejected(
  project: Project,
  consequences: { focusPathId: string },
  reason: string,
): PathElementEditResult {
  return { status: "rejected", project, reason, consequences };
}

function elementEditNoop(
  project: Project,
  consequences: { focusPathId: string },
  reason: string,
): PathElementEditResult {
  return { status: "noop", project, reason, consequences };
}

function rejected(
  project: Project,
  consequences: PathStructureEditConsequences,
  reason: string,
): PathStructureEditResult {
  return { status: "rejected", project, reason, consequences };
}

function noop(
  project: Project,
  consequences: PathStructureEditConsequences,
  reason: string,
): PathStructureEditResult {
  return { status: "noop", project, reason, consequences };
}

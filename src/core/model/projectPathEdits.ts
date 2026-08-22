import { applyAutoVelocityConstraintsToOrdinals } from "../constraints/autoVelocityApply";
import { clearGeneratedAutoConstraints } from "../constraints/autoConstraintGeneration";
import { remapRangedConstraints } from "../constraints/rangedConstraints";
import {
  setPathElementLinkedTargetId,
  syncLinkedTargetElementsInProject,
} from "../linkedTargets";
import type { Project, ProjectConfig } from "./project";
import { isAnchorElement, type PathElement, type PathModel } from "./path";

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

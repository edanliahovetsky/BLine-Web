import type { ProjectDocument } from "../core/io/projectSchema";
import { projectStore } from "../state/projectStore";
import { selectionStore } from "../state/selectionStore";
import {
  canMovePathElement,
  createMovePathElementCommand,
  createRemovePathElementCommand,
  createRemoveRangedConstraintCommand
} from "./sidebar/sidebarCommands";

const editableSelector = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='searchbox']",
  "[role='spinbutton']",
  "[role='textbox']"
].join(",");

const interactiveSelector = [
  editableSelector,
  "a[href]",
  "button",
  "summary",
  "[role='button']",
  "[role='menuitem']",
  "[role='option']",
  "[role='slider']",
  "[role='switch']",
  "[role='tab']"
].join(",");

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return isElementWithin(target, editableSelector);
}

export function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  return isElementWithin(target, interactiveSelector);
}

export function removeSelectedPathElement(): boolean {
  const project = projectStore.getState().project;
  const selectedElementIndex = selectionStore.getState().selectedElementIndex;

  if (!project || selectedElementIndex === null) {
    return false;
  }

  const element = project.path.path_elements[selectedElementIndex];
  if (!element) {
    return false;
  }

  projectStore
    .getState()
    .applyCommand(createRemovePathElementCommand(selectedElementIndex, element));
  selectionStore
    .getState()
    .selectElement(
      nextSelectionAfterRemoval(project, selectedElementIndex),
      projectStore.getState().project
    );

  return true;
}

export function moveSelectedPathElement(direction: -1 | 1): boolean {
  const project = projectStore.getState().project;
  const selectedElementIndex = selectionStore.getState().selectedElementIndex;

  if (!project || selectedElementIndex === null) {
    return false;
  }

  const nextIndex = selectedElementIndex + direction;
  if (!canMovePathElement(project, selectedElementIndex, nextIndex)) {
    return false;
  }

  projectStore
    .getState()
    .applyCommand(createMovePathElementCommand(selectedElementIndex, nextIndex));
  selectionStore
    .getState()
    .selectElement(nextIndex, projectStore.getState().project);

  return true;
}

export function removeSelectedRangedConstraint(): boolean {
  const project = projectStore.getState().project;
  const selectedRangedConstraint = selectionStore.getState().selectedRangedConstraint;

  if (!project || !selectedRangedConstraint) {
    return false;
  }

  const constraint = project.path.ranged_constraints[selectedRangedConstraint.index];
  if (!constraint || constraint.key !== selectedRangedConstraint.key) {
    return false;
  }

  projectStore
    .getState()
    .applyCommand(
      createRemoveRangedConstraintCommand(
        selectedRangedConstraint.index,
        constraint
      )
    );
  selectionStore.getState().clearRangedConstraintSelection();

  return true;
}

function nextSelectionAfterRemoval(
  project: ProjectDocument,
  removedIndex: number
): number | null {
  const nextIndex = Math.min(removedIndex, project.path.path_elements.length - 2);
  return nextIndex >= 0 ? nextIndex : null;
}

function isElementWithin(target: EventTarget | null, selector: string): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest(selector));
}

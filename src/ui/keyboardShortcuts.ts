import {
  fieldCoordinateLengthMeters,
  fieldCoordinateWidthMeters,
  fieldGeometryFromConfig,
} from "../core/field/fieldConfig";
import type { ProjectDocument } from "../core/io/projectSchema";
import { isTranslationTarget, isWaypoint } from "../core/model/path";
import {
  activePathDocumentForProjectStore,
  projectStore,
} from "../state/projectStore";
import { selectionStore } from "../state/selectionStore";
import {
  canMovePathElement,
  createDuplicatePathElementCommand,
  createMovePathElementCommand,
  createRemovePathElementCommand,
  createRemoveRangedConstraintCommand,
  createUpdatePathElementCommand,
  updateTranslationTarget,
  updateWaypoint,
} from "./sidebar/sidebarCommands";

const editableSelector = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='searchbox']",
  "[role='spinbutton']",
  "[role='textbox']",
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
  "[role='tab']",
].join(",");

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return isElementWithin(target, editableSelector);
}

export function isInteractiveShortcutTarget(
  target: EventTarget | null,
): boolean {
  return isElementWithin(target, interactiveSelector);
}

export function removeSelectedPathElement(): boolean {
  const project = activePathDocumentForProjectStore(projectStore.getState());
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
    .applyCommand(
      createRemovePathElementCommand(selectedElementIndex, element),
    );
  selectionStore
    .getState()
    .selectElement(
      nextSelectionAfterRemoval(project, selectedElementIndex),
      activePathDocumentForProjectStore(projectStore.getState()),
    );

  return true;
}

export function nudgeSelectedPathElement(
  dxMeters: number,
  dyMeters: number,
): boolean {
  const project = activePathDocumentForProjectStore(projectStore.getState());
  const selectedElementIndex = selectionStore.getState().selectedElementIndex;

  if (!project || selectedElementIndex === null) {
    return false;
  }

  const element = project.path.path_elements[selectedElementIndex];
  if (!element) {
    return false;
  }

  const field = fieldGeometryFromConfig(project.config.gui.field);
  const maxX = fieldCoordinateLengthMeters(field);
  const maxY = fieldCoordinateWidthMeters(field);
  const clamp = (value: number, max: number) =>
    Math.min(Math.max(value, 0), max);

  let nextElement;
  if (isTranslationTarget(element)) {
    nextElement = updateTranslationTarget(element, {
      x_meters: clamp(element.x_meters + dxMeters, maxX),
      y_meters: clamp(element.y_meters + dyMeters, maxY),
    });
  } else if (isWaypoint(element)) {
    nextElement = updateWaypoint(element, {
      translation: {
        x_meters: clamp(element.translation_target.x_meters + dxMeters, maxX),
        y_meters: clamp(element.translation_target.y_meters + dyMeters, maxY),
      },
    });
  } else {
    // Rotation and event elements have no field position to nudge.
    return false;
  }

  projectStore
    .getState()
    .applyCommand(
      createUpdatePathElementCommand(
        selectedElementIndex,
        element,
        nextElement,
      ),
    );

  return true;
}

export function duplicateSelectedPathElement(): boolean {
  const project = activePathDocumentForProjectStore(projectStore.getState());
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
    .applyCommand(
      createDuplicatePathElementCommand(selectedElementIndex, element),
    );
  selectionStore
    .getState()
    .selectElement(
      selectedElementIndex + 1,
      activePathDocumentForProjectStore(projectStore.getState()),
    );

  return true;
}

export function moveSelectedPathElement(direction: -1 | 1): boolean {
  const project = activePathDocumentForProjectStore(projectStore.getState());
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
    .applyCommand(
      createMovePathElementCommand(selectedElementIndex, nextIndex),
    );
  selectionStore
    .getState()
    .selectElement(
      nextIndex,
      activePathDocumentForProjectStore(projectStore.getState()),
    );

  return true;
}

export function selectAdjacentPathElement(direction: -1 | 1): boolean {
  const project = activePathDocumentForProjectStore(projectStore.getState());
  if (!project || project.path.path_elements.length === 0) {
    return false;
  }

  const selectedElementIndex = selectionStore.getState().selectedElementIndex;
  const nextIndex =
    selectedElementIndex === null
      ? direction > 0
        ? 0
        : project.path.path_elements.length - 1
      : Math.min(
          project.path.path_elements.length - 1,
          Math.max(0, selectedElementIndex + direction),
        );

  if (nextIndex === selectedElementIndex) {
    return false;
  }

  selectionStore.getState().selectElement(nextIndex, project);
  return true;
}

export function removeSelectedRangedConstraint(): boolean {
  const project = activePathDocumentForProjectStore(projectStore.getState());
  const selectedRangedConstraint =
    selectionStore.getState().selectedRangedConstraint;

  if (!project || !selectedRangedConstraint) {
    return false;
  }

  const constraint =
    project.path.ranged_constraints[selectedRangedConstraint.index];
  if (!constraint || constraint.key !== selectedRangedConstraint.key) {
    return false;
  }

  projectStore
    .getState()
    .applyCommand(
      createRemoveRangedConstraintCommand(
        selectedRangedConstraint.index,
        constraint,
      ),
    );
  selectionStore.getState().clearRangedConstraintSelection();

  return true;
}

function nextSelectionAfterRemoval(
  project: ProjectDocument,
  removedIndex: number,
): number | null {
  const nextIndex = Math.min(
    removedIndex,
    project.path.path_elements.length - 2,
  );
  return nextIndex >= 0 ? nextIndex : null;
}

function isElementWithin(
  target: EventTarget | null,
  selector: string,
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest(selector));
}

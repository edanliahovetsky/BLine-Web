import {
  fieldCoordinateLengthMeters,
  fieldCoordinateWidthMeters,
  defaultFieldGeometry,
  type FieldGeometry,
} from "../core/field/fieldConfig";
import { isTranslationTarget, isWaypoint } from "../core/model/path";
import { canMovePathElement } from "../core/model/projectPathEdits";
import { activePathForProjectStore, projectStore } from "../state/projectStore";
import { selectionStore } from "../state/selectionStore";
import {
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
  const path = activePathForProjectStore(projectStore.getState())?.path;
  const selectedElementIndex = selectionStore.getState().selectedElementIndex;

  if (!path || selectedElementIndex === null) {
    return false;
  }

  const element = path.path_elements[selectedElementIndex];
  if (!element) {
    return false;
  }

  const result = projectStore
    .getState()
    .applyPathStructureEdit(
      { kind: "remove", index: selectedElementIndex },
      { selectedElementIndex },
    );
  if (result.status !== "applied") {
    return false;
  }
  selectionStore
    .getState()
    .selectElement(
      result.consequences.selectedElementIndex,
      activePathForProjectStore(projectStore.getState())?.path,
    );

  return true;
}

export function nudgeSelectedPathElement(
  dxMeters: number,
  dyMeters: number,
  field: FieldGeometry = defaultFieldGeometry,
): boolean {
  const state = projectStore.getState();
  const project = state.project;
  const path = activePathForProjectStore(state)?.path;
  const selectedElementIndex = selectionStore.getState().selectedElementIndex;

  if (!project || !path || selectedElementIndex === null) {
    return false;
  }

  const element = path.path_elements[selectedElementIndex];
  if (!element) {
    return false;
  }

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
    .applyPathCommand(
      createUpdatePathElementCommand(
        selectedElementIndex,
        element,
        nextElement,
      ),
    );

  return true;
}

export function duplicateSelectedPathElement(): boolean {
  const path = activePathForProjectStore(projectStore.getState())?.path;
  const selectedElementIndex = selectionStore.getState().selectedElementIndex;

  if (!path || selectedElementIndex === null) {
    return false;
  }

  const element = path.path_elements[selectedElementIndex];
  if (!element) {
    return false;
  }

  const result = projectStore
    .getState()
    .applyPathStructureEdit(
      { kind: "duplicate", index: selectedElementIndex },
      { selectedElementIndex },
    );
  if (result.status !== "applied") {
    return false;
  }
  selectionStore
    .getState()
    .selectElement(
      result.consequences.selectedElementIndex,
      activePathForProjectStore(projectStore.getState())?.path,
    );

  return true;
}

export function moveSelectedPathElement(direction: -1 | 1): boolean {
  const path = activePathForProjectStore(projectStore.getState())?.path;
  const selectedElementIndex = selectionStore.getState().selectedElementIndex;

  if (!path || selectedElementIndex === null) {
    return false;
  }

  const nextIndex = selectedElementIndex + direction;
  if (!canMovePathElement(path, selectedElementIndex, nextIndex)) {
    return false;
  }

  const result = projectStore
    .getState()
    .applyPathStructureEdit(
      { kind: "reorder", fromIndex: selectedElementIndex, toIndex: nextIndex },
      { selectedElementIndex },
    );
  if (result.status !== "applied") {
    return false;
  }
  selectionStore
    .getState()
    .selectElement(
      result.consequences.selectedElementIndex,
      activePathForProjectStore(projectStore.getState())?.path,
    );

  return true;
}

export function selectAdjacentPathElement(direction: -1 | 1): boolean {
  const path = activePathForProjectStore(projectStore.getState())?.path;
  if (!path || path.path_elements.length === 0) {
    return false;
  }

  const selectedElementIndex = selectionStore.getState().selectedElementIndex;
  const nextIndex =
    selectedElementIndex === null
      ? direction > 0
        ? 0
        : path.path_elements.length - 1
      : Math.min(
          path.path_elements.length - 1,
          Math.max(0, selectedElementIndex + direction),
        );

  if (nextIndex === selectedElementIndex) {
    return false;
  }

  selectionStore.getState().selectElement(nextIndex, path);
  return true;
}

export function removeSelectedRangedConstraint(): boolean {
  const path = activePathForProjectStore(projectStore.getState())?.path;
  const selectedRangedConstraint =
    selectionStore.getState().selectedRangedConstraint;

  if (!path || !selectedRangedConstraint) {
    return false;
  }

  const constraint = path.ranged_constraints[selectedRangedConstraint.index];
  if (!constraint || constraint.key !== selectedRangedConstraint.key) {
    return false;
  }

  projectStore
    .getState()
    .applyPathCommand(
      createRemoveRangedConstraintCommand(
        selectedRangedConstraint.index,
        constraint,
      ),
    );
  selectionStore.getState().clearRangedConstraintSelection();

  return true;
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

import { createStore, type StoreApi } from "zustand/vanilla";
import type { ProjectDocument } from "../core/io/projectSchema";
import {
  isRangedConstraintKey,
  type RangedConstraintKey
} from "../core/model/path";

export interface SelectedRangedConstraint {
  key: RangedConstraintKey;
  index: number;
  startOrdinal: number;
  endOrdinal: number;
}

export interface SelectionState {
  selectedElementIndex: number | null;
  selectedRangedConstraint: SelectedRangedConstraint | null;
  selectElement(index: number | null, project?: ProjectDocument | null): void;
  selectRangedConstraint(
    selection: SelectedRangedConstraint | null,
    project?: ProjectDocument | null
  ): void;
  clearSelection(): void;
  clearRangedConstraintSelection(): void;
  reconcileProject(project: ProjectDocument | null): void;
}

export type SelectionStore = StoreApi<SelectionState>;

export function createSelectionStore(): SelectionStore {
  return createStore<SelectionState>((set, get) => ({
    selectedElementIndex: null,
    selectedRangedConstraint: null,
    selectElement(index, project) {
      set({
        selectedElementIndex:
          project === undefined
            ? normalizeRawSelection(index)
            : normalizeElementSelection(project, index),
        selectedRangedConstraint: null
      });
    },
    selectRangedConstraint(selection, project) {
      set({
        selectedElementIndex: null,
        selectedRangedConstraint:
          project === undefined
            ? normalizeRawRangedConstraintSelection(selection)
            : normalizeRangedConstraintSelection(project, selection)
      });
    },
    clearSelection() {
      set({ selectedElementIndex: null, selectedRangedConstraint: null });
    },
    clearRangedConstraintSelection() {
      set({ selectedRangedConstraint: null });
    },
    reconcileProject(project) {
      set({
        selectedElementIndex: normalizeElementSelection(
          project,
          get().selectedElementIndex
        ),
        selectedRangedConstraint: normalizeRangedConstraintSelection(
          project,
          get().selectedRangedConstraint
        )
      });
    }
  }));
}

export const selectionStore = createSelectionStore();

export function normalizeElementSelection(
  project: ProjectDocument | null,
  index: number | null
): number | null {
  const rawSelection = normalizeRawSelection(index);
  const length = project?.path.path_elements.length ?? 0;

  if (rawSelection === null || length === 0) {
    return null;
  }

  return Math.min(rawSelection, length - 1);
}

function normalizeRawSelection(index: number | null): number | null {
  if (index === null || !Number.isInteger(index) || index < 0) {
    return null;
  }

  return index;
}

export function normalizeRangedConstraintSelection(
  project: ProjectDocument | null,
  selection: SelectedRangedConstraint | null
): SelectedRangedConstraint | null {
  const rawSelection = normalizeRawRangedConstraintSelection(selection);
  if (!project || rawSelection === null) {
    return null;
  }

  const constraint = project.path.ranged_constraints[rawSelection.index];
  if (!constraint || constraint.key !== rawSelection.key) {
    return null;
  }

  return {
    key: constraint.key,
    index: rawSelection.index,
    startOrdinal: constraint.start_ordinal,
    endOrdinal: constraint.end_ordinal
  };
}

function normalizeRawRangedConstraintSelection(
  selection: SelectedRangedConstraint | null
): SelectedRangedConstraint | null {
  if (
    selection === null ||
    !isRangedConstraintKey(selection.key) ||
    !Number.isInteger(selection.index) ||
    selection.index < 0
  ) {
    return null;
  }

  return {
    key: selection.key,
    index: selection.index,
    startOrdinal: normalizeOrdinal(selection.startOrdinal),
    endOrdinal: normalizeOrdinal(selection.endOrdinal)
  };
}

function normalizeOrdinal(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

import { createStore, type StoreApi } from "zustand/vanilla";
import type { ProjectDocument } from "../core/io/projectSchema";

export interface SelectionState {
  selectedElementIndex: number | null;
  selectElement(index: number | null, project?: ProjectDocument | null): void;
  clearSelection(): void;
  reconcileProject(project: ProjectDocument | null): void;
}

export type SelectionStore = StoreApi<SelectionState>;

export function createSelectionStore(): SelectionStore {
  return createStore<SelectionState>((set, get) => ({
    selectedElementIndex: null,
    selectElement(index, project) {
      set({
        selectedElementIndex:
          project === undefined
            ? normalizeRawSelection(index)
            : normalizeElementSelection(project, index)
      });
    },
    clearSelection() {
      set({ selectedElementIndex: null });
    },
    reconcileProject(project) {
      set({
        selectedElementIndex: normalizeElementSelection(
          project,
          get().selectedElementIndex
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

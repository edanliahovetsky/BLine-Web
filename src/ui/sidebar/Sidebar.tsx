import type { ProjectDocument } from "../../core/io/projectSchema";
import type { PathElement } from "../../core/model/path";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import { ConstraintEditor } from "./sections/ConstraintEditor";
import { ElementList } from "./sections/ElementList";
import { PropertyEditor } from "./sections/PropertyEditor";
import {
  canMovePathElement,
  createChangePathElementTypeCommand,
  createConvertedElement,
  createDefaultElement,
  createInsertPathElementCommand,
  createMovePathElementCommand,
  createRemovePathElementCommand,
  createUpdatePathElementCommand,
  getInsertionIndex,
  getSwitchableElementTypes,
  type AddableElementType
} from "./sidebarCommands";

interface SidebarProps {
  project: ProjectDocument | null;
  selectedElementIndex: number | null;
}

export function Sidebar({ project, selectedElementIndex }: SidebarProps) {
  const selectedElement =
    project && selectedElementIndex !== null
      ? project.path.path_elements[selectedElementIndex] ?? null
      : null;

  const handleSelectElement = (index: number) => {
    selectionStore.getState().selectElement(index, project);
  };

  const handleAddElement = (type: AddableElementType) => {
    if (!project) {
      return;
    }

    const insertionIndex = getInsertionIndex(project, type, selectedElementIndex);
    const element = createDefaultElement(project, type, selectedElementIndex);
    projectStore
      .getState()
      .applyCommand(createInsertPathElementCommand(insertionIndex, element));
    selectionStore.getState().selectElement(insertionIndex, projectStore.getState().project);
  };

  const handleRemoveElement = (index: number) => {
    if (!project) {
      return;
    }

    const element = project.path.path_elements[index];
    if (!element) {
      return;
    }

    projectStore
      .getState()
      .applyCommand(createRemovePathElementCommand(index, element));
    selectionStore
      .getState()
      .selectElement(nextSelectionAfterRemoval(index, selectedElementIndex), projectStore.getState().project);
  };

  const handleMoveElement = (fromIndex: number, toIndex: number) => {
    if (!project || !canMovePathElement(project, fromIndex, toIndex)) {
      return;
    }

    const nextSelection = selectionAfterMove(
      selectedElementIndex,
      fromIndex,
      toIndex
    );
    projectStore
      .getState()
      .applyCommand(createMovePathElementCommand(fromIndex, toIndex));
    selectionStore.getState().selectElement(nextSelection, projectStore.getState().project);
  };

  const handleChangeElementType = (type: AddableElementType) => {
    if (!project || selectedElementIndex === null || !selectedElement) {
      return;
    }

    const convertedElement = createConvertedElement(
      project,
      selectedElementIndex,
      type
    );
    if (!convertedElement) {
      return;
    }

    projectStore
      .getState()
      .applyCommand(
        createChangePathElementTypeCommand(
          selectedElementIndex,
          selectedElement,
          convertedElement
        )
      );
    selectionStore
      .getState()
      .selectElement(selectedElementIndex, projectStore.getState().project);
  };

  const handleUpdateElement = (nextElement: PathElement) => {
    if (!project || selectedElementIndex === null || !selectedElement) {
      return;
    }

    projectStore
      .getState()
      .applyCommand(
        createUpdatePathElementCommand(selectedElementIndex, selectedElement, nextElement)
      );
    selectionStore
      .getState()
      .selectElement(selectedElementIndex, projectStore.getState().project);
  };

  return (
    <aside className="inspector-sidebar" aria-label="Path inspector">
      <ElementList
        project={project}
        selectedElementIndex={selectedElementIndex}
        onAddElement={handleAddElement}
        onSelectElement={handleSelectElement}
        onRemoveElement={handleRemoveElement}
        onMoveElement={handleMoveElement}
      />
      <PropertyEditor
        element={selectedElement}
        selectedElementIndex={selectedElementIndex}
        typeOptions={
          project && selectedElementIndex !== null
            ? getSwitchableElementTypes(project, selectedElementIndex)
            : []
        }
        onChangeType={handleChangeElementType}
        onUpdateElement={handleUpdateElement}
      />
      <ConstraintEditor project={project} />
    </aside>
  );
}

function selectionAfterMove(
  selectedElementIndex: number | null,
  fromIndex: number,
  toIndex: number
): number | null {
  if (selectedElementIndex === null) {
    return null;
  }

  if (selectedElementIndex === fromIndex) {
    return toIndex;
  }

  if (fromIndex < selectedElementIndex && selectedElementIndex <= toIndex) {
    return selectedElementIndex - 1;
  }

  if (toIndex <= selectedElementIndex && selectedElementIndex < fromIndex) {
    return selectedElementIndex + 1;
  }

  return selectedElementIndex;
}

function nextSelectionAfterRemoval(
  removedIndex: number,
  selectedElementIndex: number | null
): number | null {
  if (selectedElementIndex === null) {
    return null;
  }

  if (selectedElementIndex > removedIndex) {
    return selectedElementIndex - 1;
  }

  return selectedElementIndex;
}

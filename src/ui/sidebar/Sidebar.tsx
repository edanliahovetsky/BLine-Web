import type { ProjectDocument } from "../../core/io/projectSchema";
import type { PathElement } from "../../core/model/path";
import { projectStore } from "../../state/projectStore";
import { selectionStore } from "../../state/selectionStore";
import { ElementList } from "./sections/ElementList";
import { PropertyEditor } from "./sections/PropertyEditor";
import {
  createDefaultElement,
  createInsertPathElementCommand,
  createRemovePathElementCommand,
  createUpdatePathElementCommand,
  getInsertionIndex,
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
      />
      <PropertyEditor
        element={selectedElement}
        selectedElementIndex={selectedElementIndex}
        onUpdateElement={handleUpdateElement}
      />
      <PathConstraintsSummary project={project} />
    </aside>
  );
}

function PathConstraintsSummary({ project }: { project: ProjectDocument | null }) {
  const constraints = project?.path.constraints;
  const rangedConstraints = project?.path.ranged_constraints ?? [];

  return (
    <section className="inspector-section constraints-section">
      <header className="inspector-section__header">
        <h2>Path Constraints</h2>
        <button type="button" className="icon-text-button" disabled>
          <span aria-hidden="true" className="icon-button-symbol">
            +
          </span>
          <span>Add constraint</span>
        </button>
      </header>
      <div className="constraint-summary-card">
        <dl>
          <ConstraintRow
            label="Max Velocity"
            value={formatConstraint(constraints?.max_velocity_meters_per_sec, "m/s")}
          />
          <ConstraintRow
            label="Max Accel"
            value={formatConstraint(constraints?.max_acceleration_meters_per_sec2, "m/s2")}
          />
          <ConstraintRow
            label="Ranged"
            value={String(rangedConstraints.length)}
          />
        </dl>
      </div>
    </section>
  );
}

function ConstraintRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function formatConstraint(value: number | null | undefined, unit: string): string {
  return value === null || value === undefined ? "Default" : `${value.toFixed(2)} ${unit}`;
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

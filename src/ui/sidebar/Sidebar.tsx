import { useState } from "react";
import type {
  LinkedTargetKind,
  ProjectDocument,
  ProjectWorkspaceDocument,
} from "../../core/io/projectSchema";
import { fieldGeometryFromConfig } from "../../core/field/fieldConfig";
import type { PathElement } from "../../core/model/path";
import {
  getElementHeadingRadians,
  getElementPosition,
} from "../../canvas/geometry";
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
  type AddableElementType,
} from "./sidebarCommands";

type SidebarSectionKey = "pathElements" | "properties" | "constraints";

type SidebarSectionState = Record<SidebarSectionKey, boolean>;

const sidebarSectionStorageKey = "bline.sidebar.sections.v1";
const defaultSidebarSectionState: SidebarSectionState = {
  pathElements: true,
  properties: true,
  constraints: true,
};

interface SidebarProps {
  project: ProjectDocument | null;
  workspace: ProjectWorkspaceDocument | null;
  selectedElementIndex: number | null;
  curveToolActive?: boolean;
  onStartCurve?(insertionIndex: number): void;
  onOpenLinkedTargetPicker?(): void;
}

export function Sidebar({
  project,
  workspace,
  selectedElementIndex,
  curveToolActive = false,
  onStartCurve,
  onOpenLinkedTargetPicker,
}: SidebarProps) {
  const [sectionState, setSectionState] = useState<SidebarSectionState>(() =>
    readSidebarSectionState(),
  );
  const selectedElement =
    project && selectedElementIndex !== null
      ? (project.path.path_elements[selectedElementIndex] ?? null)
      : null;
  const fieldGeometry = project
    ? fieldGeometryFromConfig(project.config.gui.field)
    : undefined;

  const handleSelectElement = (index: number) => {
    selectionStore.getState().selectElement(index, project);
  };

  const handleAddElement = (type: AddableElementType) => {
    if (!project) {
      return;
    }

    const insertionIndex = getInsertionIndex(
      project,
      type,
      selectedElementIndex,
    );
    const element = createDefaultElement(project, type, selectedElementIndex);
    projectStore
      .getState()
      .applyCommand(createInsertPathElementCommand(insertionIndex, element));
    selectionStore
      .getState()
      .selectElement(insertionIndex, projectStore.getState().project);
  };

  const handleAddCurve = () => {
    if (!project || !onStartCurve || curveToolActive) {
      return;
    }

    onStartCurve(
      getInsertionIndex(project, "translation", selectedElementIndex),
    );
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
      .selectElement(
        nextSelectionAfterRemoval(index, selectedElementIndex),
        projectStore.getState().project,
      );
  };

  const handleMoveElement = (fromIndex: number, toIndex: number) => {
    if (!project || !canMovePathElement(project, fromIndex, toIndex)) {
      return;
    }

    const nextSelection = selectionAfterMove(
      selectedElementIndex,
      fromIndex,
      toIndex,
    );
    projectStore
      .getState()
      .applyCommand(createMovePathElementCommand(fromIndex, toIndex));
    selectionStore
      .getState()
      .selectElement(nextSelection, projectStore.getState().project);
  };

  const handleChangeElementType = (type: AddableElementType) => {
    if (!project || selectedElementIndex === null || !selectedElement) {
      return;
    }

    const convertedElement = createConvertedElement(
      project,
      selectedElementIndex,
      type,
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
          convertedElement,
        ),
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
        createUpdatePathElementCommand(
          selectedElementIndex,
          selectedElement,
          nextElement,
        ),
      );
    selectionStore
      .getState()
      .selectElement(selectedElementIndex, projectStore.getState().project);
  };

  const handleUnlinkTarget = () => {
    if (!project || selectedElementIndex === null) {
      return;
    }

    projectStore
      .getState()
      .unlinkPathElement(project.project_id, selectedElementIndex);
    selectionStore
      .getState()
      .selectElement(selectedElementIndex, projectStore.getState().project);
  };

  const handleLinkTarget = (targetId: string) => {
    if (!project || selectedElementIndex === null) {
      return;
    }

    projectStore
      .getState()
      .linkPathElementToTarget(
        project.project_id,
        selectedElementIndex,
        targetId,
      );
    selectionStore
      .getState()
      .selectElement(selectedElementIndex, projectStore.getState().project);
  };

  const handleCreateLinkedTarget = (kind: LinkedTargetKind) => {
    if (!project || !workspace || selectedElementIndex === null) {
      return;
    }

    const position = getElementPosition(
      project.path.path_elements,
      selectedElementIndex,
    );
    if (!position) {
      return;
    }

    const displayName = nextLinkedTargetName(workspace, kind);
    projectStore.getState().createLinkedTarget({
      display_name: displayName,
      kind,
      x_meters: position.x_meters,
      y_meters: position.y_meters,
      rotation_radians:
        kind === "waypoint"
          ? (getElementHeadingRadians(
              project.path.path_elements,
              selectedElementIndex,
            ) ?? 0)
          : null,
      link: {
        pathId: project.project_id,
        elementIndex: selectedElementIndex,
      },
    });
    selectionStore
      .getState()
      .selectElement(selectedElementIndex, projectStore.getState().project);
  };

  const handleToggleSection = (key: SidebarSectionKey) => {
    setSectionState((current) => {
      const next = { ...current, [key]: !current[key] };
      writeSidebarSectionState(next);
      return next;
    });
  };

  return (
    <aside className="inspector-sidebar" aria-label="Path inspector">
      <ElementList
        project={project}
        selectedElementIndex={selectedElementIndex}
        curveToolActive={curveToolActive}
        open={sectionState.pathElements}
        onToggleSection={() => handleToggleSection("pathElements")}
        onAddElement={handleAddElement}
        onAddCurve={handleAddCurve}
        onSelectElement={handleSelectElement}
        onRemoveElement={handleRemoveElement}
        onMoveElement={handleMoveElement}
      />
      <PropertyEditor
        element={selectedElement}
        workspace={workspace}
        selectedElementIndex={selectedElementIndex}
        open={sectionState.properties}
        typeOptions={
          project && selectedElementIndex !== null
            ? getSwitchableElementTypes(project, selectedElementIndex)
            : []
        }
        fieldGeometry={fieldGeometry}
        onToggleSection={() => handleToggleSection("properties")}
        onChangeType={handleChangeElementType}
        onUpdateElement={handleUpdateElement}
        onUnlinkTarget={handleUnlinkTarget}
        onCreateLinkedTarget={handleCreateLinkedTarget}
        onLinkTarget={handleLinkTarget}
        onOpenLinkedTargetPicker={() => onOpenLinkedTargetPicker?.()}
      />
      <ConstraintEditor
        project={project}
        open={sectionState.constraints}
        onToggleSection={() => handleToggleSection("constraints")}
      />
    </aside>
  );
}

function selectionAfterMove(
  selectedElementIndex: number | null,
  fromIndex: number,
  toIndex: number,
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
  selectedElementIndex: number | null,
): number | null {
  if (selectedElementIndex === null) {
    return null;
  }

  if (selectedElementIndex > removedIndex) {
    return selectedElementIndex - 1;
  }

  return selectedElementIndex;
}

function readSidebarSectionState(): SidebarSectionState {
  if (typeof window === "undefined") {
    return defaultSidebarSectionState;
  }

  try {
    const rawValue = window.localStorage.getItem(sidebarSectionStorageKey);
    if (!rawValue) {
      return defaultSidebarSectionState;
    }

    const parsed = JSON.parse(rawValue) as Partial<SidebarSectionState>;
    return {
      pathElements:
        typeof parsed.pathElements === "boolean"
          ? parsed.pathElements
          : defaultSidebarSectionState.pathElements,
      properties:
        typeof parsed.properties === "boolean"
          ? parsed.properties
          : defaultSidebarSectionState.properties,
      constraints:
        typeof parsed.constraints === "boolean"
          ? parsed.constraints
          : defaultSidebarSectionState.constraints,
    };
  } catch {
    return defaultSidebarSectionState;
  }
}

function writeSidebarSectionState(state: SidebarSectionState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      sidebarSectionStorageKey,
      JSON.stringify(state),
    );
  } catch {
    // Local UI preferences should never block editing.
  }
}

function nextLinkedTargetName(
  workspace: ProjectWorkspaceDocument,
  kind: LinkedTargetKind,
): string {
  const base =
    kind === "waypoint" ? "Linked Waypoint" : "Linked Translation";
  const existing = new Set(
    workspace.linked_targets.map((target) => target.display_name),
  );
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  return `${base} ${workspace.linked_targets.length + 1}`;
}

import {
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import type { LinkedTargetKind } from "../../core/io/projectSchema";
import type { Project, ProjectPath } from "../../core/model/project";
import type { FieldGeometry } from "../../core/field/fieldConfig";
import type { PathElement } from "../../core/model/path";
import { canMovePathElement } from "../../core/model/projectPathEdits";
import {
  getElementHeadingRadians,
  getElementPosition,
} from "../../canvas/geometry";
import { nextLinkedTargetName } from "../../core/linkedTargets";
import { autoVelocityStore } from "../../state/autoVelocityStore";
import {
  activePathForProjectStore,
  projectStore,
} from "../../state/projectStore";
import { useStoreSelector } from "../../state/react";
import { selectionStore } from "../../state/selectionStore";
import { optimizerBeamClass, optimizerBeamTitle } from "../optimizerBeam";
import { ConstraintEditor } from "./sections/ConstraintEditor";
import { ElementList } from "./sections/ElementList";
import { PropertyEditor } from "./sections/PropertyEditor";
import {
  createConvertedElement,
  createDefaultElement,
  getInsertionIndex,
  getSwitchableElementTypes,
  type AddableElementType,
} from "./sidebarCommands";
import {
  clampInspectorWidth,
  inspectorWidthMax,
  inspectorWidthMin,
  readEditorUiPreferences,
  writeEditorUiPreferences,
} from "../app/editorCommands";
import { IconButton } from "../controls";
import {
  updateOrderedSelection,
  type OrderedSelectionGesture,
  type OrderedSelectionState,
} from "./orderedSelection";

interface SidebarProps {
  project: Project | null;
  activePath: ProjectPath | null;
  selectedElementIndex: number | null;
  fieldGeometry?: FieldGeometry;
  open?: boolean;
  activeTab: "elements" | "constraints";
  inspectorWidth: number;
  footer?: ReactNode;
  curveToolActive?: boolean;
  onClose?(): void;
  onActiveTabChange?(tab: "elements" | "constraints"): void;
  onInspectorResize?(width: number): void;
  onOpenLinkedTargetPicker?(): void;
  onDialogOpenChange?(open: boolean): void;
}

export function Sidebar({
  project,
  activePath,
  selectedElementIndex,
  fieldGeometry,
  open = false,
  activeTab,
  inspectorWidth,
  footer,
  curveToolActive = false,
  onClose,
  onActiveTabChange,
  onInspectorResize,
  onOpenLinkedTargetPicker,
  onDialogOpenChange,
}: SidebarProps) {
  const optimizerPhase = useStoreSelector(
    autoVelocityStore,
    (state) => state.phase,
  );
  const optimizerError = useStoreSelector(
    autoVelocityStore,
    (state) => state.lastError,
  );
  const selectedElement =
    activePath && selectedElementIndex !== null
      ? (activePath.path.path_elements[selectedElementIndex] ?? null)
      : null;
  const [elementSelectionState, setElementSelectionState] = useState<
    OrderedSelectionState & { pathId: string | null }
  >({
    anchorIndex: null,
    focusIndex: null,
    indexes: [],
    pathId: null,
  });
  const elementIndexes =
    activePath?.path.path_elements.map((_, index) => index) ?? [];
  const selectableElementIndexes = new Set(elementIndexes);
  const elementSelectionIsCurrent =
    elementSelectionState.pathId === (activePath?.path_id ?? null) &&
    elementSelectionState.focusIndex === selectedElementIndex;
  const selectedElementIndexes = (
    elementSelectionIsCurrent && elementSelectionState.indexes.length > 0
      ? elementSelectionState.indexes
      : selectedElementIndex !== null
        ? [selectedElementIndex]
        : []
  ).filter((index) => selectableElementIndexes.has(index));
  const selectedElements = selectedElementIndexes.flatMap((index) => {
    const element = activePath?.path.path_elements[index];
    return element ? [{ index, element }] : [];
  });

  const selectOnlyElement = (index: number | null) => {
    setElementSelectionState({
      anchorIndex: index,
      focusIndex: index,
      indexes: index === null ? [] : [index],
      pathId: activePath?.path_id ?? null,
    });
    selectionStore
      .getState()
      .selectElement(
        index,
        activePathForProjectStore(projectStore.getState())?.path ??
          activePath?.path,
      );
  };

  const handleSelectElement = (
    index: number,
    gesture: OrderedSelectionGesture,
  ) => {
    const nextSelection = updateOrderedSelection({
      orderedIndexes: elementIndexes,
      selectedIndexes: selectedElementIndexes,
      anchorIndex: elementSelectionIsCurrent
        ? elementSelectionState.anchorIndex
        : selectedElementIndex,
      targetIndex: index,
      gesture,
    });
    setElementSelectionState({
      ...nextSelection,
      pathId: activePath?.path_id ?? null,
    });
    selectionStore
      .getState()
      .selectElement(nextSelection.focusIndex, activePath?.path);
  };

  const handleAddElement = (type: AddableElementType) => {
    if (!project || !activePath) {
      return;
    }

    const insertionIndex = getInsertionIndex(
      activePath.path,
      type,
      selectedElementIndex,
    );
    const element = createDefaultElement(
      activePath.path,
      project.config,
      type,
      selectedElementIndex,
      fieldGeometry,
    );
    const result = projectStore
      .getState()
      .applyPathStructureEdit(
        { kind: "insert", index: insertionIndex, element },
        { selectedElementIndex },
      );
    if (result.status !== "applied") {
      return;
    }
    selectOnlyElement(result.consequences.selectedElementIndex);
  };

  const handleRemoveElement = (index: number) => {
    if (!activePath) {
      return;
    }

    const result = projectStore
      .getState()
      .applyPathStructureEdit(
        { kind: "remove", index },
        { selectedElementIndex },
      );
    if (result.status !== "applied") {
      return;
    }
    selectOnlyElement(result.consequences.selectedElementIndex);
  };

  const handleDuplicateElement = (index: number) => {
    if (!activePath) {
      return;
    }

    const result = projectStore
      .getState()
      .applyPathStructureEdit(
        { kind: "duplicate", index },
        { selectedElementIndex },
      );
    if (result.status !== "applied") {
      return;
    }
    selectOnlyElement(result.consequences.selectedElementIndex);
  };

  const handleMoveElement = (fromIndex: number, toIndex: number) => {
    if (
      !activePath ||
      !canMovePathElement(activePath.path, fromIndex, toIndex)
    ) {
      return;
    }

    const result = projectStore
      .getState()
      .applyPathStructureEdit(
        { kind: "reorder", fromIndex, toIndex },
        { selectedElementIndex },
      );
    if (result.status !== "applied") {
      return;
    }
    selectOnlyElement(result.consequences.selectedElementIndex);
  };

  const handleChangeElementType = (type: AddableElementType) => {
    if (
      !project ||
      !activePath ||
      selectedElementIndex === null ||
      !selectedElement
    ) {
      return;
    }

    const convertedElement = createConvertedElement(
      activePath.path,
      project.config,
      selectedElementIndex,
      type,
      fieldGeometry,
    );
    if (!convertedElement) {
      return;
    }

    const result = projectStore.getState().applyPathStructureEdit(
      {
        kind: "convert",
        index: selectedElementIndex,
        element: convertedElement,
      },
      { selectedElementIndex },
    );
    if (result.status !== "applied") {
      return;
    }
    selectionStore
      .getState()
      .selectElement(
        result.consequences.selectedElementIndex,
        activePathForProjectStore(projectStore.getState())?.path,
      );
  };

  const handleUpdateElement = (nextElement: PathElement) => {
    if (!activePath || selectedElementIndex === null || !selectedElement) {
      return;
    }

    projectStore.getState().applyPathElementEdit({
      kind: "replace",
      index: selectedElementIndex,
      element: nextElement,
    });
    selectionStore
      .getState()
      .selectElement(
        selectedElementIndex,
        activePathForProjectStore(projectStore.getState())?.path,
      );
  };

  const handleUpdateSelectedElements = (
    replacements: readonly { index: number; element: PathElement }[],
  ) => {
    if (!activePath || replacements.length < 2) {
      return;
    }

    projectStore.getState().applyPathElementEdit({
      kind: "replace-many",
      replacements,
    });
    selectionStore
      .getState()
      .selectElement(
        elementSelectionState.focusIndex,
        activePathForProjectStore(projectStore.getState())?.path,
      );
  };

  const handleUnlinkTarget = () => {
    if (!activePath || selectedElementIndex === null) {
      return;
    }

    projectStore
      .getState()
      .unlinkPathElement(activePath.path_id, selectedElementIndex);
    selectionStore
      .getState()
      .selectElement(
        selectedElementIndex,
        activePathForProjectStore(projectStore.getState())?.path,
      );
  };

  const handleCreateLinkedTarget = (
    kind: LinkedTargetKind,
    displayName: string,
  ) => {
    if (!project || !activePath || selectedElementIndex === null) {
      return;
    }

    const position = getElementPosition(
      activePath.path.path_elements,
      selectedElementIndex,
    );
    if (!position) {
      return;
    }

    projectStore.getState().createLinkedTarget({
      display_name: displayName.trim() || nextLinkedTargetName(project, kind),
      kind,
      x_meters: position.x_meters,
      y_meters: position.y_meters,
      rotation_radians:
        kind === "waypoint"
          ? (getElementHeadingRadians(
              activePath.path.path_elements,
              selectedElementIndex,
            ) ?? 0)
          : null,
      link: {
        pathId: activePath.path_id,
        elementIndex: selectedElementIndex,
      },
    });
    selectionStore
      .getState()
      .selectElement(
        selectedElementIndex,
        activePathForProjectStore(projectStore.getState())?.path,
      );
  };

  const handleSelectTab = (tab: "elements" | "constraints") => {
    onActiveTabChange?.(tab);
    writeEditorUiPreferences({
      ...readEditorUiPreferences(),
      inspectorTab: tab,
    });
  };

  const commitInspectorWidth = (width: number) => {
    const nextWidth = clampInspectorWidth(width);
    onInspectorResize?.(nextWidth);
    writeEditorUiPreferences({
      ...readEditorUiPreferences(),
      inspectorWidth: nextWidth,
    });
  };

  const handleResizeStart = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || window.innerWidth <= 1120) {
      return;
    }

    const startX = event.clientX;
    const startWidth = inspectorWidth;
    event.preventDefault();
    document.body.classList.add("is-resizing-inspector");

    const widthForClientX = (clientX: number) =>
      clampInspectorWidth(startWidth + startX - clientX);
    const handleMove = (moveEvent: globalThis.MouseEvent) => {
      onInspectorResize?.(widthForClientX(moveEvent.clientX));
      moveEvent.preventDefault();
    };
    const handleUp = (upEvent: globalThis.MouseEvent) => {
      commitInspectorWidth(widthForClientX(upEvent.clientX));
      document.body.classList.remove("is-resizing-inspector");
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 40 : 16;
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextWidth = inspectorWidth + step;
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextWidth = inspectorWidth - step;
    } else if (event.key === "Home") {
      nextWidth = inspectorWidthMin;
    } else if (event.key === "End") {
      nextWidth = inspectorWidthMax;
    }

    if (nextWidth !== null) {
      event.preventDefault();
      commitInspectorWidth(nextWidth);
    }
  };

  return (
    <aside
      className={`inspector-sidebar ${open ? "is-open" : ""}`}
      data-tour="inspector-panel"
      aria-label="Path inspector"
    >
      <div
        className="inspector-resize-handle"
        role="separator"
        aria-label="Resize inspector"
        aria-orientation="vertical"
        aria-valuemin={inspectorWidthMin}
        aria-valuemax={inspectorWidthMax}
        aria-valuenow={inspectorWidth}
        tabIndex={0}
        title="Drag to resize inspector"
        onMouseDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
      />
      <header className="inspector-sidebar__header">
        <div className="inspector-tabs" role="tablist" aria-label="Inspector">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "elements"}
            className={activeTab === "elements" ? "is-active" : ""}
            onClick={() => handleSelectTab("elements")}
          >
            Elements
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "constraints"}
            data-tour="inspector-constraints"
            className={[
              activeTab === "constraints" ? "is-active" : "",
              optimizerBeamClass(optimizerPhase, optimizerError),
            ]
              .filter(Boolean)
              .join(" ")}
            title={optimizerBeamTitle(optimizerPhase, optimizerError)}
            onClick={() => handleSelectTab("constraints")}
          >
            Constraints
          </button>
        </div>
        <IconButton
          className="inspector-sidebar__close"
          aria-label="Close inspector"
          title="Close inspector"
          onClick={onClose}
        >
          <X aria-hidden="true" size={16} />
        </IconButton>
      </header>

      {activeTab === "elements" ? (
        <div
          className="inspector-sidebar__panel inspector-sidebar__panel--elements"
          role="tabpanel"
        >
          <ElementList
            path={activePath?.path ?? null}
            selectedElementIndex={selectedElementIndex}
            selectedElementIndexes={selectedElementIndexes}
            curveToolActive={curveToolActive}
            open
            onAddElement={handleAddElement}
            onSelectElement={handleSelectElement}
            onRemoveElement={handleRemoveElement}
            onDuplicateElement={handleDuplicateElement}
            onMoveElement={handleMoveElement}
          />
          <PropertyEditor
            element={selectedElement}
            selectedElements={selectedElements}
            project={project}
            selectedElementIndex={selectedElementIndex}
            open
            typeOptions={
              activePath && selectedElementIndex !== null
                ? getSwitchableElementTypes(
                    activePath.path,
                    selectedElementIndex,
                  )
                : []
            }
            fieldGeometry={fieldGeometry}
            onChangeType={handleChangeElementType}
            onUpdateElement={handleUpdateElement}
            onUpdateSelectedElements={handleUpdateSelectedElements}
            onUnlinkTarget={handleUnlinkTarget}
            onCreateLinkedTarget={handleCreateLinkedTarget}
            onOpenLinkedTargetPicker={() => onOpenLinkedTargetPicker?.()}
          />
        </div>
      ) : (
        <div className="inspector-sidebar__panel" role="tabpanel">
          <ConstraintEditor
            path={activePath?.path ?? null}
            config={project?.config ?? null}
            open
            onDialogOpenChange={onDialogOpenChange}
          />
        </div>
      )}
      {footer ? (
        <div className="inspector-sidebar__status">{footer}</div>
      ) : null}
    </aside>
  );
}

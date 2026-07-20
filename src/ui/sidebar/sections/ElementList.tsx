import { useEffect, useRef, useState, type MouseEvent } from "react";
import { getElementPosition } from "../../../canvas/geometry";
import type { ProjectDocument } from "../../../core/io/projectSchema";
import { formatPointMeters } from "../../../canvas/modelSync";
import { CurveIcon, ElementIcon, GripIcon, RemoveIcon } from "../../icons";
import { AddElementMenu } from "../../controls/AddElementMenu";
import { SidebarIconButton } from "../../controls";
import { SidebarSection } from "../SidebarSection";
import {
  canMovePathElement,
  elementTypeLabel,
  elementTypeValue,
  getAddableElementTypes,
  type AddableElementType,
} from "../sidebarCommands";

interface ElementListProps {
  project: ProjectDocument | null;
  selectedElementIndex: number | null;
  curveToolActive?: boolean;
  open: boolean;
  onAddElement(type: AddableElementType): void;
  onAddCurve(): void;
  onSelectElement(index: number): void;
  onRemoveElement(index: number): void;
  onMoveElement(fromIndex: number, toIndex: number): void;
  onToggleSection?(): void;
}

export function ElementList({
  project,
  selectedElementIndex,
  curveToolActive = false,
  open,
  onAddElement,
  onAddCurve,
  onSelectElement,
  onRemoveElement,
  onMoveElement,
  onToggleSection,
}: ElementListProps) {
  const elements = project?.path.path_elements ?? [];
  const listRef = useRef<HTMLOListElement | null>(null);
  const selectedRowRef = useRef<HTMLLIElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const suppressClickRef = useRef(false);
  const addableTypes = project ? getAddableElementTypes(project) : [];

  useEffect(() => {
    if (!open) {
      return;
    }

    const list = listRef.current;
    const selectedRow = selectedRowRef.current;

    if (!list || !selectedRow) {
      return;
    }

    scrollChildIntoContainerView(list, selectedRow);
  }, [elements.length, open, selectedElementIndex]);

  const handleMouseDown = (
    event: MouseEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (!project || event.button !== 0) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let currentDropIndex: number | null = null;

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const movement = Math.hypot(
        moveEvent.clientX - startX,
        moveEvent.clientY - startY,
      );
      if (!active && movement < 5) {
        return;
      }

      if (!active) {
        active = true;
        suppressClickRef.current = true;
        setDragIndex(index);
      }

      const nextDropIndex = getDropIndexFromPoint(
        moveEvent.clientX,
        moveEvent.clientY,
      );
      currentDropIndex =
        nextDropIndex !== null &&
        canMovePathElement(project, index, nextDropIndex)
          ? nextDropIndex
          : null;
      setDragOverIndex(currentDropIndex);
    };

    const handleMouseUp = (upEvent: globalThis.MouseEvent) => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      setDragIndex(null);
      setDragOverIndex(null);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);

      if (
        !active ||
        currentDropIndex === null ||
        !canMovePathElement(project, index, currentDropIndex)
      ) {
        return;
      }

      upEvent.preventDefault();
      onMoveElement(index, currentDropIndex);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <SidebarSection
      actions={
        <>
          <SidebarIconButton
            className="sidebar-icon-button--add"
            disabled={!project || curveToolActive}
            aria-label="Add curve"
            title="Add curve"
            onClick={onAddCurve}
          >
            <CurveIcon />
          </SidebarIconButton>
          <AddElementMenu
            disabled={!project || curveToolActive}
            options={addableTypes}
            onAdd={onAddElement}
          />
        </>
      }
      className="path-elements-section"
      open={open}
      sectionId="path-elements"
      title="Path Elements"
      onToggle={onToggleSection}
    >
      {elements.length > 0 ? (
        <ol
          ref={listRef}
          className="path-element-list"
          aria-label="Path elements"
        >
          {elements.map((element, index) => {
            const selected = selectedElementIndex === index;
            const position = getElementPosition(elements, index);
            const type = elementTypeValue(element);

            return (
              <li
                key={`${element.type}-${index}`}
                ref={selected ? selectedRowRef : undefined}
                className={[
                  selected ? "is-selected" : "",
                  dragIndex === index ? "is-dragging" : "",
                  dragOverIndex === index ? "is-drop-target" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-testid={`path-element-item-${index}`}
                data-path-element-index={index}
              >
                <button
                  type="button"
                  className="path-element-row"
                  data-testid={`path-element-row-${index}`}
                  aria-keyshortcuts="ArrowUp ArrowDown Alt+ArrowUp Alt+ArrowDown Delete Backspace"
                  aria-pressed={selected}
                  onMouseDown={(event) => handleMouseDown(event, index)}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    onSelectElement(index);
                  }}
                >
                  <span className="drag-grip" aria-hidden="true">
                    <GripIcon />
                  </span>
                  <span
                    aria-hidden="true"
                    className={`element-type-mark type-${type}`}
                  >
                    <ElementIcon type={type} />
                  </span>
                  <span className="path-element-row__label">
                    {index + 1}. {elementTypeLabel(element)}
                  </span>
                  <span className="path-element-row__meta">
                    {formatPointMeters(position)}
                  </span>
                </button>
                <button
                  type="button"
                  className="remove-element-button"
                  aria-label={`Remove ${elementTypeLabel(element)} ${index + 1}`}
                  onClick={() => onRemoveElement(index)}
                >
                  <RemoveIcon />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="sidebar-empty-state">No path elements</div>
      )}
    </SidebarSection>
  );
}

function getDropIndexFromPoint(
  _clientX: number,
  clientY: number,
): number | null {
  const target = Array.from(
    document.querySelectorAll<HTMLElement>("[data-path-element-index]"),
  ).find((element) => {
    const rect = element.getBoundingClientRect();
    return clientY >= rect.top && clientY <= rect.bottom;
  });
  const rawIndex = target?.dataset.pathElementIndex;
  const index = Number(rawIndex);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function scrollChildIntoContainerView(
  container: HTMLElement,
  child: HTMLElement,
): void {
  const containerRect = container.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const childTop = childRect.top - containerRect.top + container.scrollTop;
  const childBottom = childTop + childRect.height;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;

  if (childTop < viewTop) {
    container.scrollTop = Math.max(0, childTop);
  } else if (childBottom > viewBottom) {
    container.scrollTop = Math.max(0, childBottom - container.clientHeight);
  }
}

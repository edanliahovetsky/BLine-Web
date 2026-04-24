import { getElementPosition } from "../../../canvas/geometry";
import type { ProjectDocument } from "../../../core/io/projectSchema";
import type { PathElement } from "../../../core/model/path";
import { formatPointMeters } from "../../../canvas/modelSync";
import { AddElementMenu } from "../../controls/AddElementMenu";
import {
  elementTypeLabel,
  elementTypeValue,
  type AddableElementType
} from "../sidebarCommands";

interface ElementListProps {
  project: ProjectDocument | null;
  selectedElementIndex: number | null;
  onAddElement(type: AddableElementType): void;
  onSelectElement(index: number): void;
  onRemoveElement(index: number): void;
}

export function ElementList({
  project,
  selectedElementIndex,
  onAddElement,
  onSelectElement,
  onRemoveElement
}: ElementListProps) {
  const elements = project?.path.path_elements ?? [];

  return (
    <section className="inspector-section path-elements-section">
      <header className="inspector-section__header">
        <h2>Path Elements</h2>
        <AddElementMenu disabled={!project} onAdd={onAddElement} />
      </header>

      {elements.length > 0 ? (
        <ol className="path-element-list" aria-label="Path elements">
          {elements.map((element, index) => {
            const selected = selectedElementIndex === index;
            const position = getElementPosition(elements, index);

            return (
              <li key={`${element.type}-${index}`} className={selected ? "is-selected" : ""}>
                <button
                  type="button"
                  className="path-element-row"
                  data-testid={`path-element-row-${index}`}
                  aria-pressed={selected}
                  onClick={() => onSelectElement(index)}
                >
                  <span className="drag-grip" aria-hidden="true">
                    ::
                  </span>
                  <ElementTypeMark element={element} />
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
                  -
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="sidebar-empty-state">No path elements</div>
      )}
    </section>
  );
}

function ElementTypeMark({ element }: { element: PathElement }) {
  const type = elementTypeValue(element);
  return (
    <span aria-hidden="true" className={`element-type-mark type-${type}`}>
      {typeLabelInitial(type)}
    </span>
  );
}

function typeLabelInitial(type: AddableElementType): string {
  if (type === "event_trigger") {
    return "E";
  }

  return type.slice(0, 1).toUpperCase();
}

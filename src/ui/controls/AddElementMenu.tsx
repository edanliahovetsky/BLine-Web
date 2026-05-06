import type { AddableElementType } from "../sidebar/sidebarCommands";
import { ElementIcon, PlusIcon } from "../icons";

interface AddElementMenuProps {
  disabled?: boolean;
  options: readonly AddableElementType[];
  onAdd(type: AddableElementType): void;
}

const addOptions: Array<{ type: AddableElementType; label: string }> = [
  { type: "waypoint", label: "Waypoint" },
  { type: "translation", label: "Translation" },
  { type: "rotation", label: "Rotation" },
  { type: "event_trigger", label: "Event Trigger" },
];

export function AddElementMenu({
  disabled = false,
  options,
  onAdd,
}: AddElementMenuProps) {
  const visibleOptions = addOptions.filter((option) =>
    options.includes(option.type),
  );

  return (
    <details className="add-element-menu">
      <summary
        aria-disabled={disabled || visibleOptions.length === 0}
        className={
          disabled || visibleOptions.length === 0 ? "is-disabled" : undefined
        }
        role="button"
      >
        <span
          className="sidebar-add-icon"
          data-testid="add-element-icon"
          aria-hidden="true"
        >
          <PlusIcon size={17} />
        </span>
        <span>Add element</span>
      </summary>
      {!disabled && visibleOptions.length > 0 ? (
        <div className="add-element-menu__panel" role="menu">
          {visibleOptions.map((option) => (
            <button
              key={option.type}
              type="button"
              role="menuitem"
              onClick={(event) => {
                onAdd(option.type);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span
                aria-hidden="true"
                className={`element-type-mark type-${option.type}`}
              >
                <ElementIcon type={option.type} />
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </details>
  );
}

import type { AddableElementType } from "../sidebar/sidebarCommands";

interface AddElementMenuProps {
  disabled?: boolean;
  onAdd(type: AddableElementType): void;
}

const addOptions: Array<{ type: AddableElementType; label: string; shortLabel: string }> = [
  { type: "waypoint", label: "Waypoint", shortLabel: "W" },
  { type: "translation", label: "Translation", shortLabel: "T" },
  { type: "rotation", label: "Rotation", shortLabel: "R" },
  { type: "event_trigger", label: "Event Trigger", shortLabel: "E" }
];

export function AddElementMenu({ disabled = false, onAdd }: AddElementMenuProps) {
  return (
    <details className="add-element-menu">
      <summary
        aria-disabled={disabled}
        className={disabled ? "is-disabled" : undefined}
        role="button"
      >
        <span aria-hidden="true" className="icon-button-symbol">
          +
        </span>
        <span>Add element</span>
      </summary>
      {!disabled ? (
        <div className="add-element-menu__panel" role="menu">
          {addOptions.map((option) => (
            <button
              key={option.type}
              type="button"
              role="menuitem"
              onClick={(event) => {
                onAdd(option.type);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span aria-hidden="true" className={`element-type-mark type-${option.type}`}>
                {option.shortLabel}
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </details>
  );
}

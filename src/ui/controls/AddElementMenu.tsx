import { createPortal } from "react-dom";
import type { AddableElementType } from "../sidebar/sidebarCommands";
import { ElementIcon, PlusIcon } from "../icons";
import { useFloatingMenu } from "./useFloatingMenu";

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
  const {
    open: menuOpen,
    setOpen: setMenuOpen,
    triggerRef: menuTriggerRef,
    panelRef: menuPanelRef,
    position: menuPosition,
  } = useFloatingMenu(220, true, "center");
  const visibleOptions = addOptions.filter((option) =>
    options.includes(option.type),
  );

  return (
    <details className="add-element-menu" open={menuOpen}>
      <summary
        ref={menuTriggerRef}
        aria-label="Add element"
        aria-expanded={menuOpen}
        aria-disabled={disabled || visibleOptions.length === 0}
        className={
          disabled || visibleOptions.length === 0
            ? "add-element-button is-disabled"
            : "add-element-button"
        }
        role="button"
        title="Add element"
        onClick={(event) => {
          event.preventDefault();
          if (!disabled && visibleOptions.length > 0)
            setMenuOpen((open) => !open);
        }}
      >
        <span
          className="sidebar-add-icon"
          data-testid="add-element-icon"
          aria-hidden="true"
        >
          <PlusIcon size={17} />
        </span>
      </summary>
      {menuOpen && !disabled && visibleOptions.length > 0
        ? createPortal(
            <div
              ref={menuPanelRef}
              className="add-element-menu__panel"
              data-tour="element-add-menu"
              role="menu"
              aria-label="Add element"
              style={menuPosition}
            >
              {visibleOptions.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onAdd(option.type);
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
            </div>,
            document.body,
          )
        : null}
    </details>
  );
}

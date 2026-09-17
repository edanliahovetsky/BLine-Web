import { createPortal } from "react-dom";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useFloatingMenu } from "./useFloatingMenu";

export function EventKeyMenu({
  name,
  onRename,
  onDuplicate,
  onDelete,
  disabled = false,
  renameLabel = "Rename All",
  deleteLabel = "Delete",
}: {
  name: string;
  disabled?: boolean;
  renameLabel?: string;
  deleteLabel?: string;
  onRename(): void;
  onDuplicate(): void;
  onDelete(): void;
}) {
  const { open, setOpen, triggerRef, panelRef, position } =
    useFloatingMenu<HTMLButtonElement>(190);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <>
      <button
        ref={triggerRef}
        disabled={disabled}
        type="button"
        className="fc-more"
        aria-label={`Event trigger actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={17} />
      </button>
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            data-tour="event-key-menu"
            className="fc-menu"
            style={position}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                triggerRef.current?.focus();
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const items = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button",
                  ),
                ];
                const current = items.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                items[
                  (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                    items.length
                ]?.focus();
              }
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onRename)}
            >
              <Pencil size={14} />
              {renameLabel}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => choose(onDuplicate)}
            >
              <Copy size={14} />
              Duplicate
            </button>
            <button
              type="button"
              role="menuitem"
              className="fc-delete"
              onClick={() => choose(onDelete)}
            >
              <Trash2 size={14} />
              {deleteLabel}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

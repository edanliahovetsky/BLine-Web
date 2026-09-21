import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "../icons";
import type { SelectControlOption } from "./Controls";
import { useFloatingMenu } from "./useFloatingMenu";

export function DropdownSelectControl<T extends string>({
  ariaLabel,
  menuTourTarget,
  disabled = false,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  menuTourTarget?: string;
  disabled?: boolean;
  options: readonly SelectControlOption<T>[];
  value: T;
  onChange(value: T): void;
}) {
  const listboxId = useId();
  const { open, setOpen, triggerRef, panelRef, position } =
    useFloatingMenu<HTMLButtonElement>("trigger", false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const enabledIndices = options.flatMap((option, index) =>
    option.disabled ? [] : [index],
  );
  const openMenu = (index = selectedIndex) => {
    setActiveIndex(enabledIndices.includes(index) ? index : enabledIndices[0]);
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (disabled || !option || option.disabled) return;
    setOpen(false);
    onChange(option.value);
    triggerRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (open) {
      panelRef.current
        ?.querySelector('[data-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [open, activeIndex, panelRef]);

  return (
    <div className={`dropdown-select-control${open ? " is-open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="dropdown-select-control__button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        disabled={disabled || enabledIndices.length === 0}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          if (event.key === "Tab") {
            if (open) choose(activeIndex);
            return;
          }
          if (event.key === "Escape") {
            if (!open) return;
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            if (open) choose(activeIndex);
            else openMenu();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            if (!open) openMenu();
            else {
              const direction = event.key === "ArrowDown" ? 1 : -1;
              const next =
                (enabledIndices.indexOf(activeIndex) +
                  direction +
                  enabledIndices.length) %
                enabledIndices.length;
              setActiveIndex(enabledIndices[next]);
            }
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            event.stopPropagation();
            openMenu(
              event.key === "Home" ? enabledIndices[0] : enabledIndices.at(-1),
            );
          } else if (event.key.length === 1) {
            const start = open ? activeIndex : selectedIndex;
            const match = Array.from(
              { length: options.length },
              (_, offset) => (start + offset + 1) % options.length,
            ).find(
              (index) =>
                !options[index].disabled &&
                options[index].label
                  .toLowerCase()
                  .startsWith(event.key.toLowerCase()),
            );
            if (match !== undefined) {
              event.preventDefault();
              event.stopPropagation();
              openMenu(match);
            }
          }
        }}
      >
        <span className="dropdown-select-control__value">
          {options[selectedIndex]?.label ?? ""}
        </span>
        <span className="dropdown-select-control__indicator" aria-hidden="true">
          <ChevronDownIcon size={12} />
        </span>
      </button>
      {open && !disabled
        ? createPortal(
            <div
              ref={panelRef}
              id={listboxId}
              role="listbox"
              data-tour={menuTourTarget}
              aria-label={`${ariaLabel} options`}
              className="dropdown-select-control__menu"
              style={position}
            >
              {options.map((option, index) => (
                <button
                  id={`${listboxId}-${index}`}
                  key={option.value}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  disabled={option.disabled}
                  aria-selected={option.value === value}
                  data-active={index === activeIndex}
                  className={`dropdown-select-control__option${option.value === value ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() =>
                    !option.disabled && setActiveIndex(index)
                  }
                  onClick={() => choose(index)}
                >
                  {option.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

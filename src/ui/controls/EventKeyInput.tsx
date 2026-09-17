import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFloatingMenu } from "./useFloatingMenu";
import "./EventKeyInput.css";

/** Editable combobox: typing remains freeform; Tab accepts the suggested suffix. */
export function EventKeyInput({
  value,
  keys,
  onChange,
  onCommit,
  placeholder = "No action",
  ariaLabel = "Lib Key",
  disabled = false,
  autoFocus = false,
}: {
  value: string;
  keys: readonly string[];
  onChange(value: string): void;
  onCommit(value: string): void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const originalKey = useRef(value);
  const { open, setOpen, triggerRef, panelRef, position } =
    useFloatingMenu<HTMLInputElement>("trigger", false);
  const [active, setActive] = useState(0);
  const [availableKeys, setAvailableKeys] = useState(keys);
  const matches = availableKeys.filter((key) =>
    key.toLocaleLowerCase().startsWith(value.toLocaleLowerCase()),
  );
  const index = Math.min(active, Math.max(0, matches.length - 1));
  const suggestion = matches[index];
  const expanded = !disabled && open && matches.length > 0;
  const choose = (key: string) => {
    onChange(key);
    onCommit(originalKey.current);
    onCommit(key);
    originalKey.current = key;
    setOpen(false);
  };
  useEffect(() => {
    if (expanded)
      panelRef.current
        ?.querySelector('[data-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [expanded, index, panelRef]);
  return (
    <div className="event-key-input">
      {expanded && value && suggestion?.startsWith(value) && (
        <span className="event-key-input__completion" aria-hidden="true">
          <span>{value}</span>
          {suggestion.slice(value.length)}
        </span>
      )}
      <input
        type="text"
        ref={triggerRef}
        aria-label={ariaLabel}
        disabled={disabled}
        autoFocus={autoFocus}
        role="combobox"
        aria-autocomplete="both"
        aria-description="Tab completes a suggestion. Use arrow keys to choose a registered trigger."
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        aria-activedescendant={expanded ? `${id}-${index}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onFocus={() => {
          originalKey.current = value;
          setAvailableKeys(keys);
          setActive(0);
          setOpen(true);
        }}
        onChange={(event) => {
          onChange(event.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={(event) => {
          onCommit(originalKey.current);
          onCommit(event.currentTarget.value);
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (
            event.nativeEvent.isComposing ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          )
            return;
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setActive(
              open
                ? (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    matches.length) %
                    Math.max(1, matches.length)
                : 0,
            );
            setOpen(true);
          } else if (
            ((event.key === "Tab" &&
              !event.shiftKey &&
              value.length > 0 &&
              suggestion !== value) ||
              event.key === "Enter") &&
            expanded &&
            suggestion
          ) {
            event.preventDefault();
            event.stopPropagation();
            choose(suggestion);
          } else if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            onCommit(originalKey.current);
            onCommit(value);
            originalKey.current = value;
            setAvailableKeys((current) => [
              ...new Set([...current, value].filter(Boolean)),
            ]);
            setOpen(false);
          }
        }}
      />
      {expanded &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="listbox"
            aria-label="Registered event triggers"
            data-tour="event-key-options"
            className="dropdown-select-control__menu event-key-options"
            style={position}
          >
            {matches.map((key, i) => (
              <button
                key={key}
                id={`${id}-${i}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === index}
                data-active={i === index}
                className={`dropdown-select-control__option${i === index ? " is-active" : ""}`}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(i)}
                onClick={() => choose(key)}
              >
                {key}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

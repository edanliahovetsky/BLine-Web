import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { eventKeyCaseVariant } from "../../core/model/eventKeys";
import { useFloatingMenu } from "./useFloatingMenu";
import "./EventKeyInput.css";

// Eight 30px options, seven 2px gaps, and the menu's padding and border.
const eventKeyMenuHeightLimit = 8 * 30 + 7 * 2 + 12;

type EventKeyOption =
  | { kind: "key"; key: string }
  | { kind: "register"; key: string };

/**
 * Editable combobox for a Lib Key. Typing stays freeform; registering a new
 * key is an explicit row, and Tab completes or cycles through matches.
 *
 * `keys` lists the project's other keys: the parent leaves out this field's
 * own text so a typo is never offered back as an existing key.
 */
export function EventKeyInput({
  value,
  keys,
  usage,
  onChange,
  onRegister,
  placeholder = "No action",
  ariaLabel = "Lib Key",
  inputId,
  disabled = false,
  autoFocus = false,
}: {
  value: string;
  keys: readonly string[];
  /** Event elements using each key, shown beside its suggestion. */
  usage?(key: string): number;
  onChange(value: string): void;
  onRegister(key: string): void;
  placeholder?: string;
  ariaLabel?: string;
  inputId?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const { open, setOpen, triggerRef, panelRef, position } =
    useFloatingMenu<HTMLInputElement>(
      "trigger",
      false,
      "start",
      eventKeyMenuHeightLimit,
    );
  const [active, setActive] = useState(0);
  // While Tab cycles, the list stays filtered by what was typed before it.
  const [cyclePrefix, setCyclePrefix] = useState<string | null>(null);
  const typed = value.trim();
  const prefix = (cyclePrefix ?? value).trim().toLocaleLowerCase();
  const matches = keys.filter((key) =>
    key.toLocaleLowerCase().startsWith(prefix),
  );
  const caseVariant = eventKeyCaseVariant(typed, keys);
  const options: EventKeyOption[] = [
    ...matches.map((key) => ({ kind: "key" as const, key })),
    ...(typed && !keys.includes(typed) && !caseVariant
      ? [{ kind: "register" as const, key: typed }]
      : []),
  ];
  const index = Math.min(active, Math.max(0, options.length - 1));
  const activeOption = options[index];
  const expanded = !disabled && open;
  const close = () => {
    setOpen(false);
    setCyclePrefix(null);
  };
  const choose = (option: EventKeyOption) => {
    onChange(option.key);
    if (option.kind === "register") onRegister(option.key);
    close();
  };
  const show = () => {
    setCyclePrefix(null);
    setActive(Math.max(0, matches.indexOf(value)));
    setOpen(true);
  };
  useEffect(() => {
    if (expanded)
      panelRef.current
        ?.querySelector('[data-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [expanded, index, panelRef]);
  const completion =
    expanded &&
    value &&
    cyclePrefix === null &&
    activeOption?.kind === "key" &&
    activeOption.key.startsWith(value)
      ? activeOption.key.slice(value.length)
      : "";
  return (
    <div className="event-key-input">
      <div className="event-key-input__field">
        {completion && (
          <span className="event-key-input__completion" aria-hidden="true">
            <span>{value}</span>
            {completion}
          </span>
        )}
        <input
          type="text"
          id={inputId}
          ref={triggerRef}
          aria-label={ariaLabel}
          disabled={disabled}
          autoFocus={autoFocus}
          role="combobox"
          aria-autocomplete="both"
          aria-description="Tab completes a key, or cycles when several match. Use arrow keys to choose a key or register a new one."
          aria-describedby={caseVariant ? hintId : undefined}
          aria-invalid={caseVariant ? true : undefined}
          aria-expanded={expanded}
          aria-controls={expanded ? id : undefined}
          aria-activedescendant={
            expanded && activeOption ? `${id}-${index}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onFocus={show}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            setCyclePrefix(null);
            setActive(0);
            setOpen(true);
          }}
          onBlur={close}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey
            )
              return;
            const handled = () => {
              event.preventDefault();
              event.stopPropagation();
            };
            if (event.key === "Escape" && expanded) {
              handled();
              close();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              handled();
              setActive(
                expanded
                  ? (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      options.length) %
                      Math.max(1, options.length)
                  : 0,
              );
              setOpen(true);
            } else if (event.key === "Enter") {
              handled();
              if (expanded && activeOption) choose(activeOption);
              else close();
            } else if (event.key === "Tab") {
              const cycling = cyclePrefix !== null;
              // Leave the field normally unless there is a key to complete.
              if (
                !expanded ||
                matches.length === 0 ||
                (!cycling && (event.shiftKey || !value || keys.includes(value)))
              )
                return;
              handled();
              if (matches.length === 1) {
                choose({ kind: "key", key: matches[0] });
                return;
              }
              const current = matches.indexOf(value);
              const next = cycling
                ? (current + (event.shiftKey ? -1 : 1) + matches.length) %
                  matches.length
                : 0;
              setCyclePrefix(cyclePrefix ?? value);
              setActive(next);
              onChange(matches[next]);
            }
          }}
        />
      </div>
      {caseVariant && (
        <p className="event-key-input__hint" id={hintId}>
          Did you mean <code>{caseVariant}</code>?{" "}
          <button
            type="button"
            disabled={disabled}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => choose({ kind: "key", key: caseVariant })}
          >
            Use it
          </button>
        </p>
      )}
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
            {options.length === 0 && (
              <div className="event-key-options__empty" role="presentation">
                No keys yet — type a name and press Enter
              </div>
            )}
            {options.map((option, i) => (
              <button
                key={`${option.kind}:${option.key}`}
                id={`${id}-${i}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === index}
                data-active={i === index}
                className={`dropdown-select-control__option event-key-options__option${i === index ? " is-active" : ""}`}
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(i)}
                onClick={() => choose(option)}
              >
                {option.kind === "key" ? (
                  <>
                    <span className="event-key-options__key">{option.key}</span>
                    {usage && (
                      <span className="event-key-options__usage">
                        {usage(option.key)
                          ? `used ${usage(option.key)}×`
                          : "unused"}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="event-key-options__register">
                    Register new key <code>{option.key}</code>
                    <span aria-hidden="true"> ↵</span>
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

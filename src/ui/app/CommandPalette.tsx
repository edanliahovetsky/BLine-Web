import { useEffect, useMemo, useRef, useState } from "react";
import { Command, Search } from "lucide-react";
import type { EditorCommand } from "./editorCommands";
import {
  commandMatchesQuery,
  executeCommand,
  formatShortcut,
} from "./editorCommands";
import { CloseButton } from "../controls";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: readonly EditorCommand[];
  onClose(): void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(
    () => commands.filter((command) => commandMatchesQuery(command, query)),
    [commands, query],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runCommand = (command: EditorCommand) => {
    if (command.disabled) {
      return;
    }
    onClose();
    executeCommand(command);
  };

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) =>
              results.length === 0 ? 0 : (current + 1) % results.length,
            );
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) =>
              results.length === 0
                ? 0
                : (current - 1 + results.length) % results.length,
            );
            return;
          }
          if (event.key === "Enter") {
            const command = results[activeIndex];
            if (command && !command.disabled) {
              event.preventDefault();
              runCommand(command);
            }
          }
        }}
      >
        <header className="command-palette__header">
          <Search aria-hidden="true" size={18} />
          <input
            ref={inputRef}
            role="searchbox"
            aria-label="Search commands and paths"
            placeholder="Search commands and paths…"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(0);
            }}
          />
          <CloseButton
            ariaLabel="Close command palette"
            size="compact"
            onClick={onClose}
          />
        </header>
        <div className="command-palette__results" role="listbox">
          {results.length > 0 ? (
            results.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={index === activeIndex ? "is-active" : ""}
                role="option"
                aria-selected={index === activeIndex}
                disabled={command.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runCommand(command)}
              >
                <span className="command-palette__result-icon">
                  <Command aria-hidden="true" size={16} />
                </span>
                <span className="command-palette__result-copy">
                  <strong>{command.label}</strong>
                  <small>{command.category}</small>
                </span>
                {command.shortcut ? (
                  <kbd>{formatShortcut(command.shortcut)}</kbd>
                ) : null}
              </button>
            ))
          ) : (
            <div className="command-palette__empty">
              No matching commands or paths.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function ShortcutHelpDialog({
  commands,
  onClose,
}: {
  commands: readonly EditorCommand[];
  onClose(): void;
}) {
  const dialogRef = useDialogFocusTrap<HTMLElement>();
  const grouped = useMemo(() => {
    const groups = new Map<string, EditorCommand[]>();
    for (const command of commands) {
      if (!command.shortcut) {
        continue;
      }
      groups.set(command.category, [
        ...(groups.get(command.category) ?? []),
        command,
      ]);
    }
    return [...groups.entries()];
  }, [commands]);

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="shortcut-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header className="config-dialog__header">
          <div>
            <strong>Keyboard shortcuts</strong>
            <span>Everything important stays within reach.</span>
          </div>
          <CloseButton ariaLabel="Close keyboard shortcuts" onClick={onClose} />
        </header>
        <div className="shortcut-help-dialog__body">
          {grouped.map(([category, categoryCommands]) => (
            <section key={category}>
              <h3>{category}</h3>
              <dl>
                {categoryCommands.map((command) => (
                  <div key={command.id}>
                    <dt>{command.label}</dt>
                    <dd>
                      <kbd>{formatShortcut(command.shortcut)}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section>
            <h3>Path elements</h3>
            <dl>
              <div>
                <dt>Nudge element on field</dt>
                <dd>
                  <kbd>Arrows</kbd>
                </dd>
              </div>
              <div>
                <dt>Nudge farther</dt>
                <dd>
                  <kbd>Shift + Arrows</kbd>
                </dd>
              </div>
              <div>
                <dt>Previous / next element</dt>
                <dd>
                  <kbd>[ / ]</kbd>
                </dd>
              </div>
              <div>
                <dt>Reorder element</dt>
                <dd>
                  <kbd>Alt + ↑ / ↓</kbd>
                </dd>
              </div>
              <div>
                <dt>Delete element</dt>
                <dd>
                  <kbd>Delete</kbd>
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Playback</h3>
            <dl>
              <div>
                <dt>Restart simulation</dt>
                <dd>
                  <kbd>J / Home</kbd>
                </dd>
              </div>
              <div>
                <dt>Play or pause</dt>
                <dd>
                  <kbd>K / Space</kbd>
                </dd>
              </div>
              <div>
                <dt>Jump to end</dt>
                <dd>
                  <kbd>L / End</kbd>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </section>
    </div>
  );
}

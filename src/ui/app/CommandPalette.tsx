import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleHelp,
  Command,
  Eye,
  FolderOpen,
  MousePointer2,
  Pencil,
  Play,
  Route,
  Search,
  type LucideIcon,
} from "lucide-react";
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
                  <CommandCategoryIcon category={command.category} />
                </span>
                <span className="command-palette__result-copy">
                  <strong>{command.label}</strong>
                  {command.category === "Paths" ? (
                    <small>{command.category}</small>
                  ) : null}
                </span>
                {command.shortcut || command.shortcutHint ? (
                  <kbd>
                    {command.shortcut
                      ? formatShortcut(command.shortcut)
                      : command.shortcutHint}
                  </kbd>
                ) : null}
              </button>
            ))
          ) : (
            <div className="command-palette__empty">No matches.</div>
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
  // Opening from a canvas key leaves focus behind the modal; move it inside
  // so Escape and Tab reach this dialog rather than the editor.
  useEffect(() => {
    dialogRef.current?.focus();
  }, [dialogRef]);
  const grouped = useMemo(() => {
    const groups = new Map<string, EditorCommand[]>();
    for (const command of commands) {
      if (!command.shortcut && !command.shortcutHint) {
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
        tabIndex={-1}
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
                      <kbd>
                        {command.shortcut
                          ? formatShortcut(command.shortcut)
                          : command.shortcutHint}
                      </kbd>
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
            <h3>Selection</h3>
            <dl>
              <div>
                <dt>Select a range of elements or constraint values</dt>
                <dd>
                  <kbd>Shift + click</kbd>
                </dd>
              </div>
              <div>
                <dt>Toggle individual elements or constraint values</dt>
                <dd>
                  <kbd>
                    {formatShortcut({ key: "click", metaOrCtrl: true })}
                  </kbd>
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>General</h3>
            <dl>
              <div>
                <dt>Command palette</dt>
                <dd>
                  <kbd>
                    {formatShortcut({ key: "k", metaOrCtrl: true })} / F1
                  </kbd>
                </dd>
              </div>
              <div>
                <dt>Cancel tool or drag</dt>
                <dd>
                  <kbd>Esc</kbd>
                </dd>
              </div>
              <div>
                <dt>Zoom at pointer</dt>
                <dd>
                  <kbd>Scroll</kbd>
                </dd>
              </div>
              <div>
                <dt>Pan the field</dt>
                <dd>
                  <kbd>Drag empty space</kbd>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </section>
    </div>
  );
}

const categoryIcons: Record<string, LucideIcon> = {
  "Canvas tools": MousePointer2,
  Edit: Pencil,
  Help: CircleHelp,
  Path: Route,
  Paths: Route,
  Playback: Play,
  Project: FolderOpen,
  View: Eye,
};

function CommandCategoryIcon({ category }: { category: string }) {
  const Icon = categoryIcons[category] ?? Command;
  return <Icon aria-hidden="true" size={16} />;
}

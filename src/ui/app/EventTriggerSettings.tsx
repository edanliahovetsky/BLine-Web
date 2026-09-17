import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { Project, ProjectConfig } from "../../core/model/project";
import {
  applyEventKeyEdits,
  eventKeyUsage,
  projectEventKeys,
  type EventKeyEdit,
} from "../../core/model/eventKeys";
import { useFloatingMenu } from "../controls/useFloatingMenu";
import "./EventTriggerSettings.css";

export function EventTriggerSettings({
  project,
  config,
  edits,
  onChange,
}: {
  project: Project;
  config: ProjectConfig;
  edits: readonly EventKeyEdit[];
  onChange(config: ProjectConfig, edits: EventKeyEdit[]): void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{
    from: string | null;
    value: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const preview = useMemo(
    () => ({ ...applyEventKeyEdits(project, edits), config }),
    [project, config, edits],
  );
  const keys = projectEventKeys(preview);
  const visible = keys.filter((key) =>
    key.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const replace = (from: string, to: string) => {
    const source = { ...preview, config: structuredClone(config) };
    source.config.gui.event_trigger_keys = keys;
    const next = applyEventKeyEdits(source, [{ from, to }]);
    onChange(next.config, [...edits, { from, to }]);
  };
  const commit = () => {
    if (!editing) return;
    const key = editing.value.trim();
    if (!key) {
      setError("Enter a Lib Key.");
      return;
    }
    if (editing.from === null && keys.includes(key)) {
      setError("This Lib Key is already registered.");
      return;
    }
    if (editing.from !== null) replace(editing.from, key);
    else
      onChange(
        {
          ...config,
          gui: { ...config.gui, event_trigger_keys: [...keys, key] },
        },
        [...edits],
      );
    setEditing(null);
    setError("");
  };
  const startEdit = (from: string | null, value: string) => {
    setEditing({ from, value });
    setDeleting(null);
    setError("");
  };
  return (
    <section
      className="config-dialog__section event-trigger-settings"
      data-tour="settings-event-triggers"
    >
      <h2>Event Triggers</h2>
      <p className="event-keys-help">
        Lib Keys are saved with this project and suggested in the inspector.
        Rename All updates every matching event and protrusion setting. Delete
        clears the key everywhere and keeps the event elements.
      </p>
      <div className="event-keys-toolbar">
        <label className="fc-search">
          <Search size={14} />
          <input
            type="search"
            aria-label="Search event triggers"
            placeholder="Search event triggers"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="event-keys-add"
          onClick={() => startEdit(null, "")}
        >
          <Plus size={14} />
          Add new
        </button>
      </div>
      {editing && (
        <div className="event-key-edit">
          <label>
            <span>
              {editing.from === null
                ? "New Lib Key"
                : `Rename all “${editing.from}” to`}
            </span>
            <input
              autoFocus
              aria-label={
                editing.from === null ? "New Lib Key" : "Replacement Lib Key"
              }
              value={editing.value}
              onChange={(event) =>
                setEditing({ ...editing, value: event.currentTarget.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  commit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setEditing(null);
                }
              }}
            />
          </label>
          <button type="button" aria-label="Save Lib Key" onClick={commit}>
            <Check size={16} />
          </button>
          <button
            type="button"
            aria-label="Cancel Lib Key edit"
            onClick={() => setEditing(null)}
          >
            <X size={16} />
          </button>
          {error && <p role="alert">{error}</p>}
          {editing.from &&
            editing.value !== editing.from &&
            keys.includes(editing.value.trim()) && (
              <p>Existing uses will be combined under this key.</p>
            )}
        </div>
      )}
      <ul className="event-keys-list" aria-label="Registered event triggers">
        {visible.map((key) => (
          <li key={key} className="event-key-row">
            <div className="event-key-row__main">
              <Zap size={15} />
              <span className="event-key-row__name" title={key}>
                {key}
              </span>
              <span className="event-key-row__count">
                {eventKeyUsage(preview, key)}{" "}
                {eventKeyUsage(preview, key) === 1 ? "use" : "uses"}
              </span>
              <EventKeyMenu
                name={key}
                onRename={() => startEdit(key, key)}
                onDelete={() => {
                  setDeleting(key);
                  setEditing(null);
                }}
                onDuplicate={() => {
                  let copy = `${key}_copy`;
                  let index = 2;
                  while (keys.includes(copy)) copy = `${key}_copy${index++}`;
                  startEdit(null, copy);
                }}
              />
            </div>
            {deleting === key && (
              <div className="event-key-delete">
                <p>
                  Clear “{key}” from this project? Event elements stay in place.
                </p>
                <button type="button" onClick={() => setDeleting(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-action"
                  onClick={() => {
                    replace(key, "");
                    setDeleting(null);
                  }}
                >
                  Clear key
                </button>
              </div>
            )}
          </li>
        ))}
        {visible.length === 0 && (
          <li className="event-keys-empty">
            {keys.length
              ? "No matching event triggers."
              : "No registered triggers yet. Add one here or enter a Lib Key in the inspector."}
          </li>
        )}
      </ul>
      <p className="event-keys-help">
        Changes apply when you save Settings. You can undo them in the editor.
      </p>
    </section>
  );
}

function EventKeyMenu({
  name,
  onRename,
  onDuplicate,
  onDelete,
}: {
  name: string;
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
        createPortal(
          <div
            ref={panelRef}
            role="menu"
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
              Rename All
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
              Delete
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

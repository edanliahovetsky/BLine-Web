import { useMemo, useState } from "react";
import { Check, CircleAlert, Plus, Search, X, Zap } from "lucide-react";
import type { Project, ProjectConfig } from "../../core/model/project";
import {
  applyEventKeyEdits,
  eventKeyUsage,
  projectEventKeys,
  type EventKeyEdit,
} from "../../core/model/eventKeys";
import { EventKeyMenu } from "../controls/EventKeyMenu";
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
  const preview = useMemo(
    () => ({ ...applyEventKeyEdits(project, edits), config }),
    [project, config, edits],
  );
  const keys = projectEventKeys(preview);
  const editedKey = editing?.value.trim() ?? "";
  const duplicateKey = editing?.from === null && keys.includes(editedKey);
  const canCommit = editedKey.length > 0 && !duplicateKey;
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
    if (!editing || !canCommit) return;
    const key = editedKey;
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
  };
  const startEdit = (from: string | null, value: string) => {
    setEditing({ from, value });
    setDeleting(null);
  };
  return (
    <section
      className="config-dialog__section event-trigger-settings"
      data-tour="settings-event-triggers"
    >
      <h2>Event Triggers</h2>
      <div className="event-keys-toolbar">
        <label className="fc-search">
          <Search size={14} />
          <input
            type="search"
            aria-label="Search event triggers"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="event-keys-add"
          aria-label="Add new"
          title="Add new"
          onClick={() => startEdit(null, "")}
        >
          <Plus size={14} />
        </button>
      </div>
      {editing && (
        <div className="event-key-edit">
          <label>
            {editing.from !== null && (
              <span>{`Rename all “${editing.from}” to`}</span>
            )}
            <div className="event-key-edit__input">
              <input
                autoFocus
                aria-label={
                  editing.from === null ? "New Lib Key" : "Replacement Lib Key"
                }
                aria-invalid={duplicateKey || undefined}
                aria-description={
                  duplicateKey
                    ? "This Lib Key is already registered."
                    : undefined
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
              {duplicateKey && <CircleAlert size={14} aria-hidden="true" />}
            </div>
          </label>
          <button
            type="button"
            aria-label="Save Lib Key"
            disabled={!canCommit}
            onClick={commit}
          >
            <Check size={16} />
          </button>
          <button
            type="button"
            aria-label="Cancel Lib Key edit"
            onClick={() => setEditing(null)}
          >
            <X size={16} />
          </button>
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
    </section>
  );
}

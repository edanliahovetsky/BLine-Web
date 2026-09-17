import { useId, useRef, useState } from "react";
import { Plus, Zap } from "lucide-react";
import { EventKeyInput } from "../controls/EventKeyInput";
import { EventKeyMenu } from "../controls/EventKeyMenu";
import "./EventTriggerSettings.css";
import "./ProtrusionEventKeys.css";

interface KeyRow {
  id: string;
  value: string;
  autoFocus?: boolean;
}

export function ProtrusionEventKeys({
  label,
  action,
  value,
  keys,
  disabled,
  onChange,
  onRegister,
}: {
  label: string;
  action: "Show" | "Hide";
  value: readonly string[];
  keys: readonly string[];
  disabled: boolean;
  onChange(keys: string[]): void;
  onRegister(key: string): void;
}) {
  const headingId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const serialized = JSON.stringify(value);
  const [draft, setDraft] = useState(() => ({
    serialized,
    rows: value.map((value) => ({ id: crypto.randomUUID(), value }) as KeyRow),
  }));
  if (draft.serialized !== serialized) {
    // Keep blank rows and typing intact through normalized lesson updates,
    // but reconcile actual external changes such as undo or a step restart.
    setDraft({
      serialized,
      rows: value.map((value) => ({ id: crypto.randomUUID(), value })),
    });
  }
  const update = (rows: KeyRow[]) => {
    const values = [
      ...new Set(rows.map((row) => row.value.trim()).filter(Boolean)),
    ];
    setDraft({ rows, serialized: JSON.stringify(values) });
    onChange(values);
  };
  const focusRow = (id: string) => {
    const input = listRef.current?.querySelector<HTMLInputElement>(
      `[data-key-row="${id}"] input`,
    );
    input?.focus();
    input?.select();
  };
  return (
    <section className="protrusion-event-keys" aria-labelledby={headingId}>
      <div className="event-keys-toolbar">
        <h4 id={headingId}>{label}</h4>
        <button
          type="button"
          className="event-keys-add"
          disabled={disabled}
          aria-label={`Add ${action.toLowerCase()} event key`}
          title={`Add ${action.toLowerCase()} event key`}
          onClick={() =>
            update([
              ...draft.rows,
              { id: crypto.randomUUID(), value: "", autoFocus: true },
            ])
          }
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
      <ul ref={listRef} className="event-keys-list" aria-label={label}>
        {draft.rows.map((row, index) => (
          <li key={row.id} data-key-row={row.id} className="event-key-row">
            <div className="event-key-row__main">
              <Zap size={15} aria-hidden="true" />
              <EventKeyInput
                ariaLabel={`${action} event key ${index + 1}`}
                value={row.value}
                keys={keys}
                disabled={disabled}
                autoFocus={row.autoFocus}
                placeholder="Lib Key"
                onChange={(value) =>
                  update(
                    draft.rows.map((item) =>
                      item.id === row.id ? { ...item, value } : item,
                    ),
                  )
                }
                onCommit={onRegister}
              />
              <EventKeyMenu
                name={`${action.toLowerCase()} key ${index + 1}`}
                disabled={disabled}
                renameLabel="Rename"
                deleteLabel="Remove"
                onRename={() => focusRow(row.id)}
                onDuplicate={() => {
                  let copy = row.value ? `${row.value}_copy` : "";
                  let suffix = 2;
                  const used = [
                    ...keys,
                    ...draft.rows.map((item) => item.value),
                  ];
                  while (copy && used.includes(copy))
                    copy = `${row.value}_copy${suffix++}`;
                  const rows = [...draft.rows];
                  rows.splice(index + 1, 0, {
                    id: crypto.randomUUID(),
                    value: copy,
                    autoFocus: true,
                  });
                  update(rows);
                }}
                onDelete={() =>
                  update(draft.rows.filter((item) => item.id !== row.id))
                }
              />
            </div>
          </li>
        ))}
        {draft.rows.length === 0 && (
          <li className="event-keys-empty">No event keys</li>
        )}
      </ul>
    </section>
  );
}

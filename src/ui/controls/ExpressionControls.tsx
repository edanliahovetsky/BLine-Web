import { useState, useCallback, useRef, KeyboardEvent } from "react";
import {
  DimensionName,
  UnitExpression,
  parseUnitExpression,
} from "../../core/math/units";

export function ExpressionInput<D extends DimensionName>({
  ariaLabel,
  value,
  dimension,
  allowEmpty = false,
  disabled = false,
  onChange,
}: {
  ariaLabel: string;
  value: UnitExpression<D> | null;
  dimension: D;
  allowEmpty?: boolean;
  disabled?: boolean;
  onChange(value: UnitExpression<D> | null): void;
}) {
  const formattedValue = value?.expression ?? "";
  const [draftValue, setDraftValue] = useState(formattedValue);
  const [editing, setEditing] = useState(false);
  const skipBlurCommitRef = useRef(false);
  const inputValue = editing && !disabled ? draftValue : formattedValue;

  const commitDraft = useCallback(
    (draft: string) => {
      const parsed = parseUnitExpression(draft, dimension);

      if (parsed == null) {
        if (allowEmpty && draft.trim() === "") {
          setDraftValue("");
          onChange(null);
        } else {
          setDraftValue(value?.expression ?? "");
        }

        return;
      }

      onChange(parsed);
    },
    [allowEmpty, dimension, onChange, value?.expression],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitDraft(draftValue);
        skipBlurCommitRef.current = true;
        event.currentTarget.blur();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setDraftValue(formattedValue);
        skipBlurCommitRef.current = true;
        event.currentTarget.blur();
      }
    },
    [commitDraft, draftValue, formattedValue],
  );

  return (
    <div className={`sidebar-number-control${disabled ? " is-disabled" : ""}`}>
      <input
        aria-label={ariaLabel}
        type="text"
        value={inputValue}
        disabled={disabled}
        onChange={(event) => setDraftValue(event.currentTarget.value)}
        onBlur={() => {
          setEditing(false);
          if (skipBlurCommitRef.current) {
            skipBlurCommitRef.current = false;
            return;
          }
          commitDraft(draftValue);
        }}
        onFocus={() => {
          setEditing(true);
          setDraftValue(formattedValue);
        }}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

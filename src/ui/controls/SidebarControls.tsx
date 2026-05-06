import {
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon } from "../icons";

export interface SidebarSelectOption<T extends string> {
  label: string;
  value: T;
}

export function SidebarSelectControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: readonly SidebarSelectOption<T>[];
  onChange(value: T): void;
}) {
  return (
    <div className="sidebar-select-control">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="sidebar-select-indicator" aria-hidden="true">
        <ChevronDownIcon size={12} />
      </span>
    </div>
  );
}

export function NumberStepperControl({
  ariaLabel,
  value,
  step,
  min,
  max,
  allowEmpty = false,
  disabled = false,
  precision = 2,
  onChange,
}: {
  ariaLabel: string;
  value: number | null;
  step: number;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
  disabled?: boolean;
  precision?: number;
  onChange(value: number | null): void;
}) {
  const formattedValue =
    value === null ? "" : formatNumericValue(value, precision);
  const [draftValue, setDraftValue] = useState(formattedValue);
  const [editing, setEditing] = useState(false);
  const skipBlurCommitRef = useRef(false);
  const inputValue = editing && !disabled ? draftValue : formattedValue;
  const draftNumber = parseDraftNumber(inputValue);
  const ariaValueNow = draftNumber ?? value ?? undefined;

  const applyStep = (direction: 1 | -1) => {
    const baseValue = parseDraftNumber(draftValue) ?? value ?? 0;
    const nextValue = stepNumber(
      baseValue,
      step,
      direction,
      min,
      max,
      precision,
    );
    setDraftValue(formatNumericValue(nextValue, precision));
    onChange(nextValue);
  };

  const commitDraft = (draft: string) => {
    const parsed = parseDraftNumber(draft);

    if (parsed === null) {
      if (allowEmpty && draft.trim() === "") {
        setDraftValue("");
        onChange(null);
      } else {
        setDraftValue(formattedValue);
      }
      return;
    }

    const nextValue = clampToBounds(
      roundToPrecision(parsed, precision),
      min,
      max,
    );
    setDraftValue(formatNumericValue(nextValue, precision));
    onChange(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      applyStep(1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      applyStep(-1);
      return;
    }

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
  };

  return (
    <div className={`sidebar-number-control${disabled ? " is-disabled" : ""}`}>
      <input
        aria-label={ariaLabel}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={ariaValueNow}
        inputMode="decimal"
        role="spinbutton"
        type="text"
        value={inputValue}
        disabled={disabled}
        onChange={(event) => {
          const nextDraft = sanitizeNumberInput(
            event.currentTarget.value,
            precision,
            min,
          );
          const parsed = parseDraftNumber(nextDraft);
          setDraftValue(nextDraft);

          if (parsed !== null) {
            onChange(
              clampToBounds(roundToPrecision(parsed, precision), min, max),
            );
          } else if (allowEmpty && nextDraft.trim() === "") {
            onChange(null);
          }
        }}
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
      <div className="sidebar-stepper">
        <button
          type="button"
          aria-label="Increase value"
          title={`Increase ${ariaLabel}`}
          disabled={disabled}
          onClick={() => applyStep(1)}
        >
          <ArrowUpIcon size={12} />
        </button>
        <button
          type="button"
          aria-label="Decrease value"
          title={`Decrease ${ariaLabel}`}
          disabled={disabled}
          onClick={() => applyStep(-1)}
        >
          <ArrowDownIcon size={12} />
        </button>
      </div>
    </div>
  );
}

export function SidebarIconButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      className={["sidebar-icon-button", className].filter(Boolean).join(" ")}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export function SidebarActionButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      className={["sidebar-action-button", className].filter(Boolean).join(" ")}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function formatNumericValue(value: number, precision: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  return Number(
    roundToPrecision(value, precision).toFixed(Math.max(0, precision)),
  ).toString();
}

function sanitizeNumberInput(
  value: string,
  precision: number,
  min?: number,
): string {
  const allowNegative = min === undefined || min < 0;
  const normalizedPrecision = Math.max(0, precision);
  let sanitized = value.replace(/[^\d.-]/g, "");

  if (allowNegative) {
    const negative = sanitized.startsWith("-");
    sanitized = sanitized.replace(/-/g, "");
    sanitized = negative ? `-${sanitized}` : sanitized;
  } else {
    sanitized = sanitized.replace(/-/g, "");
  }

  if (normalizedPrecision === 0) {
    return sanitized.replace(/\./g, "");
  }

  const decimalIndex = sanitized.indexOf(".");
  if (decimalIndex === -1) {
    return sanitized;
  }

  const integerPart = sanitized.slice(0, decimalIndex + 1);
  const decimalPart = sanitized
    .slice(decimalIndex + 1)
    .replace(/\./g, "")
    .slice(0, normalizedPrecision);
  return `${integerPart}${decimalPart}`;
}

function parseDraftNumber(value: string): number | null {
  const draft = value.trim();
  if (draft === "" || draft === "-" || draft === "." || draft === "-.") {
    return null;
  }

  const parsed = Number(draft);
  return Number.isFinite(parsed) ? parsed : null;
}

function stepNumber(
  value: number,
  step: number,
  direction: 1 | -1,
  min: number | undefined,
  max: number | undefined,
  precision: number,
): number {
  const nextValue = roundToPrecision(value + step * direction, precision);
  return clampToBounds(nextValue, min, max);
}

function roundToPrecision(value: number, precision: number): number {
  const normalizedPrecision = Math.max(0, precision);
  const factor = 10 ** normalizedPrecision;
  const epsilon = value >= 0 ? Number.EPSILON : -Number.EPSILON;
  return Number(
    (Math.round((value + epsilon) * factor) / factor).toFixed(
      normalizedPrecision,
    ),
  );
}

function clampToBounds(value: number, min?: number, max?: number): number {
  if (min !== undefined && value < min) {
    return min;
  }

  if (max !== undefined && value > max) {
    return max;
  }

  return value;
}

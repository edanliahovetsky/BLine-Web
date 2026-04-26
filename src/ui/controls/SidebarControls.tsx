import type { ButtonHTMLAttributes, ReactNode } from "react";

import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon } from "../icons";

export interface SidebarSelectOption<T extends string> {
  label: string;
  value: T;
}

export function SidebarSelectControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange
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
  onChange
}: {
  ariaLabel: string;
  value: number | null;
  step: number;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
  onChange(value: number | null): void;
}) {
  const applyStep = (direction: 1 | -1) => {
    onChange(stepNumber(value ?? 0, step, direction, min, max));
  };

  return (
    <div className="sidebar-number-control">
      <input
        aria-label={ariaLabel}
        type="number"
        value={value === null ? "" : formatNumericValue(value)}
        step={step}
        min={min}
        max={max}
        onChange={(event) => {
          const parsed = parseNumberInput(event.currentTarget.value, allowEmpty);
          onChange(parsed === null ? null : clampToBounds(parsed, min, max));
        }}
      />
      <div className="sidebar-stepper">
        <button
          type="button"
          aria-label="Increase value"
          title={`Increase ${ariaLabel}`}
          onClick={() => applyStep(1)}
        >
          <ArrowUpIcon size={12} />
        </button>
        <button
          type="button"
          aria-label="Decrease value"
          title={`Decrease ${ariaLabel}`}
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

function formatNumericValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function parseNumberInput(value: string, allowEmpty: boolean): number | null {
  if (value.trim() === "") {
    return allowEmpty ? null : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : allowEmpty ? null : 0;
}

function stepNumber(value: number, step: number, direction: 1 | -1, min?: number, max?: number): number {
  const precision = decimalPlaces(step);
  const nextValue = Number((value + step * direction).toFixed(precision));
  return clampToBounds(nextValue, min, max);
}

function decimalPlaces(value: number): number {
  const [, decimals = ""] = String(value).split(".");
  return decimals.length;
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

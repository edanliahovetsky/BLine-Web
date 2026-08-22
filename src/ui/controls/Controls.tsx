import {
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, XIcon } from "../icons";

export type ControlTone = "neutral" | "accent" | "primary" | "danger";
export type ControlSize = "compact" | "default" | "icon";

export interface SelectControlOption<T extends string> {
  label: string;
  value: T;
  disabled?: boolean;
}

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  size?: ControlSize;
  tone?: ControlTone;
}

export interface IconButtonProps extends ActionButtonProps {
  "aria-label": string;
}

export interface CloseButtonProps extends Omit<
  IconButtonProps,
  "aria-label" | "children"
> {
  ariaLabel: string;
}

export interface SelectControlProps<T extends string> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "onChange" | "value"
> {
  ariaLabel: string;
  indicatorClassName?: string;
  options: readonly SelectControlOption<T>[];
  selectClassName?: string;
  value: T;
  onChange(value: T): void;
}

export interface SwitchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "checked" | "onChange" | "role" | "type"
> {
  ariaLabel: string;
  checked: boolean;
  inputClassName?: string;
  trackClassName?: string;
  onChange(checked: boolean): void;
}

export interface NumberStepperControlProps {
  ariaLabel: string;
  value: number | null;
  step: number;
  allowEmpty?: boolean;
  className?: string;
  disabled?: boolean;
  inputClassName?: string;
  max?: number;
  min?: number;
  precision?: number;
  stepperClassName?: string;
  onChange(value: number | null): void;
}

export function ActionButton({
  children,
  className,
  size = "default",
  tone = "neutral",
  type = "button",
  ...props
}: ActionButtonProps) {
  return (
    <button
      className={controlButtonClassName(
        "bline-action-button",
        tone,
        size,
        className,
      )}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  className,
  size = "icon",
  tone = "neutral",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      className={controlButtonClassName(
        "bline-icon-button",
        tone,
        size,
        className,
      )}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

export function CloseButton({
  ariaLabel,
  className,
  size = "icon",
  title,
  tone = "neutral",
  ...props
}: CloseButtonProps) {
  return (
    <IconButton
      {...props}
      aria-label={ariaLabel}
      className={combineClassNames("bline-close-button", className)}
      size={size}
      title={title ?? ariaLabel}
      tone={tone}
    >
      <XIcon size={16} />
    </IconButton>
  );
}

export function SelectControl<T extends string>({
  ariaLabel,
  className,
  disabled = false,
  indicatorClassName,
  options,
  selectClassName,
  value,
  onChange,
  ...props
}: SelectControlProps<T>) {
  return (
    <div className={combineClassNames("bline-select-control", className)}>
      <select
        {...props}
        aria-label={ariaLabel}
        className={selectClassName}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value as T)}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      <span
        className={combineClassNames(
          "bline-select-control__indicator",
          indicatorClassName,
        )}
        aria-hidden="true"
      >
        <ChevronDownIcon size={12} />
      </span>
    </div>
  );
}

export function SidebarSelectControl<T extends string>({
  className,
  ...props
}: SelectControlProps<T>) {
  return (
    <SelectControl
      {...props}
      className={combineClassNames("sidebar-select-control", className)}
      indicatorClassName="sidebar-select-indicator"
    />
  );
}

export function SwitchInput({
  ariaLabel,
  checked,
  className,
  disabled = false,
  inputClassName,
  trackClassName,
  onChange,
  ...props
}: SwitchInputProps) {
  return (
    <span
      className={combineClassNames(
        "bline-switch",
        disabled ? "is-disabled" : "",
        className,
      )}
    >
      <input
        {...props}
        aria-label={ariaLabel}
        checked={checked}
        className={combineClassNames("bline-switch__input", inputClassName)}
        disabled={disabled}
        role="switch"
        type="checkbox"
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span
        className={combineClassNames("bline-switch__track", trackClassName)}
        aria-hidden="true"
      />
    </span>
  );
}

export function NumberStepperControl({
  ariaLabel,
  value,
  step,
  min,
  max,
  allowEmpty = false,
  className,
  disabled = false,
  inputClassName,
  precision = 2,
  stepperClassName,
  onChange,
}: NumberStepperControlProps) {
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
    <div
      className={combineClassNames(
        "bline-number-control",
        "sidebar-number-control",
        disabled ? "is-disabled" : "",
        className,
      )}
    >
      <input
        aria-label={ariaLabel}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={ariaValueNow}
        className={inputClassName}
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
      <div
        className={combineClassNames(
          "bline-number-control__stepper",
          "sidebar-stepper",
          stepperClassName,
        )}
      >
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
  className,
  size = "icon",
  ...props
}: IconButtonProps) {
  return (
    <IconButton
      {...props}
      className={combineClassNames("sidebar-icon-button", className)}
      size={size}
    />
  );
}

export function SidebarActionButton({
  className,
  size = "compact",
  ...props
}: ActionButtonProps) {
  return (
    <ActionButton
      {...props}
      className={combineClassNames("sidebar-action-button", className)}
      size={size}
    />
  );
}

function controlButtonClassName(
  baseClassName: string,
  tone: ControlTone,
  size: ControlSize,
  className?: string,
): string {
  return combineClassNames(
    "bline-control-button",
    baseClassName,
    `bline-control-button--${tone}`,
    `bline-control-button--${size}`,
    className,
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

function combineClassNames(
  ...classNames: Array<string | false | null | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}

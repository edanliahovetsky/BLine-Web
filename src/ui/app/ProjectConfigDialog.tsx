import { useState, type Dispatch, type SetStateAction } from "react";
import type { ProjectConfig } from "../../core/io/projectSchema";
import {
  createProjectConfig,
  type ProtrusionSide,
  type ProtrusionState
} from "../../core/config/projectConfig";

interface ProjectConfigDialogProps {
  config: ProjectConfig;
  onCancel(): void;
  onSave(config: ProjectConfig): void;
}

export function ProjectConfigDialog({
  config,
  onCancel,
  onSave
}: ProjectConfigDialogProps) {
  const [draft, setDraft] = useState<ProjectConfig>(() => createProjectConfig(config));
  const protrusionDefaultStateOptions = draft.gui.protrusions.enabled
    ? ["shown", "hidden"]
    : [""];

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        className="config-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Edit Config"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(createProjectConfig(draft));
        }}
      >
        <header className="config-dialog__header">
          <strong>Configuration</strong>
          <button type="button" aria-label="Close config" onClick={onCancel}>
            x
          </button>
        </header>

        <section className="config-dialog__section">
          <h2>GUI</h2>
          <NumberRow
            label="Robot Length (m)"
            value={draft.gui.robot.length_meters}
            min={0.05}
            max={5}
            step={0.01}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                gui: {
                  ...current.gui,
                  robot: { ...current.gui.robot, length_meters: value }
                }
              }))
            }
          />
          <NumberRow
            label="Robot Width (m)"
            value={draft.gui.robot.width_meters}
            min={0.05}
            max={5}
            step={0.01}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                gui: {
                  ...current.gui,
                  robot: { ...current.gui.robot, width_meters: value }
                }
              }))
            }
          />
          <CheckboxRow
            label="Enable Protrusions"
            checked={draft.gui.protrusions.enabled}
            onChange={(checked) =>
              setDraft((current) => ({
                ...current,
                gui: {
                  ...current.gui,
                  protrusions: {
                    ...current.gui.protrusions,
                    enabled: checked,
                    default_state: checked
                      ? current.gui.protrusions.default_state || "shown"
                      : ""
                  }
                }
              }))
            }
          />
          <NumberRow
            label="Protrusion Distance (m)"
            value={draft.gui.protrusions.distance_meters}
            min={0}
            max={2}
            step={0.01}
            disabled={!draft.gui.protrusions.enabled}
            onChange={(value) => updateProtrusions(setDraft, { distance_meters: value })}
          />
          <SelectRow
            label="Protrusion Side"
            value={draft.gui.protrusions.side}
            disabled={!draft.gui.protrusions.enabled}
            options={["none", "left", "right", "front", "back"]}
            onChange={(value) =>
              updateProtrusions(setDraft, { side: value as ProtrusionSide })
            }
          />
          <SelectRow
            label="Default Protrusion State"
            value={
              draft.gui.protrusions.enabled
                ? draft.gui.protrusions.default_state || "shown"
                : ""
            }
            disabled={!draft.gui.protrusions.enabled}
            options={protrusionDefaultStateOptions}
            onChange={(value) =>
              updateProtrusions(setDraft, {
                default_state: value as ProtrusionState
              })
            }
          />
          <TextRow
            label="Show On Event Keys"
            value={draft.gui.protrusions.show_on_event_keys.join(", ")}
            disabled={!draft.gui.protrusions.enabled}
            placeholder="Comma-separated event keys"
            onChange={(value) =>
              updateProtrusions(setDraft, {
                show_on_event_keys: parseKeyList(value)
              })
            }
          />
          <TextRow
            label="Hide On Event Keys"
            value={draft.gui.protrusions.hide_on_event_keys.join(", ")}
            disabled={!draft.gui.protrusions.enabled}
            placeholder="Comma-separated event keys"
            onChange={(value) =>
              updateProtrusions(setDraft, {
                hide_on_event_keys: parseKeyList(value)
              })
            }
          />
        </section>

        <section className="config-dialog__section">
          <h2>Kinematic Constraints</h2>
          <KinematicNumberRow
            draft={draft}
            label="Default Max Velocity (m/s)"
            configKey="default_max_velocity_meters_per_sec"
            step={0.1}
            setDraft={setDraft}
          />
          <KinematicNumberRow
            draft={draft}
            label="Default Max Accel (m/s2)"
            configKey="default_max_acceleration_meters_per_sec2"
            step={0.1}
            setDraft={setDraft}
          />
          <KinematicNumberRow
            draft={draft}
            label="Default Handoff Radius (m)"
            configKey="default_intermediate_handoff_radius_meters"
            step={0.05}
            setDraft={setDraft}
          />
          <KinematicNumberRow
            draft={draft}
            label="Default Max Rot Vel (deg/s)"
            configKey="default_max_velocity_deg_per_sec"
            step={1}
            setDraft={setDraft}
          />
          <KinematicNumberRow
            draft={draft}
            label="Default Max Rot Accel (deg/s2)"
            configKey="default_max_acceleration_deg_per_sec2"
            step={1}
            setDraft={setDraft}
          />
          <KinematicNumberRow
            draft={draft}
            label="End Translation Tolerance (m)"
            configKey="default_end_translation_tolerance_meters"
            max={1}
            step={0.01}
            setDraft={setDraft}
          />
          <KinematicNumberRow
            draft={draft}
            label="End Rotation Tolerance (deg)"
            configKey="default_end_rotation_tolerance_deg"
            max={180}
            step={0.1}
            setDraft={setDraft}
          />
        </section>

        <footer className="config-dialog__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-action"
            onClick={() => onSave(createProjectConfig(draft))}
          >
            OK
          </button>
        </footer>
      </form>
    </div>
  );
}

type KinematicKey = keyof ProjectConfig["kinematic_constraints"];

function KinematicNumberRow({
  draft,
  label,
  configKey,
  max = 99999,
  step,
  setDraft
}: {
  draft: ProjectConfig;
  label: string;
  configKey: KinematicKey;
  max?: number;
  step: number;
  setDraft: Dispatch<SetStateAction<ProjectConfig>>;
}) {
  return (
    <NumberRow
      label={label}
      value={draft.kinematic_constraints[configKey]}
      min={0}
      max={max}
      step={step}
      onChange={(value) =>
        setDraft((current) => ({
          ...current,
          kinematic_constraints: {
            ...current.kinematic_constraints,
            [configKey]: value
          }
        }))
      }
    />
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange(value: number): void;
}) {
  return (
    <label className="config-row">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={formatNumber(value)}
        onChange={(event) =>
          onChange(parseNumber(event.currentTarget.value, value, min, max))
        }
      />
    </label>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="config-row config-row--checkbox">
      <span>{label}</span>
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

function SelectRow({
  label,
  value,
  options,
  disabled = false,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  onChange(value: string): void;
}) {
  return (
    <label className="config-row">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "" ? "none" : option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextRow({
  label,
  value,
  disabled = false,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onChange(value: string): void;
}) {
  return (
    <label className="config-row">
      <span>{label}</span>
      <input
        aria-label={label}
        type="text"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function updateProtrusions(
  setDraft: Dispatch<SetStateAction<ProjectConfig>>,
  update: Partial<ProjectConfig["gui"]["protrusions"]>
): void {
  setDraft((current) => ({
    ...current,
    gui: {
      ...current.gui,
      protrusions: {
        ...current.gui.protrusions,
        ...update
      }
    }
  }));
}

function parseKeyList(value: string): string[] {
  return [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
}

function parseNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

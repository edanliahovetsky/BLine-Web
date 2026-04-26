import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type { ProjectConfig } from "../../core/io/projectSchema";
import {
  createProjectConfig,
  type ProtrusionSide,
  type ProtrusionState
} from "../../core/config/projectConfig";
import { NumberStepperControl } from "../controls/SidebarControls";

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
  const initialConfig = useMemo(() => createProjectConfig(config), [config]);
  const [draft, setDraft] = useState<ProjectConfig>(() => createProjectConfig(config));
  const normalizedDraft = useMemo(() => createProjectConfig(draft), [draft]);
  const isDirty = !configsEqual(initialConfig, normalizedDraft);
  const protrusionsEnabled = draft.gui.protrusions.enabled;
  const protrusionDefaultStateOptions = protrusionsEnabled ? ["shown", "hidden"] : [""];

  const saveDraft = () => {
    if (isDirty) {
      onSave(normalizedDraft);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="config-dialog-backdrop" role="presentation">
      <form
        className="config-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Edit Config"
        onSubmit={(event) => {
          event.preventDefault();
          saveDraft();
        }}
      >
        <header className="config-dialog__header">
          <strong>Settings</strong>
          <button type="button" aria-label="Close config" onClick={onCancel}>
            x
          </button>
        </header>

        <div className="config-dialog__body">
          <section className="config-dialog__section">
            <h2>Robot</h2>
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
          </section>

          <section className="config-dialog__section">
            <h2>Protrusions</h2>
            <CheckboxRow
              label="Enable Protrusions"
              checked={protrusionsEnabled}
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
            <div
              className={`config-dialog__dependent-group${
                protrusionsEnabled ? "" : " is-disabled"
              }`}
              aria-disabled={!protrusionsEnabled}
            >
              <NumberRow
                label="Protrusion Distance (m)"
                value={draft.gui.protrusions.distance_meters}
                min={0}
                max={2}
                step={0.01}
                disabled={!protrusionsEnabled}
                onChange={(value) =>
                  updateProtrusions(setDraft, { distance_meters: value })
                }
              />
              <SelectRow
                label="Protrusion Side"
                value={draft.gui.protrusions.side}
                disabled={!protrusionsEnabled}
                options={["none", "left", "right", "front", "back"]}
                onChange={(value) =>
                  updateProtrusions(setDraft, { side: value as ProtrusionSide })
                }
              />
              <SelectRow
                label="Default Protrusion State"
                value={
                  protrusionsEnabled ? draft.gui.protrusions.default_state || "shown" : ""
                }
                disabled={!protrusionsEnabled}
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
                disabled={!protrusionsEnabled}
                placeholder="event_a, event_b"
                onChange={(value) =>
                  updateProtrusions(setDraft, {
                    show_on_event_keys: parseKeyList(value)
                  })
                }
              />
              <TextRow
                label="Hide On Event Keys"
                value={draft.gui.protrusions.hide_on_event_keys.join(", ")}
                disabled={!protrusionsEnabled}
                placeholder="event_a, event_b"
                onChange={(value) =>
                  updateProtrusions(setDraft, {
                    hide_on_event_keys: parseKeyList(value)
                  })
                }
              />
            </div>
          </section>

          <section className="config-dialog__section config-dialog__section--kinematics">
            <h2>Kinematics</h2>
            <div className="config-dialog__subsection">
              <h3>Translation</h3>
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
            </div>
            <div className="config-dialog__subsection">
              <h3>Rotation</h3>
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
            </div>
            <div className="config-dialog__subsection">
              <h3>End Tolerance</h3>
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
            </div>
          </section>
        </div>

        <footer className="config-dialog__footer">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={!isDirty}
            onClick={saveDraft}
          >
            Save
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
    <label className={`config-row${disabled ? " is-disabled" : ""}`}>
      <span className="config-row__label">{label}</span>
      <NumberStepperControl
        ariaLabel={label}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(nextValue) => onChange(nextValue ?? value)}
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
    <label className="config-row config-row--switch">
      <span className="config-row__label">{label}</span>
      <span className="config-switch">
        <input
          aria-label={label}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="config-switch__track" aria-hidden="true" />
      </span>
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
    <label className={`config-row${disabled ? " is-disabled" : ""}`}>
      <span className="config-row__label">{label}</span>
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
    <label className={`config-row${disabled ? " is-disabled" : ""}`}>
      <span className="config-row__label">{label}</span>
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

function configsEqual(left: ProjectConfig, right: ProjectConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

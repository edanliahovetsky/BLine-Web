import {
  useEffect,
  useMemo,
  type RefObject,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ProjectConfig } from "../../core/io/projectSchema";
import {
  builtInFieldDefinitions,
  createPathPlannerFieldGeometry,
  defaultFieldId,
  fieldCoordinateOffsetXMeters,
  fieldCoordinateOffsetYMeters,
  resolveFieldDefinition,
  type CustomFieldImage,
  type FieldGeometry,
  type ResolvedFieldDefinition,
} from "../../core/field/fieldConfig";
import {
  createProjectConfig,
  type ProtrusionSide,
  type ProtrusionState,
} from "../../core/config/projectConfig";
import {
  CloseButton,
  NumberStepperControl,
  SelectControl,
  SwitchInput,
} from "../controls";

const configSections = [
  { id: "robot", label: "Robot" },
  { id: "path-defaults", label: "Path Defaults" },
  { id: "field", label: "Field" },
  { id: "optimizer", label: "Optimizer" },
] as const;

type ConfigSectionId = (typeof configSections)[number]["id"];

interface ProjectConfigDialogProps {
  config: ProjectConfig;
  autoSyncEnabled: boolean;
  onCancel(): void;
  onSave(
    config: ProjectConfig,
    options: { autoSyncEnabled: boolean; configChanged: boolean },
  ): void;
  onUploadFieldImage(
    file: File,
    geometry: FieldGeometry,
  ): Promise<CustomFieldImage>;
  onLoadFieldImage(field: CustomFieldImage): Promise<Blob | null>;
}

export function ProjectConfigDialog({
  config,
  autoSyncEnabled,
  onCancel,
  onSave,
  onUploadFieldImage,
  onLoadFieldImage,
}: ProjectConfigDialogProps) {
  const initialConfig = useMemo(() => createProjectConfig(config), [config]);
  const [draft, setDraft] = useState<ProjectConfig>(() =>
    createProjectConfig(config),
  );
  const [draftAutoSyncEnabled, setDraftAutoSyncEnabled] =
    useState(autoSyncEnabled);
  const fieldInputRef = useRef<HTMLInputElement | null>(null);
  const [activeSection, setActiveSection] = useState<ConfigSectionId>("robot");
  const [fieldPreview, setFieldPreview] = useState<{
    fieldId: string;
    url: string;
  } | null>(null);
  const [fieldUploadError, setFieldUploadError] = useState<string | null>(null);
  const [fieldUploading, setFieldUploading] = useState(false);
  const normalizedDraft = useMemo(() => createProjectConfig(draft), [draft]);
  const configChanged = !configsEqual(initialConfig, normalizedDraft);
  const isDirty =
    configChanged || draftAutoSyncEnabled !== autoSyncEnabled;
  const selectedField = useMemo(
    () => resolveFieldDefinition(draft.gui.field),
    [draft.gui.field],
  );
  const selectedCustomField = selectedField.custom ?? null;
  const protrusionsEnabled = draft.gui.protrusions.enabled;
  const protrusionDefaultStateOptions = protrusionsEnabled
    ? ["shown", "hidden"]
    : [""];

  const saveDraft = () => {
    if (isDirty) {
      onSave(normalizedDraft, {
        autoSyncEnabled: draftAutoSyncEnabled,
        configChanged,
      });
    }
  };

  useEffect(() => {
    if (!selectedCustomField) {
      return undefined;
    }

    let disposed = false;
    let objectUrl: string | null = null;
    const fieldId = selectedCustomField.id;

    void onLoadFieldImage(selectedCustomField)
      .then((blob) => {
        if (disposed || !blob) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setFieldPreview({ fieldId, url: objectUrl });
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setFieldUploadError(
            error instanceof Error ? error.message : String(error),
          );
        }
      });

    return () => {
      disposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [onLoadFieldImage, selectedCustomField]);
  const fieldPreviewUrl =
    fieldPreview && fieldPreview.fieldId === selectedCustomField?.id
      ? fieldPreview.url
      : null;

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
          <CloseButton ariaLabel="Close config" onClick={onCancel} />
        </header>

        <div className="config-dialog__body">
          <SettingsNav
            activeSection={activeSection}
            onSectionChange={setActiveSection}
          />

          <div className="config-dialog__content">
            {activeSection === "field" ? (
              <FieldSettingsSection
                draft={draft}
                fieldInputRef={fieldInputRef}
                fieldPreviewUrl={fieldPreviewUrl}
                fieldUploadError={fieldUploadError}
                fieldUploading={fieldUploading}
                selectedCustomField={selectedCustomField}
                selectedField={selectedField}
                setDraft={setDraft}
                setFieldUploadError={setFieldUploadError}
                setFieldUploading={setFieldUploading}
                onUploadFieldImage={onUploadFieldImage}
              />
            ) : null}

            {activeSection === "robot" ? (
              <RobotSettingsSection
                draft={draft}
                protrusionDefaultStateOptions={protrusionDefaultStateOptions}
                protrusionsEnabled={protrusionsEnabled}
                setDraft={setDraft}
              />
            ) : null}

            {activeSection === "path-defaults" ? (
              <PathDefaultsSettingsSection draft={draft} setDraft={setDraft} />
            ) : null}

            {activeSection === "optimizer" ? (
              <OptimizerSettingsSection
                autoSyncEnabled={draftAutoSyncEnabled}
                draft={draft}
                setAutoSyncEnabled={setDraftAutoSyncEnabled}
                setDraft={setDraft}
              />
            ) : null}
          </div>
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

function SettingsNav({
  activeSection,
  onSectionChange,
}: {
  activeSection: ConfigSectionId;
  onSectionChange(section: ConfigSectionId): void;
}) {
  return (
    <nav className="config-dialog__nav" aria-label="Settings sections">
      {configSections.map((section) => (
        <button
          key={section.id}
          type="button"
          className={
            section.id === activeSection
              ? "config-dialog__nav-item is-active"
              : "config-dialog__nav-item"
          }
          aria-current={section.id === activeSection ? "page" : undefined}
          onClick={() => onSectionChange(section.id)}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}

function ConfigSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="config-dialog__section">
      <h2>{title}</h2>
      <div className="config-dialog__section-body">{children}</div>
    </section>
  );
}

function ConfigSubsection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="config-dialog__subsection">
      <h3>{title}</h3>
      <div className="config-dialog__subsection-body">{children}</div>
    </div>
  );
}

function FieldSettingsSection({
  draft,
  fieldInputRef,
  fieldPreviewUrl,
  fieldUploadError,
  fieldUploading,
  selectedCustomField,
  selectedField,
  setDraft,
  setFieldUploadError,
  setFieldUploading,
  onUploadFieldImage,
}: {
  draft: ProjectConfig;
  fieldInputRef: RefObject<HTMLInputElement | null>;
  fieldPreviewUrl: string | null;
  fieldUploadError: string | null;
  fieldUploading: boolean;
  selectedCustomField: CustomFieldImage | null;
  selectedField: ResolvedFieldDefinition;
  setDraft: Dispatch<SetStateAction<ProjectConfig>>;
  setFieldUploadError(value: string | null): void;
  setFieldUploading(value: boolean): void;
  onUploadFieldImage(
    file: File,
    geometry: FieldGeometry,
  ): Promise<CustomFieldImage>;
}) {
  return (
    <ConfigSection title="Field">
      <div className="config-dialog__field-layout">
        <div className="field-preview" data-testid="field-preview">
          {selectedField.kind === "grid" ? (
            <div className="field-preview__grid" aria-hidden="true" />
          ) : selectedField.image_src || fieldPreviewUrl ? (
            <img
              alt={`${selectedField.label} preview`}
              src={selectedField.image_src ?? fieldPreviewUrl ?? ""}
            />
          ) : (
            <div className="field-preview__empty" aria-hidden="true" />
          )}
        </div>

        <div className="config-dialog__section-body">
          <FieldSelectRow
            value={draft.gui.field.selected_field_id}
            customFields={draft.gui.field.custom_fields}
            onChange={(value) => updateFieldSelection(setDraft, value)}
          />
          <div className="config-dialog__button-row">
            <button
              type="button"
              onClick={() => fieldInputRef.current?.click()}
              disabled={fieldUploading}
            >
              {selectedCustomField ? "Replace Image" : "Upload Image"}
            </button>
            {selectedCustomField ? (
              <button
                type="button"
                onClick={() => removeSelectedCustomField(setDraft)}
              >
                Remove Custom Field
              </button>
            ) : null}
          </div>
          <input
            ref={fieldInputRef}
            className="file-import-input"
            aria-label="Upload field image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = "";
              if (file) {
                void uploadCustomFieldImage({
                  file,
                  draft,
                  selectedCustomField,
                  setDraft,
                  setFieldUploading,
                  setFieldUploadError,
                  onUploadFieldImage,
                });
              }
            }}
          />
          <TextRow
            label="Field Name"
            value={selectedCustomField?.name ?? selectedField.label}
            disabled={!selectedCustomField}
            onChange={(value) =>
              updateSelectedCustomField(setDraft, { name: value })
            }
          />
          <NumberRow
            label="Field Length (m)"
            value={selectedField.geometry.length_meters}
            min={0.5}
            max={30}
            step={0.01}
            disabled={!selectedCustomField}
            onChange={(value) =>
              updateSelectedCustomFieldDimensions(setDraft, {
                length_meters: value,
              })
            }
          />
          <NumberRow
            label="Field Width (m)"
            value={selectedField.geometry.width_meters}
            min={0.5}
            max={30}
            step={0.01}
            disabled={!selectedCustomField}
            onChange={(value) =>
              updateSelectedCustomFieldDimensions(setDraft, {
                width_meters: value,
              })
            }
          />
          <NumberRow
            label="Field Padding X (m)"
            value={fieldCoordinateOffsetXMeters(selectedField.geometry)}
            min={0}
            max={5}
            step={0.01}
            disabled={!selectedCustomField}
            onChange={(value) =>
              updateSelectedCustomFieldGeometry(
                setDraft,
                selectedField.geometry,
                "x",
                value,
              )
            }
          />
          <NumberRow
            label="Field Padding Y (m)"
            value={fieldCoordinateOffsetYMeters(selectedField.geometry)}
            min={0}
            max={5}
            step={0.01}
            disabled={!selectedCustomField}
            onChange={(value) =>
              updateSelectedCustomFieldGeometry(
                setDraft,
                selectedField.geometry,
                "y",
                value,
              )
            }
          />
          {fieldUploadError ? (
            <p className="config-dialog__error">{fieldUploadError}</p>
          ) : null}
        </div>
      </div>
    </ConfigSection>
  );
}

function RobotSettingsSection({
  draft,
  protrusionDefaultStateOptions,
  protrusionsEnabled,
  setDraft,
}: {
  draft: ProjectConfig;
  protrusionDefaultStateOptions: string[];
  protrusionsEnabled: boolean;
  setDraft: Dispatch<SetStateAction<ProjectConfig>>;
}) {
  return (
    <ConfigSection title="Robot">
      <ConfigSubsection title="Size">
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
                robot: { ...current.gui.robot, length_meters: value },
              },
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
                robot: { ...current.gui.robot, width_meters: value },
              },
            }))
          }
        />
      </ConfigSubsection>

      <ConfigSubsection title="Protrusions">
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
                    : "",
                },
              },
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
              updateProtrusions(setDraft, {
                side: value as ProtrusionSide,
              })
            }
          />
          <SelectRow
            label="Default Protrusion State"
            value={
              protrusionsEnabled
                ? draft.gui.protrusions.default_state || "shown"
                : ""
            }
            disabled={!protrusionsEnabled}
            options={protrusionDefaultStateOptions}
            onChange={(value) =>
              updateProtrusions(setDraft, {
                default_state: value as ProtrusionState,
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
                show_on_event_keys: parseKeyList(value),
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
                hide_on_event_keys: parseKeyList(value),
              })
            }
          />
        </div>
      </ConfigSubsection>
    </ConfigSection>
  );
}

function PathDefaultsSettingsSection({
  draft,
  setDraft,
}: {
  draft: ProjectConfig;
  setDraft: Dispatch<SetStateAction<ProjectConfig>>;
}) {
  return (
    <ConfigSection title="Path Defaults">
      <ConfigSubsection title="Translation">
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
      </ConfigSubsection>

      <ConfigSubsection title="Rotation">
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
      </ConfigSubsection>

      <ConfigSubsection title="End Tolerance">
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
      </ConfigSubsection>
    </ConfigSection>
  );
}

function OptimizerSettingsSection({
  autoSyncEnabled,
  draft,
  setAutoSyncEnabled,
  setDraft,
}: {
  autoSyncEnabled: boolean;
  draft: ProjectConfig;
  setAutoSyncEnabled(enabled: boolean): void;
  setDraft: Dispatch<SetStateAction<ProjectConfig>>;
}) {
  return (
    <ConfigSection title="Optimizer">
      <ConfigSubsection title="Constraint Generation">
        <CheckboxRow
          label="Keep in sync"
          description="Regenerate automatic radii and velocity caps whenever the path or optimizer settings change."
          checked={autoSyncEnabled}
          onChange={setAutoSyncEnabled}
        />
        <KinematicNumberRow
          draft={draft}
          label="Velocity safety factor"
          configKey="default_auto_velocity_velocity_safety_factor"
          min={0.05}
          max={1}
          step={0.05}
          setDraft={setDraft}
        />
        <KinematicNumberRow
          draft={draft}
          label="Acceleration safety factor"
          configKey="default_auto_velocity_acceleration_safety_factor"
          min={0.05}
          max={1}
          step={0.05}
          setDraft={setDraft}
        />
        <KinematicNumberRow
          draft={draft}
          label="Merge difference (m/s)"
          configKey="default_auto_velocity_merge_tolerance_meters_per_sec"
          max={20}
          step={0.05}
          setDraft={setDraft}
        />
      </ConfigSubsection>
    </ConfigSection>
  );
}

function FieldSelectRow({
  value,
  customFields,
  onChange,
}: {
  value: string;
  customFields: readonly CustomFieldImage[];
  onChange(value: string): void;
}) {
  return (
    <label className="config-row">
      <span className="config-row__label">Field Image</span>
      <SelectControl
        ariaLabel="Field Image"
        value={value}
        options={[
          ...builtInFieldDefinitions.map((field) => ({
            label: field.label,
            value: field.id,
          })),
          ...customFields.map((field) => ({
            label: field.name,
            value: field.id,
          })),
        ]}
        onChange={onChange}
      />
    </label>
  );
}

function KinematicNumberRow({
  draft,
  label,
  configKey,
  min = 0,
  max = 99999,
  step,
  setDraft,
}: {
  draft: ProjectConfig;
  label: string;
  configKey: KinematicKey;
  min?: number;
  max?: number;
  step: number;
  setDraft: Dispatch<SetStateAction<ProjectConfig>>;
}) {
  return (
    <NumberRow
      label={label}
      value={draft.kinematic_constraints[configKey]}
      min={min}
      max={max}
      step={step}
      onChange={(value) =>
        setDraft((current) => ({
          ...current,
          kinematic_constraints: {
            ...current.kinematic_constraints,
            [configKey]: value,
          },
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
  onChange,
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
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="config-row config-row--switch">
      <span className="config-row__copy">
        <span className="config-row__label">{label}</span>
        {description ? <small>{description}</small> : null}
      </span>
      <SwitchInput ariaLabel={label} checked={checked} onChange={onChange} />
    </label>
  );
}

function SelectRow({
  label,
  value,
  options,
  disabled = false,
  onChange,
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
      <SelectControl
        ariaLabel={label}
        value={value}
        disabled={disabled}
        options={options.map((option) => ({
          label: option === "" ? "none" : option,
          value: option,
        }))}
        onChange={onChange}
      />
    </label>
  );
}

function TextRow({
  label,
  value,
  disabled = false,
  placeholder,
  onChange,
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
  update: Partial<ProjectConfig["gui"]["protrusions"]>,
): void {
  setDraft((current) => ({
    ...current,
    gui: {
      ...current.gui,
      protrusions: {
        ...current.gui.protrusions,
        ...update,
      },
    },
  }));
}

function updateFieldSelection(
  setDraft: Dispatch<SetStateAction<ProjectConfig>>,
  selectedFieldId: string,
): void {
  setDraft((current) => ({
    ...current,
    gui: {
      ...current.gui,
      field: {
        ...current.gui.field,
        selected_field_id: selectedFieldId,
      },
    },
  }));
}

function removeSelectedCustomField(
  setDraft: Dispatch<SetStateAction<ProjectConfig>>,
): void {
  setDraft((current) => {
    const selectedId = current.gui.field.selected_field_id;
    return {
      ...current,
      gui: {
        ...current.gui,
        field: {
          selected_field_id: defaultFieldId,
          custom_fields: current.gui.field.custom_fields.filter(
            (field) => field.id !== selectedId,
          ),
        },
      },
    };
  });
}

function updateSelectedCustomFieldGeometry(
  setDraft: Dispatch<SetStateAction<ProjectConfig>>,
  currentGeometry: FieldGeometry,
  axis: "x" | "y",
  value: number,
): void {
  const offsetX =
    axis === "x" ? value : fieldCoordinateOffsetXMeters(currentGeometry);
  const offsetY =
    axis === "y" ? value : fieldCoordinateOffsetYMeters(currentGeometry);
  updateSelectedCustomField(setDraft, {
    geometry: {
      coordinate_offset_meters:
        offsetX === offsetY
          ? offsetX
          : currentGeometry.coordinate_offset_meters,
      coordinate_offset_x_meters: offsetX,
      coordinate_offset_y_meters: offsetY,
    },
  });
}

function updateSelectedCustomFieldDimensions(
  setDraft: Dispatch<SetStateAction<ProjectConfig>>,
  geometry: Partial<Pick<FieldGeometry, "length_meters" | "width_meters">>,
): void {
  updateSelectedCustomField(setDraft, { geometry });
}

function updateSelectedCustomField(
  setDraft: Dispatch<SetStateAction<ProjectConfig>>,
  update: Partial<Pick<CustomFieldImage, "name">> & {
    geometry?: Partial<FieldGeometry>;
  },
): void {
  setDraft((current) => {
    const selectedId = current.gui.field.selected_field_id;
    return {
      ...current,
      gui: {
        ...current.gui,
        field: {
          ...current.gui.field,
          custom_fields: current.gui.field.custom_fields.map((field) =>
            field.id === selectedId
              ? {
                  ...field,
                  ...("name" in update
                    ? { name: update.name ?? field.name }
                    : {}),
                  geometry: update.geometry
                    ? {
                        ...field.geometry,
                        ...update.geometry,
                      }
                    : field.geometry,
                }
              : field,
          ),
        },
      },
    };
  });
}

async function uploadCustomFieldImage({
  file,
  draft,
  selectedCustomField,
  setDraft,
  setFieldUploading,
  setFieldUploadError,
  onUploadFieldImage,
}: {
  file: File;
  draft: ProjectConfig;
  selectedCustomField: CustomFieldImage | null;
  setDraft: Dispatch<SetStateAction<ProjectConfig>>;
  setFieldUploading(value: boolean): void;
  setFieldUploadError(value: string | null): void;
  onUploadFieldImage(
    file: File,
    geometry: FieldGeometry,
  ): Promise<CustomFieldImage>;
}): Promise<void> {
  setFieldUploading(true);
  setFieldUploadError(null);
  try {
    const fallbackGeometry =
      selectedCustomField?.geometry ??
      resolveFieldDefinition(draft.gui.field).geometry;
    const geometry = await inferCustomFieldGeometry(file, fallbackGeometry);
    const uploaded = await onUploadFieldImage(file, geometry);
    setDraft((current) => ({
      ...current,
      gui: {
        ...current.gui,
        field: {
          selected_field_id: uploaded.id,
          custom_fields: [
            ...current.gui.field.custom_fields.filter(
              (field) => field.id !== selectedCustomField?.id,
            ),
            uploaded,
          ],
        },
      },
    }));
  } catch (error) {
    setFieldUploadError(error instanceof Error ? error.message : String(error));
  } finally {
    setFieldUploading(false);
  }
}

async function inferCustomFieldGeometry(
  file: File,
  fallback: FieldGeometry,
): Promise<FieldGeometry> {
  const pixelsPerMeter = parsePathPlannerPixelsPerMeter(file.name);
  if (pixelsPerMeter === null) {
    return fallback;
  }

  const imageSize = await readImageSize(file);
  if (!imageSize) {
    return fallback;
  }

  return createPathPlannerFieldGeometry({
    imageWidthPx: imageSize.width,
    imageHeightPx: imageSize.height,
    pixelsPerMeter,
    marginMeters: 0,
  });
}

function parsePathPlannerPixelsPerMeter(fileName: string): number | null {
  const extensionIndex = fileName.lastIndexOf(".");
  const baseName =
    extensionIndex >= 0 ? fileName.slice(0, extensionIndex) : fileName;
  const separatorIndex = baseName.lastIndexOf("_");
  if (separatorIndex < 0) {
    return null;
  }

  const pixelsPerMeter = Number(baseName.slice(separatorIndex + 1));
  return Number.isFinite(pixelsPerMeter) && pixelsPerMeter > 0
    ? pixelsPerMeter
    : null;
}

async function readImageSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (typeof Image === "undefined" || typeof URL === "undefined") {
    return null;
  }

  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      image.addEventListener(
        "load",
        () =>
          resolve({
            width: image.naturalWidth || image.width,
            height: image.naturalHeight || image.height,
          }),
        { once: true },
      );
      image.addEventListener("error", () => resolve(null), { once: true });
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function parseKeyList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function configsEqual(left: ProjectConfig, right: ProjectConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

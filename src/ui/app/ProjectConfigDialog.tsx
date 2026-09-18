import type { Project } from "../../core/model/project";
import {
  applyEventKeyEdits,
  projectEventKeys,
  type EventKeyEdit,
} from "../../core/model/eventKeys";
import { ProtrusionEventKeys } from "./ProtrusionEventKeys";
import { EventTriggerSettings } from "./EventTriggerSettings";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
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
  fieldCoordinateOffsetMaximumMeters,
  normalizeFieldCoordinateGeometry,
  resolveUserFieldDefinition,
  type FieldBackgroundEntry,
  type FieldGeometry,
  type ResolvedFieldDefinition,
} from "../../core/field/fieldConfig";
import {
  createProjectConfig,
  type ProtrusionSide,
  type ProtrusionState,
} from "../../core/config/projectConfig";
import { pathDisplayNameFromFileName } from "../../core/model/projectIdentity";
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
  { id: "optimizer", label: "Generator" },
  { id: "event-triggers", label: "Event Triggers" },
] as const;

export type ConfigSectionId = (typeof configSections)[number]["id"];

interface ProjectConfigDialogProps {
  lessonMode?: boolean;
  initialSection?: ConfigSectionId;
  project?: Project;
  walkthrough?: {
    section: ConfigSectionId;
    target?: string;
    initialSection?: ConfigSectionId;
  };
  config: ProjectConfig;
  autoSyncEnabled: boolean;
  fieldBackgrounds: readonly FieldBackgroundEntry[];
  selectedFieldId: string;
  onWalkthroughChange?(
    config: ProjectConfig,
    options: {
      autoSyncEnabled: boolean;
      selectedFieldId: string;
      eventKeyEdits?: EventKeyEdit[];
    },
  ): void;
  onCancel(): void;
  onSave(
    config: ProjectConfig,
    options: {
      autoSyncEnabled: boolean;
      configChanged: boolean;
      eventKeyEdits: EventKeyEdit[];
      selectedFieldId: string;
      fieldBackgrounds: FieldBackgroundEntry[];
      fieldImageDrafts: Array<{ fieldId: string; file: File }>;
    },
  ): void | Promise<void>;
  onLoadFieldImage(field: FieldBackgroundEntry): Promise<Blob | null>;
}

interface FieldDraft {
  selectedFieldId: string;
  fieldBackgrounds: FieldBackgroundEntry[];
}

const SettingsWalkthroughContext =
  createContext<ProjectConfigDialogProps["walkthrough"]>(undefined);

export function ProjectConfigDialog({
  project,
  lessonMode = false,
  initialSection = "robot",
  walkthrough,
  config,
  autoSyncEnabled,
  fieldBackgrounds,
  selectedFieldId,
  onCancel,
  onWalkthroughChange,
  onSave,
  onLoadFieldImage,
}: ProjectConfigDialogProps) {
  const [eventKeyEdits, setEventKeyEdits] = useState<EventKeyEdit[]>([]);
  const eventKeyProject = useMemo(
    () => (project ? applyEventKeyEdits(project, eventKeyEdits) : null),
    [project, eventKeyEdits],
  );
  const initialConfig = useMemo(() => createProjectConfig(config), [config]);
  const initialFieldDraft = useMemo<FieldDraft>(
    () => ({
      selectedFieldId,
      fieldBackgrounds: structuredClone([...fieldBackgrounds]),
    }),
    [fieldBackgrounds, selectedFieldId],
  );
  const [draft, setDraft] = useState<ProjectConfig>(() =>
    createProjectConfig(config),
  );
  const [fieldDraft, setFieldDraft] = useState<FieldDraft>(() =>
    structuredClone(initialFieldDraft),
  );
  const [draftAutoSyncEnabled, setDraftAutoSyncEnabled] =
    useState(autoSyncEnabled);
  const fieldInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedSection, setActiveSection] = useState<ConfigSectionId>(
    walkthrough?.initialSection ?? walkthrough?.section ?? initialSection,
  );
  const activeSection = selectedSection;
  const contentRef = useRef<HTMLDivElement>(null);
  const walkthroughTarget = walkthrough?.target;
  useLayoutEffect(() => {
    if (!walkthroughTarget) return;
    contentRef.current
      ?.querySelector(`[data-tour="${walkthroughTarget}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeSection, walkthroughTarget]);
  const [fieldPreview, setFieldPreview] = useState<{
    fieldId: string;
    url: string;
  } | null>(null);
  const [fieldUploadError, setFieldUploadError] = useState<string | null>(null);
  const [fieldUploading, setFieldUploading] = useState(false);
  const [fieldImageDrafts, setFieldImageDrafts] = useState<
    Record<string, File>
  >({});
  const [saving, setSaving] = useState(false);
  const normalizedDraft = useMemo(() => createProjectConfig(draft), [draft]);
  const isWalkthrough = Boolean(walkthrough);
  const [lastPracticeConfig, setLastPracticeConfig] = useState(config);
  if (isWalkthrough && lastPracticeConfig !== config) {
    // Reconcile undo/redo before rendering the form or applying its draft.
    setLastPracticeConfig(config);
    setDraft(createProjectConfig(config));
    setFieldDraft((current) => ({
      ...current,
      selectedFieldId: config.gui.field.selected_field_id,
    }));
  }
  useEffect(() => {
    if (isWalkthrough)
      onWalkthroughChange?.(normalizedDraft, {
        autoSyncEnabled: draftAutoSyncEnabled,
        selectedFieldId: fieldDraft.selectedFieldId,
      });
  }, [
    isWalkthrough,
    normalizedDraft,
    draftAutoSyncEnabled,
    fieldDraft.selectedFieldId,
    onWalkthroughChange,
  ]);
  const configChanged = !configsEqual(initialConfig, normalizedDraft);
  const fieldChanged = !fieldDraftsEqual(initialFieldDraft, fieldDraft);
  const isDirty =
    configChanged ||
    eventKeyEdits.length > 0 ||
    fieldChanged ||
    draftAutoSyncEnabled !== autoSyncEnabled;
  const selectedField = useMemo(
    () =>
      resolveUserFieldDefinition(
        fieldDraft.selectedFieldId,
        fieldDraft.fieldBackgrounds,
        draft.gui.field.grid_size_meters,
      ),
    [fieldDraft, draft.gui.field.grid_size_meters],
  );
  const selectedCustomField = useMemo(
    () =>
      fieldDraft.fieldBackgrounds.find(
        (field) => field.id === fieldDraft.selectedFieldId,
      ) ?? null,
    [fieldDraft],
  );
  const protrusionsEnabled = draft.gui.protrusions.enabled;
  const protrusionDefaultStateOptions = protrusionsEnabled
    ? ["shown", "hidden"]
    : [""];

  const saveDraft = () => {
    if (!walkthrough && isDirty && !saving) {
      setSaving(true);
      setFieldUploadError(null);
      void Promise.resolve(
        onSave(normalizedDraft, {
          autoSyncEnabled: draftAutoSyncEnabled,
          configChanged,
          eventKeyEdits,
          selectedFieldId: fieldDraft.selectedFieldId,
          fieldBackgrounds: structuredClone(fieldDraft.fieldBackgrounds),
          fieldImageDrafts: Object.entries(fieldImageDrafts)
            .filter(([fieldId]) =>
              fieldDraft.fieldBackgrounds.some((field) => field.id === fieldId),
            )
            .map(([fieldId, file]) => ({ fieldId, file })),
        }),
      ).catch((error: unknown) => {
        setSaving(false);
        setFieldUploadError(
          error instanceof Error ? error.message : String(error),
        );
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

    const draftFile = fieldImageDrafts[selectedCustomField.id];
    const loadPreview = draftFile
      ? Promise.resolve(draftFile as Blob)
      : onLoadFieldImage(selectedCustomField);

    void loadPreview
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
  }, [fieldImageDrafts, onLoadFieldImage, selectedCustomField]);
  const fieldPreviewUrl =
    fieldPreview && fieldPreview.fieldId === selectedCustomField?.id
      ? fieldPreview.url
      : null;

  useEffect(() => {
    if (walkthrough) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, saving, walkthrough]);

  return (
    <SettingsWalkthroughContext.Provider value={walkthrough}>
      <div
        className={`config-dialog-backdrop${lessonMode ? " config-dialog-backdrop--lesson" : ""}`}
        role="presentation"
      >
        <form
          className="config-dialog"
          data-tour="settings-dialog"
          data-walkthrough={walkthrough ? "true" : undefined}
          role="dialog"
          aria-modal={!walkthrough}
          aria-label="Edit Config"
          onSubmit={(event) => {
            event.preventDefault();
            saveDraft();
          }}
        >
          <header className="config-dialog__header">
            <strong>Settings</strong>
            {!walkthrough && (
              <CloseButton
                ariaLabel="Close config"
                disabled={saving}
                onClick={onCancel}
              />
            )}
          </header>

          <div className="config-dialog__body" inert={saving}>
            <SettingsNav
              activeSection={activeSection}
              onSectionChange={(section) => {
                setActiveSection(section);
                contentRef.current?.scrollTo({ top: 0 });
              }}
            />

            <div ref={contentRef} className="config-dialog__content">
              {activeSection === "field" ? (
                <FieldSettingsSection
                  fieldDraft={fieldDraft}
                  fieldInputRef={fieldInputRef}
                  fieldPreviewUrl={fieldPreviewUrl}
                  fieldUploadError={fieldUploadError}
                  fieldUploading={fieldUploading}
                  selectedCustomField={selectedCustomField}
                  selectedField={selectedField}
                  onGridSizeChange={(size) =>
                    setDraft((current) => ({
                      ...current,
                      gui: {
                        ...current.gui,
                        field: {
                          ...current.gui.field,
                          grid_size_meters: {
                            ...selectedField.geometry,
                            ...size,
                          },
                        },
                      },
                    }))
                  }
                  setFieldDraft={setFieldDraft}
                  setFieldImageDrafts={setFieldImageDrafts}
                  setFieldUploadError={setFieldUploadError}
                  setFieldUploading={setFieldUploading}
                />
              ) : null}

              {activeSection === "robot" ? (
                <RobotSettingsSection
                  draft={draft}
                  eventKeys={
                    eventKeyProject
                      ? projectEventKeys({ ...eventKeyProject, config: draft })
                      : [
                          ...new Set([
                            ...(draft.gui.event_trigger_keys ?? []),
                            ...draft.gui.protrusions.show_on_event_keys,
                            ...draft.gui.protrusions.hide_on_event_keys,
                          ]),
                        ]
                  }
                  protrusionDefaultStateOptions={protrusionDefaultStateOptions}
                  protrusionsEnabled={protrusionsEnabled}
                  setDraft={setDraft}
                />
              ) : null}

              {activeSection === "path-defaults" ? (
                <PathDefaultsSettingsSection
                  draft={draft}
                  setDraft={setDraft}
                />
              ) : null}

              {activeSection === "event-triggers" && project && (
                <EventTriggerSettings
                  project={project}
                  config={draft}
                  edits={eventKeyEdits}
                  onChange={(config, edits) => {
                    if (walkthrough) {
                      onWalkthroughChange?.(config, {
                        autoSyncEnabled: draftAutoSyncEnabled,
                        selectedFieldId: fieldDraft.selectedFieldId,
                        eventKeyEdits: edits,
                      });
                      return;
                    }
                    setDraft(config);
                    setEventKeyEdits(edits);
                  }}
                />
              )}
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

          {!walkthrough && (
            <footer className="config-dialog__footer">
              <button type="button" disabled={saving} onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={!isDirty || fieldUploading || saving}
                onClick={saveDraft}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </footer>
          )}
        </form>
      </div>
    </SettingsWalkthroughContext.Provider>
  );
}

type KinematicKey = keyof ProjectConfig["kinematic_constraints"];

function SettingsNav({
  activeSection,
  onSectionChange,
  readOnly = false,
}: {
  activeSection: ConfigSectionId;
  onSectionChange(section: ConfigSectionId): void;
  readOnly?: boolean;
}) {
  return (
    <nav
      className="config-dialog__nav"
      aria-label="Settings sections"
      data-tour="settings-nav"
    >
      {configSections.map((section) => (
        <button
          key={section.id}
          type="button"
          disabled={readOnly}
          data-tour={`settings-nav-${section.id}`}
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
    <section
      className="config-dialog__section"
      data-tour={`settings-${title.toLowerCase().replaceAll(" ", "-")}`}
    >
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
    <div
      className="config-dialog__subsection"
      data-tour={`settings-${title.toLowerCase().replaceAll(" ", "-")}`}
    >
      <h3>{title}</h3>
      <div className="config-dialog__subsection-body">{children}</div>
    </div>
  );
}

function FieldSettingsSection({
  fieldDraft,
  fieldInputRef,
  fieldPreviewUrl,
  fieldUploadError,
  fieldUploading,
  selectedCustomField,
  selectedField,
  onGridSizeChange,
  setFieldDraft,
  setFieldImageDrafts,
  setFieldUploadError,
  setFieldUploading,
}: {
  fieldDraft: FieldDraft;
  fieldInputRef: RefObject<HTMLInputElement | null>;
  fieldPreviewUrl: string | null;
  fieldUploadError: string | null;
  fieldUploading: boolean;
  selectedCustomField: FieldBackgroundEntry | null;
  selectedField: ResolvedFieldDefinition;
  onGridSizeChange(
    size: Partial<Pick<FieldGeometry, "length_meters" | "width_meters">>,
  ): void;
  setFieldDraft: Dispatch<SetStateAction<FieldDraft>>;
  setFieldImageDrafts: Dispatch<SetStateAction<Record<string, File>>>;
  setFieldUploadError(value: string | null): void;
  setFieldUploading(value: boolean): void;
}) {
  const walkthrough = useContext(SettingsWalkthroughContext);
  return (
    <ConfigSection title="Field">
      <div className="config-dialog__field-layout">
        <div
          className="field-preview"
          data-testid="field-preview"
          style={{
            aspectRatio: `${selectedField.geometry.length_meters} / ${selectedField.geometry.width_meters}`,
          }}
        >
          {selectedField.kind === "grid" ? (
            <div className="field-preview__grid" aria-hidden="true" />
          ) : selectedField.image_src || fieldPreviewUrl ? (
            <img
              alt={`${selectedField.label} preview`}
              src={fieldImageUrl(
                selectedField.image_src ?? fieldPreviewUrl ?? "",
              )}
            />
          ) : (
            <div className="field-preview__empty" aria-hidden="true" />
          )}
        </div>

        <div className="config-dialog__section-body">
          <div
            className="config-dialog__section-body"
            data-tour="settings-field-image"
          >
            <FieldSelectRow
              value={fieldDraft.selectedFieldId}
              customFields={fieldDraft.fieldBackgrounds}
              onChange={(value) => updateFieldSelection(setFieldDraft, value)}
            />
            <div className="config-dialog__button-row">
              <button
                type="button"
                onClick={() => fieldInputRef.current?.click()}
                disabled={fieldUploading || Boolean(walkthrough)}
              >
                {selectedCustomField ? "Replace Image" : "Upload Image"}
              </button>
              {selectedCustomField ? (
                <button
                  type="button"
                  disabled={Boolean(walkthrough)}
                  onClick={() => removeSelectedCustomField(setFieldDraft)}
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
              disabled={Boolean(walkthrough)}
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                event.currentTarget.value = "";
                if (file) {
                  void uploadCustomFieldImage({
                    file,
                    fieldDraft,
                    selectedCustomField,
                    setFieldDraft,
                    setFieldImageDrafts,
                    setFieldUploading,
                    setFieldUploadError,
                  });
                }
              }}
            />
            <TextRow
              label="Field Name"
              value={selectedCustomField?.name ?? selectedField.label}
              disabled={!selectedCustomField}
              onChange={(value) =>
                updateSelectedCustomField(setFieldDraft, { name: value })
              }
            />
          </div>
          <div
            className="config-dialog__section-body"
            data-tour="settings-field-geometry"
          >
            <NumberRow
              label="Field Length (m)"
              value={selectedField.geometry.length_meters}
              min={0.5}
              max={30}
              step={0.01}
              disabled={!selectedCustomField && selectedField.kind !== "grid"}
              onChange={(value) =>
                selectedField.kind === "grid"
                  ? onGridSizeChange({ length_meters: value })
                  : updateSelectedCustomFieldDimensions(setFieldDraft, {
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
              disabled={!selectedCustomField && selectedField.kind !== "grid"}
              onChange={(value) =>
                selectedField.kind === "grid"
                  ? onGridSizeChange({ width_meters: value })
                  : updateSelectedCustomFieldDimensions(setFieldDraft, {
                      width_meters: value,
                    })
              }
            />
            <NumberRow
              label="Field Padding X (m)"
              value={fieldCoordinateOffsetXMeters(selectedField.geometry)}
              min={0}
              max={fieldCoordinateOffsetMaximumMeters(
                selectedField.geometry.length_meters,
              )}
              step={0.01}
              disabled={!selectedCustomField}
              onChange={(value) =>
                updateSelectedCustomFieldGeometry(
                  setFieldDraft,
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
              max={fieldCoordinateOffsetMaximumMeters(
                selectedField.geometry.width_meters,
              )}
              step={0.01}
              disabled={!selectedCustomField}
              onChange={(value) =>
                updateSelectedCustomFieldGeometry(
                  setFieldDraft,
                  selectedField.geometry,
                  "y",
                  value,
                )
              }
            />
          </div>
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
  eventKeys,
  protrusionDefaultStateOptions,
  protrusionsEnabled,
  setDraft,
}: {
  draft: ProjectConfig;
  eventKeys: string[];
  protrusionDefaultStateOptions: string[];
  protrusionsEnabled: boolean;
  setDraft: Dispatch<SetStateAction<ProjectConfig>>;
}) {
  const registerKey = (value: string) => {
    const key = value.trim();
    if (!key) return;
    setDraft((current) => {
      const keys = current.gui.event_trigger_keys ?? [];
      if (keys.includes(key)) return current;
      return {
        ...current,
        gui: { ...current.gui, event_trigger_keys: [...keys, key] },
      };
    });
  };
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

      <ConfigSubsection title="Appearance">
        <CheckboxRow
          label="Legacy appearance"
          checked={draft.gui.robot.legacy_heading_marker ?? false}
          onChange={(checked) =>
            setDraft((current) => ({
              ...current,
              gui: {
                ...current.gui,
                robot: { ...current.gui.robot, legacy_heading_marker: checked },
              },
            }))
          }
        />
      </ConfigSubsection>
      <ConfigSubsection title="Protrusions">
        <CheckboxRow
          label="Enable Protrusions"
          walkthroughControl="protrusions"
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
          <ProtrusionEventKeys
            label="Show On Event Keys"
            action="Show"
            value={draft.gui.protrusions.show_on_event_keys}
            keys={eventKeys}
            disabled={!protrusionsEnabled}
            onRegister={registerKey}
            onChange={(show_on_event_keys) =>
              updateProtrusions(setDraft, { show_on_event_keys })
            }
          />
          <ProtrusionEventKeys
            label="Hide On Event Keys"
            action="Hide"
            value={draft.gui.protrusions.hide_on_event_keys}
            keys={eventKeys}
            disabled={!protrusionsEnabled}
            onRegister={registerKey}
            onChange={(hide_on_event_keys) =>
              updateProtrusions(setDraft, { hide_on_event_keys })
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
    <ConfigSection title="Generator">
      <ConfigSubsection title="Constraint Generation">
        <CheckboxRow
          label="Keep in sync"
          description="Regenerate automatic radii and velocity caps whenever the path or generator settings change."
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
  customFields: readonly FieldBackgroundEntry[];
  onChange(value: string): void;
}) {
  return (
    <label className="config-row" data-tour="settings-field-select">
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
  walkthroughControl,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  walkthroughControl?: "protrusions";
  onChange(checked: boolean): void;
}) {
  return (
    <label
      className="config-row config-row--switch"
      data-tour={walkthroughControl ? "settings-enable-protrusions" : undefined}
    >
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
  setFieldDraft: Dispatch<SetStateAction<FieldDraft>>,
  selectedFieldId: string,
): void {
  setFieldDraft((current) => ({
    ...current,
    selectedFieldId,
  }));
}

function removeSelectedCustomField(
  setFieldDraft: Dispatch<SetStateAction<FieldDraft>>,
): void {
  setFieldDraft((current) => {
    const selectedId = current.selectedFieldId;
    return {
      ...current,
      selectedFieldId: defaultFieldId,
      fieldBackgrounds: current.fieldBackgrounds.filter(
        (field) => field.id !== selectedId,
      ),
    };
  });
}

function updateSelectedCustomFieldGeometry(
  setFieldDraft: Dispatch<SetStateAction<FieldDraft>>,
  currentGeometry: FieldGeometry,
  axis: "x" | "y",
  value: number,
): void {
  const offsetX =
    axis === "x" ? value : fieldCoordinateOffsetXMeters(currentGeometry);
  const offsetY =
    axis === "y" ? value : fieldCoordinateOffsetYMeters(currentGeometry);
  updateSelectedCustomField(setFieldDraft, {
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
  setFieldDraft: Dispatch<SetStateAction<FieldDraft>>,
  geometry: Partial<Pick<FieldGeometry, "length_meters" | "width_meters">>,
): void {
  updateSelectedCustomField(setFieldDraft, { geometry });
}

function updateSelectedCustomField(
  setFieldDraft: Dispatch<SetStateAction<FieldDraft>>,
  update: Partial<Pick<FieldBackgroundEntry, "name">> & {
    geometry?: Partial<FieldGeometry>;
  },
): void {
  setFieldDraft((current) => {
    const selectedId = current.selectedFieldId;
    return {
      ...current,
      fieldBackgrounds: current.fieldBackgrounds.map((field) =>
        field.id === selectedId
          ? {
              ...field,
              ...("name" in update ? { name: update.name ?? field.name } : {}),
              geometry: update.geometry
                ? normalizeFieldCoordinateGeometry({
                    ...field.geometry,
                    ...update.geometry,
                  })
                : field.geometry,
            }
          : field,
      ),
    };
  });
}

async function uploadCustomFieldImage({
  file,
  fieldDraft,
  selectedCustomField,
  setFieldDraft,
  setFieldImageDrafts,
  setFieldUploading,
  setFieldUploadError,
}: {
  file: File;
  fieldDraft: FieldDraft;
  selectedCustomField: FieldBackgroundEntry | null;
  setFieldDraft: Dispatch<SetStateAction<FieldDraft>>;
  setFieldImageDrafts: Dispatch<SetStateAction<Record<string, File>>>;
  setFieldUploading(value: boolean): void;
  setFieldUploadError(value: string | null): void;
}): Promise<void> {
  setFieldUploading(true);
  setFieldUploadError(null);
  try {
    const fallbackGeometry =
      selectedCustomField?.geometry ??
      resolveUserFieldDefinition(
        fieldDraft.selectedFieldId,
        fieldDraft.fieldBackgrounds,
      ).geometry;
    const geometry = await inferCustomFieldGeometry(file, fallbackGeometry);
    const fieldId = selectedCustomField?.id ?? createFieldImageId();
    const uploaded: FieldBackgroundEntry = {
      id: fieldId,
      asset_id: selectedCustomField?.asset_id ?? fieldId,
      name: pathDisplayNameFromFileName(file.name).replace(/[-_]+/g, " "),
      file_name: file.name,
      mime_type: file.type || "image/png",
      size_bytes: file.size,
      created_at: selectedCustomField?.created_at ?? new Date().toISOString(),
      geometry,
    };
    setFieldImageDrafts((current) => ({
      ...current,
      [uploaded.id]: file,
    }));
    setFieldDraft((current) => ({
      ...current,
      selectedFieldId: uploaded.id,
      fieldBackgrounds: selectedCustomField
        ? current.fieldBackgrounds.map((field) =>
            field.id === selectedCustomField.id ? uploaded : field,
          )
        : [...current.fieldBackgrounds, uploaded],
    }));
  } catch (error) {
    setFieldUploadError(error instanceof Error ? error.message : String(error));
  } finally {
    setFieldUploading(false);
  }
}

function createFieldImageId(): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `field-${random}`;
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

function configsEqual(left: ProjectConfig, right: ProjectConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fieldDraftsEqual(left: FieldDraft, right: FieldDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
import { fieldImageUrl } from "../../platform/fieldImageUrl";

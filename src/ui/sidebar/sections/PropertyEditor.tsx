import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  defaultFieldGeometry,
  type FieldGeometry,
} from "../../../core/field/fieldConfig";
import type {
  LinkedTargetKind,
  ProjectWorkspaceDocument,
} from "../../../core/io/projectSchema";
import {
  getPathElementLinkedTargetId,
  isElementCompatibleWithLinkedTarget,
  nextLinkedTargetName,
} from "../../../core/linkedTargets";
import { LinkIcon } from "../../icons";
import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement,
} from "../../../core/model/path";
import {
  NumberStepperControl,
  SidebarSelectControl,
  SwitchInput,
} from "../../controls";
import { SidebarSection } from "../SidebarSection";
import {
  type AddableElementType,
  elementTypeValue,
  updateEventTrigger,
  updateRotationTarget,
  updateTranslationTarget,
  updateWaypoint,
} from "../sidebarCommands";

interface PropertyEditorProps {
  element: PathElement | null;
  workspace: ProjectWorkspaceDocument | null;
  selectedElementIndex: number | null;
  open: boolean;
  typeOptions: readonly AddableElementType[];
  onToggleSection?(): void;
  onChangeType(type: AddableElementType): void;
  onUpdateElement(element: PathElement): void;
  onUnlinkTarget(): void;
  onCreateLinkedTarget(kind: LinkedTargetKind, displayName: string): void;
  onOpenLinkedTargetPicker(): void;
  fieldGeometry?: FieldGeometry;
  /** The last translation anchor: its handoff radius has no runtime effect. */
  isFinalAnchor?: boolean;
}

export function PropertyEditor({
  element,
  workspace,
  selectedElementIndex,
  open,
  typeOptions,
  onToggleSection,
  onChangeType,
  onUpdateElement,
  onUnlinkTarget,
  onCreateLinkedTarget,
  onOpenLinkedTargetPicker,
  fieldGeometry = defaultFieldGeometry,
  isFinalAnchor = false,
}: PropertyEditorProps) {
  if (!element) {
    return null;
  }

  return (
    <SidebarSection
      className="property-editor-section"
      actions={
        <LinkedTargetMenu
          key={`element-${selectedElementIndex ?? "none"}-${element.type}`}
          element={element}
          workspace={workspace}
          onCreateLinkedTarget={onCreateLinkedTarget}
          onOpenLinkedTargetPicker={onOpenLinkedTargetPicker}
          onUnlinkTarget={onUnlinkTarget}
        />
      }
      meta={propertySectionMeta(element, selectedElementIndex)}
      open={open}
      sectionId="element-properties"
      title="Element Properties"
      onToggle={onToggleSection}
    >
      <div
        className="property-editor"
        data-testid="property-editor"
        aria-label={`Element ${selectedElementIndex === null ? "" : selectedElementIndex + 1} properties`}
      >
        <TypeField
          element={element}
          options={typeOptions}
          onChangeType={onChangeType}
        />
        {isTranslationTarget(element) ? (
          <TranslationFields
            element={element}
            fieldGeometry={fieldGeometry}
            isFinalAnchor={isFinalAnchor}
            onUpdateElement={(nextElement) => onUpdateElement(nextElement)}
          />
        ) : null}
        {isWaypoint(element) ? (
          <WaypointFields
            element={element}
            fieldGeometry={fieldGeometry}
            isFinalAnchor={isFinalAnchor}
            onUpdateElement={(nextElement) => onUpdateElement(nextElement)}
          />
        ) : null}
        {isRotationTarget(element) ? (
          <RotationFields
            element={element}
            onUpdateElement={(nextElement) => onUpdateElement(nextElement)}
          />
        ) : null}
        {isEventTrigger(element) ? (
          <EventFields
            element={element}
            onUpdateElement={(nextElement) => onUpdateElement(nextElement)}
          />
        ) : null}
      </div>
    </SidebarSection>
  );
}

function TypeField({
  element,
  options,
  onChangeType,
}: {
  element: PathElement;
  options: readonly AddableElementType[];
  onChangeType(type: AddableElementType): void;
}) {
  const currentType = elementTypeValue(element);
  const visibleOptions = options.includes(currentType)
    ? options
    : [currentType, ...options];

  return (
    <label className="property-row">
      <span>Type</span>
      <SidebarSelectControl
        ariaLabel="Type"
        value={currentType}
        options={visibleOptions.map((type) => ({
          label: typeOptionLabel(type),
          value: type,
        }))}
        onChange={onChangeType}
      />
    </label>
  );
}

function LinkedTargetMenu({
  element,
  workspace,
  onCreateLinkedTarget,
  onOpenLinkedTargetPicker,
  onUnlinkTarget,
}: {
  element: PathElement;
  workspace: ProjectWorkspaceDocument | null;
  onCreateLinkedTarget(kind: LinkedTargetKind, displayName: string): void;
  onOpenLinkedTargetPicker(): void;
  onUnlinkTarget(): void;
}) {
  const [draftKind, setDraftKind] = useState<LinkedTargetKind | null>(null);
  const [draftName, setDraftName] = useState("");
  const draftNameInputRef = useRef<HTMLInputElement | null>(null);
  const canLinkElement =
    workspace !== null && (isTranslationTarget(element) || isWaypoint(element));
  const currentTargetId = getPathElementLinkedTargetId(element);
  const currentTarget = workspace
    ? (workspace.linked_targets.find(
        (target) => target.target_id === currentTargetId,
      ) ?? null)
    : null;
  const compatibleTargets = workspace
    ? workspace.linked_targets.filter((target) =>
        isElementCompatibleWithLinkedTarget(element, target),
      )
    : [];
  const createKinds: LinkedTargetKind[] = isWaypoint(element)
    ? ["translation", "waypoint"]
    : ["translation"];
  const trimmedDraftName = draftName.trim();
  const draftNameExists =
    workspace?.linked_targets.some(
      (target) => target.display_name === trimmedDraftName,
    ) ?? false;
  const draftNameIsValid = trimmedDraftName.length > 0 && !draftNameExists;

  useEffect(() => {
    if (!draftKind) {
      return;
    }
    draftNameInputRef.current?.focus();
    draftNameInputRef.current?.select();
  }, [draftKind]);

  if (!canLinkElement || !workspace) {
    return null;
  }

  const startCreate = (kind: LinkedTargetKind) => {
    setDraftKind(kind);
    setDraftName(nextLinkedTargetName(workspace, kind));
  };

  const cancelCreate = () => {
    setDraftKind(null);
    setDraftName("");
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftKind || !draftNameIsValid) {
      return;
    }
    onCreateLinkedTarget(draftKind, trimmedDraftName);
    cancelCreate();
    closeContainingDetails(event.currentTarget);
  };

  const currentTargetName =
    workspace.linked_targets.find(
      (target) => target.target_id === currentTargetId,
    )?.display_name ?? null;

  return (
    <details
      className={["linked-element-menu", currentTarget ? "is-linked" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <summary
        aria-label={
          currentTarget
            ? `Linked to ${currentTarget.display_name}`
            : "Link element"
        }
        role="button"
      >
        <LinkIcon size={15} />
        <span>Link</span>
      </summary>
      <div
        className="linked-element-menu__panel"
        role="group"
        aria-label="Linked element actions"
      >
        {currentTarget ? (
          <div className="linked-element-menu__status">
            <span>Linked</span>
            <strong>{currentTarget.display_name}</strong>
          </div>
        ) : null}
        <button
          type="button"
          disabled={compatibleTargets.length === 0}
          onClick={(event) => {
            onOpenLinkedTargetPicker();
            closeContainingDetails(event.currentTarget);
          }}
        >
          <span>Choose Existing...</span>
          <small>{compatibleTargets.length}</small>
        </button>
        {draftKind ? (
          <form className="linked-element-menu__create" onSubmit={submitCreate}>
            <label>
              <span>
                {draftKind === "waypoint"
                  ? "New Linked Waypoint"
                  : "New Linked Translation"}
              </span>
              <input
                ref={draftNameInputRef}
                aria-label="Linked element name"
                value={draftName}
                onChange={(event) => setDraftName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelCreate();
                  }
                }}
              />
            </label>
            {trimmedDraftName.length === 0 ? (
              <small>Name required.</small>
            ) : draftNameExists ? (
              <small>Name already exists.</small>
            ) : (
              <small>
                {currentTargetName
                  ? `Currently linked to ${currentTargetName}.`
                  : "Creates and links this element."}
              </small>
            )}
            <div className="linked-element-menu__create-actions">
              <button type="button" onClick={cancelCreate}>
                Cancel
              </button>
              <button
                type="submit"
                className="linked-element-menu__create-primary"
                disabled={!draftNameIsValid}
              >
                Create &amp; Link
              </button>
            </div>
          </form>
        ) : (
          createKinds.map((kind) => (
            <button key={kind} type="button" onClick={() => startCreate(kind)}>
              <span>
                {kind === "waypoint"
                  ? "New Linked Waypoint..."
                  : "New Linked Translation..."}
              </span>
            </button>
          ))
        )}
        {currentTargetId ? (
          <button
            type="button"
            onClick={(event) => {
              onUnlinkTarget();
              closeContainingDetails(event.currentTarget);
            }}
          >
            <span>Unlink Element</span>
          </button>
        ) : null}
      </div>
    </details>
  );
}

function closeContainingDetails(element: HTMLElement): void {
  element.closest("details")?.removeAttribute("open");
}

function TranslationFields({
  element,
  fieldGeometry,
  isFinalAnchor,
  onUpdateElement,
}: {
  element: Extract<PathElement, { type: "translation" }>;
  fieldGeometry: FieldGeometry;
  isFinalAnchor: boolean;
  onUpdateElement(element: PathElement): void;
}) {
  return (
    <>
      <NumberField
        label="X (m)"
        value={element.x_meters}
        step={0.05}
        min={0}
        max={fieldGeometry.length_meters}
        onChange={(value) =>
          onUpdateElement(updateTranslationTarget(element, { x_meters: value }))
        }
      />
      <NumberField
        label="Y (m)"
        value={element.y_meters}
        step={0.05}
        min={0}
        max={fieldGeometry.width_meters}
        onChange={(value) =>
          onUpdateElement(updateTranslationTarget(element, { y_meters: value }))
        }
      />
      <OptionalNumberField
        label="Handoff Radius (m)"
        note={isFinalAnchor ? finalAnchorHandoffNote : undefined}
        value={element.intermediate_handoff_radius_meters}
        step={0.05}
        onChange={(value) =>
          onUpdateElement(
            updateTranslationTarget(element, {
              intermediate_handoff_radius_meters: value,
            }),
          )
        }
      />
    </>
  );
}

function WaypointFields({
  element,
  fieldGeometry,
  isFinalAnchor,
  onUpdateElement,
}: {
  element: Extract<PathElement, { type: "waypoint" }>;
  fieldGeometry: FieldGeometry;
  isFinalAnchor: boolean;
  onUpdateElement(element: PathElement): void;
}) {
  return (
    <>
      <NumberField
        label="Rotation (deg)"
        value={radiansToDegrees(element.rotation_target.rotation_radians)}
        step={1}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              rotation: { rotation_radians: degreesToRadians(value) },
            }),
          )
        }
      />
      <NumberField
        label="X (m)"
        value={element.translation_target.x_meters}
        step={0.05}
        min={0}
        max={fieldGeometry.length_meters}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              translation: { x_meters: value },
            }),
          )
        }
      />
      <NumberField
        label="Y (m)"
        value={element.translation_target.y_meters}
        step={0.05}
        min={0}
        max={fieldGeometry.width_meters}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              translation: { y_meters: value },
            }),
          )
        }
      />
      <OptionalNumberField
        label="Handoff Radius (m)"
        note={isFinalAnchor ? finalAnchorHandoffNote : undefined}
        value={element.translation_target.intermediate_handoff_radius_meters}
        step={0.05}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              translation: { intermediate_handoff_radius_meters: value },
            }),
          )
        }
      />
      <BooleanField
        label="Profiled Rotation"
        checked={element.rotation_target.profiled_rotation}
        onChange={(checked) =>
          onUpdateElement(
            updateWaypoint(element, {
              rotation: { profiled_rotation: checked },
            }),
          )
        }
      />
    </>
  );
}

function RotationFields({
  element,
  onUpdateElement,
}: {
  element: Extract<PathElement, { type: "rotation" }>;
  onUpdateElement(element: PathElement): void;
}) {
  return (
    <>
      <NumberField
        label="Rotation (deg)"
        value={radiansToDegrees(element.rotation_radians)}
        step={1}
        onChange={(value) =>
          onUpdateElement(
            updateRotationTarget(element, {
              rotation_radians: degreesToRadians(value),
            }),
          )
        }
      />
      <NumberField
        label="Rotation Pos (0-1)"
        value={element.t_ratio}
        step={0.01}
        min={0}
        max={1}
        onChange={(value) =>
          onUpdateElement(
            updateRotationTarget(element, { t_ratio: clamp01(value) }),
          )
        }
      />
      <BooleanField
        label="Profiled Rotation"
        checked={element.profiled_rotation}
        onChange={(checked) =>
          onUpdateElement(
            updateRotationTarget(element, { profiled_rotation: checked }),
          )
        }
      />
    </>
  );
}

function EventFields({
  element,
  onUpdateElement,
}: {
  element: Extract<PathElement, { type: "event_trigger" }>;
  onUpdateElement(element: PathElement): void;
}) {
  return (
    <>
      <NumberField
        label="Event Pos (0-1)"
        value={element.t_ratio}
        step={0.01}
        min={0}
        max={1}
        onChange={(value) =>
          onUpdateElement(
            updateEventTrigger(element, { t_ratio: clamp01(value) }),
          )
        }
      />
      <label className="property-row">
        <span>Lib Key</span>
        <input
          aria-label="Lib Key"
          type="text"
          value={element.lib_key}
          onChange={(event) =>
            onUpdateElement(
              updateEventTrigger(element, {
                lib_key: event.currentTarget.value,
              }),
            )
          }
        />
      </label>
    </>
  );
}

function NumberField({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  onChange(value: number): void;
}) {
  return (
    <label className="property-row">
      <span>{label}</span>
      <NumberStepperControl
        ariaLabel={label}
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(nextValue) => onChange(nextValue ?? 0)}
      />
    </label>
  );
}

function OptionalNumberField({
  label,
  note,
  value,
  step,
  onChange,
}: {
  label: string;
  note?: string;
  value: number | null;
  step: number;
  onChange(value: number | null): void;
}) {
  return (
    <>
      <label className="property-row">
        <span>{label}</span>
        <NumberStepperControl
          allowEmpty
          ariaLabel={label}
          value={value}
          step={step}
          min={0}
          onChange={onChange}
        />
      </label>
      {note ? (
        <p className="property-row__note" role="note">
          {note}
        </p>
      ) : null}
    </>
  );
}

function BooleanField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="property-row property-row--toggle">
      <span>{label}</span>
      <SwitchInput ariaLabel={label} checked={checked} onChange={onChange} />
    </label>
  );
}

const finalAnchorHandoffNote =
  "Not used here — the path finishes at this element by tolerance, not by a handoff.";

function radiansToDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function typeOptionLabel(type: AddableElementType): string {
  if (type === "event_trigger") {
    return "Event Trigger";
  }

  if (type === "translation") {
    return "Translation";
  }

  if (type === "rotation") {
    return "Rotation";
  }

  return "Waypoint";
}

function propertySectionMeta(
  element: PathElement | null,
  selectedElementIndex: number | null,
): string {
  if (!element || selectedElementIndex === null) {
    return "No selection";
  }

  return `${selectedElementIndex + 1}. ${typeOptionLabel(elementTypeValue(element))}`;
}

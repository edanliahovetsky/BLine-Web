import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  coordinateEditBounds,
  defaultFieldGeometry,
  fieldCoordinateLengthMeters,
  fieldCoordinateWidthMeters,
  type FieldGeometry,
} from "../../../core/field/fieldConfig";
import type { LinkedTargetKind } from "../../../core/io/projectSchema";
import type { Project } from "../../../core/model/project";
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
  project: Pick<Project, "linked_targets"> | null;
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
}

export function PropertyEditor({
  element,
  project,
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
          project={project}
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
            onUpdateElement={(nextElement) => onUpdateElement(nextElement)}
          />
        ) : null}
        {isWaypoint(element) ? (
          <WaypointFields
            element={element}
            fieldGeometry={fieldGeometry}
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
  project,
  onCreateLinkedTarget,
  onOpenLinkedTargetPicker,
  onUnlinkTarget,
}: {
  element: PathElement;
  project: Pick<Project, "linked_targets"> | null;
  onCreateLinkedTarget(kind: LinkedTargetKind, displayName: string): void;
  onOpenLinkedTargetPicker(): void;
  onUnlinkTarget(): void;
}) {
  const [draftKind, setDraftKind] = useState<LinkedTargetKind | null>(null);
  const [draftName, setDraftName] = useState("");
  const draftNameInputRef = useRef<HTMLInputElement | null>(null);
  const canLinkElement =
    project !== null && (isTranslationTarget(element) || isWaypoint(element));
  const currentTargetId = getPathElementLinkedTargetId(element);
  const currentTarget = project
    ? (project.linked_targets.find(
        (target) => target.target_id === currentTargetId,
      ) ?? null)
    : null;
  const compatibleTargets = project
    ? project.linked_targets.filter((target) =>
        isElementCompatibleWithLinkedTarget(element, target),
      )
    : [];
  const createKinds: LinkedTargetKind[] = isWaypoint(element)
    ? ["translation", "waypoint"]
    : ["translation"];
  const trimmedDraftName = draftName.trim();
  const draftNameExists =
    project?.linked_targets.some(
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

  if (!canLinkElement || !project) {
    return null;
  }

  const startCreate = (kind: LinkedTargetKind) => {
    setDraftKind(kind);
    setDraftName(nextLinkedTargetName(project, kind));
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
    project.linked_targets.find(
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
  onUpdateElement,
}: {
  element: Extract<PathElement, { type: "translation" }>;
  fieldGeometry: FieldGeometry;
  onUpdateElement(element: PathElement): void;
}) {
  const xBounds = coordinateEditBounds(
    element.x_meters,
    fieldCoordinateLengthMeters(fieldGeometry),
  );
  const yBounds = coordinateEditBounds(
    element.y_meters,
    fieldCoordinateWidthMeters(fieldGeometry),
  );
  return (
    <>
      <NumberField
        label="X (m)"
        value={element.x_meters}
        step={0.05}
        min={xBounds.min}
        max={xBounds.max}
        onChange={(value) =>
          onUpdateElement(updateTranslationTarget(element, { x_meters: value }))
        }
      />
      <NumberField
        label="Y (m)"
        value={element.y_meters}
        step={0.05}
        min={yBounds.min}
        max={yBounds.max}
        onChange={(value) =>
          onUpdateElement(updateTranslationTarget(element, { y_meters: value }))
        }
      />
    </>
  );
}

function WaypointFields({
  element,
  fieldGeometry,
  onUpdateElement,
}: {
  element: Extract<PathElement, { type: "waypoint" }>;
  fieldGeometry: FieldGeometry;
  onUpdateElement(element: PathElement): void;
}) {
  const xBounds = coordinateEditBounds(
    element.translation_target.x_meters,
    fieldCoordinateLengthMeters(fieldGeometry),
  );
  const yBounds = coordinateEditBounds(
    element.translation_target.y_meters,
    fieldCoordinateWidthMeters(fieldGeometry),
  );
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
        min={xBounds.min}
        max={xBounds.max}
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
        min={yBounds.min}
        max={yBounds.max}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              translation: { y_meters: value },
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
          placeholder="No action"
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

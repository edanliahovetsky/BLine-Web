import { useState } from "react";
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
} from "../../controls/SidebarControls";
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
  onToggleSection(): void;
  onChangeType(type: AddableElementType): void;
  onUpdateElement(element: PathElement): void;
  onUnlinkTarget(): void;
  onCreateLinkedTarget(kind: LinkedTargetKind): void;
  onLinkTarget(targetId: string): void;
  onOpenLinkedTargetPicker(): void;
  fieldGeometry?: FieldGeometry;
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
  onLinkTarget,
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
          element={element}
          workspace={workspace}
          onCreateLinkedTarget={onCreateLinkedTarget}
          onLinkTarget={onLinkTarget}
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
  workspace,
  onCreateLinkedTarget,
  onLinkTarget,
  onOpenLinkedTargetPicker,
  onUnlinkTarget,
}: {
  element: PathElement;
  workspace: ProjectWorkspaceDocument | null;
  onCreateLinkedTarget(kind: LinkedTargetKind): void;
  onLinkTarget(targetId: string): void;
  onOpenLinkedTargetPicker(): void;
  onUnlinkTarget(): void;
}) {
  const [query, setQuery] = useState("");
  if (!workspace || (!isTranslationTarget(element) && !isWaypoint(element))) {
    return null;
  }

  const currentTargetId = getPathElementLinkedTargetId(element);
  const currentTarget =
    workspace.linked_targets.find(
      (target) => target.target_id === currentTargetId,
    ) ?? null;
  const compatibleTargets = workspace.linked_targets.filter((target) =>
    isElementCompatibleWithLinkedTarget(element, target),
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTargets = normalizedQuery
    ? compatibleTargets.filter((target) =>
        target.display_name.toLowerCase().includes(normalizedQuery),
      )
    : compatibleTargets;
  const hasTargetChoices = compatibleTargets.length > 0;
  const createKinds: LinkedTargetKind[] = isWaypoint(element)
    ? ["translation", "waypoint"]
    : ["translation"];
  const statusLabel = currentTarget
    ? `Linked to ${currentTarget.display_name}`
    : "Unlinked";

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
      <div className="linked-element-menu__panel" role="menu">
        <div className="linked-element-menu__status">
          <span>{currentTarget ? "Linked" : "Unlinked"}</span>
          <strong>{statusLabel}</strong>
        </div>
        {hasTargetChoices ? (
          <div className="linked-element-menu__target-picker">
            {compatibleTargets.length >= linkedTargetSearchThreshold ? (
              <input
                aria-label="Filter linked elements"
                value={query}
                placeholder="Filter linked elements"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            ) : null}
            <div className="linked-element-menu__target-list" role="group">
              {visibleTargets.length > 0 ? (
                visibleTargets.map((target) => (
                  <button
                    key={target.target_id}
                    type="button"
                    role="menuitem"
                    className={
                      target.target_id === currentTargetId ? "is-current" : ""
                    }
                    disabled={target.target_id === currentTargetId}
                    onClick={(event) => {
                      onLinkTarget(target.target_id);
                      closeContainingDetails(event.currentTarget);
                    }}
                  >
                    <span>{target.display_name}</span>
                    <small>{formatLinkedTargetKind(target.kind)}</small>
                  </button>
                ))
              ) : (
                <div className="linked-element-menu__empty">
                  No matching linked elements.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="linked-element-menu__empty">
            No compatible linked elements yet.
          </div>
        )}
        <div className="linked-element-menu__separator" role="separator" />
        {createKinds.map((kind) => (
          <button
            key={kind}
            type="button"
            role="menuitem"
            onClick={(event) => {
              onCreateLinkedTarget(kind);
              closeContainingDetails(event.currentTarget);
            }}
          >
            <span>
              {kind === "waypoint"
                ? "Create Linked Waypoint"
                : "Create Linked Translation"}
            </span>
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          onClick={(event) => {
            onOpenLinkedTargetPicker();
            closeContainingDetails(event.currentTarget);
          }}
        >
          <span>
            {currentTarget ? "Open in Field Preview..." : "Field Preview..."}
          </span>
          <small>{compatibleTargets.length}</small>
        </button>
        {currentTargetId ? (
          <button
            type="button"
            role="menuitem"
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

function formatLinkedTargetKind(kind: LinkedTargetKind): string {
  return kind === "waypoint" ? "Waypoint" : "Translation";
}

function closeContainingDetails(element: HTMLElement): void {
  element.closest("details")?.removeAttribute("open");
}

const linkedTargetSearchThreshold = 6;

function TranslationFields({
  element,
  fieldGeometry,
  onUpdateElement,
}: {
  element: Extract<PathElement, { type: "translation" }>;
  fieldGeometry: FieldGeometry;
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
  onUpdateElement,
}: {
  element: Extract<PathElement, { type: "waypoint" }>;
  fieldGeometry: FieldGeometry;
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
  value,
  step,
  onChange,
}: {
  label: string;
  value: number | null;
  step: number;
  onChange(value: number | null): void;
}) {
  return (
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
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
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

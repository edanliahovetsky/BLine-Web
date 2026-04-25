import {
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type PathElement
} from "../../../core/model/path";
import {
  type AddableElementType,
  elementTypeValue,
  updateEventTrigger,
  updateRotationTarget,
  updateTranslationTarget,
  updateWaypoint
} from "../sidebarCommands";

interface PropertyEditorProps {
  element: PathElement | null;
  selectedElementIndex: number | null;
  onChangeType(type: AddableElementType): void;
  onUpdateElement(element: PathElement): void;
}

export function PropertyEditor({
  element,
  selectedElementIndex,
  onChangeType,
  onUpdateElement
}: PropertyEditorProps) {
  return (
    <section className="inspector-section property-editor-section">
      <header className="inspector-section__header">
        <h2>Element Properties</h2>
      </header>

      {element ? (
        <div
          className="property-editor"
          data-testid="property-editor"
          aria-label={`Element ${selectedElementIndex === null ? "" : selectedElementIndex + 1} properties`}
        >
          <TypeField element={element} onChangeType={onChangeType} />
          {isTranslationTarget(element) ? (
            <TranslationFields
              element={element}
              onUpdateElement={(nextElement) => onUpdateElement(nextElement)}
            />
          ) : null}
          {isWaypoint(element) ? (
            <WaypointFields
              element={element}
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
      ) : (
        <div className="sidebar-empty-state">No element selected</div>
      )}
    </section>
  );
}

function TypeField({
  element,
  onChangeType
}: {
  element: PathElement;
  onChangeType(type: AddableElementType): void;
}) {
  return (
    <label className="property-row">
      <span>Type</span>
      <select
        aria-label="Type"
        value={elementTypeValue(element)}
        onChange={(event) =>
          onChangeType(event.currentTarget.value as AddableElementType)
        }
      >
        <option value="translation">Translation</option>
        <option value="waypoint">Waypoint</option>
        <option value="rotation">Rotation</option>
        <option value="event_trigger">Event Trigger</option>
      </select>
    </label>
  );
}

function TranslationFields({
  element,
  onUpdateElement
}: {
  element: Extract<PathElement, { type: "translation" }>;
  onUpdateElement(element: PathElement): void;
}) {
  return (
    <>
      <NumberField
        label="X (m)"
        value={element.x_meters}
        step={0.001}
        onChange={(value) =>
          onUpdateElement(updateTranslationTarget(element, { x_meters: value }))
        }
      />
      <NumberField
        label="Y (m)"
        value={element.y_meters}
        step={0.001}
        onChange={(value) =>
          onUpdateElement(updateTranslationTarget(element, { y_meters: value }))
        }
      />
      <OptionalNumberField
        label="Handoff Radius (m)"
        value={element.intermediate_handoff_radius_meters}
        step={0.001}
        onChange={(value) =>
          onUpdateElement(
            updateTranslationTarget(element, {
              intermediate_handoff_radius_meters: value
            })
          )
        }
      />
    </>
  );
}

function WaypointFields({
  element,
  onUpdateElement
}: {
  element: Extract<PathElement, { type: "waypoint" }>;
  onUpdateElement(element: PathElement): void;
}) {
  return (
    <>
      <NumberField
        label="Rotation (deg)"
        value={radiansToDegrees(element.rotation_target.rotation_radians)}
        step={0.001}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              rotation: { rotation_radians: degreesToRadians(value) }
            })
          )
        }
      />
      <NumberField
        label="X (m)"
        value={element.translation_target.x_meters}
        step={0.001}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              translation: { x_meters: value }
            })
          )
        }
      />
      <NumberField
        label="Y (m)"
        value={element.translation_target.y_meters}
        step={0.001}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              translation: { y_meters: value }
            })
          )
        }
      />
      <OptionalNumberField
        label="Handoff Radius (m)"
        value={element.translation_target.intermediate_handoff_radius_meters}
        step={0.001}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              translation: { intermediate_handoff_radius_meters: value }
            })
          )
        }
      />
      <BooleanField
        label="Profiled Rotation"
        checked={element.rotation_target.profiled_rotation}
        onChange={(checked) =>
          onUpdateElement(
            updateWaypoint(element, {
              rotation: { profiled_rotation: checked }
            })
          )
        }
      />
    </>
  );
}

function RotationFields({
  element,
  onUpdateElement
}: {
  element: Extract<PathElement, { type: "rotation" }>;
  onUpdateElement(element: PathElement): void;
}) {
  return (
    <>
      <NumberField
        label="Rotation (deg)"
        value={radiansToDegrees(element.rotation_radians)}
        step={0.001}
        onChange={(value) =>
          onUpdateElement(
            updateRotationTarget(element, { rotation_radians: degreesToRadians(value) })
          )
        }
      />
      <NumberField
        label="Rotation Pos (0-1)"
        value={element.t_ratio}
        step={0.001}
        min={0}
        max={1}
        onChange={(value) =>
          onUpdateElement(updateRotationTarget(element, { t_ratio: clamp01(value) }))
        }
      />
      <BooleanField
        label="Profiled Rotation"
        checked={element.profiled_rotation}
        onChange={(checked) =>
          onUpdateElement(updateRotationTarget(element, { profiled_rotation: checked }))
        }
      />
    </>
  );
}

function EventFields({
  element,
  onUpdateElement
}: {
  element: Extract<PathElement, { type: "event_trigger" }>;
  onUpdateElement(element: PathElement): void;
}) {
  return (
    <>
      <NumberField
        label="Event Pos (0-1)"
        value={element.t_ratio}
        step={0.001}
        min={0}
        max={1}
        onChange={(value) =>
          onUpdateElement(updateEventTrigger(element, { t_ratio: clamp01(value) }))
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
              updateEventTrigger(element, { lib_key: event.currentTarget.value })
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
  onChange
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
      <input
        aria-label={label}
        type="number"
        value={formatNumericValue(value)}
        step={step}
        min={min}
        max={max}
        onChange={(event) => onChange(parseRequiredNumber(event.currentTarget.value))}
      />
    </label>
  );
}

function OptionalNumberField({
  label,
  value,
  step,
  onChange
}: {
  label: string;
  value: number | null;
  step: number;
  onChange(value: number | null): void;
}) {
  return (
    <label className="property-row">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        value={value === null ? "" : formatNumericValue(value)}
        step={step}
        min={0}
        onChange={(event) => onChange(parseOptionalNumber(event.currentTarget.value))}
      />
    </label>
  );
}

function BooleanField({
  label,
  checked,
  onChange
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

function formatNumericValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function parseRequiredNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

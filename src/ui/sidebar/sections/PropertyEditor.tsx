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
import {
  DimensionName,
  dimensions,
  UnitExpression,
} from "../../../core/math/units";
import { ExpressionInput } from "../../controls/ExpressionControls";

interface PropertyEditorProps {
  element: PathElement | null;
  selectedElementIndex: number | null;
  open: boolean;
  typeOptions: readonly AddableElementType[];
  onToggleSection(): void;
  onChangeType(type: AddableElementType): void;
  onUpdateElement(element: PathElement): void;
}

export function PropertyEditor({
  element,
  selectedElementIndex,
  open,
  typeOptions,
  onToggleSection,
  onChangeType,
  onUpdateElement,
}: PropertyEditorProps) {
  if (!element) {
    return null;
  }

  return (
    <SidebarSection
      className="property-editor-section"
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

function TranslationFields({
  element,
  onUpdateElement,
}: {
  element: Extract<PathElement, { type: "translation" }>;
  onUpdateElement(element: PathElement): void;
}) {
  return (
    <>
      <ExpressionField
        label="X"
        value={element.x}
        onChange={(value) =>
          onUpdateElement(updateTranslationTarget(element, { x: value }))
        }
      />
      <ExpressionField
        label="Y"
        value={element.y}
        onChange={(value) =>
          onUpdateElement(updateTranslationTarget(element, { y: value }))
        }
      />
      <OptionalExpressionField
        label="Handoff Radius"
        value={element.intermediate_handoff_radius}
        dimension={"Length"}
        onChange={(value) =>
          onUpdateElement(
            updateTranslationTarget(element, {
              intermediate_handoff_radius: value,
            }),
          )
        }
      />
    </>
  );
}

function WaypointFields({
  element,
  onUpdateElement,
}: {
  element: Extract<PathElement, { type: "waypoint" }>;
  onUpdateElement(element: PathElement): void;
}) {
  return (
    <>
      <ExpressionField
        label="Rotation"
        value={element.rotation_target.rotation}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              rotation: { rotation: value },
            }),
          )
        }
      />
      <ExpressionField
        label="X"
        value={element.translation_target.x}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              translation: { x: value },
            }),
          )
        }
      />
      <ExpressionField
        label="Y"
        value={element.translation_target.y}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              translation: { y: value },
            }),
          )
        }
      />
      <OptionalExpressionField
        label="Handoff Radius"
        value={element.translation_target.intermediate_handoff_radius}
        dimension={"Length"}
        onChange={(value) =>
          onUpdateElement(
            updateWaypoint(element, {
              translation: { intermediate_handoff_radius: value },
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
      <ExpressionField
        label="Rotation"
        value={element.rotation}
        onChange={(value) =>
          onUpdateElement(updateRotationTarget(element, { rotation: value }))
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

/*function OptionalNumberField({
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
}*/

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

export function ExpressionField<D extends DimensionName>({
  label,
  value,
  onChange,
}: {
  label: string;
  value: UnitExpression<D>;
  onChange(value: UnitExpression<D>): void;
}) {
  return (
    <label className="property-row">
      <span>{label}</span>
      <ExpressionInput
        ariaLabel={`${dimensions[value.dimension].name} Expression`}
        value={value}
        dimension={value.dimension}
        onChange={onChange}
      />
    </label>
  );
}

export function OptionalExpressionField<D extends DimensionName>({
  label,
  value,
  dimension,
  onChange,
}: {
  label: string;
  value: UnitExpression<D> | null;
  dimension: D;
  onChange(value: UnitExpression<D> | null): void;
}) {
  return (
    <label className="property-row">
      <span>{label}</span>
      <ExpressionInput
        allowEmpty
        ariaLabel={`${dimensions[dimension].name} Expression`}
        value={value}
        dimension={dimension}
        onChange={onChange}
      />
    </label>
  );
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

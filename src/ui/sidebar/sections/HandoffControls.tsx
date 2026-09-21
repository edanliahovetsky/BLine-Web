import type { CanonicalProjectConfig } from "../../../core/config/projectConfig";
import type { AnchorHandoffRadius } from "../../../core/model/handoffRadii";
import type { HandoffMode, PathModel } from "../../../core/model/path";
import {
  createSetHandoffModeCommand,
  createSetHandoffRadiusCommand,
} from "../../../canvas/modelSync";
import { projectStore } from "../../../state/projectStore";
import { NumberStepperControl } from "../../controls";
import { AutoVelocityModeControl } from "../../controls/AutoVelocityModeControl";
import { DropdownSelectControl } from "../../controls/DropdownSelectControl";

export function HandoffModeControl({
  value,
  inherited,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: HandoffMode | undefined;
  inherited: HandoffMode;
  onChange(mode: HandoffMode | undefined): void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <DropdownSelectControl
      ariaLabel={ariaLabel}
      value={value ?? "default"}
      options={
        [
          {
            value: "default",
            label: `Default (${inherited === "radius" ? "Radius" : "Progress"})`,
            disabled,
          },
          { value: "radius", label: "Radius", disabled },
          { value: "progress", label: "Progress", disabled },
        ] as const
      }
      onChange={(mode) => onChange(mode === "default" ? undefined : mode)}
    />
  );
}

/** Authored-element handoff controls in the constraints ledger. */
export function ElementHandoffControls({
  path,
  config,
  chip,
  disabled = false,
}: {
  path: PathModel;
  config: CanonicalProjectConfig;
  chip: AnchorHandoffRadius | null;
  disabled?: boolean;
}) {
  if (!chip || chip.inert) return null;
  const element = path.path_elements[chip.elementIndex];
  const target =
    element.type === "waypoint"
      ? element.translation_target
      : element.type === "translation"
        ? element
        : null;
  if (!target) return null;
  const updateDistance = (
    source: "auto" | "manual",
    radiusMeters = chip.effectiveValueMeters,
  ) => {
    projectStore
      .getState()
      .applyPathCommand(
        createSetHandoffRadiusCommand(
          chip.elementIndex,
          { radiusMeters: chip.valueMeters, source: chip.source },
          { radiusMeters, source },
        ),
      );
  };
  return (
    <div
      className="handoff-controls"
      data-testid="handoff-radius-detail"
      data-tour="element-handoff"
    >
      <AutoVelocityModeControl
        ariaLabel="Handoff distance source"
        disabled={disabled}
        mode={chip.state === "unset" ? null : chip.state}
        onModeChange={(source) => updateDistance(source)}
      />
      <div className="constraint-value-input">
        <NumberStepperControl
          ariaLabel={`Handoff distance ${chip.ordinal} (m)`}
          value={chip.effectiveValueMeters}
          step={0.05}
          min={0}
          disabled={disabled || chip.state === "auto"}
          onChange={(value) => {
            if (value !== null) updateDistance("manual", value);
          }}
        />
        <span>m</span>
      </div>
      <HandoffModeControl
        ariaLabel={`Handoff mode ${chip.ordinal}`}
        disabled={disabled}
        value={target.handoff_mode}
        inherited={
          path.handoff_mode ??
          config.kinematic_constraints.default_handoff_mode ??
          "radius"
        }
        onChange={(mode) =>
          projectStore
            .getState()
            .applyPathCommand(
              createSetHandoffModeCommand(path, chip.elementIndex, mode),
            )
        }
      />
    </div>
  );
}

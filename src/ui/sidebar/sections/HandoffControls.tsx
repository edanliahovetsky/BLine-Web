import { RotateCcw } from "lucide-react";
import type { CanonicalProjectConfig } from "../../../core/config/projectConfig";
import type { AnchorHandoffRadius } from "../../../core/model/handoffRadii";
import type { PathModel } from "../../../core/model/path";
import {
  createSetHandoffModeCommand,
  createSetHandoffRadiusCommand,
} from "../../../canvas/modelSync";
import { projectStore } from "../../../state/projectStore";
import { NumberStepperControl, TooltipIconButton } from "../../controls";
import { AutoVelocityModeControl } from "../../controls/AutoVelocityModeControl";
import { HandoffProgressIcon, HandoffRadiusIcon } from "../../icons";

export function HandoffModeControl({
  path,
  config,
  chips,
  disabled = false,
  ariaLabel,
}: {
  path: PathModel;
  config: CanonicalProjectConfig;
  chips: readonly AnchorHandoffRadius[];
  disabled?: boolean;
  ariaLabel: string;
}) {
  const selected = chips.filter((chip) => !chip.inert);
  const values = selected.map(
    (chip) => handoffTarget(path, chip.elementIndex)?.handoff_mode,
  );
  const inherited =
    path.handoff_mode ??
    config.kinematic_constraints.default_handoff_mode ??
    "radius";
  const defaultSource = path.handoff_mode === undefined ? "project" : "path";
  const resolved = new Set(values.map((value) => value ?? inherited));
  const defaultLabel = inherited === "radius" ? "Radius" : "Progress";
  const origin = values.every((value) => value === undefined)
    ? `Using ${defaultSource} default (${defaultLabel}).`
    : `Element override. Reset on each selected tile to use the ${defaultSource} default (${defaultLabel}).`;
  const selectionNote =
    selected.length > 1
      ? `${resolved.size > 1 ? "Selected points use different modes. " : ""}Applies to all ${selected.length} selected points. `
      : "";
  return (
    <div className="handoff-mode-buttons" role="group" aria-label={ariaLabel}>
      {(["radius", "progress"] as const).map((mode) => (
        <TooltipIconButton
          key={mode}
          aria-label={mode === "radius" ? "Radius" : "Progress"}
          aria-pressed={resolved.size === 1 && resolved.has(mode)}
          title={`${mode === "radius" ? "Radius" : "Progress"} handoff. ${selectionNote}${origin}`}
          disabled={disabled || selected.length === 0}
          onClick={() => {
            if (values.some((value) => value !== mode)) {
              projectStore.getState().applyPathCommand(
                createSetHandoffModeCommand(
                  path,
                  selected.map((chip) => chip.elementIndex),
                  mode,
                ),
              );
            }
          }}
        >
          {mode === "radius" ? <HandoffRadiusIcon /> : <HandoffProgressIcon />}
        </TooltipIconButton>
      ))}
    </div>
  );
}

function handoffTarget(path: PathModel, elementIndex: number) {
  const element = path.path_elements[elementIndex];
  return element?.type === "waypoint"
    ? element.translation_target
    : element?.type === "translation"
      ? element
      : null;
}

/** Kept beside (not inside) the selected tile's button for keyboard access. */
export function HandoffModeReset({
  path,
  config,
  chip,
  disabled,
}: {
  path: PathModel;
  config: CanonicalProjectConfig;
  chip: AnchorHandoffRadius;
  disabled: boolean;
}) {
  const target = handoffTarget(path, chip.elementIndex);
  if (chip.inert || target?.handoff_mode === undefined) return null;
  const inherited =
    path.handoff_mode ??
    config.kinematic_constraints.default_handoff_mode ??
    "radius";
  const source = path.handoff_mode === undefined ? "project" : "path";
  return (
    <TooltipIconButton
      className="handoff-mode-reset"
      aria-label={`Use default handoff mode for point ${chip.ordinal}`}
      title={`Use ${source} default (${inherited === "radius" ? "Radius" : "Progress"}). Distance and Auto/Manual stay unchanged.`}
      disabled={disabled}
      onClick={() =>
        projectStore
          .getState()
          .applyPathCommand(
            createSetHandoffModeCommand(path, chip.elementIndex, undefined),
          )
      }
    >
      <RotateCcw size={12} />
    </TooltipIconButton>
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
  const target = handoffTarget(path, chip.elementIndex);
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
      <div className="handoff-controls__geometry">
        <div className="handoff-distance-control">
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
          <span aria-hidden="true">m</span>
        </div>
        <HandoffModeControl
          ariaLabel={`Handoff mode ${chip.ordinal}`}
          disabled={disabled}
          path={path}
          config={config}
          chips={[chip]}
        />
      </div>
    </div>
  );
}

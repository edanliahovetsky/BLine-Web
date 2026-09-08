import { evaluateRotationFeasibility } from "../../core/sim/rotationFeasibility";
import { getElementPosition } from "../../canvas/geometry";
import { getPathElementLinkedTargetId } from "../../core/linkedTargets";
import {
  isPointWithinFieldCoordinates,
  type FieldGeometry,
} from "../../core/field/fieldConfig";
import type { LinkedTarget } from "../../core/model/project";
import {
  buildGlobalRotationTargets,
  buildSegments,
  evaluateRotationTargets,
  radiansToDegrees,
  simulatePathWithTrace,
  type SimulationConfig,
} from "../../core/sim";
import {
  isAnchorElement,
  isEventTrigger,
  type PathModel,
} from "../../core/model/path";

export type PathDiagnosticSeverity = "error" | "warning" | "info";

export type PathDiagnosticFix =
  | { kind: "add-anchors"; count: number; label: string }
  | { kind: "focus-event-key"; elementIndex: number; label: string }
  | { kind: "move-inside-field"; elementIndex: number; label: string }
  | { kind: "remove-missing-link"; elementIndex: number; label: string };

export interface PathDiagnostic {
  id: string;
  severity: PathDiagnosticSeverity;
  summary: string;
  elementIndex?: number;
  fix?: PathDiagnosticFix;
}

export function derivePathDiagnostics(
  path: PathModel | null,
  geometry: FieldGeometry | null,
  linkedTargets: readonly LinkedTarget[],
  config: SimulationConfig = {},
): PathDiagnostic[] {
  if (!path || !geometry) {
    return [];
  }

  const diagnostics: PathDiagnostic[] = [];
  const elements = path.path_elements;
  const anchorCount = elements.filter(isAnchorElement).length;
  if (anchorCount < 2) {
    const missingAnchorCount = 2 - anchorCount;
    diagnostics.push({
      id: "anchor-count",
      severity: "warning",
      summary:
        anchorCount === 0
          ? "Add two waypoints or translation targets to simulate this path."
          : "Add one more waypoint or translation target to simulate this path.",
      fix: {
        kind: "add-anchors",
        count: missingAnchorCount,
        label:
          missingAnchorCount === 1 ? "Add a waypoint" : "Add two waypoints",
      },
    });
  }

  elements.forEach((element, index) => {
    if (isEventTrigger(element) && !element.lib_key.trim()) {
      diagnostics.push({
        id: `event-key-${index}`,
        severity: "warning",
        summary: `Event ${index + 1} command key empty.`,
        elementIndex: index,
        fix: {
          kind: "focus-event-key",
          elementIndex: index,
          label: "Enter command key",
        },
      });
    }

    const position = getElementPosition(elements, index);
    const linkedTargetId = getPathElementLinkedTargetId(element);
    const linkedTarget = linkedTargetId
      ? linkedTargets.find((target) => target.target_id === linkedTargetId)
      : undefined;
    if (position && !isPointWithinFieldCoordinates(position, geometry)) {
      diagnostics.push({
        id: `off-field-${index}`,
        severity: "warning",
        summary: `Element ${index + 1} is outside the configured field.`,
        elementIndex: index,
        ...(isAnchorElement(element) && !linkedTarget?.locked
          ? {
              fix: {
                kind: "move-inside-field" as const,
                elementIndex: index,
                label: "Move element onto field",
              },
            }
          : {}),
      });
    }

    if (linkedTargetId && !linkedTarget) {
      diagnostics.push({
        id: `broken-link-${index}`,
        severity: "error",
        summary: `Element ${index + 1} references a missing linked element.`,
        elementIndex: index,
        fix: {
          kind: "remove-missing-link",
          elementIndex: index,
          label: "Remove missing link",
        },
      });
    }
  });

  if (anchorCount >= 2) {
    const { anchors, cumulativeLengths } = buildSegments(path);
    const rotationTargets = buildGlobalRotationTargets(
      path,
      anchors,
      cumulativeLengths,
    );
    if (rotationTargets.length > 0) {
      try {
        const result = simulatePathWithTrace(path, config, { dt_s: 0.02 });
        for (const target of evaluateRotationFeasibility(
          path,
          config,
          result.trace,
        )) {
          if (target.passed) continue;
          const detail =
            target.reason === "unreached"
              ? "is never reached by the translation path."
              : target.reason === "conflicting-targets"
                ? "conflicts with another rotation at the same location."
                : target.reason === "angular-transition"
                  ? "cannot make the angular velocity transition within its limits."
                  : `needs at least ${target.requiredTimeS.toFixed(2)} s to turn; only ${target.availableTimeS.toFixed(2)} s is available before arrival or handoff.`;
          diagnostics.push({
            id: `rotation-feasibility-${target.eventOrdinal}`,
            severity: "warning",
            summary: `Rotation ${target.eventOrdinal} ${detail}`,
            elementIndex: target.elementIndex,
          });
        }
        for (const target of evaluateRotationTargets(
          rotationTargets,
          result.trace,
        )) {
          if (target.passed) {
            continue;
          }
          const missDegrees = Number.isFinite(target.error_rad)
            ? `${radiansToDegrees(target.error_rad).toFixed(1)}°`
            : "an unknown amount";
          diagnostics.push({
            id: `rotation-target-${target.event_ordinal_1b}`,
            severity: "warning",
            summary: `Preview tracking: rotation ${target.event_ordinal_1b} misses its target by ${missDegrees} on arrival.`,
            elementIndex: target.path_element_index,
          });
        }
      } catch {
        diagnostics.push({
          id: "rotation-evaluation",
          severity: "warning",
          summary: "Rotation targets could not be evaluated by the simulator.",
        });
      }
    }
  }

  return diagnostics;
}

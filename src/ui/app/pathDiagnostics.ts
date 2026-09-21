import { hasAuthoredStart } from "../../core/model/pathPreview";
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
  if (anchorCount === 0) {
    diagnostics.push({
      id: "anchor-count",
      severity: "warning",
      summary: "Add a waypoint or translation target to simulate this path.",
      fix: { kind: "add-anchors", count: 1, label: "Add a waypoint" },
    });
  }

  if (elements.length > 0 && !isAnchorElement(elements.at(-1)!)) {
    diagnostics.push({
      id: "path-end",
      severity: "error",
      summary: "The final element must be a waypoint or translation target.",
      fix: { kind: "add-anchors", count: 1, label: "Add a waypoint" },
    });
  }
  if (anchorCount > 0 && !hasAuthoredStart(path)) {
    diagnostics.push({
      id: "current-pose-start",
      severity: "info",
      summary:
        "This path starts at the robot’s current pose. The ghost waypoint sets its preview start.",
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

  const tank = config.gui?.robot?.drive_type === "tank";
  if (tank && anchorCount > 0) {
    const ignored = elements.findIndex(
      (element, index) =>
        element.type === "rotation" ||
        (element.type === "waypoint" &&
          index > 0 &&
          index < elements.length - 1),
    );
    if (ignored >= 0)
      diagnostics.push({
        id: "tank-intermediate-rotations",
        severity: "info",
        elementIndex: ignored,
        summary: "Tank drive ignores intermediate rotation targets.",
      });
    try {
      const result = simulatePathWithTrace(path, config, { dt_s: 0.02 });
      if (!result.completed)
        diagnostics.push({
          id: "tank-incomplete",
          severity: "warning",
          summary:
            "Tank preview did not finish. Check the path geometry and motion limits.",
        });
    } catch {
      diagnostics.push({
        id: "tank-evaluation",
        severity: "warning",
        summary: "Tank motion could not be simulated with these limits.",
      });
    }
  }
  if (!tank && anchorCount > 0) {
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

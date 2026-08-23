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

export interface PathDiagnostic {
  id: string;
  severity: PathDiagnosticSeverity;
  summary: string;
  elementIndex?: number;
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
    diagnostics.push({
      id: "anchor-count",
      severity: "warning",
      summary:
        anchorCount === 0
          ? "Add two waypoints or translation targets to simulate this path."
          : "Add one more waypoint or translation target to simulate this path.",
    });
  }

  elements.forEach((element, index) => {
    if (isEventTrigger(element) && !element.lib_key.trim()) {
      diagnostics.push({
        id: `event-key-${index}`,
        severity: "warning",
        summary: `Event ${index + 1} needs a command key.`,
        elementIndex: index,
      });
    }

    const position = getElementPosition(elements, index);
    if (position && !isPointWithinFieldCoordinates(position, geometry)) {
      diagnostics.push({
        id: `off-field-${index}`,
        severity: "warning",
        summary: `Element ${index + 1} is outside the configured field.`,
        elementIndex: index,
      });
    }

    const linkedTargetId = getPathElementLinkedTargetId(element);
    if (
      linkedTargetId &&
      !linkedTargets.some((target) => target.target_id === linkedTargetId)
    ) {
      diagnostics.push({
        id: `broken-link-${index}`,
        severity: "error",
        summary: `Element ${index + 1} references a missing linked element.`,
        elementIndex: index,
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
            summary: `Rotation ${target.event_ordinal_1b} misses its target by ${missDegrees} on arrival.`,
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

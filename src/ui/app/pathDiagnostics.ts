import { getElementPosition } from "../../canvas/geometry";
import { getPathElementLinkedTargetId } from "../../core/linkedTargets";
import {
  isPointWithinFieldCoordinates,
  type FieldGeometry,
} from "../../core/field/fieldConfig";
import type { LinkedTarget } from "../../core/model/project";
import {
  isAnchorElement,
  isEventTrigger,
  type PathModel,
} from "../../core/model/path";

export type PathDiagnosticSeverity = "error" | "warning" | "info";

export type PathDiagnosticFix =
  | { kind: "add-anchors"; count: number; label: string }
  | {
      kind: "set-event-key";
      elementIndex: number;
      value: string;
      label: string;
    }
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
        summary: `Event ${index + 1} needs a command key.`,
        elementIndex: index,
        fix: {
          kind: "set-event-key",
          elementIndex: index,
          value: "event",
          label: 'Set key to "event"',
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

    if (
      linkedTargetId &&
      !linkedTarget
    ) {
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

  return diagnostics;
}

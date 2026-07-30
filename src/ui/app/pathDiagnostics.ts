import { getElementPosition } from "../../canvas/geometry";
import { getPathElementLinkedTargetId } from "../../core/linkedTargets";
import type {
  ProjectDocument,
  ProjectWorkspaceDocument,
} from "../../core/io/projectSchema";
import { fieldGeometryFromConfig } from "../../core/field/fieldConfig";
import { isAnchorElement, isEventTrigger } from "../../core/model/path";

export type PathDiagnosticSeverity = "error" | "warning" | "info";

export interface PathDiagnostic {
  id: string;
  severity: PathDiagnosticSeverity;
  summary: string;
  elementIndex?: number;
}

export function derivePathDiagnostics(
  project: ProjectDocument | null,
  workspace: ProjectWorkspaceDocument | null,
): PathDiagnostic[] {
  if (!project) {
    return [];
  }

  const diagnostics: PathDiagnostic[] = [];
  const elements = project.path.path_elements;
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

  const geometry = fieldGeometryFromConfig(project.config.gui.field);
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
    if (
      position &&
      (position.x_meters < 0 ||
        position.y_meters < 0 ||
        position.x_meters > geometry.length_meters ||
        position.y_meters > geometry.width_meters)
    ) {
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
      !workspace?.linked_targets.some(
        (target) => target.target_id === linkedTargetId,
      )
    ) {
      diagnostics.push({
        id: `broken-link-${index}`,
        severity: "error",
        summary: `Element ${index + 1} references a missing linked element.`,
        elementIndex: index,
      });
    }
  });

  return diagnostics;
}

import { getPathElementLinkedTargetId } from "../linkedTargets";
import type { PathModel } from "../model/path";
import type {
  SerializedPathEditorMetadata,
  SerializedRangedConstraintMetadata,
} from "./projectSchema";

/** Editor-owned Path details that must survive Project and legacy round trips. */
export function serializePathEditorMetadata(
  path: PathModel,
): SerializedPathEditorMetadata | undefined {
  const linkedTargets = path.path_elements.flatMap((element, index) => {
    const targetId = getPathElementLinkedTargetId(element);
    return targetId ? [{ element_index: index, target_id: targetId }] : [];
  });
  const rangedConstraints = path.ranged_constraints.flatMap((constraint) => {
    if (constraint.source !== "auto_velocity") {
      return [];
    }

    const metadata: SerializedRangedConstraintMetadata = {
      key: constraint.key,
      value: Number(constraint.value),
      start_ordinal: Math.trunc(constraint.start_ordinal),
      end_ordinal: Math.trunc(constraint.end_ordinal),
      source: constraint.source,
    };
    if (constraint.auto_velocity) {
      metadata.auto_velocity = structuredClone(constraint.auto_velocity);
    }
    return [metadata];
  });

  if (rangedConstraints.length === 0 && linkedTargets.length === 0) {
    return undefined;
  }

  return {
    ...(rangedConstraints.length > 0
      ? { ranged_constraints: rangedConstraints }
      : {}),
    ...(linkedTargets.length > 0 ? { linked_targets: linkedTargets } : {}),
  };
}

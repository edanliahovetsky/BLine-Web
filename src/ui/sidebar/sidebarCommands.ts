import {
  fieldCoordinateOffsetMeters,
  fieldLengthMeters,
  fieldWidthMeters,
  robotLengthMeters,
  robotWidthMeters
} from "../../canvas/constants";
import { getElementHeadingRadians, getElementPosition } from "../../canvas/geometry";
import { remapRangedConstraints } from "../../core/constraints/rangedConstraints";
import type { ProjectDocument } from "../../core/io/projectSchema";
import {
  createEventTrigger,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
  isEventTrigger,
  isRotationTarget,
  isTranslationTarget,
  isWaypoint,
  type EventTrigger,
  type PathElement,
  type RotationTarget,
  type TranslationTarget,
  type Waypoint
} from "../../core/model/path";
import type { HistoryCommand } from "../../state/historyStore";

export type AddableElementType = PathElement["type"];

export function createInsertPathElementCommand(
  index: number,
  element: PathElement
): HistoryCommand<ProjectDocument> {
  return {
    description: `Insert ${element.type} element`,
    apply: (project) => {
      const nextProject = structuredClone(project);
      const previousElements = nextProject.path.path_elements.slice();
      const insertionIndex = clampIndex(index, nextProject.path.path_elements.length);
      nextProject.path.path_elements.splice(insertionIndex, 0, structuredClone(element));
      remapRangedConstraints(nextProject.path, previousElements);
      return nextProject;
    },
    revert: (project) => {
      const nextProject = structuredClone(project);
      const previousElements = nextProject.path.path_elements.slice();
      const removalIndex = clampIndex(index, nextProject.path.path_elements.length - 1);
      nextProject.path.path_elements.splice(removalIndex, 1);
      remapRangedConstraints(nextProject.path, previousElements);
      return nextProject;
    }
  };
}

export function createRemovePathElementCommand(
  index: number,
  element: PathElement
): HistoryCommand<ProjectDocument> {
  return {
    description: `Remove ${element.type} element`,
    apply: (project) => {
      const nextProject = structuredClone(project);
      if (index >= 0 && index < nextProject.path.path_elements.length) {
        const previousElements = nextProject.path.path_elements.slice();
        nextProject.path.path_elements.splice(index, 1);
        remapRangedConstraints(nextProject.path, previousElements);
      }
      return nextProject;
    },
    revert: (project) => {
      const nextProject = structuredClone(project);
      const previousElements = nextProject.path.path_elements.slice();
      const insertionIndex = clampIndex(index, nextProject.path.path_elements.length);
      nextProject.path.path_elements.splice(insertionIndex, 0, structuredClone(element));
      remapRangedConstraints(nextProject.path, previousElements);
      return nextProject;
    }
  };
}

export function createUpdatePathElementCommand(
  index: number,
  previousElement: PathElement,
  nextElement: PathElement
): HistoryCommand<ProjectDocument> {
  return {
    description: `Update element ${index + 1}`,
    apply: (project) => replaceElement(project, index, nextElement),
    revert: (project) => replaceElement(project, index, previousElement)
  };
}

export function createDefaultElement(
  project: ProjectDocument,
  type: AddableElementType,
  selectedIndex: number | null
): PathElement {
  const position = defaultPosition(project, selectedIndex);
  const headingRadians = selectedIndex === null
    ? 0
    : (getElementHeadingRadians(project.path.path_elements, selectedIndex) ?? 0);

  if (type === "translation") {
    return createTranslationTarget({
      x_meters: position.x_meters,
      y_meters: position.y_meters,
      intermediate_handoff_radius_meters: 0.25
    });
  }

  if (type === "waypoint") {
    return createWaypoint({
      translation_target: createTranslationTarget({
        x_meters: position.x_meters,
        y_meters: position.y_meters,
        intermediate_handoff_radius_meters: 0.25
      }),
      rotation_target: createRotationTarget({
        rotation_radians: headingRadians,
        t_ratio: 0
      })
    });
  }

  if (type === "rotation") {
    return createRotationTarget({
      rotation_radians: headingRadians,
      t_ratio: 0.5
    });
  }

  return createEventTrigger({
    t_ratio: 0.5,
    lib_key: "event"
  });
}

export function getInsertionIndex(
  project: ProjectDocument,
  type: AddableElementType,
  selectedIndex: number | null
): number {
  const length = project.path.path_elements.length;
  const baseIndex = selectedIndex === null ? length : selectedIndex + 1;

  if (type === "rotation" || type === "event_trigger") {
    if (length < 2) {
      return length;
    }
    return clamp(baseIndex, 1, length - 1);
  }

  return clampIndex(baseIndex, length);
}

export function updateTranslationTarget(
  element: TranslationTarget,
  update: Partial<Omit<TranslationTarget, "type">>
): TranslationTarget {
  return {
    ...element,
    ...update
  };
}

export function updateWaypoint(
  element: Waypoint,
  update: {
    translation?: Partial<Omit<TranslationTarget, "type">>;
    rotation?: Partial<Omit<RotationTarget, "type">>;
  }
): Waypoint {
  return {
    ...element,
    translation_target: {
      ...element.translation_target,
      ...update.translation
    },
    rotation_target: {
      ...element.rotation_target,
      ...update.rotation
    }
  };
}

export function updateRotationTarget(
  element: RotationTarget,
  update: Partial<Omit<RotationTarget, "type">>
): RotationTarget {
  return {
    ...element,
    ...update
  };
}

export function updateEventTrigger(
  element: EventTrigger,
  update: Partial<Omit<EventTrigger, "type">>
): EventTrigger {
  return {
    ...element,
    ...update
  };
}

export function elementTypeLabel(element: PathElement): string {
  if (isTranslationTarget(element)) {
    return "Translation";
  }

  if (isWaypoint(element)) {
    return "Waypoint";
  }

  if (isRotationTarget(element)) {
    return "Rotation";
  }

  if (isEventTrigger(element)) {
    return "Event Trigger";
  }

  return "Element";
}

export function elementTypeValue(element: PathElement): AddableElementType {
  return element.type;
}

function replaceElement(
  project: ProjectDocument,
  index: number,
  element: PathElement
): ProjectDocument {
  const nextProject = structuredClone(project);
  if (index >= 0 && index < nextProject.path.path_elements.length) {
    nextProject.path.path_elements[index] = structuredClone(element);
  }
  return nextProject;
}

function defaultPosition(
  project: ProjectDocument,
  selectedIndex: number | null
): { x_meters: number; y_meters: number } {
  const selectedPosition =
    selectedIndex === null
      ? null
      : getElementPosition(project.path.path_elements, selectedIndex);
  const fallbackPosition =
    selectedPosition ??
    getElementPosition(
      project.path.path_elements,
      Math.max(0, project.path.path_elements.length - 1)
    );

  return clampFieldPosition({
    x_meters: (fallbackPosition?.x_meters ?? fieldLengthMeters / 2) + 0.75,
    y_meters: (fallbackPosition?.y_meters ?? fieldWidthMeters / 2) + 0.35
  });
}

function clampFieldPosition(point: { x_meters: number; y_meters: number }) {
  const halfRobotLength = robotLengthMeters / 2;
  const halfRobotWidth = robotWidthMeters / 2;
  return {
    x_meters: clamp(
      point.x_meters,
      halfRobotLength,
      fieldLengthMeters - fieldCoordinateOffsetMeters * 2 - halfRobotLength
    ),
    y_meters: clamp(
      point.y_meters,
      halfRobotWidth,
      fieldWidthMeters - fieldCoordinateOffsetMeters * 2 - halfRobotWidth
    )
  };
}

function clampIndex(index: number, length: number): number {
  return clamp(index, 0, Math.max(0, length));
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

import { createProjectConfig } from "../../core/config/projectConfig";
import {
  createPathModel,
  createWaypoint,
  createTranslationTarget,
  createRotationTarget,
  isAnchorElement,
  type PathModel,
} from "../../core/model/path";
import type { ProjectConfig } from "../../core/model/project";
import {
  simulatePathWithTrace,
  type SimulationTraceSample,
} from "../../core/sim";
import { getElementPosition } from "../../canvas/geometry";
import { refreshAutoVelocityConstraints } from "../../core/constraints/autoVelocityApply";
import type { TourMarker } from "./tourStore";
import { traceClearsObstacle, type BumperObstacle } from "./bumperClearance";

export const practiceField = { width: 18, height: 9 };
export const mission = {
  start: { x_meters: 5, y_meters: 2 },
  pickup: { x_meters: 8, y_meters: 6 },
  turn: { x_meters: 12.8, y_meters: 6.3 },
  delivery: { x_meters: 15, y_meters: 2.5 },
  structure: { minX: 9.7, maxX: 11.9, minY: 1.8, maxY: 4.2 },
};

export const missionMarkers: readonly TourMarker[] = [
  {
    id: "lesson-start-zone",
    label: "Start",
    kind: "zone",
    xMeters: 5,
    yMeters: 2,
    widthMeters: 1.4,
    heightMeters: 1.4,
  },
  {
    id: "lesson-game-piece",
    label: "Pickup",
    kind: "game-piece",
    xMeters: 8,
    yMeters: 6.4,
    widthMeters: 0.45,
    heightMeters: 0.45,
  },
  {
    id: "lesson-pickup-pose",
    label: "Face the pickup",
    kind: "pose",
    xMeters: 8,
    yMeters: 6,
    rotationDegrees: 90,
    widthMeters: 0.85,
    heightMeters: 0.85,
  },
  {
    id: "lesson-structure",
    label: "Structure",
    kind: "structure",
    xMeters: 10.8,
    yMeters: 3,
    widthMeters: 2.2,
    heightMeters: 2.4,
  },
  {
    id: "lesson-goal-zone",
    label: "Delivery",
    kind: "zone",
    xMeters: 15,
    yMeters: 2.5,
    widthMeters: 1.4,
    heightMeters: 1.4,
  },
  {
    id: "lesson-delivery-pose",
    label: "Delivery heading",
    kind: "pose",
    xMeters: 15,
    yMeters: 2.5,
    rotationDegrees: -90,
    widthMeters: 0.85,
    heightMeters: 0.85,
  },
];
export const buildMarkers = missionMarkers
  .filter((marker) => marker.kind === "zone")
  .map((marker) => ({
    ...marker,
    label: marker.id === "lesson-goal-zone" ? "End" : marker.label,
  }));

export function practiceConfig(): ProjectConfig {
  const config = createProjectConfig();
  config.gui.field.selected_field_id = "blank-grid";
  config.gui.robot = { length_meters: 0.8, width_meters: 0.8 };
  config.kinematic_constraints.default_max_velocity_meters_per_sec = 3;
  config.kinematic_constraints.default_max_acceleration_meters_per_sec2 = 3;
  return config;
}

export function waypoint(x: number, y: number, heading = 0) {
  return createWaypoint({
    translation_target: createTranslationTarget({ x_meters: x, y_meters: y }),
    rotation_target: createRotationTarget({
      rotation_radians: (heading * Math.PI) / 180,
      t_ratio: 0,
    }),
  });
}
export function translation(x: number, y: number, radius = 0.25) {
  return createTranslationTarget({
    x_meters: x,
    y_meters: y,
    intermediate_handoff_radius_meters: radius,
    handoff_radius_source: "manual",
  });
}
export function createSpeedPath() {
  return createPathModel({
    path_elements: [
      waypoint(5, 2, 90),
      translation(8, 6),
      translation(12.8, 6.3, 0.7),
      waypoint(15, 2.5, -90),
    ],
  });
}
/** The first local-speed exercise begins with a real proposal and a separate turn cell. */
export function createSpeedLessonPath() {
  return refreshAutoVelocityConstraints(createSpeedPath(), practiceConfig(), {
    whenPresentOnly: false,
  });
}
export function createHandoffPath() {
  return createPathModel({
    path_elements: [
      waypoint(5, 2),
      translation(10.8, 6.8, 0.7),
      waypoint(15, 2.5, -90),
    ],
    constraints: {
      ...createPathModel().constraints,
      max_velocity_meters_per_sec: 1,
    },
    ranged_constraints: [
      {
        key: "max_velocity_meters_per_sec",
        value: 1,
        source: "manual",
        start_ordinal: 1,
        end_ordinal: 3,
      },
    ],
  });
}
export function anchorPositions(path: PathModel) {
  return path.path_elements.flatMap((element, index) => {
    const point = isAnchorElement(element)
      ? getElementPosition(path.path_elements, index)
      : null;
    return point ? [{ ...point, index }] : [];
  });
}

export function near(
  point: { x_meters: number; y_meters: number } | null | undefined,
  target: { x_meters: number; y_meters: number },
  tolerance = 0.6,
) {
  return (
    !!point &&
    Math.hypot(
      point.x_meters - target.x_meters,
      point.y_meters - target.y_meters,
    ) <= tolerance
  );
}

export function segmentClearsStructure(
  a: { x_meters: number; y_meters: number },
  b: { x_meters: number; y_meters: number },
  margin: number,
): boolean {
  const box = mission.structure;
  let enter = 0;
  let leave = 1;
  for (const [start, delta, low, high] of [
    [a.x_meters, b.x_meters - a.x_meters, box.minX - margin, box.maxX + margin],
    [a.y_meters, b.y_meters - a.y_meters, box.minY - margin, box.maxY + margin],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (start < low || start > high) return true;
    } else {
      const t1 = (low - start) / delta;
      const t2 = (high - start) / delta;
      enter = Math.max(enter, Math.min(t1, t2));
      leave = Math.min(leave, Math.max(t1, t2));
      if (enter > leave) return true;
    }
  }
  return false;
}

let cached: {
  path: PathModel;
  config: ProjectConfig;
  result: ReturnType<typeof simulatePathWithTrace>;
} | null = null;
export function practiceSimulation(path: PathModel, config: ProjectConfig) {
  if (cached?.path === path && cached.config === config) return cached.result;
  const result = simulatePathWithTrace(path, config, { dt_s: 0.02 });
  cached = { path, config, result };
  return result;
}
export function clearance(
  path: PathModel,
  config: ProjectConfig,
  obstacleOrLegacyPreview: BumperObstacle | boolean = mission.structure,
): boolean {
  const obstacle =
    typeof obstacleOrLegacyPreview === "boolean"
      ? mission.structure
      : obstacleOrLegacyPreview;
  return traceClearsObstacle(
    practiceSimulation(path, config).trace,
    config.gui.robot,
    obstacle,
  );
}
export function sampleAtTime(
  trace: readonly SimulationTraceSample[],
  time: number,
) {
  if (trace.length === 0) return null;
  let low = 0;
  let high = trace.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (trace[middle].time_s < time) low = middle + 1;
    else high = middle;
  }
  return trace[low];
}

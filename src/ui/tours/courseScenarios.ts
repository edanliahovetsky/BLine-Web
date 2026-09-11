import {
  createConstraints,
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  type PathModel,
} from "../../core/model/path";
import { refreshAutoVelocityConstraints } from "../../core/constraints/autoVelocityApply";
import {
  buildMarkers,
  mission,
  practiceConfig,
  waypoint,
} from "./tourScenario";
import type { TourMarker } from "./tourStore";

export const fundamentalsZones = buildMarkers;
export const fundamentalsMarkers: readonly TourMarker[] = [
  ...fundamentalsZones,
  {
    id: "lesson-structure",
    label: "Obstacle",
    kind: "structure",
    xMeters: (mission.structure.minX + mission.structure.maxX) / 2,
    yMeters: (mission.structure.minY + mission.structure.maxY) / 2,
    widthMeters: mission.structure.maxX - mission.structure.minX,
    heightMeters: mission.structure.maxY - mission.structure.minY,
  },
];

const automaticTranslation = (x: number, y: number) =>
  createTranslationTarget({
    x_meters: x,
    y_meters: y,
    handoff_radius_source: "auto",
  });

export function createFundamentalsDemoPath(): PathModel {
  return refreshAutoVelocityConstraints(
    createPathModel({
      path_elements: [
        waypoint(5, 2),
        automaticTranslation(8, 6),
        createRotationTarget({ rotation_radians: Math.PI / 2, t_ratio: 0.5 }),
        createEventTrigger({ lib_key: "startIntake", t_ratio: 0.75 }),
        automaticTranslation(12.8, 6.3),
        waypoint(15, 2.5, -90),
      ],
    }),
    practiceConfig(),
    { whenPresentOnly: false },
  );
}

export function createHandoffLessonPath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(5, 2),
      createTranslationTarget({
        x_meters: 10.8,
        y_meters: 6.8,
        intermediate_handoff_radius_meters: 0.7,
        handoff_radius_source: "manual",
      }),
      waypoint(15, 2.5, -90),
    ],
    constraints: createConstraints({
      max_velocity_meters_per_sec: 1.8,
      max_acceleration_meters_per_sec2: 3,
    }),
    ranged_constraints: [
      {
        key: "max_velocity_meters_per_sec",
        value: 1.8,
        source: "manual",
        start_ordinal: 1,
        end_ordinal: 3,
      },
    ],
  });
}

export function createLowAccelerationPath(): PathModel {
  const path = createHandoffLessonPath();
  path.constraints.max_acceleration_meters_per_sec2 = 0.6;
  return path;
}

export const tuningObstacle = { minX: 8.7, maxX: 10.9, minY: 2.4, maxY: 6.6 };
export const tuningMarkers: readonly TourMarker[] = [
  {
    id: "lesson-start-zone",
    label: "Start",
    kind: "zone",
    xMeters: 6,
    yMeters: 7.6,
    widthMeters: 1.5,
    heightMeters: 1.5,
  },
  {
    id: "lesson-goal-zone",
    label: "End",
    kind: "zone",
    xMeters: 6,
    yMeters: 1.4,
    widthMeters: 1.5,
    heightMeters: 1.5,
  },
  {
    id: "lesson-structure",
    label: "Obstacle",
    kind: "structure",
    xMeters: 9.8,
    yMeters: 4.5,
    widthMeters: 2.2,
    heightMeters: 4.2,
  },
  {
    id: "lesson-intermediate-zone",
    label: "Intermediate",
    kind: "zone",
    xMeters: 12.3,
    yMeters: 4.5,
    widthMeters: 1.5,
    heightMeters: 1.5,
  },
];

/** Auto slots exist for selection, but contain no generated proposal or signature. */
export function createTuningRectanglePath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(6, 7.6),
      automaticTranslation(12.3, 7.6),
      automaticTranslation(12.3, 4.5),
      automaticTranslation(12.3, 1.4),
      waypoint(6, 1.4),
    ],
    ranged_constraints: [1, 2, 3, 4, 5].map((ordinal) => ({
      key: "max_velocity_meters_per_sec",
      value: 3,
      source: "auto_velocity",
      start_ordinal: ordinal,
      end_ordinal: ordinal,
    })),
  });
}

export function createRotationLessonPath(): PathModel {
  return createPathModel({
    path_elements: [waypoint(5, 4.5), waypoint(15, 4.5)],
    constraints: createConstraints({ max_velocity_meters_per_sec: 2 }),
    ranged_constraints: [
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        source: "manual",
        start_ordinal: 1,
        end_ordinal: 2,
      },
    ],
  });
}

export function createFastRotationPath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(6, 4.5),
      createRotationTarget({
        rotation_radians: Math.PI,
        t_ratio: 0.5,
        profiled_rotation: true,
      }),
      waypoint(12, 4.5),
    ],
    constraints: createConstraints({
      max_velocity_meters_per_sec: 6,
      max_acceleration_meters_per_sec2: 10,
      max_velocity_deg_per_sec: 120,
      max_acceleration_deg_per_sec2: 180,
    }),
    ranged_constraints: [
      {
        key: "max_velocity_meters_per_sec",
        value: 6,
        source: "manual",
        start_ordinal: 1,
        end_ordinal: 2,
      },
    ],
  });
}

export function createEventLessonPath(): PathModel {
  return createPathModel({
    path_elements: [
      waypoint(5, 2),
      createEventTrigger({ lib_key: "startIntake", t_ratio: 0.45 }),
      createTranslationTarget({
        x_meters: 9,
        y_meters: 6,
        intermediate_handoff_radius_meters: 0.5,
        handoff_radius_source: "manual",
      }),
      waypoint(15, 2.5),
    ],
    constraints: createConstraints({ max_velocity_meters_per_sec: 2 }),
    ranged_constraints: [
      {
        key: "max_velocity_meters_per_sec",
        value: 2,
        source: "manual",
        start_ordinal: 1,
        end_ordinal: 3,
      },
    ],
  });
}

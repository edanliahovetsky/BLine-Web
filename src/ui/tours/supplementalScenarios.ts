import {
  createEventTrigger,
  createPathModel,
  type PathElement,
} from "../../core/model/path";
import type {
  LinkedTarget,
  ProjectPath,
  ProjectPathGroup,
} from "../../core/model/project";
import { setPathElementLinkedTargetId } from "../../core/linkedTargets";
import { translation, waypoint } from "./tourScenario";
import type { TourMarker } from "./tourStore";

export const supplementalPathIds = {
  stagingScore: "lesson-staging-score",
  scorePickup: "lesson-score-pickup",
  pickupScore: "lesson-pickup-score",
  stagingPickup: "lesson-staging-pickup",
  pickupExit: "lesson-pickup-exit",
};

export const scorePose = { x_meters: 10.8, y_meters: 4.5, heading: 0 };
export const pickupHandoff = { x_meters: 11, y_meters: 6.3, heading: 0 };
export const pickupHandoffId = "lesson-pickup-handoff";

export const organizationMarkers: readonly TourMarker[] = [
  {
    id: "lesson-staging-zone",
    label: "Staging",
    kind: "zone",
    xMeters: 4.5,
    yMeters: 2.5,
    widthMeters: 1.3,
    heightMeters: 1.3,
  },
  {
    id: "lesson-score-zone",
    label: "Score",
    kind: "zone",
    xMeters: scorePose.x_meters,
    yMeters: scorePose.y_meters,
    widthMeters: 1.3,
    heightMeters: 1.3,
  },
  {
    id: "lesson-pickup-zone",
    label: "Pickup",
    kind: "zone",
    xMeters: 14.8,
    yMeters: 6.5,
    widthMeters: 1.3,
    heightMeters: 1.3,
  },
];

export const linkingMarkers: readonly TourMarker[] = [
  organizationMarkers[0],
  {
    id: "lesson-shared-pickup",
    label: "Pickup handoff",
    kind: "zone",
    xMeters: pickupHandoff.x_meters,
    yMeters: pickupHandoff.y_meters,
    widthMeters: 1.3,
    heightMeters: 1.3,
  },
  {
    id: "lesson-chain-score",
    label: "Score",
    kind: "zone",
    xMeters: 15,
    yMeters: 3.5,
    widthMeters: 1.3,
    heightMeters: 1.3,
  },
];

function route(
  pathId: string,
  name: string,
  elements: PathElement[],
): ProjectPath {
  const anchorCount = elements.filter(
    (element) => element.type === "waypoint" || element.type === "translation",
  ).length;
  return {
    path_id: pathId,
    display_name: name,
    file_name: `${name.toLowerCase().replaceAll(" ", "-")}.json`,
    path: createPathModel({
      path_elements: elements,
      ranged_constraints: [
        {
          key: "max_velocity_meters_per_sec",
          value: 2,
          source: "manual",
          start_ordinal: 1,
          end_ordinal: anchorCount,
        },
      ],
    }),
  };
}

/** Three reusable legs form an opening score and a pickup/scoring cycle. */
export function createManagementPaths(): ProjectPath[] {
  return [
    route(supplementalPathIds.stagingScore, "Staging to Score", [
      waypoint(4.5, 2.5),
      translation(7.5, 3.4, 0.35),
      waypoint(scorePose.x_meters, scorePose.y_meters, scorePose.heading),
    ]),
    route(supplementalPathIds.scorePickup, "Score to Pickup", [
      waypoint(scorePose.x_meters, scorePose.y_meters, scorePose.heading),
      translation(12.8, 5.8, 0.35),
      waypoint(14.8, 6.5, 180),
    ]),
    route(supplementalPathIds.pickupScore, "Pickup to Score", [
      waypoint(14.8, 6.5, 180),
      translation(13.4, 4.6, 0.3),
      waypoint(scorePose.x_meters, scorePose.y_meters, scorePose.heading),
    ]),
  ];
}

export function createManagementGroups(): ProjectPathGroup[] {
  return [
    {
      group_id: "lesson-opening-score",
      display_name: "Opening score",
      path_ids: [supplementalPathIds.stagingScore],
    },
    {
      group_id: "lesson-pickup-cycle",
      display_name: "Pickup cycle",
      path_ids: [
        supplementalPathIds.scorePickup,
        supplementalPathIds.pickupScore,
      ],
    },
  ];
}

export function createTransferPaths(): ProjectPath[] {
  const path = createManagementPaths()[0];
  path.path.path_elements.splice(
    2,
    0,
    createEventTrigger({ t_ratio: 0.7, lib_key: "prepareScore" }),
  );
  return [path];
}

/** Coincident endpoints begin unlinked so the learner creates the relationship. */
export function createLinkedElementPaths(): ProjectPath[] {
  return createManagementPaths().slice(0, 2);
}

export function createLinkedElementGroups(): ProjectPathGroup[] {
  return [
    {
      group_id: "lesson-score-cycle",
      display_name: "Score and collect",
      path_ids: [
        supplementalPathIds.stagingScore,
        supplementalPathIds.scorePickup,
      ],
    },
  ];
}

export function createPathLinkingTargets(): LinkedTarget[] {
  return [
    {
      target_id: pickupHandoffId,
      display_name: "Pickup handoff",
      kind: "waypoint",
      x_meters: pickupHandoff.x_meters,
      y_meters: pickupHandoff.y_meters,
      rotation_radians: 0,
      locked: false,
    },
  ];
}

export function createPathLinkingPaths(): ProjectPath[] {
  const shared = () =>
    setPathElementLinkedTargetId(
      waypoint(
        pickupHandoff.x_meters,
        pickupHandoff.y_meters,
        pickupHandoff.heading,
      ),
      pickupHandoffId,
    );
  return [
    route(supplementalPathIds.stagingPickup, "Staging to Pickup", [
      waypoint(4.5, 2.5),
      translation(8, 6.3, 0.3),
      shared(),
    ]),
    route(supplementalPathIds.pickupExit, "Pickup to Score", [
      shared(),
      translation(13, 6.3, 0.3),
      waypoint(15, 3.5, -90),
    ]),
  ];
}

export function createPathLinkingGroups(): ProjectPathGroup[] {
  return [
    {
      group_id: "lesson-pickup-chain",
      display_name: "Pickup chain",
      path_ids: [
        supplementalPathIds.stagingPickup,
        supplementalPathIds.pickupExit,
      ],
    },
  ];
}

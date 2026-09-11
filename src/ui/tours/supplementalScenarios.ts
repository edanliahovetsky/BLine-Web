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

export const managementPathIds = {
  topStartScore: "lesson-top-start-score",
  topScorePickup: "lesson-top-score-pickup",
  topPickupScore: "lesson-top-pickup-score",
  bottomStartScore: "lesson-bottom-start-score",
  bottomScorePickup: "lesson-bottom-score-pickup",
  bottomPickupScore: "lesson-bottom-pickup-score",
  straight: "lesson-test-straight",
  turn: "lesson-test-turn",
  curve: "lesson-test-curve",
};

export const scorePose = { x_meters: 10.8, y_meters: 4.5, heading: 0 };
export const pickupHandoff = { x_meters: 11, y_meters: 6.3, heading: 0 };
export const pickupHandoffId = "lesson-pickup-handoff";

export const organizationMarkers: readonly TourMarker[] = [
  {
    id: "lesson-staging-zone",
    label: "Start",
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
    label: "Pickup",
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

/** These smaller examples leave the learner to create the links themselves. */
function createScoringPaths(): ProjectPath[] {
  return [
    route(supplementalPathIds.stagingScore, "Start to Score", [
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

export function createManagementTargets(): LinkedTarget[] {
  const targets: [string, string, number, number, number][] = [
    ["top-score", "Top Score", 6.4, 6.3, 0],
    ["top-pickup", "Top Pickup", 12, 7.2, 180],
    ["bottom-score", "Bottom Score", 6.4, 2.7, 0],
    ["bottom-pickup", "Bottom Pickup", 12, 1.8, 180],
    ["test-straight", "Straight End", 8, 4.5, 0],
    ["test-turn", "Turn End", 7, 6.5, 90],
    ["test-curve", "Curve End", 13, 4.5, 0],
  ];
  return targets.map(([id, name, x, y, heading]) => ({
    target_id: `lesson-${id}`,
    display_name: name,
    kind: "waypoint",
    x_meters: x,
    y_meters: y,
    rotation_radians: (heading * Math.PI) / 180,
  }));
}

export function createManagementPaths(): ProjectPath[] {
  const targets = createManagementTargets();
  const linked = (id: string) => {
    const target = targets.find(
      (candidate) => candidate.target_id === `lesson-${id}`,
    )!;
    return setPathElementLinkedTargetId(
      waypoint(
        target.x_meters,
        target.y_meters,
        (target.rotation_radians! * 180) / Math.PI,
      ),
      target.target_id,
    );
  };
  const ids = managementPathIds;
  return [
    route(ids.topStartScore, "Top - Start to Score", [
      waypoint(3, 7.2),
      translation(4.8, 7.2, 0.3),
      linked("top-score"),
    ]),
    route(ids.topScorePickup, "Top - Score to Pickup", [
      linked("top-score"),
      translation(8.5, 7.2, 0.3),
      linked("top-pickup"),
    ]),
    route(ids.topPickupScore, "Top - Pickup to Score", [
      linked("top-pickup"),
      translation(9, 5.6, 0.3),
      linked("top-score"),
    ]),
    route(ids.bottomStartScore, "Bottom - Start to Score", [
      waypoint(3, 1.8),
      translation(4.8, 1.8, 0.3),
      linked("bottom-score"),
    ]),
    route(ids.bottomScorePickup, "Bottom - Score to Pickup", [
      linked("bottom-score"),
      translation(8.5, 1.8, 0.3),
      linked("bottom-pickup"),
    ]),
    route(ids.bottomPickupScore, "Bottom - Pickup to Score", [
      linked("bottom-pickup"),
      translation(9, 3.4, 0.3),
      linked("bottom-score"),
    ]),
    route(ids.straight, "Straight Line Test", [
      waypoint(3, 4.5),
      translation(5.5, 4.5, 0.3),
      linked("test-straight"),
    ]),
    route(ids.turn, "Turn Test", [
      waypoint(3, 3),
      translation(7, 3, 0.5),
      linked("test-turn"),
    ]),
    route(ids.curve, "Curve Test", [
      waypoint(8, 4.5),
      translation(10.5, 6, 0.7),
      linked("test-curve"),
    ]),
  ];
}

export function createManagementGroups(): ProjectPathGroup[] {
  const ids = managementPathIds;
  return [
    {
      group_id: "lesson-testing",
      display_name: "Testing",
      path_ids: [ids.straight, ids.turn, ids.curve],
    },
    {
      group_id: "lesson-top-auto",
      display_name: "Top Side Auto",
      path_ids: [ids.topStartScore, ids.topScorePickup, ids.topPickupScore],
    },
    {
      group_id: "lesson-bottom-auto",
      display_name: "Bottom Side Auto",
      path_ids: [
        ids.bottomStartScore,
        ids.bottomScorePickup,
        ids.bottomPickupScore,
      ],
    },
  ];
}

export function createTransferPaths(): ProjectPath[] {
  const path = createScoringPaths()[0];
  path.path.path_elements.splice(
    2,
    0,
    createEventTrigger({ t_ratio: 0.7, lib_key: "prepareScore" }),
  );
  return [path];
}

/** Coincident endpoints begin unlinked so the learner creates the relationship. */
export function createLinkedElementPaths(): ProjectPath[] {
  return createScoringPaths().slice(0, 2);
}

export function createLinkedElementGroups(): ProjectPathGroup[] {
  return [
    {
      group_id: "lesson-score-cycle",
      display_name: "Score and Pickup",
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
      display_name: "Pickup",
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
    route(supplementalPathIds.stagingPickup, "Start to Pickup", [
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
      display_name: "Pickup and Score",
      path_ids: [
        supplementalPathIds.stagingPickup,
        supplementalPathIds.pickupExit,
      ],
    },
  ];
}

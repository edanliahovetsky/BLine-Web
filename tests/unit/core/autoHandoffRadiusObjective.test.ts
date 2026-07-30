import { describe, expect, it } from "vitest";
import { autoHandoffRadiusObjectiveCost } from "../../../src/core/constraints/autoHandoffRadiusObjective";
import { generateAutoVelocityProfile } from "../../../src/core/constraints/autoVelocityConstraints";
import {
  createPathModel,
  createTranslationTarget,
  setHandoffRadiusSource,
  type PathModel,
} from "../../../src/core/model/path";

describe("autoHandoffRadiusObjectiveCost", () => {
  it("prefers a measured reversal handoff over an oversized shared-corridor cut", () => {
    const path = pathOf([
      [0, 0],
      [4, 0],
      [0, 0],
    ]);

    expect(cost(withRadius(path, 0.72))).toBeLessThan(
      cost(withRadius(path, 1.96)),
    );
  });

  it("still rewards a useful wide radius on a non-reversing sharp corner", () => {
    const turnRadians = (149.2 * Math.PI) / 180;
    const path = pathOf([
      [0, 0],
      [3.65, 0],
      [3.65 + 3.78 * Math.cos(turnRadians), 3.78 * Math.sin(turnRadians)],
    ]);

    expect(cost(withRadius(path, 1.2))).toBeLessThan(
      cost(withRadius(path, 0.55)),
    );
  });
});

function cost(path: PathModel): number {
  return autoHandoffRadiusObjectiveCost(
    generateAutoVelocityProfile(
      path,
      {},
      {
        includeGeneratedRadiiInCacheKey: true,
      },
    ),
  );
}

function pathOf(points: Array<[number, number]>): PathModel {
  return createPathModel({
    path_elements: points.map(([x, y]) =>
      createTranslationTarget({ x_meters: x, y_meters: y }),
    ),
  });
}

function withRadius(path: PathModel, radiusMeters: number): PathModel {
  const element = path.path_elements[1];
  if (!element || element.type !== "translation") {
    return path;
  }
  return {
    ...path,
    path_elements: path.path_elements.map((candidate, index) =>
      index === 1
        ? setHandoffRadiusSource(
            {
              ...element,
              intermediate_handoff_radius_meters: radiusMeters,
            },
            "auto",
          )
        : candidate,
    ),
  };
}

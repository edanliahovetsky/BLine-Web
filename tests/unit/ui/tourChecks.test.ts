import { describe, expect, it } from "vitest";
import {
  createEventTrigger,
  createRotationTarget,
  isWaypoint,
} from "../../../src/core/model/path";
import { refreshAutoVelocityConstraints } from "../../../src/core/constraints/autoVelocityApply";
import {
  checkDelivery,
  checkEvent,
  checkPlan,
  checkMission,
  checkSpeed,
} from "../../../src/ui/tours/tourChecks";
import {
  createHeadingPath,
  createMissionPath,
  createSpeedPath,
  practiceConfig,
} from "../../../src/ui/tours/tourScenario";

describe("lesson outcome checks", () => {
  it("does not accept an unrelated speed cell, Auto cap, or a faster approach", () => {
    const path = createSpeedPath();
    path.ranged_constraints = [
      {
        key: "max_velocity_meters_per_sec",
        start_ordinal: 2,
        end_ordinal: 2,
        value: 1.2,
        source: "manual",
      },
    ];
    expect(checkSpeed(path, 3, 1.2).complete).toBe(false);
    path.ranged_constraints[0].start_ordinal = 3;
    path.ranged_constraints[0].end_ordinal = 3;
    expect(checkSpeed(path, 3, 1.2).complete).toBe(true);
    path.ranged_constraints[0].source = "auto_velocity";
    expect(checkSpeed(path, 3, 1.2).complete).toBe(false);
    path.ranged_constraints[0].source = "manual";
    path.ranged_constraints[0].value = 2;
    expect(checkSpeed(path, 3, 1.2).complete).toBe(false);
  });
  it("requires the delivery zone even after an off-field error has been repaired", () => {
    const path = createMissionPath();
    const endpoint = path.path_elements.at(-1)!;
    expect(checkDelivery(path, practiceConfig()).complete).toBe(true);
    if (isWaypoint(endpoint)) endpoint.translation_target.x_meters = 13;
    expect(checkDelivery(path, practiceConfig()).complete).toBe(false);
  });
  it("requires the intended event key and position after the heading target", () => {
    const path = createHeadingPath();
    const rotation = createRotationTarget({
      rotation_radians: Math.PI / 2,
      t_ratio: 0.5,
    });
    const event = createEventTrigger({ lib_key: "startIntake", t_ratio: 0.7 });
    path.path_elements.splice(1, 0, rotation, event);
    expect(checkEvent(path).complete).toBe(true);
    event.lib_key = "anything";
    expect(checkEvent(path).complete).toBe(false);
    event.lib_key = "startIntake";
    rotation.t_ratio = 0.8;
    expect(checkEvent(path).complete).toBe(false);
  });
  it("accepts a current plan without demanding an unnecessary Generate click", () => {
    const config = practiceConfig();
    const path = createSpeedPath();
    expect(checkPlan(path, config).complete).toBe(false);
    const generated = refreshAutoVelocityConstraints(path, config, {
      whenPresentOnly: false,
    });
    expect(checkPlan(generated, config).complete).toBe(true);
  });
  it("checks the complete mission, including the pickup and both event roles", () => {
    const path = createMissionPath();
    const config = practiceConfig();
    expect(checkMission(path, config).complete).toBe(true);
    const changed = structuredClone(path);
    changed.path_elements.splice(2, 1);
    expect(checkMission(changed, config).complete).toBe(false);
    const wrongPickup = structuredClone(path);
    if (wrongPickup.path_elements[3].type === "translation")
      wrongPickup.path_elements[3].y_meters = 7;
    expect(checkMission(wrongPickup, config).complete).toBe(false);
  });
});

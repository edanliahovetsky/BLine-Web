import { describe, expect, it } from "vitest";
import {
  createPathModel,
  isEventTrigger,
  isWaypoint,
} from "../../../src/core/model/path";
import { simulatePathWithTrace } from "../../../src/core/sim";
import {
  clearance,
  createMissionPath,
  demonstrationPaths,
  practiceConfig,
  segmentClearsStructure,
  waypoint,
  withinField,
} from "../../../src/ui/tours/tourScenario";

describe("lesson practice scenario", () => {
  it("provides a complete pickup and delivery route with repairable defects", () => {
    const correct = createMissionPath();
    const broken = createMissionPath(true);
    const config = practiceConfig();
    expect(correct.path_elements).toHaveLength(7);
    expect(
      correct.path_elements
        .filter(isEventTrigger)
        .map((event) => event.lib_key),
    ).toEqual(["startIntake", "prepareDelivery"]);
    expect(withinField(correct, config)).toBe(true);
    expect(clearance(correct, config)).toBe(true);
    expect(clearance(correct, config, true)).toBe(true);
    expect(withinField(broken, config)).toBe(false);
    expect(broken.path_elements.filter(isEventTrigger)[0].lib_key).toBe("");
    const endpoint = broken.path_elements.at(-1)!;
    expect(isWaypoint(endpoint) && endpoint.translation_target.y_meters).toBe(
      -0.25,
    );
  });

  it("checks bumper clearance along whole segments, including between samples", () => {
    expect(
      segmentClearsStructure(
        { x_meters: 8, y_meters: 3 },
        { x_meters: 14, y_meters: 3 },
        0,
      ),
    ).toBe(false);
    expect(
      segmentClearsStructure(
        { x_meters: 8, y_meters: 4.4 },
        { x_meters: 14, y_meters: 4.4 },
        0,
      ),
    ).toBe(true);
    expect(
      segmentClearsStructure(
        { x_meters: 8, y_meters: 4.4 },
        { x_meters: 14, y_meters: 4.4 },
        0.6,
      ),
    ).toBe(false);
    const path = createPathModel({
      path_elements: [waypoint(8, 4.4), waypoint(14, 4.4)],
    });
    expect(clearance(path, practiceConfig())).toBe(false);
  });

  it("uses real simulation for visibly different radius and speed demonstrations", () => {
    const config = practiceConfig();
    const radii = demonstrationPaths("handoff");
    const small = simulatePathWithTrace(radii.before, config);
    const large = simulatePathWithTrace(radii.after, config);
    expect(clearance(radii.before, config, true)).toBe(true);
    expect(small.trail_points).not.toEqual(large.trail_points);
    const speed = demonstrationPaths("speed");
    const fast = simulatePathWithTrace(speed.before, config);
    const slow = simulatePathWithTrace(speed.after, config);
    expect(slow.total_time_s).toBeGreaterThan(fast.total_time_s);
  });
});

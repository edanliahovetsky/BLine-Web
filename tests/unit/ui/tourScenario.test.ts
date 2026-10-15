import { describe, expect, it } from "vitest";
import { createPathModel } from "../../../src/core/model/path";
import {
  clearance,
  practiceConfig,
  waypoint,
} from "../../../src/ui/tours/tourScenario";

describe("lesson practice scenario", () => {
  it("checks bumper clearance along the simulated route", () => {
    const blocked = createPathModel({
      path_elements: [waypoint(8, 3), waypoint(14, 3)],
    });
    expect(clearance(blocked, practiceConfig())).toBe(false);
    const clear = createPathModel({
      path_elements: [waypoint(8, 6.5), waypoint(14, 6.5)],
    });
    expect(clearance(clear, practiceConfig())).toBe(true);
  });
});

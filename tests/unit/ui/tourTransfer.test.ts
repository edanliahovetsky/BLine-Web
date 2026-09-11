import { describe, expect, it } from "vitest";
import {
  exportPracticePath,
  parsePracticePath,
} from "../../../src/ui/tours/tourTransfer";
import { createFundamentalsDemoPath } from "../../../src/ui/tours/courseScenarios";
import { practiceConfig } from "../../../src/ui/tours/tourScenario";

describe("lesson path transfer", () => {
  it("imports the normal robot path format with the current project defaults", async () => {
    const path = createFundamentalsDemoPath();
    const text = await exportPracticePath(path).text();
    const restored = parsePracticePath(text, practiceConfig());
    expect(restored.path_elements).toHaveLength(6);
    expect(restored.path_elements[3]).toMatchObject({
      type: "event_trigger",
      lib_key: "startIntake",
    });
    expect(restored.path_elements[0]).toMatchObject({
      type: "waypoint",
      translation_target: {
        x_meters: 5,
        y_meters: 2,
        intermediate_handoff_radius_meters: 0.45,
      },
    });
    expect(restored.ranged_constraints).toHaveLength(
      path.ranged_constraints.length,
    );
    expect(JSON.parse(text)).not.toHaveProperty("project_id");
  });
  it("rejects malformed JSON before creating a practice path", () => {
    expect(() => parsePracticePath("{broken", practiceConfig())).toThrow();
  });
});

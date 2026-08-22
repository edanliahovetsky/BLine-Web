import { describe, expect, it } from "vitest";
import { createProjectDocument } from "../../../src/core/io/projectSchema";
import { createPathModel } from "../../../src/core/model/path";
import { createUpdateProjectConfigCommand } from "../../../src/ui/app/configCommands";

describe("config commands", () => {
  it("updates project config through reversible history commands", () => {
    const project = createProjectDocument({
      project_id: "project-a",
      display_name: "Alpha",
      path: createPathModel(),
    });
    const nextConfig = structuredClone(project.config);
    nextConfig.gui.robot.length_meters = 0.8255;
    nextConfig.kinematic_constraints.default_max_velocity_meters_per_sec = 5.5;

    const command = createUpdateProjectConfigCommand(
      project.config,
      nextConfig,
    );
    const updated = command.apply(project.config);
    const reverted = command.revert(updated);

    expect(updated.gui.robot.length_meters).toBe(0.8255);
    expect(
      updated.kinematic_constraints.default_max_velocity_meters_per_sec,
    ).toBe(5.5);
    expect(reverted).toEqual(project.config);
  });
});

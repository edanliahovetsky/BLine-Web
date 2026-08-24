import { describe, expect, it } from "vitest";
import { createSampleProject } from "../../../src/ui/app/initialProject";
import { derivePathDiagnostics } from "../../../src/ui/app/pathDiagnostics";
import { defaultFieldGeometry } from "../../../src/core/field/fieldConfig";

describe("path diagnostics", () => {
  it("reports incomplete paths", () => {
    const workspace = createSampleProject();
    workspace.paths[0].path.path_elements =
      workspace.paths[0].path.path_elements.slice(0, 1);
    expect(
      derivePathDiagnostics(
        workspace.paths[0].path,
        defaultFieldGeometry,
        workspace.linked_targets,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "anchor-count",
          severity: "warning",
          fix: expect.objectContaining({ kind: "add-anchors", count: 1 }),
        }),
      ]),
    );
  });

  it("reports empty event keys and off-field elements", () => {
    const workspace = createSampleProject();
    const event = workspace.paths[0].path.path_elements.find(
      (element) => element.type === "event_trigger",
    );
    if (event?.type === "event_trigger") {
      event.lib_key = "";
    }
    const first = workspace.paths[0].path.path_elements[0];
    if (first?.type === "waypoint") {
      first.translation_target.x_meters = -1;
    }
    const diagnostics = derivePathDiagnostics(
      workspace.paths[0].path,
      defaultFieldGeometry,
      workspace.linked_targets,
    );

    expect(diagnostics.some((item) => item.id.startsWith("event-key-"))).toBe(
      true,
    );
    expect(diagnostics.some((item) => item.id === "off-field-0")).toBe(true);
    expect(
      diagnostics.find((item) => item.id.startsWith("event-key-"))?.fix,
    ).toMatchObject({ kind: "focus-event-key", elementIndex: 4 });
    expect(
      diagnostics.find((item) => item.id.startsWith("event-key-"))?.summary,
    ).toBe("Event 5 command key empty.");
    expect(
      diagnostics.find((item) => item.id === "off-field-0")?.fix,
    ).toMatchObject({ kind: "move-inside-field", elementIndex: 0 });
  });

  it("treats image padding as outside the effective coordinate bounds", () => {
    const workspace = createSampleProject();
    const first = workspace.paths[0].path.path_elements[0];
    if (first?.type !== "waypoint") {
      throw new Error("Expected the sample Path to begin with a waypoint");
    }
    first.translation_target.x_meters = 8.5;
    first.translation_target.y_meters = 5;
    const geometry = {
      length_meters: 10,
      width_meters: 6,
      coordinate_offset_meters: 0,
      coordinate_offset_x_meters: 1,
      coordinate_offset_y_meters: 0.5,
    };

    expect(
      derivePathDiagnostics(
        workspace.paths[0].path,
        geometry,
        workspace.linked_targets,
      ).some((item) => item.id === "off-field-0"),
    ).toBe(true);

    first.translation_target.x_meters = 8;
    expect(
      derivePathDiagnostics(
        workspace.paths[0].path,
        geometry,
        workspace.linked_targets,
      ).some((item) => item.id === "off-field-0"),
    ).toBe(false);
  });

  it("offers to remove a reference to a missing linked target", () => {
    const workspace = createSampleProject();
    const first = workspace.paths[0].path.path_elements[0];
    if (first?.type !== "waypoint") {
      throw new Error("Expected the sample Path to begin with a waypoint");
    }
    first.linked_target_id = "missing-target";

    expect(
      derivePathDiagnostics(
        workspace.paths[0].path,
        defaultFieldGeometry,
        workspace.linked_targets,
      ).find((item) => item.id === "broken-link-0")?.fix,
    ).toMatchObject({ kind: "remove-missing-link", elementIndex: 0 });
  });
});

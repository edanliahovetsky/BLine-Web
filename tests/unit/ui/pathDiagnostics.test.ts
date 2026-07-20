import { describe, expect, it } from "vitest";
import { activeProjectFromWorkspace } from "../../../src/core/io/workspaceSerde";
import { createSampleCanvasWorkspace } from "../../../src/ui/app/initialProject";
import { derivePathDiagnostics } from "../../../src/ui/app/pathDiagnostics";

describe("path diagnostics", () => {
  it("reports incomplete paths", () => {
    const workspace = createSampleCanvasWorkspace();
    workspace.paths[0].path.path_elements =
      workspace.paths[0].path.path_elements.slice(0, 1);
    const project = activeProjectFromWorkspace(workspace);

    expect(derivePathDiagnostics(project, workspace)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "anchor-count", severity: "warning" }),
      ]),
    );
  });

  it("reports empty event keys and off-field elements", () => {
    const workspace = createSampleCanvasWorkspace();
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
    const project = activeProjectFromWorkspace(workspace);
    const diagnostics = derivePathDiagnostics(project, workspace);

    expect(diagnostics.some((item) => item.id.startsWith("event-key-"))).toBe(
      true,
    );
    expect(diagnostics.some((item) => item.id === "off-field-0")).toBe(true);
  });
});

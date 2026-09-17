import { describe, expect, it } from "vitest";
import { createProject } from "../../../src/core/model/project";
import {
  createEventTrigger,
  createPathModel,
  createWaypoint,
} from "../../../src/core/model/path";
import {
  applyEventKeyEdits,
  projectEventKeys,
} from "../../../src/core/model/eventKeys";
import {
  deserializeProjectFiles,
  serializeProjectFiles,
} from "../../../src/core/io/projectFiles";
import {
  createBLineProjectArchive,
  deserializeBLineProjectArchive,
} from "../../../src/core/io/blineProject";
import { createProjectStore } from "../../../src/state/projectStore";

function fixture() {
  return createProject({
    project_id: "events",
    display_name: "Events",
    config: {
      gui: {
        event_trigger_keys: ["unused", "Intake", "Intake"],
        robot: { legacy_heading_marker: true },
        protrusions: {
          show_on_event_keys: ["Intake"],
          hide_on_event_keys: ["Stop"],
        },
      },
    },
    paths: ["A", "B"].map((name) => ({
      path_id: name,
      display_name: name,
      file_name: `${name}.json`,
      path: createPathModel({
        path_elements: [
          createWaypoint(),
          createEventTrigger({ lib_key: "Intake", t_ratio: 0.4 }),
          createEventTrigger({ lib_key: "Stop", t_ratio: 0.6 }),
          createWaypoint(),
        ],
      }),
    })),
  });
}

describe("registered event keys", () => {
  it("includes existing path and protrusion keys, preserving case", () => {
    expect(projectEventKeys(fixture())).toEqual(["Intake", "Stop", "unused"]);
  });
  it("round-trips unused registrations and the legacy marker through files and archives", () => {
    const project = fixture();
    for (const restored of [
      deserializeProjectFiles(serializeProjectFiles(project)),
      deserializeBLineProjectArchive(
        createBLineProjectArchive(project, "2026-09-16T00:00:00.000Z"),
      ),
    ]) {
      expect(restored.config.gui.event_trigger_keys).toEqual([
        "unused",
        "Intake",
      ]);
      expect(restored.config.gui.robot.legacy_heading_marker).toBe(true);
    }
  });
  it("renames every path and protrusion reference, merging existing registrations", () => {
    const original = fixture();
    const next = applyEventKeyEdits(original, [{ from: "Intake", to: "Stop" }]);
    for (const { path } of next.paths)
      expect(
        path.path_elements
          .filter((element) => element.type === "event_trigger")
          .map((event) => event.lib_key),
      ).toEqual(["Stop", "Stop"]);
    expect(next.config.gui.protrusions.show_on_event_keys).toEqual(["Stop"]);
    expect(projectEventKeys(next)).toEqual(["Stop", "unused"]);
    expect(projectEventKeys(original)).toContain("Intake");
  });
  it("clears names without removing elements, and supports atomic undo/redo", () => {
    const original = fixture();
    const edits = [{ from: "Intake", to: "" }];
    const next = applyEventKeyEdits(original, edits);
    const store = createProjectStore();
    store.setState({
      project: original,
      activePathId: "A",
      projectSessionId: "test",
    });
    store.getState().applySettings(next.config, edits);
    expect(projectEventKeys(store.getState().project!)).not.toContain("Intake");
    expect(store.getState().project!.paths[0].path.path_elements).toHaveLength(
      4,
    );
    expect(
      store.getState().project!.config.gui.protrusions.show_on_event_keys,
    ).toEqual([]);
    store.getState().undo();
    expect(store.getState().project).toEqual(original);
    store.getState().redo();
    expect(store.getState().project).toEqual(next);
  });
  it("registers a committed key once and keeps it after its event is cleared", () => {
    const store = createProjectStore();
    store.setState({
      project: fixture(),
      activePathId: "A",
      projectSessionId: "test",
    });
    store.getState().registerEventKey(" Shoot ");
    const revision = store.getState().revision;
    store.getState().registerEventKey("Shoot");
    expect(store.getState().revision).toBe(revision);
    expect(projectEventKeys(store.getState().project!)).toContain("Shoot");
  });
});

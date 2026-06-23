import { describe, expect, it } from "vitest";
import {
  createProjectPathDocument,
  createProjectWorkspaceDocument,
} from "../../../src/core/io/projectSchema";
import {
  deserializeProjectWorkspaceDocument,
  serializeProjectWorkspaceDocument,
} from "../../../src/core/io/workspaceSerde";
import { serializeBLineProjectFolder } from "../../../src/core/io/projectFolder";
import { serializePath } from "../../../src/core/io/projectSerde";
import {
  createPathModel,
  createTranslationTarget,
  createWaypoint,
} from "../../../src/core/model/path";
import {
  deleteLinkedTargetFromWorkspace,
  linkPathElementToTargetInWorkspace,
  unlinkPathElementInWorkspace,
  updateLinkedTargetInWorkspace,
} from "../../../src/core/linkedTargets";

describe("linked targets", () => {
  it("keeps linked target references out of runtime path JSON", () => {
    const path = createPathModel({
      path_elements: [
        createTranslationTarget({
          x_meters: 1,
          y_meters: 2,
          linked_target_id: "note-a",
        }),
      ],
    });

    expect(JSON.stringify(serializePath(path))).not.toContain("linked_target");
  });

  it("round-trips linked targets through workspace metadata and syncs uses", () => {
    const workspace = createProjectWorkspaceDocument({
      project_id: "workspace-1",
      display_name: "Robot Autos",
      linked_targets: [
        {
          target_id: "note-a",
          display_name: "Note A",
          kind: "point",
          x_meters: 3,
          y_meters: 4,
        },
        {
          target_id: "start-pose",
          display_name: "Start Pose",
          kind: "pose",
          x_meters: 1,
          y_meters: 2,
          rotation_radians: Math.PI / 2,
        },
      ],
      paths: [
        createProjectPathDocument({
          path_id: "auto",
          display_name: "Auto",
          file_name: "auto.json",
          path: createPathModel({
            path_elements: [
              createTranslationTarget({
                x_meters: 0,
                y_meters: 0,
                linked_target_id: "note-a",
              }),
              createWaypoint({
                linked_target_id: "start-pose",
              }),
            ],
          }),
        }),
      ],
    });

    const serialized = serializeProjectWorkspaceDocument(workspace);
    expect(serialized.linked_targets).toHaveLength(2);
    expect(serialized.paths[0]?.editor_metadata?.linked_targets).toEqual([
      { element_index: 0, target_id: "note-a" },
      { element_index: 1, target_id: "start-pose" },
    ]);

    const restored = deserializeProjectWorkspaceDocument(serialized);
    const translation = restored.paths[0]?.path.path_elements[0];
    const waypoint = restored.paths[0]?.path.path_elements[1];
    expect(translation).toMatchObject({
      linked_target_id: "note-a",
      x_meters: 3,
      y_meters: 4,
    });
    expect(waypoint).toMatchObject({
      linked_target_id: "start-pose",
      translation_target: {
        x_meters: 1,
        y_meters: 2,
      },
      rotation_target: {
        rotation_radians: Math.PI / 2,
      },
    });
  });

  it("stores linked target metadata in project folder state, not path files", async () => {
    const workspace = createProjectWorkspaceDocument({
      project_id: "workspace-1",
      display_name: "Robot Autos",
      linked_targets: [
        {
          target_id: "note-a",
          display_name: "Note A",
          kind: "point",
          x_meters: 3,
          y_meters: 4,
        },
      ],
      paths: [
        createProjectPathDocument({
          path_id: "auto",
          display_name: "Auto",
          file_name: "auto.json",
          path: createPathModel({
            path_elements: [
              createTranslationTarget({
                x_meters: 3,
                y_meters: 4,
                linked_target_id: "note-a",
              }),
            ],
          }),
        }),
      ],
    });

    const folder = serializeBLineProjectFolder(workspace);
    const stateFile = folder.files.find((file) =>
      file.relativePath.endsWith("state.json"),
    );
    const pathFile = folder.files.find(
      (file) => file.relativePath === "paths/auto.json",
    );

    expect(JSON.parse(await stateFile!.blob.text()).linked_targets).toEqual([
      {
        target_id: "note-a",
        display_name: "Note A",
        kind: "point",
        x_meters: 3,
        y_meters: 4,
      },
    ]);
    expect(await pathFile!.blob.text()).not.toContain("linked_target");
  });

  it("updates all linked uses when a target moves", () => {
    const workspace = createProjectWorkspaceDocument({
      project_id: "workspace-1",
      display_name: "Robot Autos",
      linked_targets: [
        {
          target_id: "note-a",
          display_name: "Note A",
          kind: "point",
          x_meters: 1,
          y_meters: 2,
        },
      ],
      paths: [
        createProjectPathDocument({
          path_id: "top",
          display_name: "Top",
          file_name: "top.json",
          path: createPathModel({
            path_elements: [
              createTranslationTarget({ linked_target_id: "note-a" }),
            ],
          }),
        }),
        createProjectPathDocument({
          path_id: "bottom",
          display_name: "Bottom",
          file_name: "bottom.json",
          path: createPathModel({
            path_elements: [createWaypoint({ linked_target_id: "note-a" })],
          }),
        }),
      ],
    });

    const moved = updateLinkedTargetInWorkspace(workspace, "note-a", {
      x_meters: 5,
      y_meters: 6,
    });

    expect(moved.paths[0]?.path.path_elements[0]).toMatchObject({
      x_meters: 5,
      y_meters: 6,
    });
    expect(moved.paths[1]?.path.path_elements[0]).toMatchObject({
      translation_target: {
        x_meters: 5,
        y_meters: 6,
      },
    });
  });

  it("links and unlinks compatible elements while preserving resolved coordinates", () => {
    const workspace = createProjectWorkspaceDocument({
      project_id: "workspace-1",
      display_name: "Robot Autos",
      linked_targets: [
        {
          target_id: "note-a",
          display_name: "Note A",
          kind: "point",
          x_meters: 7,
          y_meters: 8,
        },
        {
          target_id: "score-pose",
          display_name: "Score Pose",
          kind: "pose",
          x_meters: 2,
          y_meters: 3,
          rotation_radians: 1.25,
        },
      ],
      paths: [
        createProjectPathDocument({
          path_id: "auto",
          display_name: "Auto",
          file_name: "auto.json",
          path: createPathModel({
            path_elements: [
              createTranslationTarget({ x_meters: 1, y_meters: 1 }),
              createWaypoint(),
            ],
          }),
        }),
      ],
    });

    const linkedPoint = linkPathElementToTargetInWorkspace(
      workspace,
      "auto",
      0,
      "note-a",
    );
    expect(linkedPoint.paths[0]?.path.path_elements[0]).toMatchObject({
      linked_target_id: "note-a",
      x_meters: 7,
      y_meters: 8,
    });

    const linkedPose = linkPathElementToTargetInWorkspace(
      linkedPoint,
      "auto",
      1,
      "score-pose",
    );
    expect(linkedPose.paths[0]?.path.path_elements[1]).toMatchObject({
      linked_target_id: "score-pose",
      translation_target: {
        x_meters: 2,
        y_meters: 3,
      },
      rotation_target: {
        rotation_radians: 1.25,
      },
    });

    const unlinked = unlinkPathElementInWorkspace(linkedPose, "auto", 1);
    expect(unlinked.paths[0]?.path.path_elements[1]).toMatchObject({
      translation_target: {
        x_meters: 2,
        y_meters: 3,
      },
      rotation_target: {
        rotation_radians: 1.25,
      },
    });
    expect(
      unlinked.paths[0]?.path.path_elements[1] &&
        "linked_target_id" in unlinked.paths[0].path.path_elements[1],
    ).toBe(false);
  });

  it("deleting a linked target unlinks uses without moving them", () => {
    const workspace = createProjectWorkspaceDocument({
      project_id: "workspace-1",
      display_name: "Robot Autos",
      linked_targets: [
        {
          target_id: "note-a",
          display_name: "Note A",
          kind: "point",
          x_meters: 2,
          y_meters: 3,
        },
      ],
      paths: [
        createProjectPathDocument({
          path_id: "auto",
          display_name: "Auto",
          file_name: "auto.json",
          path: createPathModel({
            path_elements: [
              createTranslationTarget({
                x_meters: 2,
                y_meters: 3,
                linked_target_id: "note-a",
              }),
            ],
          }),
        }),
      ],
    });

    const deleted = deleteLinkedTargetFromWorkspace(workspace, "note-a");
    expect(deleted.linked_targets).toEqual([]);
    expect(deleted.paths[0]?.path.path_elements[0]).toMatchObject({
      x_meters: 2,
      y_meters: 3,
    });
    expect(
      deleted.paths[0]?.path.path_elements[0] &&
        "linked_target_id" in deleted.paths[0].path.path_elements[0],
    ).toBe(false);
  });
});

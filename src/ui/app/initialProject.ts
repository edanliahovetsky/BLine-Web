import { createProject } from "../../core/model/project";
import {
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
} from "../../core/model/path";
import { pathFileNameFromDisplayName } from "../../core/model/projectIdentity";

function createExampleCanvasPath() {
  return createPathModel({
    path_elements: [
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 5.7,
          y_meters: 2.5,
          intermediate_handoff_radius_meters: 0.4,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: Math.PI / 4,
        }),
      }),
      createTranslationTarget({
        x_meters: 7.0,
        y_meters: 4.0,
        intermediate_handoff_radius_meters: 0.4,
      }),
      createRotationTarget({
        t_ratio: 0.5,
        rotation_radians: Math.PI / 4,
      }),
      createTranslationTarget({
        x_meters: 9.6,
        y_meters: 4.0,
        intermediate_handoff_radius_meters: 0.4,
      }),
      createEventTrigger({
        t_ratio: 0.5,
        lib_key: "intake",
      }),
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 10.9,
          y_meters: 5.5,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: Math.PI / 4,
        }),
      }),
    ],
    ranged_constraints: [
      {
        key: "max_velocity_meters_per_sec",
        value: 3,
        start_ordinal: 1,
        end_ordinal: 4,
      },
    ],
  });
}

export function createBlankCanvasPath() {
  return createPathModel();
}

export function createNamedProject(
  projectName: string,
  pathName: string,
  now = new Date(),
) {
  const stamp = now
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const random =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ??
    Math.random().toString(36).slice(2, 10);

  const projectId = `project-${stamp}-${random}`;
  const pathId = `path-${stamp}-${random}`;
  const path = {
    path_id: pathId,
    display_name: pathName.trim() || "Path 1",
    file_name: pathFileNameFromDisplayName(pathName.trim() || "Path 1"),
    path: createBlankCanvasPath(),
  };

  return createProject({
    project_id: projectId,
    display_name: projectName.trim() || "Untitled Project",
    paths: [path],
  });
}

export function createSampleProject(now = new Date()) {
  const project = createNamedProject(
    "Phase 1 Canvas Draft",
    "Phase 1 Canvas Draft",
    now,
  );
  return {
    ...project,
    paths: project.paths.map((path) => ({
      ...path,
      path: createExampleCanvasPath(),
    })),
  };
}

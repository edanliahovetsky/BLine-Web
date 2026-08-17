import {
  createProjectPathDocument,
  createProjectWorkspaceDocument,
} from "../../core/io/projectSchema";
import {
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
} from "../../core/model/path";

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

export function createNamedCanvasWorkspace(
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

  const workspaceId = `workspace-${stamp}-${random}`;
  const pathId = `path-${stamp}-${random}`;
  const path = createProjectPathDocument({
    path_id: pathId,
    display_name: pathName.trim() || "Path 1",
    file_name: `${safePathFileStem(pathName) || "path-1"}.json`,
    path: createBlankCanvasPath(),
  });

  return createProjectWorkspaceDocument({
    project_id: workspaceId,
    display_name: projectName.trim() || "Untitled Project",
    paths: [path],
    active_path_id: path.path_id,
  });
}

export function createSampleCanvasWorkspace(now = new Date()) {
  const workspace = createNamedCanvasWorkspace(
    "Phase 1 Canvas Draft",
    "Phase 1 Canvas Draft",
    now,
  );
  return {
    ...workspace,
    paths: workspace.paths.map((path) => ({
      ...path,
      path: createExampleCanvasPath(),
    })),
  };
}

function safePathFileStem(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

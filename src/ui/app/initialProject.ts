import {
  createProjectDocument,
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

interface InitialCanvasProjectOptions {
  projectId?: string;
  displayName?: string;
}

export function createInitialCanvasProject(
  options: InitialCanvasProjectOptions = {},
) {
  return createProjectDocument({
    project_id: options.projectId ?? "phase-1-canvas-draft",
    display_name: options.displayName ?? "Phase 1 Canvas Draft",
    path: createExampleCanvasPath(),
  });
}

export function createInitialCanvasWorkspace(
  options: InitialCanvasProjectOptions = {},
) {
  const project = createInitialCanvasProject(options);
  const path = createProjectPathDocument({
    path_id: project.project_id,
    display_name: project.display_name,
    file_name: project.path_file_name ?? `${project.project_id}.json`,
    path: project.path,
  });

  return createProjectWorkspaceDocument({
    project_id: options.projectId ?? "phase-1-canvas-workspace",
    display_name: options.displayName ?? "Phase 1 Canvas Draft",
    config: project.config,
    paths: [path],
    active_path_id: path.path_id,
  });
}

export function createExampleCanvasPath() {
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

export function createBlankCanvasProject(
  options: InitialCanvasProjectOptions = {},
) {
  return createProjectDocument({
    project_id: options.projectId ?? "blank-path",
    display_name: options.displayName ?? "Untitled Path",
    path: createBlankCanvasPath(),
  });
}

export function createBlankCanvasWorkspace(
  options: InitialCanvasProjectOptions = {},
) {
  const project = createBlankCanvasProject(options);
  const path = createProjectPathDocument({
    path_id: project.project_id,
    display_name: project.display_name,
    file_name: project.path_file_name ?? `${project.project_id}.json`,
    path: project.path,
  });

  return createProjectWorkspaceDocument({
    project_id: options.projectId ?? "blank-workspace",
    display_name: options.displayName ?? "Untitled Project",
    config: project.config,
    paths: [path],
    active_path_id: path.path_id,
  });
}

export function createNewCanvasProject(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const random =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ??
    Math.random().toString(36).slice(2, 10);

  return createBlankCanvasProject({
    projectId: `phase-1-path-${stamp}-${random}`,
    displayName: "Untitled Path",
  });
}

export function createNewCanvasWorkspace(now = new Date()) {
  return createNamedCanvasWorkspace("Untitled Project", "Path 1", now);
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

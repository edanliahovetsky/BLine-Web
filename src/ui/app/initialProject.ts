import { autoRadiiCapSolveInput } from "../../core/constraints/autoConstraintGeneration";
import { projectConfigDefaultLookup } from "../../core/config/projectConfig";
import {
  autoVelocitySettingsForPath,
  refreshAutoVelocityConstraints,
} from "../../core/constraints/autoVelocityApply";
import { stringifyBLineJson } from "../../core/io/blineJson";
import { deserializePath, serializePath } from "../../core/io/projectSerde";
import { createProject, type ProjectConfig } from "../../core/model/project";
import {
  createEventTrigger,
  createPathModel,
  createRotationTarget,
  createTranslationTarget,
  createWaypoint,
} from "../../core/model/path";
import {
  pathDisplayNameFromFileName,
  pathFileNameFromDisplayName,
} from "../../core/model/projectIdentity";

function createExampleCanvasPath(config: ProjectConfig) {
  const path = createPathModel({
    path_elements: [
      createWaypoint({
        translation_target: createTranslationTarget({
          x_meters: 5.7,
          y_meters: 2.5,
        }),
        rotation_target: createRotationTarget({
          rotation_radians: Math.PI / 4,
        }),
      }),
      createTranslationTarget({
        x_meters: 7.0,
        y_meters: 4.0,
      }),
      createRotationTarget({
        t_ratio: 0.5,
        rotation_radians: (3 * Math.PI) / 4,
      }),
      createTranslationTarget({
        x_meters: 9.6,
        y_meters: 4.0,
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
  });
  const settings = autoVelocitySettingsForPath(path, config);
  const generated = autoRadiiCapSolveInput(path, config, settings);
  // Sign the same precision and inherited defaults that reopening will use.
  const savedPath = deserializePath(
    JSON.parse(stringifyBLineJson(serializePath(generated.path))),
    projectConfigDefaultLookup(config),
  );
  return refreshAutoVelocityConstraints(savedPath, config, {
    whenPresentOnly: false,
    settings,
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
    display_name: pathDisplayNameFromFileName(
      pathFileNameFromDisplayName(pathName.trim() || "Path 1"),
    ),
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
  const project = createNamedProject("Sample Project", "Sample Path", now);
  return {
    ...project,
    paths: project.paths.map((path) => ({
      ...path,
      path: createExampleCanvasPath(project.config),
    })),
  };
}

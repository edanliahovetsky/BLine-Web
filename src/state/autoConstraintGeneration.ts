import { applyGeneratedAutoRadii } from "../core/constraints/autoConstraintGeneration";
import {
  autoVelocityGenerationOptions,
  refreshAutoVelocityConstraints,
  type AutoVelocitySettings,
} from "../core/constraints/autoVelocityApply";
import { autoVelocityInputSignature } from "../core/constraints/autoVelocityConstraints";
import {
  requestAutoRadiiAndCaps,
  supersededAutoVelocityProfile,
} from "../platform/autoVelocityRunner";
import type { ProjectConfig } from "../core/model/project";
import type { PathModel } from "../core/model/path";
import { autoVelocityStore, type AutoVelocityStore } from "./autoVelocityStore";
import { projectStore, type ProjectStore } from "./projectStore";

export interface ManualAutoConstraintGenerationOptions {
  projects?: ProjectStore;
  request?: typeof requestAutoRadiiAndCaps;
  status?: AutoVelocityStore;
}

/**
 * Runs an explicit Generate off the UI thread, then commits the complete
 * radius/cap policy as one undoable edit if its inputs are still current.
 */
export async function generateAutoConstraintsInWorker(
  settings: AutoVelocitySettings,
  options: ManualAutoConstraintGenerationOptions = {},
): Promise<void> {
  const projects = options.projects ?? projectStore;
  const request = options.request ?? requestAutoRadiiAndCaps;
  const status = options.status ?? autoVelocityStore;
  const initialState = projects.getState();
  const initialProject = initialState.project;
  const initialPath = initialProject?.paths.find(
    (path) => path.path_id === initialState.activePathId,
  );
  if (
    !initialProject ||
    !initialPath ||
    status.getState().runSource === "manual"
  ) {
    return;
  }

  const signature = generationInputSignature(
    initialPath.path,
    initialProject.config,
    settings,
  );
  status.getState().setLastError(null);
  status.getState().setPhase("running", "manual");

  try {
    const run = await request(
      initialPath.path,
      initialProject.config,
      settings,
    );
    if (run === supersededAutoVelocityProfile) {
      return;
    }

    const currentProject = projects.getState().project;
    const currentPath = currentProject?.paths.find(
      (path) => path.path_id === initialPath.path_id,
    );
    if (
      !currentProject ||
      !currentPath ||
      currentProject.project_id !== initialProject.project_id ||
      (signature === null
        ? currentPath.path !== initialPath.path ||
          currentProject.config !== initialProject.config
        : generationInputSignature(
            currentPath.path,
            currentProject.config,
            settings,
          ) !== signature)
    ) {
      return;
    }

    const completedSignature = autoVelocityInputSignature(
      applyGeneratedAutoRadii(currentPath.path, run.radii),
      currentProject.config,
      autoVelocityGenerationOptions(settings),
    );

    let previousPath: PathModel | null = null;
    const config = currentProject.config;
    projects.getState().applyPathCommand(
      {
        description: "Generate constraints",
        apply: (path) => {
          previousPath = path;
          return refreshAutoVelocityConstraints(
            applyGeneratedAutoRadii(path, run.radii),
            config,
            { whenPresentOnly: false, settings },
          );
        },
        revert: (path) => previousPath ?? path,
      },
      initialPath.path_id,
    );
    status.getState().setLastRun({
      elapsedMs: run.elapsedMs,
      inputSignature: completedSignature,
      projectId: currentProject.project_id,
      stats: run.stats,
      status: run.status,
    });
  } catch (error) {
    status
      .getState()
      .setLastError(error instanceof Error ? error.message : String(error));
  } finally {
    if (status.getState().runSource === "manual") {
      status.getState().setPhase("idle");
    }
  }
}

function generationInputSignature(
  path: PathModel,
  config: ProjectConfig,
  settings: AutoVelocitySettings,
): string | null {
  return autoVelocityInputSignature(
    path,
    config,
    autoVelocityGenerationOptions(settings),
  );
}

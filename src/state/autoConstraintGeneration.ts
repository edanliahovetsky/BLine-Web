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
} from "../core/constraints/autoVelocityRunner";
import type { ProjectDocument } from "../core/io/projectSchema";
import {
  autoVelocityStore,
  type AutoVelocityStore,
} from "./autoVelocityStore";
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
  const initial = projects.getState().project;
  if (!initial || status.getState().runSource === "manual") {
    return;
  }

  const signature = generationInputSignature(initial, settings);
  status.getState().setLastError(null);
  status.getState().setPhase("running", "manual");

  try {
    const run = await request(
      initial.path,
      initial.config,
      settings,
    );
    if (run === supersededAutoVelocityProfile) {
      return;
    }

    const current = projects.getState().project;
    if (
      !current ||
      current.project_id !== initial.project_id ||
      (signature === null
        ? current.path !== initial.path || current.config !== initial.config
        : generationInputSignature(current, settings) !== signature)
    ) {
      return;
    }

    const completedSignature = autoVelocityInputSignature(
      applyGeneratedAutoRadii(current.path, run.radii),
      current.config,
      autoVelocityGenerationOptions(settings),
    );

    let previousPath: ProjectDocument["path"] | null = null;
    projects.getState().applyCommand({
      description: "Generate constraints",
      apply: (project) => {
        previousPath = project.path;
        return {
          ...project,
          path: refreshAutoVelocityConstraints(
            applyGeneratedAutoRadii(project.path, run.radii),
            project.config,
            { whenPresentOnly: false, settings },
          ),
        };
      },
      revert: (project) =>
        previousPath ? { ...project, path: previousPath } : project,
    });
    status.getState().setLastRun({
      elapsedMs: run.elapsedMs,
      inputSignature: completedSignature,
      projectId: current.project_id,
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
  project: ProjectDocument,
  settings: AutoVelocitySettings,
): string | null {
  return autoVelocityInputSignature(
    project.path,
    project.config,
    autoVelocityGenerationOptions(settings),
  );
}

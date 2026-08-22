import {
  applyGeneratedAutoRadii,
  type AutoHandoffRadiusAssignment,
} from "../core/constraints/autoConstraintGeneration";
import {
  autoVelocityRefreshRequest,
  refreshAutoVelocityConstraints,
  type AutoVelocitySettings,
} from "../core/constraints/autoVelocityApply";
import {
  requestAutoRadiiAndCaps,
  supersededAutoVelocityProfile,
} from "../platform/autoVelocityRunner";
import type { ProjectConfig } from "../core/model/project";
import type { PathModel } from "../core/model/path";
import { autoVelocityStore, type AutoVelocityStore } from "./autoVelocityStore";
import { projectStore, type ProjectStore } from "./projectStore";

/**
 * How long the path must sit still before the optimizer starts. Long enough
 * that a drag does not fire a solve per frame, short enough that pausing to
 * look at the path gets fresh caps without a deliberate click.
 */
export const autoVelocitySyncDelayMs = 400;

export interface AutoVelocitySyncOptions {
  projects?: ProjectStore;
  status?: AutoVelocityStore;
  delayMs?: number;
  request?: typeof requestAutoRadiiAndCaps;
}

/**
 * Keeps generated handoff radii and velocity caps in step with the path they
 * were solved for.
 *
 * Only paths that already carry generated caps are touched: generating the
 * first time stays an explicit choice, and pinned radii and pinned segments are
 * left alone by the apply step. The generated caps carry the input signature
 * that decides staleness, so a path whose every cap is pinned by hand waits for
 * an explicit Generate. The result is written without a history entry, so undo
 * steps back through the edit the user made rather than the regeneration that
 * followed it.
 */
export function startAutoVelocitySync(
  options: AutoVelocitySyncOptions = {},
): () => void {
  const projects = options.projects ?? projectStore;
  const status = options.status ?? autoVelocityStore;
  const delayMs = options.delayMs ?? autoVelocitySyncDelayMs;
  const requestProfile = options.request ?? requestAutoRadiiAndCaps;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlightSignature: string | null = null;
  let lastAppliedUnstampedToken: string | null = null;
  let disposed = false;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const settle = () => {
    if (!disposed && status.getState().runSource === "sync") {
      status.getState().setPhase("idle");
    }
  };

  const run = (pathId: string, signature: string | null) => {
    const state = projects.getState();
    const project = state.project;
    const path = project?.paths.find(
      (candidate) => candidate.path_id === pathId,
    );
    if (!project || !path) {
      settle();
      return;
    }

    const request = autoVelocityRefreshRequest(path.path, project.config);
    if (
      !request ||
      !refreshRequestIsStale(
        project.project_id,
        pathId,
        request,
        lastAppliedUnstampedToken,
      ) ||
      request.signature !== signature
    ) {
      settle();
      return;
    }

    inFlightSignature = signature;
    status.getState().setPhase("running", "sync");

    requestProfile(path.path, project.config, request.settings)
      .then((run) => {
        if (disposed || run === supersededAutoVelocityProfile) {
          return;
        }

        // The project may have moved on while the solver ran; the next
        // evaluate() will schedule a fresh pass for whatever it is now.
        const currentProject = projects.getState().project;
        const currentPath = currentProject?.paths.find(
          (candidate) => candidate.path_id === pathId,
        );
        if (
          currentProject &&
          currentPath &&
          sameAutoVelocityInputs(
            currentPath.path,
            currentProject.config,
            signature,
          )
        ) {
          if (!request.hasGeneratedVelocityCaps) {
            lastAppliedUnstampedToken = unstampedRefreshToken(
              project.project_id,
              pathId,
              request.signature,
            );
          }
          applyRefresh(
            projects,
            pathId,
            currentProject.config,
            run.radii,
            request.settings,
          );
        }
        status.getState().setLastError(null);
        status.getState().setLastRun({
          elapsedMs: run.elapsedMs,
          inputSignature: request.signature,
          projectId: project.project_id,
          stats: run.stats,
          status: run.status,
        });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        status
          .getState()
          .setLastError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (inFlightSignature === signature) {
          inFlightSignature = null;
        }
        settle();
      });
  };

  const evaluate = () => {
    if (disposed) {
      return;
    }

    if (status.getState().runSource === "manual") {
      cancelTimer();
      return;
    }

    const state = projects.getState();
    const project = state.project;
    const path = project?.paths.find(
      (candidate) => candidate.path_id === state.activePathId,
    );
    const request =
      project && path
        ? autoVelocityRefreshRequest(path.path, project.config)
        : null;
    const stale =
      project && path && request
        ? refreshRequestIsStale(
            project.project_id,
            path.path_id,
            request,
            lastAppliedUnstampedToken,
          )
        : false;

    if (
      !status.getState().autoSyncEnabled ||
      !path ||
      !request ||
      !stale ||
      // An unsignable path can never be stamped as current, so syncing it would
      // re-solve on every pass. Leave those to the explicit Generate button.
      request.signature === null ||
      request.signature === inFlightSignature
    ) {
      if (inFlightSignature === null) {
        cancelTimer();
        settle();
      }
      return;
    }

    cancelTimer();
    status.getState().setPhase("pending", "sync");
    const signature = request.signature;
    const pathId = path.path_id;
    timer = setTimeout(() => {
      timer = null;
      run(pathId, signature);
    }, delayMs);
  };

  const unsubscribeProject = projects.subscribe(evaluate);
  // Only the toggle should restart the loop. Re-evaluating on every phase
  // write would cancel and reschedule the debounce that is trying to fire.
  let lastAutoSyncEnabled = status.getState().autoSyncEnabled;
  let lastRunSource = status.getState().runSource;
  const unsubscribeStatus = status.subscribe((state) => {
    const autoSyncChanged = state.autoSyncEnabled !== lastAutoSyncEnabled;
    const manualActivityChanged =
      state.runSource === "manual" || lastRunSource === "manual";
    lastAutoSyncEnabled = state.autoSyncEnabled;
    lastRunSource = state.runSource;
    if (!autoSyncChanged && !manualActivityChanged) {
      return;
    }
    evaluate();
  });
  evaluate();

  return () => {
    disposed = true;
    cancelTimer();
    unsubscribeProject();
    unsubscribeStatus();
  };
}

function refreshRequestIsStale(
  projectId: string,
  pathId: string,
  request: NonNullable<ReturnType<typeof autoVelocityRefreshRequest>>,
  lastAppliedUnstampedToken: string | null,
): boolean {
  if (!request.stale) {
    return false;
  }
  return (
    request.hasGeneratedVelocityCaps ||
    unstampedRefreshToken(projectId, pathId, request.signature) !==
      lastAppliedUnstampedToken
  );
}

function unstampedRefreshToken(
  projectId: string,
  pathId: string,
  signature: string | null,
): string {
  return `${projectId}:${pathId}:${signature ?? "unsignable"}`;
}

function sameAutoVelocityInputs(
  path: PathModel,
  config: ProjectConfig,
  signature: string | null,
): boolean {
  return autoVelocityRefreshRequest(path, config)?.signature === signature;
}

/**
 * Writes the solved radii and the caps solved for them in one derived step, so
 * the two halves of the optimizer's output never land apart.
 */
function applyRefresh(
  projects: ProjectStore,
  pathId: string,
  config: ProjectConfig,
  radii: readonly AutoHandoffRadiusAssignment[],
  settings: AutoVelocitySettings,
): void {
  let previous: PathModel | null = null;

  projects.getState().applyDerivedPathCommand(
    {
      description: "Sync generated constraints",
      apply: (path) => {
        previous = path;
        return refreshAutoVelocityConstraints(
          applyGeneratedAutoRadii(path, radii),
          config,
          { whenPresentOnly: true, settings },
        );
      },
      revert: (path) => previous ?? path,
    },
    pathId,
  );
}

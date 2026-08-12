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
} from "../core/constraints/autoVelocityRunner";
import type { ProjectDocument } from "../core/io/projectSchema";
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
    if (!disposed && status.getState().phase !== "idle") {
      status.getState().setPhase("idle");
    }
  };

  const run = (signature: string | null) => {
    const project = projects.getState().project;
    if (!project) {
      settle();
      return;
    }

    const request = autoVelocityRefreshRequest(project.path, project.config);
    if (
      !request ||
      !refreshRequestIsStale(project, request, lastAppliedUnstampedToken) ||
      request.signature !== signature
    ) {
      settle();
      return;
    }

    inFlightSignature = signature;
    status.getState().setPhase("running");

    requestAutoRadiiAndCaps(project.path, project.config, request.settings)
      .then((run) => {
        if (disposed || run === supersededAutoVelocityProfile) {
          return;
        }

        // The project may have moved on while the solver ran; the next
        // evaluate() will schedule a fresh pass for whatever it is now.
        const current = projects.getState().project;
        if (!current || sameAutoVelocityInputs(current, signature)) {
          if (!request.hasGeneratedVelocityCaps) {
            lastAppliedUnstampedToken = unstampedRefreshToken(
              project,
              request.signature,
            );
          }
          applyRefresh(projects, run.radii, request.settings);
        }
        status.getState().setLastError(null);
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

    const project = projects.getState().project;
    const request = project
      ? autoVelocityRefreshRequest(project.path, project.config)
      : null;
    const stale =
      project && request
        ? refreshRequestIsStale(project, request, lastAppliedUnstampedToken)
        : false;

    if (
      !status.getState().autoSyncEnabled ||
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
    status.getState().setPhase("pending");
    const signature = request.signature;
    timer = setTimeout(() => {
      timer = null;
      run(signature);
    }, delayMs);
  };

  const unsubscribeProject = projects.subscribe(evaluate);
  // Only the toggle should restart the loop. Re-evaluating on every phase
  // write would cancel and reschedule the debounce that is trying to fire.
  let lastAutoSyncEnabled = status.getState().autoSyncEnabled;
  const unsubscribeStatus = status.subscribe((state) => {
    if (state.autoSyncEnabled === lastAutoSyncEnabled) {
      return;
    }
    lastAutoSyncEnabled = state.autoSyncEnabled;
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
  project: ProjectDocument,
  request: NonNullable<ReturnType<typeof autoVelocityRefreshRequest>>,
  lastAppliedUnstampedToken: string | null,
): boolean {
  if (!request.stale) {
    return false;
  }
  return (
    request.hasGeneratedVelocityCaps ||
    unstampedRefreshToken(project, request.signature) !==
      lastAppliedUnstampedToken
  );
}

function unstampedRefreshToken(
  project: ProjectDocument,
  signature: string | null,
): string {
  return `${project.project_id}:${signature ?? "unsignable"}`;
}

function sameAutoVelocityInputs(
  project: ProjectDocument,
  signature: string | null,
): boolean {
  return (
    autoVelocityRefreshRequest(project.path, project.config)?.signature ===
    signature
  );
}

/**
 * Writes the solved radii and the caps solved for them in one derived step, so
 * the two halves of the optimizer's output never land apart.
 */
function applyRefresh(
  projects: ProjectStore,
  radii: readonly AutoHandoffRadiusAssignment[],
  settings: AutoVelocitySettings,
): void {
  let previous: ProjectDocument["path"] | null = null;

  projects.getState().applyDerivedCommand({
    description: "Sync generated constraints",
    apply: (project) => {
      previous = project.path;
      return {
        ...project,
        path: refreshAutoVelocityConstraints(
          applyGeneratedAutoRadii(project.path, radii),
          project.config,
          { whenPresentOnly: true, settings },
        ),
      };
    },
    revert: (project) => (previous ? { ...project, path: previous } : project),
  });
}

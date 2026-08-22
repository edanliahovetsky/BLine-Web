import {
  applyGeneratedAutoRadii,
  clearGeneratedAutoConstraints,
  hasGeneratedAutoConstraints,
} from "../core/constraints/autoConstraintGeneration";
import {
  autoVelocityRefreshRequest,
  refreshAutoVelocityConstraints,
  type AutoVelocitySettings,
} from "../core/constraints/autoVelocityApply";
import type { ProjectConfig } from "../core/model/project";
import type { PathModel } from "../core/model/path";
import {
  requestAutoRadiiAndCaps,
  supersededAutoVelocityProfile,
  type AutoRadiiAndCapsRun,
} from "../platform/autoVelocityRunner";
import { autoVelocityStore, type AutoVelocityStore } from "./autoVelocityStore";
import {
  captureProjectEditOwnership,
  captureProjectMutationOwnership,
  projectMutationIsCurrent,
  projectStore,
  type DerivedPathCommandResult,
  type ProjectEditOwnership,
  type ProjectMutationOwnership,
  type ProjectStore,
} from "./projectStore";

export const automaticConstraintSyncDelayMs = 400;

interface AutomaticConstraintOptions {
  projects?: ProjectStore;
  request?: typeof requestAutoRadiiAndCaps;
  status?: AutoVelocityStore;
}

export interface AutomaticConstraintSyncOptions extends AutomaticConstraintOptions {
  delayMs?: number;
}

interface SyncCandidate {
  token: number;
  ownership: ProjectEditOwnership;
  pathId: string;
  path: PathModel;
  config: ProjectConfig;
  refresh: NonNullable<ReturnType<typeof autoVelocityRefreshRequest>>;
}

/** Runs explicit generation and records one undoable Path edit if it still owns its inputs. */
export async function generateAutomaticConstraints(
  settings: AutoVelocitySettings,
  options: AutomaticConstraintOptions = {},
): Promise<void> {
  const projects = options.projects ?? projectStore;
  const request = options.request ?? requestAutoRadiiAndCaps;
  const status = options.status ?? autoVelocityStore;
  const initialState = projects.getState();
  const ownership = captureProjectMutationOwnership(initialState);
  const initialProject = initialState.project;
  const initialPath = initialProject?.paths.find(
    (path) => path.path_id === initialState.activePathId,
  );
  if (
    !ownership ||
    !initialProject ||
    !initialPath ||
    status.getState().runSource === "manual"
  ) {
    return;
  }

  const pathSnapshot = structuredClone(initialPath.path);
  const configSnapshot = structuredClone(initialProject.config);
  const settingsSnapshot = structuredClone(settings);
  status.getState().setLastError(null);
  status.getState().setPhase("running", "manual");

  try {
    const run = await request(pathSnapshot, configSnapshot, settingsSnapshot);
    if (run === supersededAutoVelocityProfile) {
      return;
    }

    const currentState = projects.getState();
    const currentProject = currentState.project;
    const currentPath = currentProject?.paths.find(
      (path) => path.path_id === initialPath.path_id,
    );
    if (
      !currentProject ||
      !currentPath ||
      !projectMutationIsCurrent(currentState, ownership)
    ) {
      return;
    }

    applyManualResult(
      projects,
      initialPath.path_id,
      currentProject.config,
      settingsSnapshot,
      run,
    );
  } catch (error) {
    if (projectMutationIsCurrent(projects.getState(), ownership)) {
      status
        .getState()
        .setLastError(error instanceof Error ? error.message : String(error));
    }
  } finally {
    if (status.getState().runSource === "manual") {
      status.getState().setPhase("idle");
    }
  }
}

/** Clears generated caps and radii only, as one ordinary undoable action. */
export function clearAutomaticConstraints(
  options: Pick<AutomaticConstraintOptions, "projects"> = {},
): boolean {
  const projects = options.projects ?? projectStore;
  const state = projects.getState();
  const path = state.project?.paths.find(
    (candidate) => candidate.path_id === state.activePathId,
  );
  if (!path || !hasGeneratedAutoConstraints(path.path)) {
    return false;
  }

  let previous: PathModel | null = null;
  projects.getState().applyPathCommand({
    description: "Clear generated constraints",
    apply: (current) => {
      previous = current;
      return clearGeneratedAutoConstraints(current);
    },
    revert: (current) => previous ?? current,
  });
  return true;
}

/**
 * Keeps existing generated output current after user edits. Accepted output is
 * folded into the exact edit that triggered it; navigation alone is harmless.
 */
export function startAutomaticConstraintSync(
  options: AutomaticConstraintSyncOptions = {},
): () => void {
  const projects = options.projects ?? projectStore;
  const request = options.request ?? requestAutoRadiiAndCaps;
  const status = options.status ?? autoVelocityStore;
  const delayMs = options.delayMs ?? automaticConstraintSyncDelayMs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextToken = 1;
  let currentToken = 0;
  let disposed = false;
  let lastAppliedUnstampedToken: string | null = null;
  let considered = captureProjectMutationOwnership(projects.getState());

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
  const invalidate = () => {
    currentToken = nextToken++;
    cancelTimer();
  };

  const run = (candidate: SyncCandidate) => {
    if (
      disposed ||
      candidate.token !== currentToken ||
      !syncCandidateIsCurrent(projects, candidate) ||
      !status.getState().autoSyncEnabled
    ) {
      settle();
      return;
    }

    status.getState().setLastError(null);
    status.getState().setPhase("running", "sync");
    request(candidate.path, candidate.config, candidate.refresh.settings)
      .then((result) => {
        if (
          disposed ||
          result === supersededAutoVelocityProfile ||
          candidate.token !== currentToken ||
          !status.getState().autoSyncEnabled ||
          !syncCandidateIsCurrent(projects, candidate)
        ) {
          return;
        }

        const nextRevision = candidate.ownership.revision + 1;
        considered = {
          projectId: candidate.ownership.projectId,
          projectSessionId: candidate.ownership.projectSessionId,
          revision: nextRevision,
        };
        const outcome = applySyncResult(projects, candidate, result);
        if (outcome !== "applied") {
          considered = captureProjectMutationOwnership(projects.getState());
        }
        if (
          outcome !== "stale" &&
          !candidate.refresh.hasGeneratedVelocityCaps
        ) {
          lastAppliedUnstampedToken = unstampedRefreshToken(candidate);
        }
      })
      .catch((error: unknown) => {
        if (
          !disposed &&
          candidate.token === currentToken &&
          syncCandidateIsCurrent(projects, candidate)
        ) {
          status
            .getState()
            .setLastError(
              error instanceof Error ? error.message : String(error),
            );
        }
      })
      .finally(() => {
        if (candidate.token === currentToken) {
          settle();
        }
      });
  };

  const evaluate = (force = false) => {
    if (disposed) return;
    const statusState = status.getState();
    if (!statusState.autoSyncEnabled || statusState.runSource === "manual") {
      invalidate();
      settle();
      return;
    }

    const state = projects.getState();
    const mutation = captureProjectMutationOwnership(state);
    if (!force && sameMutation(mutation, considered)) {
      return;
    }
    considered = mutation;
    invalidate();

    const ownership = captureProjectEditOwnership(state);
    const path = state.project?.paths.find(
      (candidate) => candidate.path_id === state.activePathId,
    );
    const refresh =
      state.project && path
        ? autoVelocityRefreshRequest(path.path, state.project.config)
        : null;
    if (
      !ownership ||
      !path ||
      !state.project ||
      !refresh ||
      !refresh.stale ||
      refresh.signature === null ||
      (!refresh.hasGeneratedVelocityCaps &&
        unstampedRefreshToken({
          ownership,
          pathId: path.path_id,
          refresh,
        }) === lastAppliedUnstampedToken)
    ) {
      settle();
      return;
    }

    const candidate: SyncCandidate = {
      token: nextToken++,
      ownership,
      pathId: path.path_id,
      path: structuredClone(path.path),
      config: structuredClone(state.project.config),
      refresh,
    };
    currentToken = candidate.token;
    status.getState().setPhase("pending", "sync");
    timer = setTimeout(() => {
      timer = null;
      run(candidate);
    }, delayMs);
  };

  let session = projects.getState().projectSessionId;
  const unsubscribeProject = projects.subscribe((state) => {
    if (state.projectSessionId !== session) {
      session = state.projectSessionId;
      lastAppliedUnstampedToken = null;
      status.getState().reset();
    }
    evaluate();
  });
  let syncEnabled = status.getState().autoSyncEnabled;
  let runSource = status.getState().runSource;
  const unsubscribeStatus = status.subscribe((state) => {
    const toggleChanged = state.autoSyncEnabled !== syncEnabled;
    const manualChanged =
      state.runSource === "manual" || runSource === "manual";
    syncEnabled = state.autoSyncEnabled;
    runSource = state.runSource;
    if (toggleChanged || manualChanged) {
      evaluate(true);
    }
  });

  return () => {
    disposed = true;
    invalidate();
    unsubscribeProject();
    unsubscribeStatus();
  };
}

function applyManualResult(
  projects: ProjectStore,
  pathId: string,
  config: ProjectConfig,
  settings: AutoVelocitySettings,
  run: AutoRadiiAndCapsRun,
): void {
  let previous: PathModel | null = null;
  projects.getState().applyPathCommand(
    {
      description: "Generate constraints",
      apply: (path) => {
        previous = path;
        return refreshAutoVelocityConstraints(
          applyGeneratedAutoRadii(path, run.radii),
          config,
          { whenPresentOnly: false, settings },
        );
      },
      revert: (path) => previous ?? path,
    },
    pathId,
  );
}

function applySyncResult(
  projects: ProjectStore,
  candidate: SyncCandidate,
  run: AutoRadiiAndCapsRun,
): DerivedPathCommandResult {
  return projects.getState().applyDerivedPathCommand(
    {
      description: "Sync generated constraints",
      apply: (path) =>
        refreshAutoVelocityConstraints(
          applyGeneratedAutoRadii(path, run.radii),
          candidate.config,
          { whenPresentOnly: true, settings: candidate.refresh.settings },
        ),
      revert: (path) => path,
    },
    candidate.ownership,
    candidate.pathId,
  );
}

function syncCandidateIsCurrent(
  projects: ProjectStore,
  candidate: SyncCandidate,
): boolean {
  const state = projects.getState();
  const path = state.project?.paths.find(
    (current) => current.path_id === candidate.pathId,
  );
  return (
    projectMutationIsCurrent(state, candidate.ownership) &&
    state.history.getState().undoStack.at(-1) ===
      candidate.ownership.historyEntry &&
    Boolean(
      path &&
      state.project &&
      autoVelocityRefreshRequest(path.path, state.project.config)?.signature ===
        candidate.refresh.signature,
    )
  );
}

function sameMutation(
  left: ProjectMutationOwnership | null,
  right: ProjectMutationOwnership | null,
): boolean {
  return (
    left?.projectId === right?.projectId &&
    left?.projectSessionId === right?.projectSessionId &&
    left?.revision === right?.revision
  );
}

function unstampedRefreshToken(
  candidate: Pick<SyncCandidate, "ownership" | "pathId" | "refresh">,
): string {
  return `${candidate.ownership.projectSessionId}:${candidate.ownership.projectId}:${candidate.pathId}:${candidate.refresh.signature ?? "unsignable"}`;
}

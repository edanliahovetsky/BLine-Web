import type { PathModel } from "../model/path";
import type { SimulationConfig } from "../sim/types";
import {
  autoRadiiCapSolveInput,
  type AutoHandoffRadiusAssignment,
} from "./autoConstraintGeneration";
import type { AutoVelocitySettings } from "./autoVelocityApply";
import {
  autoVelocityInputSignature,
  primeAutoVelocityProfileCache,
  type AutoVelocityProfile,
  type JointAutoConstraintSolveStats,
  type JointAutoConstraintSolveStatus,
} from "./autoVelocityConstraints";
import type {
  AutoVelocityWorkerRequest,
  AutoVelocityWorkerResponse,
} from "./autoVelocityWorkerProtocol";

/**
 * A run that a newer request replaced. The caller wanted the output for a path
 * that no longer exists, so there is nothing meaningful to return.
 */
export const supersededAutoVelocityProfile = Symbol("superseded");

export interface AutoRadiiAndCapsRun {
  radii: AutoHandoffRadiusAssignment[];
  profile: AutoVelocityProfile;
  stats: JointAutoConstraintSolveStats;
  status: JointAutoConstraintSolveStatus;
  elapsedMs: number;
}

export type AutoRadiiAndCapsRunResult =
  | AutoRadiiAndCapsRun
  | typeof supersededAutoVelocityProfile;

interface PendingRun {
  requestId: number;
  onResponse(response: AutoVelocityWorkerResponse): void;
  onSuperseded(): void;
  reject(error: unknown): void;
}

let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;
let pending: PendingRun | null = null;

/**
 * Runs the whole generation pipeline off the main thread when the browser has
 * workers, falling back to an in-place solve when it does not. The handoff radii
 * and the caps solved for them come back together, so the caller applies one
 * consistent result instead of re-deriving half of it.
 *
 * Only the most recent request survives: an earlier run is abandoned — and its
 * worker torn down, since the solver has no interior cancellation point — so a
 * fast sequence of edits does not queue up seconds of stale work.
 */
export function requestAutoRadiiAndCaps(
  path: PathModel,
  config: SimulationConfig,
  settings: AutoVelocitySettings,
): Promise<AutoRadiiAndCapsRunResult> {
  const startedAtMs = optimizerNowMs();
  supersedePending();

  const activeWorker = ensureWorker();
  if (!activeWorker) {
    return solveRadiiAndCapsOnMainThread(path, config, settings);
  }

  const requestId = takeRequestId();
  return new Promise<AutoRadiiAndCapsRunResult>((resolve, reject) => {
    pending = {
      requestId,
      onResponse: (response) => {
        if (response.kind !== "generated-radii-and-caps") {
          reject(new Error(`Unexpected worker response ${response.kind}`));
          return;
        }
        primeAutoVelocityProfileCache(response.cacheKey, response.profile);
        resolve({
          radii: response.radii,
          profile: response.profile,
          stats: response.stats,
          status: response.status,
          elapsedMs: optimizerNowMs() - startedAtMs,
        });
      },
      onSuperseded: () => resolve(supersededAutoVelocityProfile),
      reject,
    };

    postOrFallBack(
      activeWorker,
      { kind: "generate-radii-and-caps", requestId, path, config, settings },
      () => solveRadiiAndCapsOnMainThread(path, config, settings),
      resolve,
      reject,
    );
  });
}

/** Drops the worker and abandons any run in flight. */
export function resetAutoVelocityRunner(): void {
  supersedePending();
  resetWorker();
  workerUnavailable = false;
}

function takeRequestId(): number {
  const requestId = nextRequestId;
  nextRequestId += 1;
  return requestId;
}

function postOrFallBack<T>(
  activeWorker: Worker,
  request: AutoVelocityWorkerRequest,
  fallback: () => Promise<T>,
  resolve: (result: T) => void,
  reject: (error: unknown) => void,
): void {
  try {
    activeWorker.postMessage(request);
  } catch {
    // Structured clone can reject exotic values; the in-place solve does not
    // care, so fall back rather than failing the run.
    pending = null;
    resetWorker();
    workerUnavailable = true;
    fallback().then(resolve, reject);
  }
}

function ensureWorker(): Worker | null {
  if (workerUnavailable) {
    return null;
  }
  if (worker) {
    return worker;
  }
  if (typeof Worker === "undefined") {
    workerUnavailable = true;
    return null;
  }

  try {
    worker = new Worker(new URL("./autoVelocity.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    workerUnavailable = true;
    return null;
  }

  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", handleWorkerError);
  return worker;
}

function handleWorkerMessage(event: MessageEvent): void {
  const response = event.data as AutoVelocityWorkerResponse;
  const run = pending;
  if (!run || !response || response.requestId !== run.requestId) {
    return;
  }

  pending = null;
  if (response.kind === "failed") {
    run.reject(new Error(response.message));
    return;
  }

  run.onResponse(response);
}

function handleWorkerError(event: ErrorEvent): void {
  const run = pending;
  pending = null;
  resetWorker();
  // A worker that failed to boot will keep failing, so stop reaching for it.
  workerUnavailable = true;
  run?.reject(new Error(event.message || "Auto velocity worker failed"));
}

function supersedePending(): void {
  const run = pending;
  if (!run) {
    return;
  }

  pending = null;
  // The solver runs to completion once started, so the only way to stop
  // spending CPU on an abandoned path is to drop the whole worker.
  resetWorker();
  run.onSuperseded();
}

function resetWorker(): void {
  if (!worker) {
    return;
  }

  worker.removeEventListener("message", handleWorkerMessage);
  worker.removeEventListener("error", handleWorkerError);
  worker.terminate();
  worker = null;
}

function solveRadiiAndCapsOnMainThread(
  path: PathModel,
  config: SimulationConfig,
  settings: AutoVelocitySettings,
): Promise<AutoRadiiAndCapsRunResult> {
  const startedAtMs = optimizerNowMs();
  return afterBrowserPaint(() => {
    const input = autoRadiiCapSolveInput(path, config, settings);
    primeAutoVelocityProfileCache(
      autoVelocityInputSignature(input.path, config, input.options),
      input.profile,
    );
    return {
      radii: input.radii,
      profile: input.profile,
      stats: input.stats,
      status: input.status,
      elapsedMs: optimizerNowMs() - startedAtMs,
    };
  });
}

function optimizerNowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function afterBrowserPaint<T>(solve: () => T): Promise<T> {
  if (typeof window === "undefined") {
    return Promise.resolve(solve());
  }

  // Let the pending status render before a solve that will block the thread.
  return new Promise<T>((resolve, reject) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        try {
          resolve(solve());
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  });
}

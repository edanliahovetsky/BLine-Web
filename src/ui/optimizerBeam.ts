import type { AutoVelocityPhase } from "../state/autoVelocityStore";

/**
 * The optimizer reports itself by tracing a current around whichever control
 * leads to the generated caps — the Constraints tab, or the inspector toggle
 * when the inspector is closed. Both hosts share these class and title rules
 * so the two never disagree about what the optimizer is doing.
 */
export function optimizerBeamClass(
  phase: AutoVelocityPhase,
  lastError: string | null,
): string {
  if (phase !== "idle") {
    return "is-optimizing";
  }
  return lastError ? "is-optimizer-failed" : "";
}

export function optimizerBeamTitle(
  phase: AutoVelocityPhase,
  lastError: string | null,
  fallback?: string,
): string | undefined {
  if (phase === "pending") {
    return "Generator queued — velocity caps refresh once the path settles.";
  }
  if (phase === "running") {
    return "Generator running — generating handoff radii and velocity caps.";
  }
  if (lastError) {
    return `The velocity generator could not finish: ${lastError}`;
  }
  return fallback;
}

export function optimizerBeamLabel(
  phase: AutoVelocityPhase,
  lastError: string | null,
): string {
  if (phase === "pending") {
    return "Generator queued";
  }
  if (phase === "running") {
    return "Generating constraints";
  }
  return lastError ? "Generator failed" : "Generator idle";
}

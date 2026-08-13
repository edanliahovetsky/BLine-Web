/// <reference lib="webworker" />
import { autoRadiiCapSolveInput } from "./autoConstraintGeneration";
import { autoVelocityInputSignature } from "./autoVelocityConstraints";
import type {
  AutoVelocityWorkerRequest,
  AutoVelocityWorkerResponse,
} from "./autoVelocityWorkerProtocol";

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.addEventListener("message", (event: MessageEvent) => {
  const request = event.data as AutoVelocityWorkerRequest;
  if (!request || request.kind !== "generate-radii-and-caps") {
    return;
  }

  let response: AutoVelocityWorkerResponse;
  try {
    response = solve(request);
  } catch (error) {
    response = {
      kind: "failed",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  worker.postMessage(response);
});

function solve(request: AutoVelocityWorkerRequest): AutoVelocityWorkerResponse {
  const input = autoRadiiCapSolveInput(
    request.path,
    request.config,
    request.settings,
    request.solver,
  );

  return {
    kind: "generated-radii-and-caps",
    requestId: request.requestId,
    profile: input.profile,
    cacheKey: autoVelocityInputSignature(
      input.path,
      request.config,
      input.options,
    ),
    radii: input.radii,
    stats: input.stats,
    status: input.status,
  };
}

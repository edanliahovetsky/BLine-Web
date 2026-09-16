import { afterEach, expect, it, vi } from "vitest";
import { createPathModel } from "../../../src/core/model/path";
import type { SimTraceResult } from "../../../src/core/sim/types";
import {
  SimulationPreviewRunner,
  simulationPreviewIntervalMs,
  simulationPreviewTimeoutMs,
} from "../../../src/platform/simulationPreviewRunner";
import type {
  SimulationPreviewRequest,
  SimulationPreviewResponse,
} from "../../../src/platform/simulationPreviewProtocol";

afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers();
  const workers: ReturnType<typeof fakeWorker>[] = [];
  const runner = new SimulationPreviewRunner(() => {
    const worker = fakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  const accept = vi.fn();
  const request = () => runner.request(createPathModel(), {}, accept);
  return { runner, workers, accept, request };
}
function fakeWorker() {
  return {
    onmessage: null as
      | ((event: MessageEvent<SimulationPreviewResponse>) => void)
      | null,
    onerror: null as (() => void) | null,
    postMessage: vi.fn<(request: SimulationPreviewRequest) => void>(),
    terminate: vi.fn(),
  };
}
function response(id: number) {
  return {
    data: { id, result: { total_time_s: id } as SimTraceResult },
  } as MessageEvent<SimulationPreviewResponse>;
}

it("coalesces rapid inputs, throttles dispatch and ignores obsolete results", () => {
  const { runner, workers, request, accept } = fixture();
  request();
  vi.advanceTimersByTime(0);
  const worker = workers[0];
  const firstId = worker.postMessage.mock.calls[0][0].id;
  for (let i = 0; i < 30; i++) request();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  worker.onmessage!(response(firstId));
  expect(accept).not.toHaveBeenCalled();
  vi.advanceTimersByTime(simulationPreviewIntervalMs - 1);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  const latestId = worker.postMessage.mock.calls[1][0].id;
  expect(latestId).toBe(firstId + 30);
  worker.onmessage!(response(latestId));
  expect(accept).toHaveBeenCalledExactlyOnceWith({ total_time_s: latestId });
  runner.dispose();
});

it("rejects late results after cancellation and across repeated drags", () => {
  const { runner, workers, request, accept } = fixture();
  request();
  vi.advanceTimersByTime(0);
  const oldHandler = workers[0].onmessage!;
  const oldId = workers[0].postMessage.mock.calls[0][0].id;
  runner.cancel();
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  request();
  vi.advanceTimersByTime(simulationPreviewIntervalMs);
  oldHandler(response(oldId));
  expect(accept).not.toHaveBeenCalled();
  const worker = workers[1];
  worker.onmessage!(response(worker.postMessage.mock.calls[0][0].id));
  expect(accept).toHaveBeenCalledOnce();
  runner.dispose();
  request();
  vi.runAllTimers();
  expect(workers).toHaveLength(2);
});

it("terminates an over-budget preview and runs only the latest pending geometry", () => {
  const { runner, workers, request, accept } = fixture();
  request();
  vi.advanceTimersByTime(0);
  request();
  request();
  vi.advanceTimersByTime(simulationPreviewTimeoutMs + 1);
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(workers).toHaveLength(2);
  const worker = workers[1];
  worker.onmessage!(response(worker.postMessage.mock.calls[0][0].id));
  expect(accept).toHaveBeenCalledOnce();
  runner.dispose();
});

it("does not block editing with a main-thread fallback when workers are unavailable", () => {
  vi.useFakeTimers();
  const accept = vi.fn();
  const runner = new SimulationPreviewRunner(() => {
    throw new Error("unavailable");
  });
  runner.request(createPathModel(), {}, accept);
  vi.runAllTimers();
  expect(accept).not.toHaveBeenCalled();
  runner.dispose();
});

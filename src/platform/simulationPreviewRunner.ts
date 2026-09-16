import type { PathModel } from "../core/model/path";
import type { SimTraceResult, SimulationConfig } from "../core/sim/types";
import type {
  SimulationPreviewRequest,
  SimulationPreviewResponse,
} from "./simulationPreviewProtocol";

export const simulationPreviewIntervalMs = 80;
export const simulationPreviewTimeoutMs = 500;

type PreviewWorker = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror"
>;
interface PendingPreview extends SimulationPreviewRequest {
  accept(result: SimTraceResult): void;
}

/** One worker, one in-flight solve, one replaceable pending input. Never optimizes constraints. */
export class SimulationPreviewRunner {
  private worker: PreviewWorker | null = null;
  private pending: PendingPreview | null = null;
  private running: PendingPreview | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;
  private lastStartedAt = -Infinity;
  private disposed = false;

  constructor(
    private readonly createWorker: () => PreviewWorker = () =>
      new Worker(new URL("./simulationPreview.worker.ts", import.meta.url), {
        type: "module",
      }),
  ) {}

  request(
    path: PathModel,
    config: SimulationConfig,
    accept: PendingPreview["accept"],
  ): void {
    if (this.disposed) return;
    this.pending = { id: ++this.revision, path, config, accept };
    this.schedule();
  }

  cancel(): void {
    this.revision++;
    this.pending = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.resetWorker();
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
  }

  private schedule(): void {
    if (this.disposed || this.running || this.timer !== null || !this.pending)
      return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.start();
      },
      Math.max(
        0,
        simulationPreviewIntervalMs - (Date.now() - this.lastStartedAt),
      ),
    );
  }

  private start(): void {
    const input = this.pending;
    if (!input || this.disposed) return;
    this.pending = null;
    this.running = input;
    this.lastStartedAt = Date.now();
    try {
      if (!this.worker) {
        this.worker = this.createWorker();
        this.worker.onmessage = (
          event: MessageEvent<SimulationPreviewResponse>,
        ) => {
          const run = this.running;
          if (!run || event.data.id !== run.id) return;
          this.running = null;
          if (this.deadline !== null) clearTimeout(this.deadline);
          this.deadline = null;
          if (run.id === this.revision && event.data.result)
            run.accept(event.data.result);
          this.schedule();
        };
        this.worker.onerror = () => {
          this.resetWorker();
          this.schedule();
        };
      }
      this.deadline = setTimeout(() => {
        this.resetWorker();
        this.schedule();
      }, simulationPreviewTimeoutMs);
      this.worker.postMessage({
        id: input.id,
        path: input.path,
        config: input.config,
      } satisfies SimulationPreviewRequest);
    } catch {
      // Preview is optional; do not fall back to blocking the editing thread.
      this.resetWorker();
      this.schedule();
    }
  }

  private resetWorker(): void {
    if (this.deadline !== null) clearTimeout(this.deadline);
    this.deadline = null;
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
    }
    this.worker = null;
    this.running = null;
  }
}

import { simulatePathWithTrace } from "../core/sim/simulatePath";
import type {
  SimulationPreviewRequest,
  SimulationPreviewResponse,
} from "./simulationPreviewProtocol";

self.addEventListener(
  "message",
  (event: MessageEvent<SimulationPreviewRequest>) => {
    const { id, path, config } = event.data;
    let result: SimulationPreviewResponse["result"] = null;
    try {
      result = simulatePathWithTrace(path, config, { dt_s: 0.02 });
    } catch {
      // The committed path still owns the final simulation if a preview fails.
    }
    self.postMessage({ id, result } satisfies SimulationPreviewResponse);
  },
);

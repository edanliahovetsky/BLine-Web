import type { PathModel } from "../core/model/path";
import type { SimTraceResult, SimulationConfig } from "../core/sim/types";

export interface SimulationPreviewRequest {
  id: number;
  path: PathModel;
  config: SimulationConfig;
}
export interface SimulationPreviewResponse {
  id: number;
  result: SimTraceResult | null;
}

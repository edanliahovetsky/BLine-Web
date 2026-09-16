import { useEffect, useRef, useState } from "react";
import type { PathModel } from "../../core/model/path";
import type { SimulationConfig, SimTraceResult } from "../../core/sim/types";
import { SimulationPreviewRunner } from "../../platform/simulationPreviewRunner";

/** Temporary results belong to a committed source and disappear on release/cancel. */
export function useSimulationPreview(
  source: PathModel | null,
  config: SimulationConfig | null,
  preview: PathModel | null,
  session: object | null,
): SimTraceResult | null {
  const runner = useRef<SimulationPreviewRunner | null>(null);
  const [completed, setCompleted] = useState<{
    session: object;
    source: PathModel;
    config: SimulationConfig;
    result: SimTraceResult;
  } | null>(null);

  useEffect(() => {
    const current = new SimulationPreviewRunner();
    runner.current = current;
    return () => {
      current.dispose();
      runner.current = null;
    };
  }, []);

  useEffect(() => {
    if (!source || !config || !preview || !session) {
      runner.current?.cancel();
      return;
    }
    let current = true;
    runner.current?.request(preview, config, (result) => {
      if (current) setCompleted({ session, source, config, result });
    });
    return () => {
      current = false;
    };
  }, [source, config, preview, session]);

  return preview &&
    completed?.session === session &&
    completed?.source === source &&
    completed.config === config
    ? completed.result
    : null;
}

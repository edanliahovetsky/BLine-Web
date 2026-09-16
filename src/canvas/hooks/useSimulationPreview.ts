import { useEffect, useMemo, useRef, useState } from "react";
import type { PathModel } from "../../core/model/path";
import type { SimulationConfig, SimTraceResult } from "../../core/sim/types";
import { SimulationPreviewRunner } from "../../platform/simulationPreviewRunner";
import {
  deformSimulationPreview,
  prepareSimulationPreview,
} from "../simulationPreviewGeometry";

export const simulationPreviewSettleDelayMs = 100;

/** Temporary results belong to a committed source and disappear on release/cancel. */
export function useSimulationPreview(
  source: PathModel | null,
  config: SimulationConfig | null,
  preview: PathModel | null,
  session: object | null,
  committed: SimTraceResult | null,
): SimTraceResult | null {
  const runner = useRef<SimulationPreviewRunner | null>(null);
  const [completed, setCompleted] = useState<{
    session: object;
    source: PathModel;
    config: SimulationConfig;
    path: PathModel;
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
    let requested = false;
    // Geometry follows the existing animation-frame drag updates immediately.
    // Refine only after a pause, instead of solving on every few pointer moves.
    const timer = setTimeout(() => {
      requested = true;
      runner.current?.request(preview, config, (result) => {
        if (current)
          setCompleted({ session, source, config, path: preview, result });
      });
    }, simulationPreviewSettleDelayMs);
    return () => {
      current = false;
      clearTimeout(timer);
      if (requested) runner.current?.cancel();
    };
  }, [source, config, preview, session]);

  const refined =
    preview &&
    completed?.session === session &&
    completed?.source === source &&
    completed.config === config
      ? completed
      : null;
  const referencePath = refined?.path ?? source;
  const referenceResult = refined?.result ?? committed;
  const prepared = useMemo(
    () =>
      referencePath && referenceResult
        ? prepareSimulationPreview(referencePath, referenceResult)
        : null,
    [referencePath, referenceResult],
  );
  return useMemo(() => {
    if (!preview || !session || !prepared) return null;
    if (refined?.path === preview) return refined.result;
    return deformSimulationPreview(prepared, preview);
  }, [preview, session, prepared, refined]);
}

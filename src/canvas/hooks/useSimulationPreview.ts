import { useEffect, useRef, useState } from "react";
import type { PathModel } from "../../core/model/path";
import type { SimulationConfig, SimTraceResult } from "../../core/sim/types";
import { SimulationPreviewRunner } from "../../platform/simulationPreviewRunner";
import { SimulationPreviewInterpolation } from "../simulationPreviewInterpolation";

/** Simulate off-thread at a bounded cadence; animate only between real results. */
export function useSimulationPreview(
  source: PathModel | null,
  config: SimulationConfig | null,
  preview: PathModel | null,
  session: object | null,
  committed: SimTraceResult | null,
): SimTraceResult | null {
  const runner = useRef<SimulationPreviewRunner | null>(null);
  const acceptResult = useRef<((result: SimTraceResult) => void) | null>(null);
  const [displayed, setDisplayed] = useState<{
    session: object;
    source: PathModel;
    config: SimulationConfig;
    committed: SimTraceResult | null;
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
    if (!source || !config || !session) return;
    let active = true;
    let frame: number | null = null;
    const interpolation = new SimulationPreviewInterpolation(committed);
    const tick = (now: number) => {
      frame = null;
      if (!active) return;
      const result = interpolation.sample(now);
      if (result) setDisplayed({ session, source, config, committed, result });
      if (interpolation.isAnimating(now)) frame = requestAnimationFrame(tick);
    };
    acceptResult.current = (result) => {
      if (!active) return;
      interpolation.retarget(result, performance.now());
      if (frame === null) frame = requestAnimationFrame(tick);
    };
    return () => {
      active = false;
      acceptResult.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
      runner.current?.cancel();
    };
  }, [source, config, session, committed]);

  useEffect(() => {
    const accept = acceptResult.current;
    if (!source || !config || !preview || !session || !accept) {
      runner.current?.cancel();
      return;
    }
    // Keep completed in-flight simulations useful while coalescing newer inputs.
    // Only a session/source change cancels their callbacks, not every pointer move.
    runner.current?.request(preview, config, accept);
  }, [source, config, preview, session, committed]);

  return preview &&
    displayed?.session === session &&
    displayed?.source === source &&
    displayed.config === config &&
    displayed.committed === committed
    ? displayed.result
    : null;
}

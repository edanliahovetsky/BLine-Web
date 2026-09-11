import type { FieldViewport } from "../../canvas/geometry";
import { simulationEventKeysAtTime } from "../../canvas/simulationEventPulse";
import type { PathModel } from "../../core/model/path";
import type { SimTraceResult } from "../../core/sim";
import { useStoreSelector } from "../../state/react";
import { sampleAtTime } from "./tourScenario";
import { tourStore } from "./tourStore";
import { findTour } from "./tours";
import { TourHandoffGuide } from "./TourHandoffGuide";

/** Lesson cues share the ordinary canvas and its existing playback transport. */
export function TourFieldComparison({
  viewport,
  path,
  result,
  time,
}: {
  viewport: FieldViewport;
  path: PathModel;
  result: SimTraceResult;
  time: number;
}) {
  const tourId = useStoreSelector(tourStore, (state) => state.activeTourId);
  const stepIndex = useStoreSelector(tourStore, (state) => state.stepIndex);
  const phase = findTour(tourId)?.steps[stepIndex]?.canvasLesson;
  const handoff = phase?.startsWith("handoff-") || phase === "low-acceleration";
  const current = sampleAtTime(result.trace, time);
  const events = simulationEventKeysAtTime(path, result.trace, time);
  return (
    <>
      {handoff && (
        <TourHandoffGuide
          viewport={viewport}
          path={path}
          result={result}
          time={time}
        />
      )}
      <div
        className="tour-simulation-readout"
        data-tour="lesson-simulation-readout"
      >
        {phase === "low-acceleration" ? (
          <span>Acceleration temporarily lowered</span>
        ) : null}
        {handoff ? (
          <span>
            {time >= result.total_time_s
              ? "End reached"
              : `Steering to ${current?.target_anchor_ordinal_1b === 2 ? "Translation" : "End"}`}
          </span>
        ) : null}
        <span>
          {(current?.speed_mps ?? 0).toFixed(2)} m/s ·{" "}
          {(((current?.theta_rad ?? 0) * 180) / Math.PI).toFixed(0)}°
        </span>
        {events.length > 0 && (
          <strong className="tour-event-cue">{events.join(" · ")}</strong>
        )}
      </div>
    </>
  );
}

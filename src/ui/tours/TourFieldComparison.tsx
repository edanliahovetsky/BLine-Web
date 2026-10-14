import {
  getElementPosition,
  modelToStagePoint,
  type FieldViewport,
} from "../../canvas/geometry";
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
  const step = findTour(tourId)?.steps[stepIndex];
  const phase = step?.canvasLesson;
  const handoff = phase?.startsWith("handoff-") || phase === "low-acceleration";
  const current = sampleAtTime(result.trace, time);
  const events = simulationEventKeysAtTime(path, result.trace, time);
  return (
    <>
      <SegmentCue
        viewport={viewport}
        path={path}
        segment={step?.segment?.(path) ?? null}
      />
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

const segmentCuePadding = 18;

/** An invisible box over a lesson's segment, for the spotlight and Show me. */
function SegmentCue({
  viewport,
  path,
  segment,
}: {
  viewport: FieldViewport;
  path: PathModel;
  segment: readonly [number, number] | null;
}) {
  const ends = segment?.map((index) =>
    getElementPosition(path.path_elements, index),
  );
  if (!ends?.[0] || !ends[1]) return null;
  const [a, b] = ends.map((point) => modelToStagePoint(point!, viewport));
  const left = Math.min(a.x, b.x) - segmentCuePadding;
  const top = Math.min(a.y, b.y) - segmentCuePadding;
  return (
    <div
      className="tour-segment-cue"
      data-tour="lesson-segment"
      aria-hidden="true"
      style={{
        left,
        top,
        width: Math.abs(a.x - b.x) + segmentCuePadding * 2,
        height: Math.abs(a.y - b.y) + segmentCuePadding * 2,
      }}
    />
  );
}

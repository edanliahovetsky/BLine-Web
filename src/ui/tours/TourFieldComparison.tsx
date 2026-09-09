import { useMemo } from "react";
import type { FieldViewport } from "../../canvas/geometry";
import { simulationEventKeysAtTime } from "../../canvas/simulationEventPulse";
import type { PathModel } from "../../core/model/path";
import { isTranslationTarget } from "../../core/model/path";
import { simulatePathWithTrace, type SimTraceResult } from "../../core/sim";
import { useStoreSelector } from "../../state/react";
import { sampleAtTime } from "./tourScenario";
import { tourStore } from "./tourStore";
import { TourHandoffGuide } from "./TourHandoffGuide";

/** A saved run remains visible on the editable field while the learner tunes. */
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
  const reference = useStoreSelector(tourStore, (state) => state.reference);
  const handoffLesson = useStoreSelector(
    tourStore,
    (state) => state.activeTourId === "understand-handoffs",
  );
  const before = useMemo(
    () =>
      reference
        ? simulatePathWithTrace(reference.path, reference.config, {
            dt_s: 0.02,
          })
        : null,
    [reference],
  );
  const points = useMemo(
    () =>
      before?.trace.map((point) => `${point.x_m},${9 - point.y_m}`).join(" "),
    [before],
  );
  const robot = before ? sampleAtTime(before.trace, time) : null;
  const current = sampleAtTime(result.trace, time);
  const events = simulationEventKeysAtTime(path, result.trace, time);
  const showReference =
    before &&
    reference &&
    (!handoffLesson || JSON.stringify(reference.path) !== JSON.stringify(path));
  return (
    <>
      {showReference && before && reference && (
        <svg
          className="tour-reference-trace"
          data-testid="tour-reference-trace"
          aria-label="Path and robot before changes"
          style={{
            left: viewport.x,
            top: viewport.y,
            width: viewport.width,
            height: viewport.height,
          }}
          viewBox="0 0 18 9"
        >
          <polyline
            points={points}
            fill="none"
            stroke="#b8c4d4"
            strokeWidth={0.04}
            strokeDasharray=".13 .12"
            opacity={0.65}
          />
          {robot && (
            <g
              transform={`translate(${robot.x_m} ${9 - robot.y_m}) rotate(${(-robot.theta_rad * 180) / Math.PI})`}
              opacity={0.55}
            >
              <rect
                x={-reference.config.gui.robot.length_meters / 2}
                y={-reference.config.gui.robot.width_meters / 2}
                width={reference.config.gui.robot.length_meters}
                height={reference.config.gui.robot.width_meters}
                fill="#acb8c8"
                fillOpacity={0.15}
                stroke="#d0dae7"
                strokeWidth={0.04}
                strokeDasharray=".1 .08"
              />
              <path
                d="M 0,-.15 L .25,0 L 0,.15"
                fill="none"
                stroke="#d0dae7"
                strokeWidth={0.05}
              />
            </g>
          )}
        </svg>
      )}
      {handoffLesson && (
        <TourHandoffGuide
          viewport={viewport}
          path={path}
          result={result}
          time={time}
          saved={
            showReference && before && reference
              ? { path: reference.path, result: before }
              : undefined
          }
        />
      )}
      <div
        className={`tour-simulation-readout${handoffLesson ? " tour-simulation-readout--handoff" : ""}`}
        data-tour="lesson-simulation-readout"
      >
        {handoffLesson ? (
          <span>
            {time >= result.total_time_s
              ? "End reached"
              : `Steering to ${current?.target_anchor_ordinal_1b === 2 ? "Bend" : "End"}`}{" "}
            · {(current?.speed_mps ?? 0).toFixed(2)} m/s
          </span>
        ) : (
          <span>
            {(current?.speed_mps ?? 0).toFixed(2)} m/s ·{" "}
            {(((current?.theta_rad ?? 0) * 180) / Math.PI).toFixed(0)}°
          </span>
        )}
        {handoffLesson && (
          <span>
            {reference &&
              `${showReference ? "Dashed: saved" : "Saved"} ${reference.path.path_elements.find(isTranslationTarget)?.intermediate_handoff_radius_meters?.toFixed(2)} m · `}
            Current radius:{" "}
            {path.path_elements
              .find(isTranslationTarget)
              ?.intermediate_handoff_radius_meters?.toFixed(2)}{" "}
            m
          </span>
        )}
        {before && !handoffLesson && (
          <span>
            Before (dashed): {before.total_time_s.toFixed(2)} s · After{" "}
            {result.total_time_s.toFixed(2)} s
          </span>
        )}
        {events.length > 0 && (
          <strong className="tour-event-cue">{events.join(" · ")}</strong>
        )}
      </div>
    </>
  );
}

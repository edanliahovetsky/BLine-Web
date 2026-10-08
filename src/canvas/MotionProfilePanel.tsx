import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { SimulationTraceSample } from "../core/sim/types";
import { elementColors } from "./elementStyle";
import {
  motionProfilePolyline,
  motionProfileReadoutAt,
  type MotionProfile,
} from "./motionProfile";

const plotWidth = 1000;
const plotHeight = 100;

/**
 * Speed and rotation rate over the preview's time, synchronized with the
 * playhead. Pressing or dragging on the plot scrubs the simulation.
 */
export function MotionProfilePanel({
  profile,
  trace,
  currentTimeS,
  onSeek,
}: {
  profile: MotionProfile;
  trace: readonly SimulationTraceSample[];
  currentTimeS: number;
  onSeek(timeS: number): void;
}) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const scrubPointerRef = useRef<number | null>(null);
  const [hoverTimeS, setHoverTimeS] = useState<number | null>(null);
  const speedLine = useMemo(
    () => motionProfilePolyline(profile, "speed", plotWidth, plotHeight),
    [profile],
  );
  const omegaLine = useMemo(
    () => motionProfilePolyline(profile, "omega", plotWidth, plotHeight),
    [profile],
  );
  const readoutTime = hoverTimeS ?? currentTimeS;
  const readout = motionProfileReadoutAt(profile, trace, readoutTime);
  const xFor = (timeS: number) =>
    (Math.min(Math.max(timeS, 0), profile.total_time_s) /
      profile.total_time_s) *
    plotWidth;
  const limitY =
    profile.speed_limit_mps === null
      ? null
      : plotHeight -
        (profile.speed_limit_mps / profile.speed_scale_max_mps) * plotHeight;

  const timeFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = plotRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) {
      return 0;
    }
    const ratio = Math.min(
      Math.max((event.clientX - box.left) / box.width, 0),
      1,
    );
    return ratio * profile.total_time_s;
  };

  return (
    <div className="motion-profile" data-testid="motion-profile">
      <div className="motion-profile__legend">
        <span className="motion-profile__series motion-profile__series--speed">
          <i aria-hidden="true" />
          Speed
          <small>peak {profile.peak_speed_mps.toFixed(2)} m/s</small>
        </span>
        <span className="motion-profile__series motion-profile__series--omega">
          <i aria-hidden="true" />
          Rotation
          <small>peak {Math.round(profile.peak_omega_deg_per_s)}°/s</small>
        </span>
        {readout ? (
          <span
            className="motion-profile__readout"
            data-testid="motion-profile-readout"
          >
            <span>{readout.time_s.toFixed(2)} s</span>
            <span>{readout.speed_mps.toFixed(2)} m/s</span>
            <span>{Math.round(readout.omega_deg_per_s)}°/s</span>
            <span title="Acceleration magnitude, including turning">
              {readout.acceleration_mps2.toFixed(1)} m/s²
            </span>
            {readout.events.length > 0 ? (
              <strong>{readout.events.join(" · ")}</strong>
            ) : null}
          </span>
        ) : null}
      </div>
      <div
        ref={plotRef}
        className="motion-profile__plot"
        data-testid="motion-profile-plot"
        role="img"
        aria-label={`Motion profile: peak speed ${profile.peak_speed_mps.toFixed(2)} meters per second, peak rotation ${Math.round(profile.peak_omega_deg_per_s)} degrees per second over ${profile.total_time_s.toFixed(2)} seconds`}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          scrubPointerRef.current = event.pointerId;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          onSeek(timeFromPointer(event));
        }}
        onPointerMove={(event) => {
          const time = timeFromPointer(event);
          setHoverTimeS(time);
          if (scrubPointerRef.current === event.pointerId) {
            onSeek(time);
          }
        }}
        onPointerUp={(event) => {
          if (scrubPointerRef.current === event.pointerId) {
            scrubPointerRef.current = null;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          scrubPointerRef.current = null;
        }}
        onPointerLeave={() => {
          if (scrubPointerRef.current === null) {
            setHoverTimeS(null);
          }
        }}
      >
        <svg
          viewBox={`0 0 ${plotWidth} ${plotHeight}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              className="motion-profile__grid"
              x1={0}
              x2={plotWidth}
              y1={plotHeight * ratio}
              y2={plotHeight * ratio}
            />
          ))}
          {profile.handoff_times_s.map((time, index) => (
            <line
              key={`handoff-${index}`}
              className="motion-profile__handoff"
              x1={xFor(time)}
              x2={xFor(time)}
              y1={0}
              y2={plotHeight}
            />
          ))}
          {limitY !== null ? (
            <line
              className="motion-profile__limit"
              data-testid="motion-profile-limit"
              x1={0}
              x2={plotWidth}
              y1={limitY}
              y2={limitY}
            />
          ) : null}
          <polygon
            className="motion-profile__speed-area"
            points={`0,${plotHeight} ${speedLine} ${plotWidth},${plotHeight}`}
          />
          <polyline
            className="motion-profile__omega"
            points={omegaLine}
            stroke={elementColors.rotation}
          />
          <polyline className="motion-profile__speed" points={speedLine} />
          {profile.events.map((event, index) => (
            <line
              key={`event-${index}`}
              className="motion-profile__event"
              data-testid="motion-profile-event"
              stroke={elementColors.event}
              x1={xFor(event.time_s)}
              x2={xFor(event.time_s)}
              y1={0}
              y2={plotHeight}
            />
          ))}
          {hoverTimeS !== null ? (
            <line
              className="motion-profile__hover"
              x1={xFor(hoverTimeS)}
              x2={xFor(hoverTimeS)}
              y1={0}
              y2={plotHeight}
            />
          ) : null}
          <line
            className="motion-profile__playhead"
            data-testid="motion-profile-playhead"
            x1={xFor(currentTimeS)}
            x2={xFor(currentTimeS)}
            y1={0}
            y2={plotHeight}
          />
        </svg>
        {limitY !== null && profile.speed_limit_mps !== null ? (
          <span
            className="motion-profile__limit-label"
            style={{ top: `${(limitY / plotHeight) * 100}%` }}
            aria-hidden="true"
          >
            max {profile.speed_limit_mps.toFixed(1)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { simulatePathWithTrace } from "../../core/sim";
import type { PathModel } from "../../core/model/path";
import type { ProjectConfig } from "../../core/model/project";
import { simulationEventPulseAtTime } from "../../canvas/simulationEventPulse";
import {
  activePathForProjectStore,
  projectStore,
} from "../../state/projectStore";
import { useStoreSelector } from "../../state/react";
import {
  anchorPositions,
  cornerReplayWindow,
  demonstrationPaths,
  practiceConfig,
  sampleAtTime,
} from "./tourScenario";
import { tourStore, type TourExperiment } from "./tourStore";

/** Both lanes use the production simulator and share an elapsed-time clock. */
export function TourLab({
  kind,
  example,
  onClose,
}: {
  kind: TourExperiment;
  example: boolean;
  onClose(): void;
}) {
  const project = useStoreSelector(projectStore, (state) => state.project);
  const reference = useStoreSelector(tourStore, (state) => state.reference);
  const current = activePathForProjectStore(projectStore.getState())?.path;
  const lanes = useMemo(() => {
    if (example) {
      const demo = demonstrationPaths(kind);
      return [demo.before, demo.after].map((path, index) => ({
        path,
        config: practiceConfig(),
        label: demo.labels[index],
      }));
    }
    if (!current || !project) return [];
    return [
      ...(reference ? [{ ...reference, label: "Saved reference" }] : []),
      { path: current, config: project.config, label: "Your current path" },
    ];
  }, [current, example, kind, project, reference]);
  const runs = useMemo(
    () =>
      lanes.map((lane) => ({
        ...lane,
        result: simulatePathWithTrace(lane.path, lane.config, { dt_s: 0.02 }),
      })),
    [lanes],
  );
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(true);
  const [focused, setFocused] = useState(false);
  const windows = runs.map((run) =>
    focused
      ? cornerReplayWindow(run.result.trace, kind, run.path)
      : { start: 0, end: run.result.total_time_s },
  );
  const duration = Math.max(
    0,
    ...windows.map((range) => range.end - range.start),
  );
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous: number | null = null;
    let elapsed = time;
    const tick = (now: number) => {
      elapsed = Math.min(
        duration,
        elapsed +
          (previous === null
            ? 0
            : ((now - previous) / 1000) * (slow ? 0.5 : 1)),
      );
      previous = now;
      setTime(elapsed);
      if (elapsed >= duration) {
        setPlaying(false);
        if (!example) tourStore.getState().recordAction("replay");
      } else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // The clock owns time while playing. Seeking pauses first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, example, playing, slow, runs]);
  return (
    <section
      className="tour-lab"
      role="dialog"
      aria-label={example ? "Worked example" : "Compare your path"}
    >
      <header>
        <div>
          <small>{example ? "WORKED EXAMPLE" : "YOUR EXPERIMENT"}</small>
          <h3>
            {kind === "handoff"
              ? "When does the robot cut the corner?"
              : kind === "speed"
                ? "Watch the approach speed"
                : "Watch the heading change"}
          </h3>
        </div>
        <button onClick={onClose} aria-label="Close comparison">
          ×
        </button>
      </header>
      <p>
        {example
          ? "Replay two prepared paths. These controls leave your exercise as you made it."
          : "Save a reference, close this panel, edit your path, then return to compare the result."}
      </p>
      <div className="tour-lab__lanes">
        {runs.map((run, index) => (
          <div key={run.label}>
            <strong>{run.label}</strong>
            <RunView
              path={run.path}
              config={run.config}
              result={run.result}
              time={Math.min(windows[index].end, time + windows[index].start)}
            />
            <p>
              {run.result.total_time_s.toFixed(2)} s total ·{" "}
              {(
                sampleAtTime(run.result.trace, time + windows[index].start)
                  ?.speed_mps ?? 0
              ).toFixed(2)}{" "}
              m/s now
            </p>
          </div>
        ))}
      </div>
      <div className="tour-lab__controls">
        <button
          onClick={() => {
            if (time >= duration) setTime(0);
            setPlaying(!playing);
          }}
        >
          {playing ? "Pause" : "Replay comparison"}
        </button>
        <label>
          <input
            type="checkbox"
            checked={slow}
            onChange={(event) => {
              setPlaying(false);
              setSlow(event.target.checked);
            }}
          />{" "}
          Half speed
        </label>
        <label>
          <input
            type="checkbox"
            checked={focused}
            onChange={(event) => {
              setPlaying(false);
              setTime(0);
              setFocused(event.target.checked);
            }}
          />{" "}
          Focus on {kind === "heading" ? "segment" : "corner"}
        </label>
        <input
          aria-label="Comparison timeline"
          type="range"
          min={0}
          max={duration}
          step={0.02}
          value={time}
          onChange={(event) => {
            setPlaying(false);
            setTime(Number(event.target.value));
          }}
        />
        {!example && (
          <button
            onClick={() => {
              if (current && project) {
                setPlaying(false);
                setTime(0);
                tourStore
                  .getState()
                  .captureReference({ path: current, config: project.config });
              }
            }}
          >
            Save current as reference
          </button>
        )}
      </div>
      {focused && (
        <p>
          Each lane begins just before its own corner. Total times above still
          describe the whole path.
        </p>
      )}
    </section>
  );
}

function RunView({
  path,
  config,
  result,
  time,
}: {
  path: PathModel;
  config: ProjectConfig;
  result: ReturnType<typeof simulatePathWithTrace>;
  time: number;
}) {
  const robot = sampleAtTime(result.trace, time);
  const pulse = simulationEventPulseAtTime(path, result.trace, time);
  const planned = anchorPositions(path)
    .map((point) => `${point.x_meters},${9 - point.y_meters}`)
    .join(" ");
  const actual = result.trace
    .map((point) => `${point.x_m},${9 - point.y_m}`)
    .join(" ");
  return (
    <svg
      viewBox="3 0.6 14 8.1"
      role="img"
      aria-label="Simulated route and moving robot"
    >
      <rect x={3} y={0.6} width={14} height={8.1} fill="#101b24" />
      <rect
        x={9.7}
        y={4.8}
        width={2.2}
        height={2.4}
        fill="#714636"
        stroke="#d99a74"
        strokeWidth={0.035}
      />
      <text x={10.8} y={6.1} textAnchor="middle" fill="#ecc5ad" fontSize={0.32}>
        Structure
      </text>
      <polyline
        points={planned}
        fill="none"
        stroke="#71869a"
        strokeWidth={0.04}
        strokeDasharray=".15 .12"
      />
      <polyline
        points={actual}
        fill="none"
        stroke="#69d6b0"
        strokeWidth={0.055}
      />
      {anchorPositions(path).map((point) => (
        <circle
          key={point.index}
          cx={point.x_meters}
          cy={9 - point.y_meters}
          r={0.12}
          fill="#c2d2dd"
        />
      ))}
      {robot && (
        <g
          transform={`translate(${robot.x_m} ${9 - robot.y_m}) rotate(${(-robot.theta_rad * 180) / Math.PI})`}
        >
          <rect
            x={-config.gui.robot.length_meters / 2}
            y={-config.gui.robot.width_meters / 2}
            width={config.gui.robot.length_meters}
            height={config.gui.robot.width_meters}
            rx={0.08}
            fill={pulse > 0.1 ? "#d185ff" : "#69d6b0"}
            opacity={0.9}
          />
          <path
            d="M 0,-.18 L .3,0 L 0,.18"
            fill="none"
            stroke="#13242d"
            strokeWidth={0.08}
          />
        </g>
      )}
      {pulse > 0.1 && robot && (
        <text
          x={robot.x_m}
          y={8.2 - robot.y_m}
          textAnchor="middle"
          fontSize={0.35}
          fill="#e7baff"
        >
          Event triggered
        </text>
      )}
    </svg>
  );
}

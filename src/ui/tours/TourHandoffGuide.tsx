import type { PathModel } from "../../core/model/path";
import { isTranslationTarget } from "../../core/model/path";
import type { SimTraceResult } from "../../core/sim";
import type { FieldViewport } from "../../canvas/geometry";
import { anchorPositions, sampleAtTime } from "./tourScenario";
import { firstHandoff } from "./handoffTrace";

/** The same target transition used by the preview, drawn on the main field. */
export function TourHandoffGuide({
  viewport,
  path,
  result,
  time,
  saved,
}: {
  viewport: FieldViewport;
  path: PathModel;
  result: SimTraceResult;
  time: number;
  saved?: { path: PathModel; result: SimTraceResult };
}) {
  const current = sampleAtTime(result.trace, time);
  const anchors = anchorPositions(path);
  const active = current ? anchors[current.target_anchor_ordinal_1b - 1] : null;
  return (
    <svg
      className="tour-handoff-guide"
      data-testid="tour-handoff-guide"
      role="img"
      aria-label="Handoff circles, target changes, and current steering target"
      viewBox="0 0 18 9"
      style={{
        left: viewport.x,
        top: viewport.y,
        width: viewport.width,
        height: viewport.height,
      }}
    >
      {saved && <HandoffCircle path={saved.path} result={saved.result} saved />}
      <HandoffCircle path={path} result={result} />
      {current && active && time < result.total_time_s && (
        <g
          data-testid="tour-active-target"
          data-target={current.target_anchor_ordinal_1b === 2 ? "Bend" : "End"}
        >
          <line
            x1={current.x_m}
            y1={9 - current.y_m}
            x2={active.x_meters}
            y2={9 - active.y_meters}
            stroke="#76e0cb"
            strokeWidth={0.035}
            opacity={0.8}
          />
          <circle
            cx={active.x_meters}
            cy={9 - active.y_meters}
            r={0.2}
            fill="none"
            stroke="#76e0cb"
            strokeWidth={0.045}
          />
        </g>
      )}
      <text
        x={anchors[1]?.x_meters}
        y={9 - (anchors[1]?.y_meters ?? 0) - 0.3}
        className="tour-handoff-guide__label"
        fill="#dce8ec"
        textAnchor="middle"
      >
        Bend
      </text>
    </svg>
  );
}

function HandoffCircle({
  path,
  result,
  saved = false,
}: {
  path: PathModel;
  result: SimTraceResult;
  saved?: boolean;
}) {
  const target = path.path_elements.find(isTranslationTarget);
  const radius = target?.intermediate_handoff_radius_meters;
  const handoff = firstHandoff(result.trace);
  if (!target || radius == null) return null;
  const color = saved ? "#c5ccdc" : "#76e0cb";
  return (
    <g
      data-testid={saved ? "tour-saved-handoff" : "tour-current-handoff"}
      data-radius={radius}
    >
      <circle
        cx={target.x_meters}
        cy={9 - target.y_meters}
        r={radius}
        fill={saved ? "none" : color}
        fillOpacity={0.055}
        stroke={color}
        strokeWidth={0.035}
        strokeDasharray={saved ? ".13 .1" : undefined}
      />
      {handoff && (
        <g>
          <circle
            cx={handoff.x}
            cy={9 - handoff.y}
            r={0.09}
            fill={color}
            stroke="#101b24"
            strokeWidth={0.035}
          />
          <text
            x={handoff.x - 0.15}
            y={9 - handoff.y + (saved ? -0.25 : 0.38)}
            fill={color}
            className="tour-handoff-guide__label"
            textAnchor="end"
          >
            {radius.toFixed(2)} m handoff
          </text>
        </g>
      )}
    </g>
  );
}

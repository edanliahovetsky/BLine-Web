import type { ProjectConfig } from "../../core/io/projectSchema";
import {
  centeredRobotBounds,
  robotBoundsWithProtrusion,
  robotProtrusionOutlineGeometry,
} from "../../canvas/robotFootprint";
import { elementColors } from "../../canvas/elementStyle";

const previewWidthPx = 260;
const previewHeightPx = 150;
const paddingPx = 26;

/**
 * The robot as the canvas will draw it with the Settings being edited:
 * bumpers, front edge and any protrusion, facing right.
 */
export function RobotFootprintPreview({ draft }: { draft: ProjectConfig }) {
  const { length_meters: length, width_meters: width } = draft.gui.robot;
  const protrusions = draft.gui.protrusions;
  const protrusionVisible =
    protrusions.enabled &&
    protrusions.side !== "none" &&
    protrusions.distance_meters > 0;
  const extent = robotBoundsWithProtrusion({
    lengthPx: length,
    widthPx: width,
    protrusionVisible,
    protrusionDistancePx: protrusions.distance_meters,
    protrusionSide: protrusions.side,
  });
  // One scale for every size so growing the robot visibly grows the preview,
  // capped so the largest legal robot still fits.
  const scale = Math.min(
    (previewWidthPx - paddingPx * 2) / Math.max(extent.width, 1.6),
    (previewHeightPx - paddingPx * 2) / Math.max(extent.height, 1.1),
  );
  const lengthPx = length * scale;
  const widthPx = width * scale;
  const body = centeredRobotBounds(lengthPx, widthPx);
  const protrusion = robotProtrusionOutlineGeometry({
    lengthPx,
    widthPx,
    protrusionVisible,
    protrusionDistancePx: protrusions.distance_meters * scale,
    protrusionSide: protrusions.side,
    strokeWidth: 2,
  });
  const centerX = -(extent.x + extent.width / 2) * scale;
  const centerY = -(extent.y + extent.height / 2) * scale;
  const hidden = protrusions.default_state === "hidden";

  return (
    <figure className="robot-footprint-preview" data-testid="robot-preview">
      <svg
        viewBox={`${-previewWidthPx / 2} ${-previewHeightPx / 2} ${previewWidthPx} ${previewHeightPx}`}
        role="img"
        aria-label={robotPreviewDescription(draft)}
      >
        <g transform={`translate(${centerX} ${centerY})`}>
          {protrusion ? (
            <path
              className={`robot-footprint-preview__protrusion${hidden ? " is-hidden" : ""}`}
              data-testid="robot-preview-protrusion"
              d={protrusion.pathData}
            />
          ) : null}
          <rect
            className="robot-footprint-preview__body"
            data-testid="robot-preview-body"
            stroke={elementColors.waypoint}
            x={body.x}
            y={body.y}
            width={body.width}
            height={body.height}
            rx={Math.min(body.width, body.height) * 0.08}
          />
          <line
            className="robot-footprint-preview__front"
            stroke={elementColors.waypoint}
            x1={body.x + body.width}
            y1={body.y + 2}
            x2={body.x + body.width}
            y2={body.y + body.height - 2}
          />
          <path
            className="robot-footprint-preview__heading"
            d={`M ${-body.width * 0.18} 0 L ${body.width * 0.22} 0 M ${body.width * 0.1} ${-body.height * 0.1} L ${body.width * 0.22} 0 L ${body.width * 0.1} ${body.height * 0.1}`}
          />
        </g>
      </svg>
      <figcaption>
        <span>
          {formatMeters(length)} × {formatMeters(width)} m
        </span>
        {protrusionVisible ? (
          <span>
            {formatMeters(protrusions.distance_meters)} m {protrusions.side}{" "}
            protrusion{hidden ? ", starts hidden" : ""}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

function robotPreviewDescription(draft: ProjectConfig): string {
  const { length_meters, width_meters } = draft.gui.robot;
  const protrusions = draft.gui.protrusions;
  const base = `Robot preview, ${formatMeters(length_meters)} by ${formatMeters(width_meters)} meters, front facing right`;
  return protrusions.enabled &&
    protrusions.side !== "none" &&
    protrusions.distance_meters > 0
    ? `${base}, with a ${formatMeters(protrusions.distance_meters)} meter ${protrusions.side} protrusion`
    : base;
}

function formatMeters(value: number): string {
  return Number(value.toFixed(2)).toString();
}

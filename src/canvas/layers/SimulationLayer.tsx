import { Circle, Group, Layer, Line, Rect } from "react-konva";
import type { ProjectConfig } from "../../core/io/projectSchema";
import type { SimResult } from "../../core/sim";
import { modelToStagePoint, type FieldViewport } from "../geometry";

interface SimulationLayerProps {
  result: SimResult | null;
  currentTimeS: number;
  viewport: FieldViewport;
  config: ProjectConfig | null;
}

export function SimulationLayer({
  result,
  currentTimeS,
  viewport,
  config
}: SimulationLayerProps) {
  if (!result || result.times_sorted.length === 0) {
    return <Layer />;
  }

  const visibleTimes = result.times_sorted.filter((time) => time <= currentTimeS);
  const trailPoints = visibleTimes.flatMap((time) => {
    const pose = result.poses_by_time.get(time);
    if (!pose) {
      return [];
    }
    const point = modelToStagePoint(
      { x_meters: pose[0], y_meters: pose[1] },
      viewport
    );
    return [point.x, point.y];
  });
  const pose = poseAtOrBefore(result, currentTimeS);
  const robotPoint = pose
    ? modelToStagePoint({ x_meters: pose[0], y_meters: pose[1] }, viewport)
    : null;
  const robotLength = Math.max(
    28,
    (config?.gui.robot.length_meters ?? 0.5) * viewport.scale
  );
  const robotWidth = Math.max(
    28,
    (config?.gui.robot.width_meters ?? 0.5) * viewport.scale
  );
  const protrusions = config?.gui.protrusions;
  const protrusionVisible =
    Boolean(protrusions?.enabled) &&
    protrusions?.default_state === "shown" &&
    (protrusions?.distance_meters ?? 0) > 0 &&
    protrusions?.side !== "none";

  return (
    <Layer listening={false}>
      {trailPoints.length >= 4 ? (
        <Line
          points={trailPoints}
          stroke="#ff8a2b"
          strokeWidth={3}
          lineCap="round"
          lineJoin="round"
          opacity={0.88}
        />
      ) : null}
      {robotPoint && pose ? (
        <Group
          x={robotPoint.x}
          y={robotPoint.y}
          rotation={-pose[2] * (180 / Math.PI)}
          opacity={0.92}
        >
          <Rect
            x={-robotLength / 2}
            y={-robotWidth / 2}
            width={robotLength}
            height={robotWidth}
            stroke="#ff8a2b"
            strokeWidth={3}
            fill="rgba(255, 138, 43, 0.14)"
          />
          <Line
            points={[
              robotLength * 0.25,
              0,
              -robotLength * 0.2,
              robotWidth * 0.28,
              -robotLength * 0.2,
              -robotWidth * 0.28
            ]}
            closed={true}
            fill="#ff8a2b"
            opacity={0.9}
          />
          {protrusionVisible ? (
            <Protrusion
              side={protrusions?.side ?? "none"}
              distancePx={(protrusions?.distance_meters ?? 0) * viewport.scale}
              robotLength={robotLength}
              robotWidth={robotWidth}
            />
          ) : null}
          <Circle radius={5} fill="#ffffff" opacity={0.92} />
        </Group>
      ) : null}
    </Layer>
  );
}

function Protrusion({
  side,
  distancePx,
  robotLength,
  robotWidth
}: {
  side: string;
  distancePx: number;
  robotLength: number;
  robotWidth: number;
}) {
  if (distancePx <= 0) {
    return null;
  }

  if (side === "front" || side === "back") {
    const direction = side === "front" ? 1 : -1;
    const x = direction * robotLength / 2;
    return (
      <Rect
        x={direction > 0 ? x : x - distancePx}
        y={-robotWidth / 2}
        width={distancePx}
        height={robotWidth}
        stroke="#ffd54d"
        strokeWidth={2}
        dash={[5, 4]}
      />
    );
  }

  if (side === "left" || side === "right") {
    const direction = side === "left" ? -1 : 1;
    const y = direction * robotWidth / 2;
    return (
      <Rect
        x={-robotLength / 2}
        y={direction > 0 ? y : y - distancePx}
        width={robotLength}
        height={distancePx}
        stroke="#ffd54d"
        strokeWidth={2}
        dash={[5, 4]}
      />
    );
  }

  return null;
}

function poseAtOrBefore(result: SimResult, timeS: number) {
  let selected = result.times_sorted[0];
  for (const time of result.times_sorted) {
    if (time > timeS) {
      break;
    }
    selected = time;
  }
  return result.poses_by_time.get(selected) ?? null;
}

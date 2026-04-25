import { Circle, Group, Layer, Line, Rect } from "react-konva";
import type { ProjectConfig } from "../../core/io/projectSchema";
import type { SimResult } from "../../core/sim";
import { modelToStagePoint, type FieldViewport } from "../geometry";

interface SimulationLayerProps {
  result: SimResult | null;
  currentTimeS: number;
  playing: boolean;
  viewport: FieldViewport;
  config: ProjectConfig | null;
}

export function SimulationLayer({
  result,
  currentTimeS,
  playing,
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
  const robotVisible = playing || currentTimeS > 1e-6;
  const robotPoint = pose
    ? modelToStagePoint({ x_meters: pose[0], y_meters: pose[1] }, viewport)
    : null;
  const robotLength = (config?.gui.robot.length_meters ?? 0.5) * viewport.scale;
  const robotWidth = (config?.gui.robot.width_meters ?? 0.5) * viewport.scale;
  const protrusions = config?.gui.protrusions;
  const protrusionVisible =
    Boolean(protrusions?.enabled) &&
    protrusions?.default_state === "shown" &&
    (protrusions?.distance_meters ?? 0) > 0 &&
    protrusions?.side !== "none";
  const robotBounds = getRobotBounds({
    robotLength,
    robotWidth,
    protrusionVisible,
    protrusionDistancePx: (protrusions?.distance_meters ?? 0) * viewport.scale,
    protrusionSide: protrusions?.side ?? "none"
  });
  const triangleSize = Math.min(robotBounds.width, robotBounds.height) * 0.3;
  const triangleOffset = robotBounds.width * 0.3;

  return (
    <Layer listening={false}>
      {trailPoints.length >= 4 ? (
        <Line
          points={trailPoints}
          stroke="#ffa500"
          strokeWidth={3}
          lineCap="round"
          lineJoin="round"
          opacity={0.88}
        />
      ) : null}
      {robotVisible && robotPoint && pose ? (
        <Group
          x={robotPoint.x}
          y={robotPoint.y}
          rotation={-pose[2] * (180 / Math.PI)}
          opacity={0.92}
        >
          <Rect
            x={robotBounds.x}
            y={robotBounds.y}
            width={robotBounds.width}
            height={robotBounds.height}
            stroke="#050505"
            strokeWidth={Math.max(1.5, viewport.scale * 0.03)}
            fill="rgba(255, 165, 0, 0.47)"
          />
          <Line
            points={[
              triangleOffset + triangleSize,
              0,
              triangleOffset - triangleSize / 2,
              triangleSize / 2,
              triangleOffset - triangleSize / 2,
              -triangleSize / 2
            ]}
            closed={true}
            fill="#ffffff"
            stroke="#050505"
            strokeWidth={Math.max(1, viewport.scale * 0.02)}
          />
          <Circle radius={Math.max(2.5, viewport.scale * 0.035)} fill="#ffffff" opacity={0.86} />
        </Group>
      ) : null}
    </Layer>
  );
}

function getRobotBounds({
  robotLength,
  robotWidth,
  protrusionVisible,
  protrusionDistancePx,
  protrusionSide
}: {
  robotLength: number;
  robotWidth: number;
  protrusionVisible: boolean;
  protrusionDistancePx: number;
  protrusionSide: string;
}) {
  let xMin = -robotLength / 2;
  let xMax = robotLength / 2;
  let yMin = -robotWidth / 2;
  let yMax = robotWidth / 2;

  if (protrusionVisible && protrusionDistancePx > 0) {
    if (protrusionSide === "front") {
      xMax += protrusionDistancePx;
    } else if (protrusionSide === "back") {
      xMin -= protrusionDistancePx;
    } else if (protrusionSide === "left") {
      yMin -= protrusionDistancePx;
    } else if (protrusionSide === "right") {
      yMax += protrusionDistancePx;
    }
  }

  return {
    x: xMin,
    y: yMin,
    width: xMax - xMin,
    height: yMax - yMin
  };
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

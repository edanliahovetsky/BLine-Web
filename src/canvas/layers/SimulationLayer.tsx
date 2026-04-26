import { memo } from "react";
import { Circle, Group, Layer, Line, Rect } from "react-konva";
import type { ProjectConfig } from "../../core/io/projectSchema";
import type { SimResult } from "../../core/sim";
import { modelToStagePoint, type FieldViewport } from "../geometry";
import { elementColors } from "../elementStyle";

interface SimulationLayerProps {
  result: SimResult | null;
  currentTimeS: number;
  playing: boolean;
  viewport: FieldViewport;
  config: ProjectConfig | null;
}

export const SimulationLayer = memo(function SimulationLayer({
  result,
  currentTimeS,
  playing,
  viewport,
  config
}: SimulationLayerProps) {
  return (
    <Layer listening={false}>
      <SimulationLayerContent
        result={result}
        currentTimeS={currentTimeS}
        playing={playing}
        viewport={viewport}
        config={config}
      />
    </Layer>
  );
});

export const SimulationLayerContent = memo(function SimulationLayerContent({
  result,
  currentTimeS,
  playing,
  viewport,
  config
}: SimulationLayerProps) {
  if (!result || result.times_sorted.length === 0) {
    return null;
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
  const triangleSize = Math.min(robotBounds.width, robotBounds.height) * 0.28;
  const triangleOffset = robotBounds.width * 0.26;
  const cornerRadius = Math.max(4, Math.min(robotBounds.width, robotBounds.height) * 0.08);
  const robotHalo = robotHaloMetrics(robotBounds.width, robotBounds.height);

  return (
    <Group listening={false}>
      {trailPoints.length >= 4 ? (
        <>
          <Line
            points={trailPoints}
            stroke={elementColors.shadow}
            strokeWidth={7}
            lineCap="round"
            lineJoin="round"
            opacity={0.7}
          />
          <Line
            points={trailPoints}
            stroke={elementColors.simulationTrail}
            strokeWidth={2.6}
            lineCap="round"
            lineJoin="round"
            opacity={0.92}
          />
        </>
      ) : null}
      {robotVisible && robotPoint && pose ? (
        <Group
          x={robotPoint.x}
          y={robotPoint.y}
          rotation={-pose[2] * (180 / Math.PI)}
          opacity={0.95}
        >
          <Rect
            x={robotBounds.x - robotHalo.padding}
            y={robotBounds.y - robotHalo.padding}
            width={robotBounds.width + robotHalo.padding * 2}
            height={robotBounds.height + robotHalo.padding * 2}
            cornerRadius={cornerRadius + robotHalo.padding * 0.7}
            stroke={elementColors.shadow}
            strokeWidth={robotHalo.strokeWidth}
            fill="rgba(5, 8, 11, 0.3)"
            lineJoin="round"
          />
          <Rect
            x={robotBounds.x}
            y={robotBounds.y}
            width={robotBounds.width}
            height={robotBounds.height}
            cornerRadius={cornerRadius}
            stroke={elementColors.simulation}
            strokeWidth={2.4}
            fill="rgba(98, 199, 255, 0.13)"
            lineJoin="round"
            shadowColor={elementColors.simulation}
            shadowBlur={6}
            shadowOpacity={0.34}
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
            fill="rgba(98, 199, 255, 0.38)"
            stroke={elementColors.simulation}
            strokeWidth={1.9}
            lineJoin="round"
          />
          <Circle
            radius={Math.max(2.5, Math.min(robotBounds.width, robotBounds.height) * 0.08)}
            fill="rgba(5, 8, 11, 0.36)"
            stroke={elementColors.simulation}
            strokeWidth={1.5}
            opacity={0.94}
          />
        </Group>
      ) : null}
    </Group>
  );
});

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

function robotHaloMetrics(width: number, height: number) {
  const footprintSize = Math.min(width, height);

  return {
    padding: clamp(footprintSize * 0.08, 1.4, 3),
    strokeWidth: clamp(footprintSize * 0.12, 2.2, 5)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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

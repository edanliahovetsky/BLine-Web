import { memo } from "react";
import { Circle, Group, Layer, Line, Rect } from "react-konva";
import type { ProjectConfig } from "../../core/io/projectSchema";
import type { SimResult } from "../../core/sim";
import { modelToStagePoint, type FieldViewport } from "../geometry";
import { elementColors } from "../elementStyle";
import {
  robotBoundsWithProtrusion,
  robotSizeFromConfig,
  robotSizeToPixels,
  strokedRectInsideBounds
} from "../robotFootprint";

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
  const robotSize = robotSizeFromConfig(config);
  const { lengthPx, widthPx } = robotSizeToPixels(robotSize, viewport.scale);
  const protrusions = config?.gui.protrusions;
  const protrusionVisible =
    Boolean(protrusions?.enabled) &&
    protrusions?.default_state === "shown" &&
    (protrusions?.distance_meters ?? 0) > 0 &&
    protrusions?.side !== "none";
  const robotBounds = robotBoundsWithProtrusion({
    lengthPx,
    widthPx,
    protrusionVisible,
    protrusionDistancePx: (protrusions?.distance_meters ?? 0) * viewport.scale,
    protrusionSide: protrusions?.side ?? "none"
  });
  const triangleSize = Math.min(robotBounds.width, robotBounds.height) * 0.28;
  const triangleOffset = robotBounds.width * 0.26;
  const cornerRadius = Math.max(4, Math.min(robotBounds.width, robotBounds.height) * 0.08);
  const robotHalo = robotHaloMetrics(robotBounds.width, robotBounds.height);
  const haloOutline = strokedRectInsideBounds(robotBounds, robotHalo.strokeWidth);
  const robotOutline = strokedRectInsideBounds(robotBounds, simulationRobotStrokeWidthPx);

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
            x={haloOutline.rect.x}
            y={haloOutline.rect.y}
            width={haloOutline.rect.width}
            height={haloOutline.rect.height}
            cornerRadius={Math.max(0, cornerRadius - haloOutline.strokeWidth / 2)}
            stroke={elementColors.shadow}
            strokeWidth={haloOutline.strokeWidth}
            fill="rgba(5, 8, 11, 0.3)"
            lineJoin="round"
          />
          <Rect
            x={robotOutline.rect.x}
            y={robotOutline.rect.y}
            width={robotOutline.rect.width}
            height={robotOutline.rect.height}
            cornerRadius={Math.max(0, cornerRadius - robotOutline.strokeWidth / 2)}
            stroke={elementColors.simulation}
            strokeWidth={robotOutline.strokeWidth}
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

function robotHaloMetrics(width: number, height: number) {
  const footprintSize = Math.min(width, height);

  return {
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

const simulationRobotStrokeWidthPx = 2.4;

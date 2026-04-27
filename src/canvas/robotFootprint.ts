import { createProjectConfig, type ProtrusionSide } from "../core/config/projectConfig";
import type { ProjectConfig } from "../core/io/projectSchema";

export interface RobotSizeMeters {
  lengthMeters: number;
  widthMeters: number;
}

export interface RobotLocalBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const defaultRobotConfig = createProjectConfig().gui.robot;

export const defaultRobotSizeMeters: RobotSizeMeters = {
  lengthMeters: defaultRobotConfig.length_meters,
  widthMeters: defaultRobotConfig.width_meters
};

export function robotSizeFromConfig(
  config: ProjectConfig | null | undefined
): RobotSizeMeters {
  return {
    lengthMeters: Math.max(
      0,
      config?.gui.robot.length_meters ?? defaultRobotSizeMeters.lengthMeters
    ),
    widthMeters: Math.max(
      0,
      config?.gui.robot.width_meters ?? defaultRobotSizeMeters.widthMeters
    )
  };
}

export function robotSizeToPixels(
  size: RobotSizeMeters,
  metersToPixels: number
): { lengthPx: number; widthPx: number } {
  return {
    lengthPx: size.lengthMeters * metersToPixels,
    widthPx: size.widthMeters * metersToPixels
  };
}

export function centeredRobotBounds(
  lengthPx: number,
  widthPx: number
): RobotLocalBounds {
  return {
    x: -lengthPx / 2,
    y: -widthPx / 2,
    width: lengthPx,
    height: widthPx
  };
}

export function robotBoundsWithProtrusion({
  lengthPx,
  widthPx,
  protrusionVisible,
  protrusionDistancePx,
  protrusionSide
}: {
  lengthPx: number;
  widthPx: number;
  protrusionVisible: boolean;
  protrusionDistancePx: number;
  protrusionSide: ProtrusionSide;
}): RobotLocalBounds {
  let xMin = -lengthPx / 2;
  let xMax = lengthPx / 2;
  let yMin = -widthPx / 2;
  let yMax = widthPx / 2;

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

export function strokedRectInsideBounds(
  bounds: RobotLocalBounds,
  requestedStrokeWidth: number
): { rect: RobotLocalBounds; strokeWidth: number } {
  const strokeWidth = clamp(requestedStrokeWidth, 0, Math.min(bounds.width, bounds.height));
  const inset = strokeWidth / 2;

  return {
    rect: {
      x: bounds.x + inset,
      y: bounds.y + inset,
      width: Math.max(0, bounds.width - strokeWidth),
      height: Math.max(0, bounds.height - strokeWidth)
    },
    strokeWidth
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

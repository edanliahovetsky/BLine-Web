import {
  createProjectConfig,
  type ProtrusionSide,
} from "../core/config/projectConfig";
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

export interface RobotProtrusionOutlineGeometry {
  bounds: RobotLocalBounds;
  strokeWidth: number;
  pathData: string;
  pathCommands: RobotProtrusionPathCommand[];
  pathPoints: number[];
}

export type RobotProtrusionPathCommand =
  | ["M", number, number]
  | ["L", number, number]
  | ["Q", number, number, number, number];

const defaultRobotConfig = createProjectConfig().gui.robot;

export const defaultRobotSizeMeters: RobotSizeMeters = {
  lengthMeters: defaultRobotConfig.length_meters,
  widthMeters: defaultRobotConfig.width_meters,
};

export function robotSizeFromConfig(
  config: ProjectConfig | null | undefined,
): RobotSizeMeters {
  return {
    lengthMeters: Math.max(
      0,
      config?.gui.robot.length_meters ?? defaultRobotSizeMeters.lengthMeters,
    ),
    widthMeters: Math.max(
      0,
      config?.gui.robot.width_meters ?? defaultRobotSizeMeters.widthMeters,
    ),
  };
}

export function robotSizeToPixels(
  size: RobotSizeMeters,
  metersToPixels: number,
): { lengthPx: number; widthPx: number } {
  return {
    lengthPx: size.lengthMeters * metersToPixels,
    widthPx: size.widthMeters * metersToPixels,
  };
}

export function centeredRobotBounds(
  lengthPx: number,
  widthPx: number,
): RobotLocalBounds {
  return {
    x: -lengthPx / 2,
    y: -widthPx / 2,
    width: lengthPx,
    height: widthPx,
  };
}

export function robotBoundsWithProtrusion({
  lengthPx,
  widthPx,
  protrusionVisible,
  protrusionDistancePx,
  protrusionSide,
}: {
  lengthPx: number;
  widthPx: number;
  protrusionVisible: boolean;
  protrusionDistancePx: number;
  protrusionSide: ProtrusionSide;
}): RobotLocalBounds {
  const baseBounds = centeredRobotBounds(lengthPx, widthPx);
  const protrusionBounds = robotProtrusionBounds({
    lengthPx,
    widthPx,
    protrusionVisible,
    protrusionDistancePx,
    protrusionSide,
  });

  if (!protrusionBounds) {
    return baseBounds;
  }

  const xMin = Math.min(baseBounds.x, protrusionBounds.x);
  const yMin = Math.min(baseBounds.y, protrusionBounds.y);
  const xMax = Math.max(
    baseBounds.x + baseBounds.width,
    protrusionBounds.x + protrusionBounds.width,
  );
  const yMax = Math.max(
    baseBounds.y + baseBounds.height,
    protrusionBounds.y + protrusionBounds.height,
  );

  return {
    x: xMin,
    y: yMin,
    width: xMax - xMin,
    height: yMax - yMin,
  };
}

export function robotProtrusionBounds({
  lengthPx,
  widthPx,
  protrusionVisible,
  protrusionDistancePx,
  protrusionSide,
}: {
  lengthPx: number;
  widthPx: number;
  protrusionVisible: boolean;
  protrusionDistancePx: number;
  protrusionSide: ProtrusionSide;
}): RobotLocalBounds | null {
  if (!protrusionVisible || protrusionDistancePx <= 0) {
    return null;
  }

  if (protrusionSide === "front") {
    return {
      x: lengthPx / 2,
      y: -widthPx / 2,
      width: protrusionDistancePx,
      height: widthPx,
    };
  }
  if (protrusionSide === "back") {
    return {
      x: -lengthPx / 2 - protrusionDistancePx,
      y: -widthPx / 2,
      width: protrusionDistancePx,
      height: widthPx,
    };
  }
  if (protrusionSide === "left") {
    return {
      x: -lengthPx / 2,
      y: -widthPx / 2 - protrusionDistancePx,
      width: lengthPx,
      height: protrusionDistancePx,
    };
  }
  if (protrusionSide === "right") {
    return {
      x: -lengthPx / 2,
      y: widthPx / 2,
      width: lengthPx,
      height: protrusionDistancePx,
    };
  }

  return null;
}

export function robotProtrusionOutlineGeometry({
  lengthPx,
  widthPx,
  protrusionVisible,
  protrusionDistancePx,
  protrusionSide,
  strokeWidth,
  cornerRadiusPx,
  rootInsetPx,
}: {
  lengthPx: number;
  widthPx: number;
  protrusionVisible: boolean;
  protrusionDistancePx: number;
  protrusionSide: ProtrusionSide;
  strokeWidth: number;
  cornerRadiusPx?: number;
  rootInsetPx?: number;
}): RobotProtrusionOutlineGeometry | null {
  const bounds = robotProtrusionBounds({
    lengthPx,
    widthPx,
    protrusionVisible,
    protrusionDistancePx,
    protrusionSide,
  });

  if (!bounds) {
    return null;
  }

  const xMin = bounds.x;
  const yMin = bounds.y;
  const xMax = bounds.x + bounds.width;
  const yMax = bounds.y + bounds.height;
  const normalizedStrokeWidth = clamp(
    strokeWidth,
    0,
    Math.min(bounds.width, bounds.height),
  );
  const xInset = Math.min(normalizedStrokeWidth / 2, bounds.width / 2);
  const yInset = Math.min(normalizedStrokeWidth / 2, bounds.height / 2);
  const leftStrokeX = xMin + xInset;
  const rightStrokeX = xMax - xInset;
  const topStrokeY = yMin + yInset;
  const bottomStrokeY = yMax - yInset;
  const robotFrontX = lengthPx / 2;
  const robotBackX = -lengthPx / 2;
  const robotLeftY = -widthPx / 2;
  const robotRightY = widthPx / 2;
  const rootInset = clamp(rootInsetPx ?? 0, 0, Math.min(lengthPx, widthPx) / 2);
  const rootFrontX = robotFrontX - rootInset;
  const rootBackX = robotBackX + rootInset;
  const rootLeftY = robotLeftY + rootInset;
  const rootRightY = robotRightY - rootInset;
  const filletRadius = Math.min(
    Math.max(0, cornerRadiusPx ?? Math.min(lengthPx, widthPx) * 0.08),
    bounds.width / 2,
    bounds.height / 2,
  );
  const rootFilletRadius = Math.min(
    filletRadius,
    rootInset,
    bounds.width,
    bounds.height / 2,
  );
  const pathPoints = protrusionOutlinePathPoints({
    protrusionSide,
    leftStrokeX,
    rightStrokeX,
    topStrokeY,
    bottomStrokeY,
    robotFrontX,
    robotBackX,
    robotLeftY,
    robotRightY,
  });
  const pathCommands = protrusionOutlinePathCommands({
    protrusionSide,
    leftStrokeX,
    rightStrokeX,
    topStrokeY,
    bottomStrokeY,
    rootFrontX,
    rootBackX,
    rootLeftY,
    rootRightY,
    filletRadius,
    rootFilletRadius,
  });

  return {
    bounds,
    strokeWidth: normalizedStrokeWidth,
    pathData: pathData(pathCommands),
    pathCommands,
    pathPoints,
  };
}

export function strokedRectInsideBounds(
  bounds: RobotLocalBounds,
  requestedStrokeWidth: number,
): { rect: RobotLocalBounds; strokeWidth: number } {
  const strokeWidth = clamp(
    requestedStrokeWidth,
    0,
    Math.min(bounds.width, bounds.height),
  );
  const inset = strokeWidth / 2;

  return {
    rect: {
      x: bounds.x + inset,
      y: bounds.y + inset,
      width: Math.max(0, bounds.width - strokeWidth),
      height: Math.max(0, bounds.height - strokeWidth),
    },
    strokeWidth,
  };
}

function protrusionOutlinePathPoints({
  protrusionSide,
  leftStrokeX,
  rightStrokeX,
  topStrokeY,
  bottomStrokeY,
  robotFrontX,
  robotBackX,
  robotLeftY,
  robotRightY,
}: {
  protrusionSide: ProtrusionSide;
  leftStrokeX: number;
  rightStrokeX: number;
  topStrokeY: number;
  bottomStrokeY: number;
  robotFrontX: number;
  robotBackX: number;
  robotLeftY: number;
  robotRightY: number;
}): number[] {
  if (protrusionSide === "front") {
    return [
      robotFrontX,
      topStrokeY,
      rightStrokeX,
      topStrokeY,
      rightStrokeX,
      bottomStrokeY,
      robotFrontX,
      bottomStrokeY,
    ];
  }
  if (protrusionSide === "back") {
    return [
      robotBackX,
      topStrokeY,
      leftStrokeX,
      topStrokeY,
      leftStrokeX,
      bottomStrokeY,
      robotBackX,
      bottomStrokeY,
    ];
  }
  if (protrusionSide === "left") {
    return [
      leftStrokeX,
      robotLeftY,
      leftStrokeX,
      topStrokeY,
      rightStrokeX,
      topStrokeY,
      rightStrokeX,
      robotLeftY,
    ];
  }
  if (protrusionSide === "right") {
    return [
      leftStrokeX,
      robotRightY,
      leftStrokeX,
      bottomStrokeY,
      rightStrokeX,
      bottomStrokeY,
      rightStrokeX,
      robotRightY,
    ];
  }

  return [];
}

function protrusionOutlinePathCommands({
  protrusionSide,
  leftStrokeX,
  rightStrokeX,
  topStrokeY,
  bottomStrokeY,
  rootFrontX,
  rootBackX,
  rootLeftY,
  rootRightY,
  filletRadius,
  rootFilletRadius,
}: {
  protrusionSide: ProtrusionSide;
  leftStrokeX: number;
  rightStrokeX: number;
  topStrokeY: number;
  bottomStrokeY: number;
  rootFrontX: number;
  rootBackX: number;
  rootLeftY: number;
  rootRightY: number;
  filletRadius: number;
  rootFilletRadius: number;
}): RobotProtrusionPathCommand[] {
  const r = filletRadius;
  const rootR = rootFilletRadius;
  if (protrusionSide === "front") {
    return [
      ["M", rootFrontX, topStrokeY + rootR],
      ["Q", rootFrontX, topStrokeY, rootFrontX + rootR, topStrokeY],
      ["L", rightStrokeX - r, topStrokeY],
      ["Q", rightStrokeX, topStrokeY, rightStrokeX, topStrokeY + r],
      ["L", rightStrokeX, bottomStrokeY - r],
      ["Q", rightStrokeX, bottomStrokeY, rightStrokeX - r, bottomStrokeY],
      ["L", rootFrontX + rootR, bottomStrokeY],
      ["Q", rootFrontX, bottomStrokeY, rootFrontX, bottomStrokeY - rootR],
    ];
  }
  if (protrusionSide === "back") {
    return [
      ["M", rootBackX, topStrokeY + rootR],
      ["Q", rootBackX, topStrokeY, rootBackX - rootR, topStrokeY],
      ["L", leftStrokeX + r, topStrokeY],
      ["Q", leftStrokeX, topStrokeY, leftStrokeX, topStrokeY + r],
      ["L", leftStrokeX, bottomStrokeY - r],
      ["Q", leftStrokeX, bottomStrokeY, leftStrokeX + r, bottomStrokeY],
      ["L", rootBackX - rootR, bottomStrokeY],
      ["Q", rootBackX, bottomStrokeY, rootBackX, bottomStrokeY - rootR],
    ];
  }
  if (protrusionSide === "left") {
    return [
      ["M", leftStrokeX + rootR, rootLeftY],
      ["Q", leftStrokeX, rootLeftY, leftStrokeX, rootLeftY - rootR],
      ["L", leftStrokeX, topStrokeY + r],
      ["Q", leftStrokeX, topStrokeY, leftStrokeX + r, topStrokeY],
      ["L", rightStrokeX - r, topStrokeY],
      ["Q", rightStrokeX, topStrokeY, rightStrokeX, topStrokeY + r],
      ["L", rightStrokeX, rootLeftY - rootR],
      ["Q", rightStrokeX, rootLeftY, rightStrokeX - rootR, rootLeftY],
    ];
  }
  if (protrusionSide === "right") {
    return [
      ["M", leftStrokeX + rootR, rootRightY],
      ["Q", leftStrokeX, rootRightY, leftStrokeX, rootRightY + rootR],
      ["L", leftStrokeX, bottomStrokeY - r],
      ["Q", leftStrokeX, bottomStrokeY, leftStrokeX + r, bottomStrokeY],
      ["L", rightStrokeX - r, bottomStrokeY],
      ["Q", rightStrokeX, bottomStrokeY, rightStrokeX, bottomStrokeY - r],
      ["L", rightStrokeX, rootRightY + rootR],
      ["Q", rightStrokeX, rootRightY, rightStrokeX - rootR, rootRightY],
    ];
  }

  return [];
}

function pathData(commands: RobotProtrusionPathCommand[]): string {
  return commands
    .map(
      ([command, ...values]) =>
        `${command} ${values.map(formatPathNumber).join(" ")}`,
    )
    .join(" ");
}

function formatPathNumber(value: number): string {
  if (Object.is(value, -0)) {
    return "0";
  }
  return Number(value.toFixed(3)).toString();
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

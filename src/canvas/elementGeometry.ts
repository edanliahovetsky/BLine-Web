import type { ProtrusionSide } from "../core/config/projectConfig";
import type { StagePoint } from "./geometry";
import {
  elementCircleRadiusMeters,
  eventTriggerLengthMeters,
} from "./constants";
import type {
  RobotLocalBounds,
  RobotProtrusionPathCommand,
} from "./robotFootprint";

/** Keep painted markers in field units; pointer hit targets can stay generous. */
export function translationMarkerMetrics(metersToPixels: number) {
  const radius = Math.max(1, elementCircleRadiusMeters * metersToPixels);
  const borderWidth = Math.max(0.6, Math.min(4, radius * 0.35));
  return {
    radius,
    borderWidth,
    outerRadius: radius + borderWidth,
    selectionPadding: Math.max(2, Math.min(6, radius * 1.2)),
  };
}

export function eventMarkerMetrics(metersToPixels: number) {
  const halfLength = Math.max(
    1,
    (eventTriggerLengthMeters * metersToPixels) / 2,
  );
  const detailScale = Math.min(1, halfLength / 16);
  return {
    halfLength,
    outlineWidth: Math.max(0.8, 4.4 * detailScale),
    strokeWidth: Math.max(0.45, 2.8 * detailScale),
    centerRadius: Math.max(0.55, 3.3 * detailScale),
    centerBorderWidth: Math.max(0.2, 0.8 * detailScale),
    selectionPadding: Math.max(2, 5 * detailScale),
  };
}

/** Screen-space details for the Open Edge footprint; its bounds stay in robot units. */
export function elementFootprintMetrics(width: number, height: number) {
  const size = Math.max(0, Math.min(width, height));
  const scale = size / 30;
  return {
    strokeWidth: Math.max(1.2, Math.min(2.4, 1.8 * scale)),
    cornerRadius: Math.min(size / 2, 6, 3 * scale),
    centerRadius: Math.max(3.5, Math.min(12, 5 * scale)),
    frontRadius: Math.max(2.5, Math.min(9, 3.8 * scale)) * 0.65,
  };
}

/** A rounded perimeter with an optional opening at the middle of the front. */
export function footprintOutlineCommands(
  bounds: RobotLocalBounds,
  radius: number,
  frontGap = 0,
  attachmentSide: ProtrusionSide = "none",
): RobotProtrusionPathCommand[] {
  const { x: left, y: top, width, height } = bounds;
  if (width <= 0 || height <= 0) return [];
  const right = left + width,
    bottom = top + height,
    middle = top + height / 2;
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const tl = attachmentSide === "left" || attachmentSide === "back" ? 0 : r;
  const tr = attachmentSide === "left" || attachmentSide === "front" ? 0 : r;
  const bl = attachmentSide === "right" || attachmentSide === "back" ? 0 : r;
  const br = attachmentSide === "right" || attachmentSide === "front" ? 0 : r;
  const gap = Math.max(0, Math.min(frontGap, height / 2 - Math.max(tr, br)));
  return [
    ["M", right, middle - gap],
    ["L", right, top + tr],
    ["Q", right, top, right - tr, top],
    ["L", left + tl, top],
    ["Q", left, top, left, top + tl],
    ["L", left, bottom - bl],
    ["Q", left, bottom, left + bl, bottom],
    ["L", right - br, bottom],
    ["Q", right, bottom, right, bottom - br],
    ["L", right, middle + gap],
  ];
}

export function robotFrontPoint(
  center: StagePoint,
  lengthPx: number,
  heading: number,
  outlineInset = 0,
): StagePoint {
  const distance = Math.max(0, lengthPx / 2 - outlineInset);
  return {
    x: center.x + Math.cos(heading) * distance,
    y: center.y - Math.sin(heading) * distance,
  };
}

/** The whole front face rotates; the center remains available for position dragging. */
export function hitTestRobotFrontFace(
  center: StagePoint,
  pointer: StagePoint,
  lengthPx: number,
  widthPx: number,
  heading: number,
): boolean {
  if (lengthPx <= 0 || widthPx <= 0) return false;
  const dx = pointer.x - center.x,
    dy = pointer.y - center.y;
  const x = dx * Math.cos(heading) - dy * Math.sin(heading);
  const y = dx * Math.sin(heading) + dy * Math.cos(heading);
  const { frontRadius } = elementFootprintMetrics(lengthPx, widthPx);
  const tolerance = Math.max(6, frontRadius + 2);
  return (
    x > Math.min(lengthPx / 4, 5) &&
    Math.abs(x - lengthPx / 2) <= tolerance &&
    Math.abs(y) <= widthPx / 2 + 4
  );
}

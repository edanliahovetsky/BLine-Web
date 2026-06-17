import { defaultFieldGeometry } from "../core/field/fieldConfig";

export const fieldLengthMeters = defaultFieldGeometry.length_meters;
export const fieldWidthMeters = defaultFieldGeometry.width_meters;
export const fieldCoordinateOffsetMeters =
  defaultFieldGeometry.coordinate_offset_meters;

export const fieldAspectRatio = fieldLengthMeters / fieldWidthMeters;

export const robotLengthMeters = 0.6;
export const robotWidthMeters = 0.6;

export const elementCircleRadiusMeters = 0.1;
export const eventTriggerLengthMeters = robotWidthMeters * 0.6;
export const elementOutlineMeters = 0.06;
export const triangleSizeRatio = 0.55;

export const nodeRadiusPx = 9;
export const waypointSizePx = 24;
export const rotationNodeRadiusPx = 13;
export const eventMarkerHalfHeightPx = 16;

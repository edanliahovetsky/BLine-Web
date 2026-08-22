import { defaultFieldGeometry } from "../core/field/fieldConfig";

const fieldLengthMeters = defaultFieldGeometry.length_meters;
const fieldWidthMeters = defaultFieldGeometry.width_meters;
export const fieldAspectRatio = fieldLengthMeters / fieldWidthMeters;

const robotWidthMeters = 0.6;

export const elementCircleRadiusMeters = 0.1;
export const eventTriggerLengthMeters = robotWidthMeters * 0.6;
export const elementOutlineMeters = 0.06;
export const triangleSizeRatio = 0.55;

export const eventMarkerHalfHeightPx = 16;

import type { PointMeters } from "./geometry";

export interface CurveToolSession {
  id: number;
  insertionIndex: number;
}

export interface CurveAuthoringPreview {
  rawPoints: readonly PointMeters[];
  targetPoints: readonly PointMeters[];
  insertionIndex: number;
}

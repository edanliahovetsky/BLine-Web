import type { RotationKeyframe } from "./types";
import { shortestAngularDistance } from "./simGeometry";

interface Geometry {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
interface Segment extends Geometry {
  length: number;
  startS: number;
}
interface Frame {
  s: number;
  theta: number;
  interpolate: boolean;
}
interface Join {
  s: number;
  theta: number;
  endS: number;
  endTheta: number;
}
const epsilon = 1e-9;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Spatial heading interpolation matching the library's RotationProgress.
 * Translation handoff permits the next connected projection; it never completes
 * a rotation interval. A corner-coordinate switch joins from the OLD requested
 * angle at the CURRENT pose, then interpolates over the remaining path distance.
 * Distances are metres and angles are unwrapped radians. No motion profile.
 */
export class RotationProgress {
  private readonly segments: Segment[];
  private readonly frames: Frame[];
  private segmentIndex = 0;
  private acceptedS = 0;
  private previousX: number;
  private previousY: number;
  private join: Join | null = null;
  private tailHeading: number | null = null;

  constructor(
    geometry: readonly Geometry[],
    keyframes: readonly RotationKeyframe[],
    private readonly initialHeading: number,
  ) {
    let distance = 0;
    this.segments = geometry.map((segment) => {
      const length = Math.hypot(
        segment.bx - segment.ax,
        segment.by - segment.ay,
      );
      const result = { ...segment, length, startS: distance };
      distance += length;
      return result;
    });
    let unwrapped = initialHeading;
    this.frames = [...keyframes]
      .sort((a, b) => a.s_m - b.s_m)
      .map((frame) => {
        unwrapped += shortestAngularDistance(frame.theta_target, unwrapped);
        return {
          s: frame.s_m,
          theta: unwrapped,
          interpolate: frame.profiled_rotation,
        };
      });
    this.previousX = geometry[0]?.ax ?? 0;
    this.previousY = geometry[0]?.ay ?? 0;
  }

  update(
    x: number,
    y: number,
    authorizedSegmentIndex: number,
  ): { headingRadians: number; progressMeters: number } {
    if (!this.segments.length)
      return { headingRadians: this.initialHeading, progressMeters: 0 };
    while (
      this.segmentIndex + 1 < this.segments.length &&
      this.segments[this.segmentIndex].length < epsilon &&
      this.segmentIndex + 1 <= authorizedSegmentIndex
    )
      this.segmentIndex++;
    const oldSegment = this.segments[this.segmentIndex];
    const oldS = Math.max(this.acceptedS, project(oldSegment, x, y));
    const oldHeading = this.heading(oldS);
    const dx = x - this.previousX;
    const dy = y - this.previousY;
    let switched = false;
    while (
      this.segmentIndex + 1 < this.segments.length &&
      this.segmentIndex + 1 <= authorizedSegmentIndex
    ) {
      const current = this.segments[this.segmentIndex];
      const next = this.segments[this.segmentIndex + 1];
      const oldDistance = distanceToSegment(current, x, y);
      const nextDistance = distanceToSegment(next, x, y);
      const retracing =
        Math.abs(oldDistance - nextDistance) <= epsilon &&
        along(current, dx, dy) < -epsilon &&
        along(next, dx, dy) > epsilon;
      if (
        current.length < epsilon ||
        ratio(current, x, y) >= 1 - epsilon ||
        nextDistance + epsilon < oldDistance ||
        retracing
      ) {
        this.segmentIndex++;
        switched = true;
      } else break;
    }
    this.acceptedS = Math.max(
      oldS,
      project(this.segments[this.segmentIndex], x, y),
    );
    if (switched && this.acceptedS > oldS + epsilon) {
      const future = this.nextFrame(this.acceptedS);
      if (
        future?.interpolate &&
        Math.abs(this.heading(this.acceptedS) - oldHeading) > epsilon
      ) {
        this.join = {
          s: this.acceptedS,
          theta: oldHeading,
          endS: future.s,
          endTheta: future.theta,
        };
        this.tailHeading = null;
      } else if (
        !future &&
        Math.abs(this.heading(this.acceptedS) - oldHeading) > epsilon
      ) {
        const segment = this.segments[this.segmentIndex];
        const endS = segment.startS + segment.length;
        if (endS > this.acceptedS + epsilon) {
          this.join = {
            s: this.acceptedS,
            theta: oldHeading,
            endS,
            endTheta: this.frames.at(-1)?.theta ?? this.initialHeading,
          };
          this.tailHeading = null;
        } else this.tailHeading = oldHeading;
      }
    }
    this.previousX = x;
    this.previousY = y;
    return {
      headingRadians: this.heading(this.acceptedS),
      progressMeters: this.acceptedS,
    };
  }

  private nextFrame(s: number) {
    return this.frames.find((frame) => frame.s > s + epsilon);
  }
  private previousFrame(s: number) {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].s <= s + epsilon) return this.frames[i];
    }
    return undefined;
  }

  private heading(s: number): number {
    const next = this.nextFrame(s);
    if (next && !next.interpolate) return next.theta;
    if (this.join && s >= this.join.s && s < this.join.endS) {
      return (
        this.join.theta +
        ((s - this.join.s) / (this.join.endS - this.join.s)) *
          (this.join.endTheta - this.join.theta)
      );
    }
    if (!next)
      return (
        this.tailHeading ?? this.frames.at(-1)?.theta ?? this.initialHeading
      );
    const previous = this.previousFrame(s);
    const startS = previous?.s ?? 0;
    const startHeading = previous?.theta ?? this.initialHeading;
    return (
      startHeading +
      clamp01((s - startS) / (next.s - startS)) * (next.theta - startHeading)
    );
  }
}

function ratio(segment: Segment, x: number, y: number): number {
  return segment.length < epsilon
    ? 1
    : clamp01(
        ((x - segment.ax) * (segment.bx - segment.ax) +
          (y - segment.ay) * (segment.by - segment.ay)) /
          (segment.length * segment.length),
      );
}
function project(segment: Segment, x: number, y: number) {
  return segment.startS + segment.length * ratio(segment, x, y);
}
function distanceToSegment(segment: Segment, x: number, y: number) {
  const t = ratio(segment, x, y);
  return Math.hypot(
    x - segment.ax - t * (segment.bx - segment.ax),
    y - segment.ay - t * (segment.by - segment.ay),
  );
}
function along(segment: Segment, x: number, y: number) {
  return x * (segment.bx - segment.ax) + y * (segment.by - segment.ay);
}

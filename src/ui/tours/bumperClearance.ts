import type { SimulationTraceSample } from "../../core/sim";

export interface BumperObstacle {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface BumperSize {
  length_meters: number;
  width_meters: number;
}

type BumperPose = Pick<SimulationTraceSample, "x_m" | "y_m" | "theta_rad">;

// A sub-micrometer unresolved gap counts as contact, rather than accepting a
// sweep whose separation cannot be established numerically.
const contactTolerance = 1e-7;

/**
 * Check the same oriented bumper rectangle drawn on the canvas throughout a
 * completed simulation. Interpolation follows each simulated translation and
 * shortest-angle rotation, including the motion between recorded poses.
 */
export function traceClearsObstacle(
  trace: readonly SimulationTraceSample[],
  robot: BumperSize,
  obstacle: BumperObstacle,
): boolean {
  const last = trace.at(-1);
  if (
    trace.length < 2 ||
    !last?.snapped_position ||
    !last.snapped_rotation ||
    !validGeometry(robot, obstacle) ||
    trace.some(
      (pose) =>
        !Number.isFinite(pose.x_m) ||
        !Number.isFinite(pose.y_m) ||
        !Number.isFinite(pose.theta_rad),
    )
  )
    return false;

  if (separation(trace[0], robot, obstacle) <= contactTolerance) return false;
  for (let index = 1; index < trace.length; index += 1) {
    const end = trace[index];
    if (
      separation(end, robot, obstacle) <= contactTolerance ||
      !sweepClearsObstacle(trace[index - 1], end, robot, obstacle)
    )
      return false;
  }
  return true;
}

function validGeometry(robot: BumperSize, obstacle: BumperObstacle) {
  return (
    Number.isFinite(robot.length_meters) &&
    Number.isFinite(robot.width_meters) &&
    robot.length_meters > 0 &&
    robot.width_meters > 0 &&
    Object.values(obstacle).every(Number.isFinite) &&
    obstacle.minX <= obstacle.maxX &&
    obstacle.minY <= obstacle.maxY
  );
}

/** Largest separating-axis gap; nonpositive means the rectangles intersect. */
function separation(
  pose: BumperPose,
  robot: BumperSize,
  obstacle: BumperObstacle,
) {
  const halfLength = robot.length_meters / 2;
  const halfWidth = robot.width_meters / 2;
  const halfX = (obstacle.maxX - obstacle.minX) / 2;
  const halfY = (obstacle.maxY - obstacle.minY) / 2;
  const dx = pose.x_m - (obstacle.minX + obstacle.maxX) / 2;
  const dy = pose.y_m - (obstacle.minY + obstacle.maxY) / 2;
  const cos = Math.cos(pose.theta_rad);
  const sin = Math.sin(pose.theta_rad);
  const absCos = Math.abs(cos);
  const absSin = Math.abs(sin);
  return Math.max(
    Math.abs(dx) - halfX - halfLength * absCos - halfWidth * absSin,
    Math.abs(dy) - halfY - halfLength * absSin - halfWidth * absCos,
    Math.abs(dx * cos + dy * sin) -
      halfLength -
      halfX * absCos -
      halfY * absSin,
    Math.abs(-dx * sin + dy * cos) -
      halfWidth -
      halfX * absSin -
      halfY * absCos,
  );
}

function sweepClearsObstacle(
  start: BumperPose,
  end: BumperPose,
  robot: BumperSize,
  obstacle: BumperObstacle,
): boolean {
  const angle = Math.atan2(
    Math.sin(end.theta_rad - start.theta_rad),
    Math.cos(end.theta_rad - start.theta_rad),
  );
  const middle = {
    x_m: (start.x_m + end.x_m) / 2,
    y_m: (start.y_m + end.y_m) / 2,
    theta_rad: start.theta_rad + angle / 2,
  };
  const gap = separation(middle, robot, obstacle);
  if (gap <= contactTolerance) return false;

  // Relative to the midpoint, every bumper point travels no farther than the
  // center's half displacement plus the corner's rotation chord. A separating
  // axis with a larger gap proves the entire interval is collision-free.
  const cornerRadius = Math.hypot(robot.length_meters, robot.width_meters) / 2;
  const movementBound =
    Math.hypot(end.x_m - start.x_m, end.y_m - start.y_m) / 2 +
    2 * cornerRadius * Math.sin(Math.abs(angle) / 4);
  if (gap > movementBound + contactTolerance) return true;
  if (movementBound <= contactTolerance) return false;

  // Refine only ambiguous intervals. Endpoint-only or fixed-rate sampling can
  // miss a thin obstacle or a corner that swings into it while turning.
  return (
    sweepClearsObstacle(start, middle, robot, obstacle) &&
    sweepClearsObstacle(middle, end, robot, obstacle)
  );
}

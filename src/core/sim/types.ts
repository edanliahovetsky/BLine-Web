import type { CanonicalProjectConfig } from "../config/projectConfig";

export type PoseTuple = readonly [x_m: number, y_m: number, theta_rad: number];
export type PointTuple = readonly [x_m: number, y_m: number];

export interface ChassisSpeeds {
  vx_mps: number;
  vy_mps: number;
  omega_radps: number;
}

type KinematicSimulationConfig = Partial<
  Record<keyof CanonicalProjectConfig["kinematic_constraints"], number | null>
>;

type GuiSimulationConfig = {
  robot?: Partial<CanonicalProjectConfig["gui"]["robot"]>;
  protrusions?: Partial<CanonicalProjectConfig["gui"]["protrusions"]> & {
    event_state_overrides?: Record<string, unknown>;
  };
};

export interface SimulationConfig extends KinematicSimulationConfig {
  kinematic_constraints?: KinematicSimulationConfig;
  gui?: GuiSimulationConfig;
  default_max_velocity_meters_per_sec?: number | null;
  default_max_acceleration_meters_per_sec2?: number | null;
  default_intermediate_handoff_radius_meters?: number | null;
  default_max_velocity_deg_per_sec?: number | null;
  default_max_acceleration_deg_per_sec2?: number | null;
}

export interface SimulationOptions {
  dt_s?: number;
}

export interface SimResult {
  poses_by_time: Map<number, PoseTuple>;
  global_s_by_time: Map<number, number>;
  protrusion_visible_by_time: Map<number, boolean>;
  times_sorted: number[];
  total_time_s: number;
  trail_points: PointTuple[];
}

export interface RotationKeyframe {
  s_m: number;
  theta_target: number;
  event_ordinal_1b: number;
  profiled_rotation: boolean;
}

export interface RotationDomainEvent {
  s_m: number;
  event_ordinal_1b: number;
}

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  length_m: number;
  ux: number;
  uy: number;
}

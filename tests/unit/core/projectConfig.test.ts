import { describe, expect, it } from "vitest";
import {
  createProjectConfig,
  getDefaultOptionalConfigValue,
  needsProjectConfigMigration,
  projectConfigToFlat
} from "../../../src/core/config/projectConfig";

describe("project config", () => {
  it("uses current robot and translation defaults", () => {
    const config = createProjectConfig();

    expect(config.gui.robot).toEqual({
      length_meters: 0.8,
      width_meters: 0.8
    });
    expect(
      config.kinematic_constraints.default_max_acceleration_meters_per_sec2
    ).toBe(12);
  });

  it("normalizes legacy flat robot, protrusion, and default values", () => {
    const config = createProjectConfig({
      robot_length_meters: 0.7,
      robot_width_meters: 0.6,
      robot_protrusion_left_meters: 0.18,
      robot_protrusion_front_meters: 0.08,
      default_max_velocity_meters_per_sec: 3,
      default_intermediate_handoff_radius_meters: 0.55,
      default_auto_velocity_velocity_safety_factor: 0.85,
      default_auto_velocity_merge_tolerance_meters_per_sec: 0.25
    });

    expect(config.gui.robot).toEqual({
      length_meters: 0.7,
      width_meters: 0.6
    });
    expect(config.gui.protrusions).toMatchObject({
      enabled: true,
      side: "left",
      distance_meters: 0.18,
      default_state: "shown"
    });
    expect(config.kinematic_constraints).toMatchObject({
      default_max_velocity_meters_per_sec: 3,
      default_intermediate_handoff_radius_meters: 0.55,
      default_auto_velocity_velocity_safety_factor: 0.85,
      default_auto_velocity_acceleration_safety_factor: 0.8,
      default_auto_velocity_merge_tolerance_meters_per_sec: 0.25
    });
  });

  it("normalizes structured protrusion event override maps", () => {
    const config = createProjectConfig({
      gui: {
        protrusions: {
          enabled: "true",
          distance_meters: "0.3",
          side: "front",
          default_state: "hidden",
          event_state_overrides: {
            intake: "shown",
            stow: "hidden",
            blank: ""
          }
        }
      }
    });

    expect(config.gui.protrusions).toMatchObject({
      enabled: true,
      distance_meters: 0.3,
      side: "front",
      default_state: "hidden",
      show_on_event_keys: ["intake"],
      hide_on_event_keys: ["stow"]
    });
  });

  it("projects canonical config to the desktop flat compatibility shape", () => {
    const flat = projectConfigToFlat({
      gui: {
        robot: { length_meters: 0.8, width_meters: 0.9 },
        protrusions: {
          enabled: true,
          distance_meters: 0.12,
          side: "back",
          default_state: "shown",
          show_on_event_keys: "deploy, deploy, intake",
          hide_on_event_keys: ["stow"]
        }
      }
    });

    expect(flat).toMatchObject({
      robot_length_meters: 0.8,
      robot_width_meters: 0.9,
      protrusion_enabled: true,
      protrusion_distance_meters: 0.12,
      protrusion_side: "back",
      protrusion_default_state: "shown",
      protrusion_show_on_event_keys: ["deploy", "intake"],
      protrusion_hide_on_event_keys: ["stow"],
      robot_protrusion_front_meters: 0,
      robot_protrusion_back_meters: 0.12
    });
  });

  it("provides default optional values for path deserialization", () => {
    const config = createProjectConfig({
      kinematic_constraints: {
        default_intermediate_handoff_radius_meters: 0.42
      }
    });

    expect(
      getDefaultOptionalConfigValue(
        config,
        "intermediate_handoff_radius_meters"
      )
    ).toBe(0.42);
    expect(getDefaultOptionalConfigValue(config, "not_real")).toBeNull();
  });

  it("provides auto velocity defaults from project settings", () => {
    const config = createProjectConfig({
      kinematic_constraints: {
        default_auto_velocity_velocity_safety_factor: 0.75,
        default_auto_velocity_acceleration_safety_factor: 0.65,
        default_auto_velocity_merge_tolerance_meters_per_sec: 0.2
      }
    });

    expect(
      getDefaultOptionalConfigValue(config, "auto_velocity_velocity_safety_factor")
    ).toBe(0.75);
    expect(
      getDefaultOptionalConfigValue(config, "auto_velocity_acceleration_safety_factor")
    ).toBe(0.65);
    expect(
      getDefaultOptionalConfigValue(config, "auto_velocity_merge_tolerance_meters_per_sec")
    ).toBe(0.2);
  });

  it("flags legacy or partial config documents as migration candidates", () => {
    expect(needsProjectConfigMigration({ robot_length_meters: 0.7 })).toBe(true);
    expect(
      needsProjectConfigMigration({
        gui: {
          robot: { length_meters: 0.8, width_meters: 0.8 },
          protrusions: {
            enabled: false,
            distance_meters: 0,
            side: "none",
            default_state: "",
            show_on_event_keys: [],
            hide_on_event_keys: []
          }
        },
        kinematic_constraints: {
          default_max_velocity_meters_per_sec: 4.5
        }
      })
    ).toBe(false);
  });
});

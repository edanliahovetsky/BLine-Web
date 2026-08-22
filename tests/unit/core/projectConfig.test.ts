import { describe, expect, it } from "vitest";
import {
  createProjectConfig,
  getDefaultOptionalConfigValue,
  needsProjectConfigMigration,
  projectConfigToFlat,
} from "../../../src/core/config/projectConfig";
import {
  blankGridFieldGeometry,
  builtInFieldDefinitions,
  defaultFieldId,
  resolveUserFieldDefinition,
} from "../../../src/core/field/fieldConfig";

describe("project config", () => {
  it("uses current robot and translation defaults", () => {
    const config = createProjectConfig();

    expect(config.gui.robot).toEqual({
      length_meters: 0.8,
      width_meters: 0.8,
    });
    expect(
      config.kinematic_constraints.default_max_acceleration_meters_per_sec2,
    ).toBe(12);
    expect(
      config.kinematic_constraints.default_intermediate_handoff_radius_meters,
    ).toBe(0.45);
    expect(
      config.kinematic_constraints.default_auto_velocity_velocity_safety_factor,
    ).toBe(1);
    expect(
      config.kinematic_constraints
        .default_auto_velocity_acceleration_safety_factor,
    ).toBe(1);
    expect(
      config.kinematic_constraints
        .default_auto_velocity_merge_tolerance_meters_per_sec,
    ).toBe(0.3);
    expect(config.gui.field).toMatchObject({
      selected_field_id: defaultFieldId,
      custom_fields: [],
    });
  });

  it("normalizes custom field image config and resolves its geometry", () => {
    const config = createProjectConfig({
      gui: {
        field: {
          selected_field_id: "custom:practice-field",
          custom_fields: [
            {
              id: "custom:practice-field",
              name: "Practice Field",
              asset_id: "field-practice.png",
              file_name: "practice.png",
              mime_type: "image/png",
              size_bytes: "128",
              created_at: "2026-06-16T12:00:00.000Z",
              geometry: {
                length_meters: "12",
                width_meters: 6,
                coordinate_offset_meters: 0.25,
                coordinate_offset_x_meters: 0.4,
                coordinate_offset_y_meters: 0.6,
              },
            },
          ],
        },
      },
    });

    expect(config.gui.field.selected_field_id).toBe("custom:practice-field");
    expect(config.gui.field.custom_fields[0]).toMatchObject({
      name: "Practice Field",
      asset_id: "field-practice.png",
      size_bytes: 128,
    });
    expect(
      resolveUserFieldDefinition(
        config.gui.field.selected_field_id,
        config.gui.field.custom_fields,
      ).geometry,
    ).toEqual({
      length_meters: 12,
      width_meters: 6,
      coordinate_offset_meters: 0.25,
      coordinate_offset_x_meters: 0.4,
      coordinate_offset_y_meters: 0.6,
    });
  });

  it("uses PathPlanner image calibration for built-in fields", () => {
    expect(
      builtInFieldDefinitions
        .filter((field) => field.kind === "image")
        .map((field) => ({
          id: field.id,
          length_meters: field.geometry.length_meters,
          width_meters: field.geometry.width_meters,
          offset_x: field.geometry.coordinate_offset_x_meters,
          offset_y: field.geometry.coordinate_offset_y_meters,
          image_src: field.image_src,
        })),
    ).toMatchObject([
      {
        id: "frc2022-rapid-react",
        length_meters: 3240 / 196.85,
        width_meters: 1620 / 196.85,
        offset_x: 0,
        offset_y: 0,
        image_src: "/assets/fields/field22.png",
      },
      {
        id: "frc2023-charged-up",
        length_meters: 3256 / 196.85,
        width_meters: 1578 / 196.85,
        offset_x: 0,
        offset_y: 0,
        image_src: "/assets/fields/field23.png",
      },
      {
        id: "frc2024-crescendo",
        length_meters: 3256 / 196.85,
        width_meters: 1616 / 196.85,
        offset_x: 0,
        offset_y: 0,
        image_src: "/assets/fields/field24.png",
      },
      {
        id: "frc2025-reefscape",
        length_meters: 3510 / 200,
        width_meters: 1610 / 200,
        offset_x: 0,
        offset_y: 0,
        image_src: "/assets/fields/field25.png",
      },
      {
        id: "frc2025-reefscape-annotated",
        length_meters: 3510 / 200,
        width_meters: 1610 / 200,
        offset_x: 0,
        offset_y: 0,
        image_src: "/assets/fields/field25-annotated.png",
      },
      {
        id: "frc2026-rebuilt",
        length_meters: 3508 / 200,
        width_meters: 1814 / 200,
        offset_x: 0.5,
        offset_y: 0.5,
        image_src: "/assets/fields/field26.png",
      },
    ]);
  });

  it("falls back to the default field when a saved field id is unavailable", () => {
    const config = createProjectConfig({
      gui: {
        field: {
          selected_field_id: "custom:missing-field",
          custom_fields: [],
        },
      },
    });

    expect(config.gui.field.selected_field_id).toBe(defaultFieldId);
  });

  it("uses half-meter aligned dimensions for the blank grid field", () => {
    const config = createProjectConfig({
      gui: {
        field: {
          selected_field_id: "blank-grid",
        },
      },
    });
    const geometry = resolveUserFieldDefinition(
      config.gui.field.selected_field_id,
      config.gui.field.custom_fields,
    ).geometry;

    expect(geometry).toEqual(blankGridFieldGeometry);
    expect((geometry.length_meters * 2) % 1).toBe(0);
    expect((geometry.width_meters * 2) % 1).toBe(0);
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
      default_auto_velocity_merge_tolerance_meters_per_sec: 0.25,
    });

    expect(config.gui.robot).toEqual({
      length_meters: 0.7,
      width_meters: 0.6,
    });
    expect(config.gui.protrusions).toMatchObject({
      enabled: true,
      side: "left",
      distance_meters: 0.18,
      default_state: "shown",
    });
    expect(config.kinematic_constraints).toMatchObject({
      default_max_velocity_meters_per_sec: 3,
      default_intermediate_handoff_radius_meters: 0.55,
      default_auto_velocity_velocity_safety_factor: 0.85,
      default_auto_velocity_acceleration_safety_factor: 1,
      default_auto_velocity_merge_tolerance_meters_per_sec: 0.25,
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
            blank: "",
          },
        },
      },
    });

    expect(config.gui.protrusions).toMatchObject({
      enabled: true,
      distance_meters: 0.3,
      side: "front",
      default_state: "hidden",
      show_on_event_keys: ["intake"],
      hide_on_event_keys: ["stow"],
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
          hide_on_event_keys: ["stow"],
        },
      },
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
      robot_protrusion_back_meters: 0.12,
    });
  });

  it("provides default optional values for path deserialization", () => {
    const config = createProjectConfig({
      kinematic_constraints: {
        default_intermediate_handoff_radius_meters: 0.42,
      },
    });

    expect(
      getDefaultOptionalConfigValue(
        config,
        "intermediate_handoff_radius_meters",
      ),
    ).toBe(0.42);
    expect(getDefaultOptionalConfigValue(config, "not_real")).toBeNull();
  });

  it("provides auto velocity defaults from project settings", () => {
    const config = createProjectConfig({
      kinematic_constraints: {
        default_auto_velocity_velocity_safety_factor: 0.75,
        default_auto_velocity_acceleration_safety_factor: 0.65,
        default_auto_velocity_merge_tolerance_meters_per_sec: 0.2,
      },
    });

    expect(
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_velocity_safety_factor",
      ),
    ).toBe(0.75);
    expect(
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_acceleration_safety_factor",
      ),
    ).toBe(0.65);
    expect(
      getDefaultOptionalConfigValue(
        config,
        "auto_velocity_merge_tolerance_meters_per_sec",
      ),
    ).toBe(0.2);
  });

  it("flags legacy or partial config documents as migration candidates", () => {
    const canonical = createProjectConfig();

    expect(needsProjectConfigMigration({ robot_length_meters: 0.7 })).toBe(
      true,
    );
    expect(
      needsProjectConfigMigration({
        gui: {
          robot: canonical.gui.robot,
          protrusions: canonical.gui.protrusions,
        },
        kinematic_constraints: {
          default_max_velocity_meters_per_sec: 4.5,
        },
      }),
    ).toBe(true);
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
            hide_on_event_keys: [],
          },
          field: canonical.gui.field,
        },
        kinematic_constraints: {
          default_max_velocity_meters_per_sec: 4.5,
        },
      }),
    ).toBe(false);
  });
});

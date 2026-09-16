import { createProjectConfig } from "../../core/config/projectConfig";
import { defaultFieldId } from "../../core/field/fieldConfig";
import { createPathModel } from "../../core/model/path";
import { feedback } from "./tourChecks";
import { waypoint, translation } from "./tourScenario";
import type { TourDefinition, TourStep } from "./tourStore";

const overview = (step: TourStep): TourStep => ({
  ...step,
  autoGenerate: false,
  visible: ["settings-dialog"],
});
const navigation = (
  section: NonNullable<TourStep["settingsSection"]>,
  label: string,
): TourStep =>
  overview({
    title: `Open ${label}`,
    body: `Choose ${label} in the settings menu to see the next group of settings.`,
    target: `settings-nav-${section}`,
    settingsSection: section,
    settingsInteraction: "navigate",
    interact: ["settings-nav"],
    task: `Open ${label}`,
    check: () =>
      feedback(
        typeof document !== "undefined" &&
          !!document.querySelector(
            `[data-tour="settings-nav-${section}"][aria-current="page"]`,
          ),
        `Choose ${label} in the settings menu.`,
        `${label} is open.`,
      ),
  });

export const robotSettingsTour: TourDefinition = {
  id: "robot-settings",
  title: "Robot Settings",
  summary: "A walkthrough of robot, path, field and generator settings",
  durationMinutes: 3,
  completionMessage:
    "You know where each setting belongs. Use Tune Your Robot for the next steps on your real robot.",
  practiceConfig: () => {
    const config = createProjectConfig();
    // Populate the extension example before the learner enables it.
    config.gui.protrusions.distance_meters = 0.25;
    config.gui.protrusions.side = "front";
    config.gui.protrusions.show_on_event_keys = ["intake_out"];
    config.gui.protrusions.hide_on_event_keys = ["intake_in"];
    return config;
  },
  practicePath: () =>
    createPathModel({
      path_elements: [waypoint(3, 2), translation(7, 4), waypoint(11, 4, 90)],
    }),
  steps: [
    overview({
      title: "Robot size",
      body: "File → Settings holds the project settings. Robot Length and Width are the outside bumper dimensions of the robot shown on the field. They set the footprint you used to judge clearance in earlier lessons. The values here are preset for this practice project.",
      target: "settings-size",
      settingsSection: "robot",
      prepare: {
        inspector: "closed",
        navigator: "closed",
        tool: "select",
        simulation: "start",
        closeMenus: true,
      },
    }),
    overview({
      title: "Enable protrusions",
      body: "Protrusions represent parts that extend beyond the bumpers, such as an intake. Turn on Enable Protrusions to reveal its settings.",
      target: "settings-protrusions",
      settingsSection: "robot",
      settingsInteraction: "protrusions",
      interact: ["settings-enable-protrusions"],
      task: "Turn on Enable Protrusions",
      check: () =>
        feedback(
          typeof document !== "undefined" &&
            !!document.querySelector<HTMLInputElement>(
              '[data-tour="settings-enable-protrusions"] input',
            )?.checked,
          "Turn on Enable Protrusions.",
          "The protrusion settings are enabled.",
        ),
    }),
    overview({
      title: "Protrusion settings",
      body: "Distance sets how far the extension reaches beyond the bumpers, and Side chooses the robot edge. Default Protrusion State controls whether it starts shown or hidden. Show On Event Keys and Hide On Event Keys use the event keys from the previous lesson to change that display during a path. Here, intake_out shows it and intake_in hides it.",
      target: "settings-protrusions",
      settingsSection: "robot",
    }),
    navigation("path-defaults", "Path Defaults"),
    overview({
      title: "Translation defaults",
      body: "Path Defaults supplies values where a path has no override. Max Velocity and Max Accel set the translation limits; Handoff Radius supplies the default radius for intermediate position targets. These are the same limits and handoffs covered in Path Tuning. Your own settings should reflect your robot's measured capability.",
      target: "settings-translation",
      settingsSection: "path-defaults",
    }),
    overview({
      title: "Rotation defaults",
      body: "Max Rot Vel and Max Rot Accel set the default heading-change limits, in degrees per second and degrees per second squared. They provide the turning limits used by the rotation targets you already practiced, unless the path overrides them.",
      target: "settings-rotation",
      settingsSection: "path-defaults",
    }),
    overview({
      title: "End tolerance",
      body: "End Translation Tolerance and End Rotation Tolerance define how close the robot must be to its final position and heading for the path to finish. These apply at the endpoint; intermediate handoffs use their radii. Tighter tolerances ask for more precise final alignment.",
      target: "settings-end-tolerance",
      settingsSection: "path-defaults",
    }),
    navigation("field", "Field"),
    overview({
      title: "Field image",
      body: "Choose a different built-in Field Image to change the background shown in Settings. Built-in fields are already scaled. For a custom practice space, Upload Image adds your own background; its dimensions and padding align the picture with field coordinates.",
      target: "settings-field-image",
      settingsSection: "field",
      settingsInteraction: "field",
      interact: ["settings-field-select"],
      task: "Choose a different Field Image",
      check: () => {
        const field =
          typeof document !== "undefined" &&
          document.querySelector<HTMLSelectElement>(
            '[data-tour="settings-field-select"] select',
          );
        return feedback(
          !!field && field.value !== defaultFieldId,
          "Choose a different built-in field from Field Image.",
          "The field background has changed.",
        );
      },
    }),
    navigation("optimizer", "Generator"),
    overview({
      title: "Generator settings",
      body: "Keep in sync regenerates automatic radii and velocity caps when the path or generator settings change. Velocity and Acceleration safety factors reserve margin below the configured limits; 1 uses the full limit. Merge difference combines nearby generated speed caps when their difference is small enough. Manual constraints stay under your control, as in Path Tuning.",
      target: "settings-generator",
      settingsSection: "optimizer",
    }),
    overview({
      title: "Tune your robot",
      body: "You have now seen the settings in menu order. When setting up your robot, match its bumper size and motion limits, then tune and validate its controllers at those limits. The Tune Your Robot guide explains that process in detail. Finish returns to your original project.",
      settingsSection: "optimizer",
      resource: {
        label: "Read Tune Your Robot",
        href: "https://bline-docs.pages.dev/getting-started/tuning/",
      },
    }),
  ],
};

import { createProjectConfig } from "../../core/config/projectConfig";
import { createPathModel } from "../../core/model/path";
import { waypoint, translation } from "./tourScenario";
import type { TourDefinition, TourStep } from "./tourStore";

const overview = (step: TourStep): TourStep => ({
  ...step,
  autoGenerate: false,
  visible: ["settings-dialog"],
});

export const robotSettingsTour: TourDefinition = {
  id: "robot-settings",
  title: "Robot Settings",
  summary: "A walkthrough of robot, path, field and generator settings",
  durationMinutes: 3,
  completionMessage:
    "You know where each setting belongs. Use Tune Your Robot for the next steps on your real robot.",
  practiceConfig: createProjectConfig,
  practicePath: () =>
    createPathModel({
      path_elements: [waypoint(3, 2), translation(7, 4), waypoint(11, 4, 90)],
    }),
  steps: [
    overview({
      title: "Robot size",
      body: "File → Settings holds the project settings. Robot Length and Width are the outside bumper dimensions of the robot shown on the field. They set the footprint you used to judge clearance in earlier lessons. This walkthrough shows preset values; use Continue to look through the settings without changing your project.",
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
      title: "Protrusions",
      body: "Enable Protrusions adds a visual extension beyond the bumpers. Distance sets its reach, Side chooses the robot edge, and Default Protrusion State controls whether it starts shown or hidden. Show On Event Keys and Hide On Event Keys use the event keys from the previous lesson to change that display during a path.",
      target: "settings-protrusions",
      settingsSection: "robot",
    }),
    overview({
      title: "Translation defaults",
      body: "Path Defaults supplies values where a path has no override. Max Velocity and Max Accel set the translation limits; Handoff Radius supplies the default radius for intermediate position targets. These are the same limits and handoffs covered in Path Tuning. The preset numbers are starting points; your own settings should reflect your robot's measured capability.",
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
    overview({
      title: "Field image",
      body: "Field Image chooses the background behind your path. Upload Image adds a custom practice field, and Field Name labels it. Built-in fields already include their dimensions; custom images let you describe your own space.",
      target: "settings-field-image",
      settingsSection: "field",
    }),
    overview({
      title: "Field dimensions and padding",
      body: "For a custom field, Length and Width set its size in meters. Padding X and Y account for image margins outside the playable field, so the picture lines up with path coordinates. Built-in field geometry is preset. These settings align the canvas with the space your robot drives in.",
      target: "settings-field-geometry",
      settingsSection: "field",
    }),
    overview({
      title: "Generator settings",
      body: "Keep in sync regenerates automatic radii and velocity caps when the path or generator settings change. Velocity and Acceleration safety factors reserve margin below the configured limits; 1 uses the full limit. Merge difference combines nearby generated speed caps when their difference is small enough. Manual constraints stay under your control, as in Path Tuning.",
      target: "settings-generator",
      settingsSection: "optimizer",
    }),
    {
      title: "Tune your robot",
      body: "You have now seen the settings in menu order. When setting up your robot, match its bumper size and motion limits, then tune and validate its controllers at those limits. The Tune Your Robot guide explains that process in detail. Finish returns to your original project.",
      autoGenerate: false,
      resource: {
        label: "Read Tune Your Robot",
        href: "https://bline-docs.pages.dev/getting-started/tuning/",
      },
    },
  ],
};

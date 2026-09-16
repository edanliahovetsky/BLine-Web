import { createPathModel } from "../../core/model/path";
import { projectStore } from "../../state/projectStore";
import { feedback } from "./tourChecks";
import { practiceConfig, waypoint, translation } from "./tourScenario";
import { tourStore, type TourAction, type TourDefinition } from "./tourStore";

const present = (id: string) =>
  typeof document !== "undefined" &&
  !!document.querySelector(`[data-tour="${id}"]`);
const openSettings = ["export-menu-entry", "settings-menu-item"];
const settings = ["settings-dialog"];
function didAction(action: TourAction) {
  let token = "";
  let baseline = 0;
  return () => {
    const state = tourStore.getState();
    const currentToken = `${state.activeTourId}:${state.attemptId}:${state.stepIndex}`;
    const count = state.actions[action] ?? 0;
    if (currentToken !== token) {
      token = currentToken;
      baseline = count;
    }
    return feedback(
      count > baseline,
      "Press Play to preview the practice path.",
      "You previewed the robot with these settings.",
    );
  };
}

export const robotSettingsTour: TourDefinition = {
  id: "robot-settings",
  title: "Robot Settings",
  summary: "Set robot size and motion limits before tuning a path",
  durationMinutes: 4,
  completionMessage:
    "You can set robot dimensions and motion limits, then use the blue trace to check a path. Continue with BLine Fundamentals and Path Tuning.",
  practiceConfig,
  practicePath: () =>
    createPathModel({
      path_elements: [waypoint(3, 2), translation(7, 4), waypoint(11, 4, 90)],
    }),
  steps: [
    {
      title: "Open robot settings",
      body: "Robot settings belong to the project. Open File → Settings. This lesson uses a temporary practice project; leaving it restores your original project and settings.",
      target: "export-menu-entry",
      interact: openSettings,
      visible: settings,
      prepare: {
        inspector: "closed",
        navigator: "closed",
        tool: "select",
        simulation: "start",
        closeMenus: true,
      },
      autoGenerate: false,
      task: "Open File → Settings",
      check: () =>
        feedback(
          present("settings-dialog"),
          "Choose Settings at the bottom of File.",
          "Settings is open.",
        ),
    },
    {
      title: "Size and bumper clearance",
      body: "In Robot, enter the full outside length and width, including bumpers. These dimensions set the displayed footprint. Leave clearance around obstacles for the whole robot, not just its center. For practice, set Length to 1.0 m and Width to 0.9 m, then Save.",
      target: "settings-robot",
      interact: settings,
      autoGenerate: false,
      task: "Save a 1.0 × 0.9 m practice robot",
      check: () => {
        const robot = projectStore.getState().project?.config.gui.robot;
        return feedback(
          !present("settings-dialog") &&
            robot?.length_meters === 1 &&
            robot.width_meters === 0.9,
          "Set Robot Length to 1.0 and Robot Width to 0.9, then Save.",
          "The preview now uses the larger robot footprint.",
        );
      },
    },
    {
      title: "Points and the blue trace",
      body: "Your position points define a polyline: straight segments from point to point. The blue trace is simulated robot motion through those points, not an authored spline. Handoffs, speed, acceleration and rotation limits affect that motion. Press Play and watch the robot footprint as well as its center.",
      target: "path-canvas",
      interact: ["simulation-transport", "transport-timeline"],
      prepare: { simulation: "start" },
      autoGenerate: false,
      task: "Play the practice path",
      check: didAction("play"),
    },
    {
      title: "Find motion limits",
      body: "Open File → Settings again and choose Path Defaults. These defaults apply where the path has no explicit override. Use measured limits that your robot can achieve.",
      target: "export-menu-entry",
      interact: [...openSettings, ...settings],
      visible: settings,
      prepare: { closeMenus: true, simulation: "start" },
      autoGenerate: false,
      task: "Open Path Defaults",
      check: () =>
        feedback(
          present("settings-path-defaults"),
          "Open Settings, then choose Path Defaults.",
          "The translation and rotation limits are here.",
        ),
    },
    {
      title: "Speed, acceleration and turning",
      body: "Max Velocity limits travel speed. Max Accel limits how quickly velocity changes, including through a turn. Rot Vel and Rot Accel limit heading changes; slower turning needs more time. For practice, set them to 2 m/s, 2 m/s², 180 deg/s and 360 deg/s², then Save.",
      target: "settings-path-defaults",
      interact: settings,
      autoGenerate: false,
      task: "Save the four practice motion limits",
      check: () => {
        const limits =
          projectStore.getState().project?.config.kinematic_constraints;
        return feedback(
          !present("settings-dialog") &&
            limits?.default_max_velocity_meters_per_sec === 2 &&
            limits.default_max_acceleration_meters_per_sec2 === 2 &&
            limits.default_max_velocity_deg_per_sec === 180 &&
            limits.default_max_acceleration_deg_per_sec2 === 360,
          "Set Max Velocity 2, Max Accel 2, Rot Vel 180 and Rot Accel 360, then Save.",
          "The preview now uses your new motion limits.",
        );
      },
    },
    {
      title: "Preview the new settings",
      body: "Press Play again. The same authored points now produce motion using the new limits. Robot dimensions change the footprint used to judge bumper clearance; they do not automatically route the center around obstacles.",
      target: "path-canvas",
      interact: ["simulation-transport", "transport-timeline"],
      prepare: { simulation: "start" },
      autoGenerate: false,
      task: "Play with the new limits",
      check: didAction("play"),
    },
    {
      title: "Generate using your robot settings",
      body: "Automatic generation uses motion limits to choose speed caps and handoff radii. Set your robot limits first, then Generate and inspect the blue trace. Manual constraints stay under your control. Generation is a modeled starting point; check the full footprint for clearance and test on your robot.",
      target: "max-velocity-card",
      interact: ["max-velocity-card", "simulation-transport"],
      prepare: {
        inspector: "open",
        inspectorTab: "constraints",
        simulation: "start",
      },
      autoGenerate: false,
      task: "Generate the practice constraints",
      check: () =>
        feedback(
          projectStore
            .getState()
            .project?.paths.some((path) =>
              path.path.ranged_constraints.some(
                (c) =>
                  c.source === "auto_velocity" &&
                  !!c.auto_velocity?.input_signature,
              ),
            ) ?? false,
          "Press Generate in the constraints panel.",
          "Generated values now reflect the practice robot's motion limits.",
        ),
    },
    {
      title: "Next: deeper tuning",
      body: "BLine Fundamentals introduces the path elements. Path Tuning goes deeper into handoff radii, automatic and manual speed caps, and checking clearance. Start from measured robot settings, compare the blue trace with your intended route, then tune and test. Finish to restore your original project.",
      target: "path-canvas",
      interact: ["simulation-transport", "transport-timeline"],
      prepare: { inspector: "closed", simulation: "start" },
      autoGenerate: false,
    },
  ],
};

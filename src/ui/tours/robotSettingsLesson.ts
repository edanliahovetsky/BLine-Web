import {
  createProjectConfig,
  type CanonicalProjectConfig,
} from "../../core/config/projectConfig";
import {
  createPathModel,
  isEventTrigger,
  isTranslationTarget,
} from "../../core/model/path";
import {
  activePathForProjectStore,
  projectStore,
} from "../../state/projectStore";
import { autoVelocityStore } from "../../state/autoVelocityStore";
import { feedback } from "./tourChecks";
import { createEventLessonPath } from "./courseScenarios";
import { observedTourCondition } from "./tourInteraction";
import { waypoint, translation } from "./tourScenario";
import { tourStore, type TourDefinition, type TourStep } from "./tourStore";

const settings = (step: TourStep): TourStep => ({
  autoGenerate: false,
  visible: ["settings-dialog"],
  interact: [step.target ?? "settings-dialog"],
  ...step,
});
const config = () =>
  projectStore.getState().project?.config ?? createProjectConfig();
const configTask =
  (
    condition: (value: CanonicalProjectConfig) => boolean,
    instruction: string,
  ) =>
  () =>
    feedback(condition(config()), instruction, "Ready to continue.");
const closeTo = (value: number, expected: number) =>
  Math.abs(value - expected) < 0.005;
const navigation = (
  section: NonNullable<TourStep["settingsSection"]>,
  from: NonNullable<TourStep["settingsSection"]>,
  label: string,
): TourStep =>
  settings({
    title: `Open ${label}`,
    body: `Choose ${label} in File → Settings. This sublesson uses a fresh practice project and restores your own project when you finish.`,
    target: `settings-nav-${section}`,
    settingsSection: section,
    settingsNavigateFrom: from,
    interact: ["settings-nav"],
    prepare: {
      inspector: "closed",
      navigator: "closed",
      simulation: "start",
      closeMenus: true,
    },
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

// Require a new playback after entering/restarting each observation step.
function playedThrough() {
  let token = "";
  let baseline = 0;
  return () => {
    const state = tourStore.getState();
    const currentToken = `${state.activeTourId}:${state.attemptId}:${state.stepIndex}`;
    const runs = state.actions.finishRun ?? 0;
    if (currentToken !== token) {
      token = currentToken;
      baseline = runs;
    }
    return feedback(
      runs > baseline,
      "Press Play and let the robot reach End.",
      "You watched the complete path.",
    );
  };
}
const canvas = (step: TourStep): TourStep => ({
  autoGenerate: false,
  visible: ["path-canvas"],
  interact: ["simulation-transport", "path-canvas"],
  prepare: { inspector: "closed", tool: "select", simulation: "start" },
  ...step,
});
function eventPlaced(key: string, segment: number, ratio: number) {
  const path = activePathForProjectStore(projectStore.getState())?.path;
  if (!path) return false;
  const bend = path.path_elements.findIndex(isTranslationTarget);
  return path.path_elements.some(
    (element, index) =>
      isEventTrigger(element) &&
      element.lib_key.trim() === key &&
      (segment === 1
        ? index > 0 && index < bend
        : index > bend && index < path.path_elements.length - 1) &&
      Math.abs(element.t_ratio - ratio) < 0.015,
  );
}
function addEvent(key: string, segment: number, ratio: number): TourStep[] {
  const eventCount = () =>
    activePathForProjectStore(
      projectStore.getState(),
    )?.path.path_elements.filter(isEventTrigger).length ?? 0;
  return [
    canvas({
      title:
        segment === 1 ? "Place the extend event" : "Place the retract event",
      body: `Choose Event and place a trigger ${segment === 1 ? "between Start and the translation target" : "between the translation target and End"}. We’ll set its key and exact position next.`,
      target: "tool-event",
      interact: ["path-canvas", "tool-event", "tool-select"],
      prepare: {
        inspector: "closed",
        tool: "select",
        simulation: "start",
        clearSelection: true,
      },
      task: "Place an event on the path",
      lockInteractionOnComplete: true,
      check: () =>
        feedback(
          eventCount() === segment,
          "Choose Event and click the path segment.",
          "The event is placed.",
        ),
    }),
    canvas({
      title: segment === 1 ? "Set the extend event" : "Set the retract event",
      body: `Set Lib Key to ${key} and Event Pos to ${ratio}. ${segment === 1 ? "This matches the Show On Event Key you configured." : "This matches Hide On Event Keys, so the intake retracts before End."}`,
      target: "element-properties",
      visible: ["path-canvas", "element-properties"],
      interact: ["inspector-panel", "element-properties"],
      prepare: {
        inspector: "open",
        inspectorTab: "elements",
        tool: "select",
        simulation: "start",
        selectElement: (path) =>
          path.path_elements.flatMap((element, index) =>
            isEventTrigger(element) ? [index] : [],
          )[segment - 1] ?? 0,
      },
      task: `Set ${key} to ${ratio} on segment ${segment}`,
      check: () =>
        feedback(
          eventPlaced(key, segment, ratio) &&
            (segment === 1 || eventPlaced("startIntake", 1, 0.3)),
          `Set ${key} on segment ${segment} at Event Pos ${ratio}. If you placed it on the wrong segment, go Back and restart the placement step.`,
          `${key} is ready.`,
        ),
    }),
  ];
}

const practiceSettingsPath = () =>
  createPathModel({
    path_elements: [waypoint(3, 2), translation(7, 4), waypoint(11, 4, 90)],
  });
function openControl(selector: string, waiting: string) {
  const opened = observedTourCondition(
    () => !!document.querySelector(selector),
  );
  return () => feedback(opened(), waiting, "Ready to continue.");
}

export const robotSettingsTour: TourDefinition = {
  id: "robot-settings",
  title: "Robot",
  summary: "Set bumper dimensions and animate protrusions with events",
  durationMinutes: 4,
  completionMessage:
    "You configured the robot footprint and animated an extension with event triggers.",
  practiceConfig: createProjectConfig,
  practicePath: practiceSettingsPath,
  steps: [
    settings({
      title: "Robot size",
      body: "Open File → Settings → Robot to set your bumper size and protrusions. This practice project starts with the normal defaults. Robot Length and Width are the outside bumper dimensions shown on the field. Set Length to 0.8 m and Width to 1.2 m, then look at the changed footprint.",
      target: "settings-size",
      settingsSection: "robot",
      prepare: {
        inspector: "closed",
        navigator: "closed",
        tool: "select",
        simulation: "start",
        closeMenus: true,
      },
      task: "Set the bumper size to 0.8 × 1.2 m",
      check: configTask(
        (c) =>
          closeTo(c.gui.robot.length_meters, 0.8) &&
          closeTo(c.gui.robot.width_meters, 1.2),
        "Set Robot Length to 0.8 and Robot Width to 1.2.",
      ),
    }),
    canvas({
      title: "See the bumper size",
      body: "The robot is now wider than it is long. Press Play to see that 0.8 × 1.2 m bumper footprint move along the path. These dimensions help you judge clearance; they do not change the path’s coordinates.",
      target: "simulation-transport",
      task: "Play the resized robot’s path",
      check: playedThrough(),
    }),
    settings({
      title: "Enable protrusions",
      body: "Back in Robot, protrusions represent mechanisms that extend beyond the bumpers, such as an intake. Turn on Enable Protrusions to configure one.",
      target: "settings-protrusions",
      settingsSection: "robot",
      task: "Turn on Enable Protrusions",
      check: configTask(
        (c) => c.gui.protrusions.enabled,
        "Turn on Enable Protrusions.",
      ),
    }),
    settings({
      title: "Set up the extension",
      body: "Distance is the reach beyond the bumpers; Side is the robot edge it extends from. Set Distance to 0.3 m and Side to front. Choose hidden for Default Protrusion State so the intake starts retracted.",
      target: "settings-protrusions",
      settingsSection: "robot",
      task: "Set 0.3 m, front, and hidden",
      check: configTask(
        (c) =>
          c.gui.protrusions.enabled &&
          closeTo(c.gui.protrusions.distance_meters, 0.3) &&
          c.gui.protrusions.side === "front" &&
          c.gui.protrusions.default_state === "hidden",
        "Set Distance to 0.3, Side to front, and Default State to hidden.",
      ),
    }),
    settings({
      title: "Connect the event keys",
      body: "Use + beside Show On Event Keys to add startIntake, then + beside Hide On Event Keys to add stopIntake. Each key has its own field; type a registered key’s prefix and press Tab to complete it, or choose from the suggestions. The ⋯ menu renames, duplicates, or removes that assignment. These lists control the preview extension; your robot code still handles what each event does.",
      target: "settings-protrusions",
      settingsSection: "robot",
      task: "Connect startIntake and stopIntake",
      check: configTask(
        (c) =>
          c.gui.protrusions.show_on_event_keys.includes("startIntake") &&
          c.gui.protrusions.hide_on_event_keys.includes("stopIntake") &&
          !c.gui.protrusions.show_on_event_keys.includes("stopIntake") &&
          !c.gui.protrusions.hide_on_event_keys.includes("startIntake"),
        "Enter startIntake under Show and stopIntake under Hide.",
      ),
    }),
    ...addEvent("startIntake", 1, 0.3),
    ...addEvent("stopIntake", 2, 0.7),
    canvas({
      title: "Watch the intake extend and retract",
      body: "Press Play. The intake starts hidden, extends at startIntake, and retracts at stopIntake. Watch the front edge of the moving robot as it crosses each event.",
      target: "simulation-transport",
      task: "Play through both events",
      check: playedThrough(),
    }),
  ],
};

export const pathDefaultsSettingsTour: TourDefinition = {
  id: "settings-path-defaults",
  title: "Path Defaults",
  summary: "Set default motion limits and end tolerances",
  durationMinutes: 2,
  completionMessage:
    "You explored the default motion limits and the tolerances for finishing a path.",
  practiceConfig: createProjectConfig,
  practicePath: practiceSettingsPath,
  steps: [
    navigation("path-defaults", "robot", "Path Defaults"),
    settings({
      title: "Translation defaults",
      body: "Match Max Velocity and Max Accel to your robot’s real limits as closely as possible. They also limit the generator’s output. They are fallback values wherever a path leaves a limit unspecified; explicit path constraints can override them. For this practice robot, try 4 m/s and 8 m/s². Handoff Radius supplies the intermediate radius when one is unspecified, as in Path Tuning.",
      target: "settings-translation",
      settingsSection: "path-defaults",
      task: "Try 4 m/s and 8 m/s²",
      check: configTask(
        (c) =>
          closeTo(
            c.kinematic_constraints.default_max_velocity_meters_per_sec,
            4,
          ) &&
          closeTo(
            c.kinematic_constraints.default_max_acceleration_meters_per_sec2,
            8,
          ),
        "Set Default Max Velocity to 4 and Default Max Accel to 8.",
      ),
    }),
    settings({
      title: "Rotation defaults",
      body: "Max Rot Vel and Max Rot Accel are the corresponding heading limits, in degrees per second and degrees per second squared. Match your robot’s turning capability. They also guide generation where no path constraint overrides them. You can try different values here; the rotation-target behavior is the same as in the earlier lesson.",
      target: "settings-rotation",
      settingsSection: "path-defaults",
    }),
    settings({
      title: "End tolerance",
      body: "End Translation Tolerance and End Rotation Tolerance say how close the robot must be to its final position and heading for the path to finish. Smaller values demand more precise alignment. These concern End; intermediate targets use their handoff radii. Keep the defaults or try adjusting them.",
      target: "settings-end-tolerance",
      settingsSection: "path-defaults",
    }),
  ],
};

export const fieldSettingsTour: TourDefinition = {
  id: "settings-field",
  title: "Field",
  summary: "Choose field images and resize a blank practice grid",
  durationMinutes: 2,
  completionMessage:
    "You changed the field image, resized a blank grid, and learned how custom images are scaled.",
  practiceConfig: createProjectConfig,
  practicePath: practiceSettingsPath,
  steps: [
    navigation("field", "robot", "Field"),
    settings({
      title: "Choose a competition field",
      body: "Field Image selects the background for a competition year. Built-in fields are already scaled to meters. Choose Reefscape 2025 to try a different year; in your project, choose the field you’re using.",
      target: "settings-field-image",
      settingsSection: "field",
      task: "Choose Reefscape 2025",
      check: configTask(
        (c) => c.gui.field.selected_field_id === "frc2025-reefscape",
        "Choose Reefscape 2025 in Field Image.",
      ),
    }),
    canvas({
      title: "See the new field",
      body: "The background has changed to Reefscape while your path keeps its meter coordinates. A different field image does not move the targets or check whether your route avoids that year’s obstacles.",
      target: "path-canvas",
    }),
    settings({
      title: "Try the blank grid",
      body: "Blank Meter Grid gives you a neutral space for planning or practice. Its lines are one meter apart. Choose it in Field Image, then we’ll resize the space.",
      target: "settings-field-image",
      settingsSection: "field",
      task: "Choose Blank Meter Grid",
      check: configTask(
        (c) => c.gui.field.selected_field_id === "blank-grid",
        "Choose Blank Meter Grid in Field Image.",
      ),
    }),
    settings({
      title: "Resize the grid",
      body: "Field Length is the horizontal span and Field Width is the vertical span. Set Length to 12 m and Width to 6 m. These dimensions resize the grid without scaling the robot or changing path coordinates.",
      target: "settings-field-geometry",
      settingsSection: "field",
      task: "Make a 12 × 6 m practice space",
      check: configTask(
        (c) =>
          closeTo(c.gui.field.grid_size_meters?.length_meters ?? 18, 12) &&
          closeTo(c.gui.field.grid_size_meters?.width_meters ?? 9, 6),
        "Set Field Length to 12 and Field Width to 6.",
      ),
    }),
    canvas({
      title: "See the resized grid",
      body: "Your practice space is now 12 × 6 m. The path still uses the same coordinates, and each grid square is still one meter. This is useful for a smaller practice area.",
      target: "path-canvas",
    }),
    settings({
      title: "Custom field images",
      body: "For your own practice space, Upload Image adds a background. Give it a name and set its full image length and width in meters. Padding X and Y describe margins between the image edges and the usable field coordinates. You don’t need to upload an image for this lesson.",
      target: "settings-field",
      settingsSection: "field",
    }),
  ],
};

export const generatorSettingsTour: TourDefinition = {
  id: "settings-generator",
  title: "Generator",
  summary: "Adjust safety factors and control automatic generation",
  durationMinutes: 2,
  completionMessage: "You explored generator factors and automatic updates.",
  practiceConfig: createProjectConfig,
  practicePath: practiceSettingsPath,
  steps: [
    navigation("optimizer", "robot", "Generator"),
    settings({
      title: "Generator factors",
      body: "Velocity and Acceleration safety factors reserve margin below the applicable motion limits. A factor of 1 uses the full limit; 0.9 uses 90%. Merge difference combines nearby generated speed caps when their difference is within that many m/s; a larger value produces fewer distinct caps. Try 0.9 for the Velocity safety factor.",
      target: "settings-generator",
      settingsSection: "optimizer",
      task: "Try a velocity safety factor of 0.9",
      check: configTask(
        (c) =>
          closeTo(
            c.kinematic_constraints
              .default_auto_velocity_velocity_safety_factor,
            0.9,
          ),
        "Set Velocity safety factor to 0.9.",
      ),
    }),
    settings({
      title: "Keep generation in sync",
      body: "Keep in sync updates automatic radii and velocity caps as you edit the path or its limits. With it off, use Generate when you want fresh values. Manual constraints stay under your control. Turn sync off to try manual generation mode.",
      target: "settings-generator",
      settingsSection: "optimizer",
      task: "Turn Keep in sync off",
      check: () =>
        feedback(
          !autoVelocityStore.getState().autoSyncEnabled,
          "Turn Keep in sync off.",
          "Automatic updates are paused.",
        ),
    }),
    settings({
      title: "Restore automatic updates",
      body: "Turn Keep in sync back on for automatic generation while editing. These practice settings stay inside this lesson; finishing restores your own project and preferences.",
      target: "settings-generator",
      settingsSection: "optimizer",
      autoGenerate: undefined,
      task: "Turn Keep in sync on",
      check: () =>
        feedback(
          autoVelocityStore.getState().autoSyncEnabled,
          "Turn Keep in sync on.",
          "Automatic updates are enabled.",
        ),
    }),
    settings({
      title: "Tune your robot",
      body: "You’ve explored the generator’s safety factors and sync controls. For your real robot, use its bumper dimensions and measured motion limits, then tune and validate its controllers. Tune Your Robot explains that process in detail. Finish returns to your original project.",
      settingsSection: "optimizer",
      resource: {
        label: "Read Tune Your Robot",
        href: "https://bline-docs.pages.dev/getting-started/tuning/",
      },
    }),
  ],
};

export const eventTriggerSettingsTour: TourDefinition = {
  id: "settings-event-triggers",
  title: "Event Triggers",
  summary: "Register, find, and manage reusable Lib Keys",
  durationMinutes: 2,
  completionMessage:
    "You registered a reusable key and explored project-wide rename, duplicate, and clear actions.",
  practiceConfig: createProjectConfig,
  practicePath: createEventLessonPath,
  steps: [
    {
      title: "Open the trigger manager",
      body: "Lib Keys belong to the project, so you can reuse them across its paths. Open Event Triggers in File → Settings to manage them. This practice path already uses startIntake, so it appears automatically.",
      target: "settings-nav-event-triggers",
      settingsSection: "event-triggers",
      autoGenerate: false,
      settingsNavigateFrom: "robot",
      visible: ["settings-dialog"],
      interact: ["settings-nav"],
      prepare: {
        inspector: "closed",
        simulation: "start",
        closeMenus: true,
      },
      task: "Open Event Triggers",
      check: openControl(
        '[data-tour="settings-nav-event-triggers"][aria-current="page"]',
        "Choose Event Triggers in the settings menu.",
      ),
    },
    {
      title: "Register a Lib Key",
      body: "Click +, enter stopIntake, and confirm with the checkmark. Registering a key makes it available in the inspector without adding an event to the path. In your own project, click Save when you finish in Settings; this lesson applies edits to its practice project as you go.",
      target: "settings-event-triggers",
      settingsSection: "event-triggers",
      autoGenerate: false,
      visible: ["settings-dialog"],
      interact: ["settings-event-triggers"],
      task: "Register stopIntake",
      check: () =>
        feedback(
          config().gui.event_trigger_keys?.includes("stopIntake") ?? false,
          "Click +, enter stopIntake, then click the checkmark.",
          "stopIntake is ready to reuse.",
        ),
    },
    {
      title: "Find a registered key",
      body: "Type stop into the search field beside the magnifying glass. The list filters as you type. Each row shows how many event trigger elements use its key across this project's paths; stopIntake has no uses yet.",
      target: "settings-event-triggers",
      settingsSection: "event-triggers",
      autoGenerate: false,
      visible: ["settings-dialog"],
      interact: ["settings-event-triggers"],
      task: "Search for stop",
      check: () =>
        feedback(
          document
            .querySelector<HTMLInputElement>(
              '[aria-label="Search event triggers"]',
            )
            ?.value.trim()
            .toLowerCase() === "stop",
          "Type stop in the search field.",
          "The list now shows matching keys.",
        ),
    },
    {
      title: "Manage registered keys",
      body: "Open the ⋯ menu beside stopIntake. Rename All replaces that key in every path and protrusion setting in the project. Duplicate registers a new key without copying event elements. Delete removes the registration and clears matching Lib Keys, leaving the event elements in place. These edits can be undone. In the inspector, type part of a registered key and press Tab, or choose a suggestion with the arrow keys or pointer.",
      target: "settings-event-triggers",
      settingsSection: "event-triggers",
      autoGenerate: false,
      visible: ["settings-dialog"],
      interact: ["settings-event-triggers"],
      task: "Open the key's action menu",
      check: openControl(
        '[aria-label="Event trigger actions for stopIntake"][aria-expanded="true"]',
        "Click the ⋯ button beside stopIntake.",
      ),
    },
  ],
};

export const settingsTours: readonly TourDefinition[] = [
  robotSettingsTour,
  pathDefaultsSettingsTour,
  fieldSettingsTour,
  generatorSettingsTour,
  eventTriggerSettingsTour,
];

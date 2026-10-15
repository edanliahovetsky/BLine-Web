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
import { feedback, withEventKeyCaseHint } from "./tourChecks";
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
const configCheck = (
  label: string,
  condition: (value: CanonicalProjectConfig) => boolean,
  hint: string,
) => ({ label, check: () => feedback(condition(config()), hint, "") });
const closeTo = (value: number, expected: number) =>
  Math.abs(value - expected) < 0.005;
const navigation = (
  section: NonNullable<TourStep["settingsSection"]>,
  from: NonNullable<TourStep["settingsSection"]>,
  label: string,
): TourStep =>
  settings({
    title: `Open ${label}`,
    body: `Choose ${label} in the Settings menu. This lesson uses a practice project and restores yours when you finish.`,
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
function segmentEvents(segment: number) {
  const path = activePathForProjectStore(projectStore.getState())?.path;
  if (!path) return [];
  const bend = path.path_elements.findIndex(isTranslationTarget);
  return path.path_elements.flatMap((element, index) =>
    isEventTrigger(element) &&
    (segment === 1
      ? index > 0 && index < bend
      : index > bend && index < path.path_elements.length - 1)
      ? [element]
      : [],
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
      body: `Choose Event and click the segment ${segment === 1 ? "between Start and the translation target" : "between the translation target and End"}. You’ll set its key and position next.`,
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
      body: `Set Lib Key to \`${key}\` and Event Pos to ${ratio}. ${segment === 1 ? "That key matches the Show list you set up." : "That key matches the Hide list, so the intake retracts before End."}`,
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
      task: `Set \`${key}\` at ${ratio} on segment ${segment}`,
      checks: [
        {
          label: `Lib Key \`${key}\``,
          check: () => {
            const keys = segmentEvents(segment).map((event) => event.lib_key);
            return withEventKeyCaseHint(
              feedback(
                keys.some((typed) => typed.trim() === key),
                segmentEvents(segment).length
                  ? `Click \`${key}\` to fill the Lib Key field.`
                  : `The event isn’t on segment ${segment}. Go Back and use Restart step.`,
                "",
              ),
              keys,
              [key],
            );
          },
        },
        {
          label: `Event Pos ${ratio}`,
          check: () =>
            feedback(
              eventPlaced(key, segment, ratio) ||
                segmentEvents(segment).some(
                  (event) => Math.abs(event.t_ratio - ratio) < 0.015,
                ),
              `Type ${ratio} in Event Pos.`,
              "",
            ),
        },
      ],
      check: () =>
        feedback(
          eventPlaced(key, segment, ratio) &&
            (segment === 1 || eventPlaced("startIntake", 1, 0.3)),
          "Keep the first event as it was.",
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
  eventKeys: ["startIntake", "stopIntake"],
  durationMinutes: 4,
  recap: [
    "Robot Length and Width set the bumper footprint drawn on the field.",
    "Protrusions show a mechanism extending and retracting at the event keys you list.",
  ],
  practiceConfig: createProjectConfig,
  practicePath: practiceSettingsPath,
  steps: [
    settings({
      title: "Robot size",
      body: "Robot Length and Width are the outside bumper dimensions drawn on the field. Set Length to 0.9 m and Width to 1.2 m.",
      why: "This practice project starts with the default robot, so your own settings are untouched.",
      target: "settings-size",
      settingsSection: "robot",
      prepare: {
        inspector: "closed",
        navigator: "closed",
        tool: "select",
        simulation: "start",
        closeMenus: true,
      },
      task: "Set the bumper size to 0.9 × 1.2 m",
      checks: [
        configCheck(
          "Length 0.9 m",
          (c) => closeTo(c.gui.robot.length_meters, 0.9),
          "Type 0.9 in Robot Length.",
        ),
        configCheck(
          "Width 1.2 m",
          (c) => closeTo(c.gui.robot.width_meters, 1.2),
          "Type 1.2 in Robot Width.",
        ),
      ],
    }),
    canvas({
      title: "See the bumper size",
      body: "The robot is now wider than it is long. Play the path to watch the 0.9 × 1.2 m footprint move.",
      why: "Bumper size helps you judge clearance; it doesn’t change the path’s coordinates.",
      target: "simulation-transport",
      task: "Play the resized robot’s path",
      check: playedThrough(),
    }),
    settings({
      title: "Enable protrusions",
      body: "Protrusions are mechanisms that reach past the bumpers, such as an intake. Turn on Enable Protrusions to set one up.",
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
      body: "Set Distance to 0.3 m and Side to Front, then choose Hidden for Default Protrusion State so the intake starts retracted.",
      why: "Distance is how far the mechanism reaches past the bumpers; Side is the robot edge it extends from.",
      target: "settings-protrusions",
      settingsSection: "robot",
      task: "Set 0.3 m, Front, and Hidden",
      checks: [
        configCheck(
          "Distance 0.3 m",
          (c) => closeTo(c.gui.protrusions.distance_meters, 0.3),
          "Type 0.3 in Distance.",
        ),
        configCheck(
          "Side: Front",
          (c) => c.gui.protrusions.side === "front",
          "Choose Front in Side.",
        ),
        configCheck(
          "Starts Hidden",
          (c) => c.gui.protrusions.default_state === "hidden",
          "Choose Hidden in Default Protrusion State.",
        ),
      ],
    }),
    settings({
      title: "Connect the event keys",
      body: "Click + beside Show On Event Keys and add `startIntake`. Then click + beside Hide On Event Keys and add `stopIntake`.",
      why: "These lists only drive the preview. Your robot code still decides what each event does. The ⋯ menu beside a key renames, duplicates, or removes it.",
      target: "settings-protrusions",
      settingsSection: "robot",
      task: "Connect `startIntake` and `stopIntake`",
      checks: (
        [
          ["Show on `startIntake`", "show_on_event_keys", "startIntake"],
          ["Hide on `stopIntake`", "hide_on_event_keys", "stopIntake"],
        ] as const
      ).map(([label, list, key]) => ({
        label,
        check: () => {
          const { protrusions } = config().gui;
          const other =
            list === "show_on_event_keys"
              ? protrusions.hide_on_event_keys
              : protrusions.show_on_event_keys;
          return withEventKeyCaseHint(
            feedback(
              protrusions[list].includes(key) && !other.includes(key),
              `Click + beside ${list === "show_on_event_keys" ? "Show" : "Hide"} On Event Keys and click \`${key}\`.`,
              "",
            ),
            protrusions[list],
            [key],
          );
        },
      })),
    }),
    ...addEvent("startIntake", 1, 0.3),
    ...addEvent("stopIntake", 2, 0.7),
    canvas({
      title: "Watch the intake extend and retract",
      body: "The intake starts hidden, extends at `startIntake`, and retracts at `stopIntake`. Watch the robot’s front edge as it crosses each event.",
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
  recap: [
    "Path Defaults set motion limits wherever a path sets none of its own.",
    "End tolerances decide how precisely the robot must finish.",
  ],
  practiceConfig: createProjectConfig,
  practicePath: practiceSettingsPath,
  steps: [
    navigation("path-defaults", "robot", "Path Defaults"),
    settings({
      title: "Translation defaults",
      body: "Max Velocity and Max Accel apply wherever a path sets no limit of its own. Match your robot’s real limits; for this practice robot, try 4 m/s and 8 m/s².",
      why: "They also cap what Generate suggests. Handoff Radius fills in any intermediate radius a path leaves unset, as in Path Tuning.",
      target: "settings-translation",
      settingsSection: "path-defaults",
      task: "Try 4 m/s and 8 m/s²",
      checks: [
        configCheck(
          "Max Velocity 4 m/s",
          (c) =>
            closeTo(
              c.kinematic_constraints.default_max_velocity_meters_per_sec,
              4,
            ),
          "Type 4 in Max Velocity.",
        ),
        configCheck(
          "Max Accel 8 m/s²",
          (c) =>
            closeTo(
              c.kinematic_constraints.default_max_acceleration_meters_per_sec2,
              8,
            ),
          "Type 8 in Max Accel.",
        ),
      ],
    }),
    settings({
      title: "Rotation defaults",
      body: "Max Rot Vel and Max Rot Accel are the matching heading limits, in degrees per second and per second squared. Match your robot’s turning ability.",
      target: "settings-rotation",
      settingsSection: "path-defaults",
    }),
    settings({
      title: "End tolerance",
      body: "End Translation and Rotation Tolerance set how close the robot must get to its final position and heading to finish. Smaller values demand more precise alignment.",
      why: "They apply only at End; intermediate targets use their handoff radii.",
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
  recap: [
    "Field Image changes the background without moving your path.",
    "A blank grid can be resized to match your practice space.",
  ],
  practiceConfig: createProjectConfig,
  practicePath: practiceSettingsPath,
  steps: [
    navigation("field", "robot", "Field"),
    settings({
      title: "Choose a competition field",
      body: "Field Image sets the background for a competition year, already scaled to meters. Choose Reefscape 2025 to try one.",
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
      body: "The background is now Reefscape, and your path keeps its coordinates in meters.",
      why: "A new field image doesn’t move your targets or check them against that year’s obstacles.",
      target: "path-canvas",
    }),
    settings({
      title: "Try the blank grid",
      body: "Blank Meter Grid gives you a neutral space with lines one meter apart. Choose it in Field Image.",
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
      body: "Field Length is the horizontal span and Field Width the vertical one. Set them to 12 m and 6 m.",
      why: "Resizing the grid doesn’t scale the robot or change path coordinates.",
      target: "settings-field-geometry",
      settingsSection: "field",
      task: "Make a 12 × 6 m practice space",
      checks: [
        configCheck(
          "Length 12 m",
          (c) => closeTo(c.gui.field.grid_size_meters?.length_meters ?? 18, 12),
          "Type 12 in Field Length.",
        ),
        configCheck(
          "Width 6 m",
          (c) => closeTo(c.gui.field.grid_size_meters?.width_meters ?? 9, 6),
          "Type 6 in Field Width.",
        ),
      ],
    }),
    canvas({
      title: "See the resized grid",
      body: "Your practice space is now 12 × 6 m. Each square is still one meter, and the path keeps its coordinates.",
      target: "path-canvas",
    }),
    settings({
      title: "Custom field images",
      body: "Upload Image adds your own background. Give it a name and its full length and width in meters. You don’t need to upload one now.",
      why: "Padding X and Y are the margins between the image edges and the usable field coordinates.",
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
  recap: [
    "Safety factors keep generated values below your robot’s limits.",
    "Keep in sync regenerates as you edit; Manual values are never changed.",
  ],
  practiceConfig: createProjectConfig,
  practicePath: practiceSettingsPath,
  steps: [
    navigation("optimizer", "robot", "Generator"),
    settings({
      title: "Generator factors",
      body: "Safety factors keep generated values below your limits: 1 uses the full limit, 0.9 uses 90%. Try 0.9 for the Velocity safety factor.",
      why: "Merge difference combines nearby generated speed caps within that many m/s, so a larger value gives fewer distinct caps.",
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
      body: "Keep in sync updates generated radii and speed caps as you edit. With it off, click Generate when you want fresh values. Turn it off.",
      why: "Manual constraints are never changed by generation either way.",
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
      body: "Turn Keep in sync back on. These practice settings stay inside the lesson; finishing restores your own project and preferences.",
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
      body: "For your real robot, use its bumper size and measured motion limits, then tune its controllers. Tune Your Robot walks through it.",
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
  recap: [
    "Registered Lib Keys are suggested in every path of the project.",
    "The ⋯ menu renames, duplicates, or deletes a key project-wide.",
  ],
  practiceConfig: createProjectConfig,
  practicePath: createEventLessonPath,
  steps: [
    {
      title: "Open the trigger manager",
      body: "Lib Keys belong to the project, so every path can reuse them. Open Event Triggers to manage them; `startIntake` is listed because this path uses it.",
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
      body: "Click +, type `stopIntake`, and click the checkmark. A registered key is suggested in the inspector before any event uses it.",
      why: "In your own project, click Save when you leave Settings. This lesson applies edits to its practice project as you go.",
      target: "settings-event-triggers",
      settingsSection: "event-triggers",
      autoGenerate: false,
      visible: ["settings-dialog"],
      interact: ["settings-event-triggers"],
      task: "Register `stopIntake`",
      check: () => {
        const keys = config().gui.event_trigger_keys ?? [];
        // A case variant blocks adding the right key, so point at the fix.
        const variant = keys.find(
          (key) =>
            key !== "stopIntake" && key.toLocaleLowerCase() === "stopintake",
        );
        return !keys.includes("stopIntake") && variant
          ? {
              complete: false,
              message: `Keys are case-sensitive — you registered "${variant}". Open its ⋯ menu, choose Rename All, and change it to "stopIntake".`,
            }
          : feedback(
              keys.includes("stopIntake"),
              "Click +, enter stopIntake, then click the checkmark.",
              "stopIntake is ready to reuse.",
            );
      },
    },
    {
      title: "Find a registered key",
      body: "Type stop in the search field. The list filters as you type, and each row counts the events using its key.",
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
      body: "Open the ⋯ menu beside `stopIntake`. Rename All changes the key everywhere, Duplicate registers a copy, and Delete clears it from events. All can be undone.",
      why: "Delete removes the registration and clears matching Lib Keys, but leaves the event elements in place. In the inspector, type part of a key and press Tab to complete it.",
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

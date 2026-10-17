import {
  createProjectConfig,
  type CanonicalProjectConfig,
} from "../../core/config/projectConfig";
import {
  createPathModel,
  isEventTrigger,
  isTranslationTarget,
  type PathModel,
} from "../../core/model/path";
import {
  activePathForProjectStore,
  projectStore,
} from "../../state/projectStore";
import { autoVelocityStore } from "../../state/autoVelocityStore";
import {
  eventPosHint,
  feedback,
  firstSeen,
  withEventKeyCaseHint,
  wrongStretchHint,
} from "./tourChecks";
import { createEventLessonPath } from "./courseScenarios";
import { observedTourCondition } from "./tourInteraction";
import { waypoint, translation } from "./tourScenario";
import { tourStore, type TourDefinition, type TourStep } from "./tourStore";
import { showProperties } from "./tourShowMe";

const settings = (step: TourStep): TourStep => ({
  autoGenerate: false,
  visible: ["settings-dialog"],
  interact: [step.target ?? "settings-dialog"],
  ...step,
});
const config = () =>
  projectStore.getState().project?.config ?? createProjectConfig();
const shown = (selector: string) =>
  typeof document !== "undefined" && !!document.querySelector(selector);
const configTask =
  (condition: (value: CanonicalProjectConfig) => boolean, success = "") =>
  () =>
    feedback(condition(config()), "", success);
/** A Settings requirement; Show me points at the row named `field`. */
const configCheck = (
  label: string,
  field: string,
  condition: (value: CanonicalProjectConfig) => boolean,
  nearMiss: (value: CanonicalProjectConfig) => string = () => "",
) => ({
  label,
  showMe: [`label:${field}`],
  check: () => {
    const value = config();
    return feedback(condition(value), nearMiss(value), "");
  },
});
const closeTo = (value: number, expected: number) =>
  Math.abs(value - expected) < 0.005;
const navigation = (
  section: NonNullable<TourStep["settingsSection"]>,
  from: NonNullable<TourStep["settingsSection"]>,
  label: string,
): TourStep =>
  settings({
    title: `Open ${label}`,
    task: `Open ${label}`,
    body: "This lesson uses a practice project and restores yours when you finish.",
    target: `settings-nav-${section}`,
    settingsSection: section,
    settingsNavigateFrom: from,
    interact: ["settings-nav"],
    showMe: [{ target: `settings-nav-${section}` }],
    prepare: {
      inspector: "closed",
      navigator: "closed",
      simulation: "start",
      closeMenus: true,
    },
    check: () =>
      feedback(
        shown(`[data-tour="settings-nav-${section}"][aria-current="page"]`),
        "",
        "",
      ),
  });

// Require a new playback after entering/restarting each observation step.
function playedThrough(success: string) {
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
    return feedback(runs > baseline, "", success);
  };
}
const canvas = (step: TourStep): TourStep => ({
  autoGenerate: false,
  visible: ["path-canvas"],
  interact: ["simulation-transport", "path-canvas"],
  prepare: { inspector: "closed", tool: "select", simulation: "start" },
  ...step,
});
const currentPath = () =>
  activePathForProjectStore(projectStore.getState())?.path;
/** Element indexes bounding stretch 1 (Start to the bend) or 2 (bend to End). */
function stretch(path: PathModel, segment: 1 | 2) {
  const bend = path.path_elements.findIndex(isTranslationTarget);
  if (bend < 0) return null;
  return segment === 1
    ? ([0, bend] as const)
    : ([bend, path.path_elements.length - 1] as const);
}
function stretchEvents(segment: 1 | 2, path = currentPath()) {
  const bounds = path ? stretch(path, segment) : null;
  if (!path || !bounds) return [];
  return path.path_elements.flatMap((element, index) =>
    isEventTrigger(element) && index > bounds[0] && index < bounds[1]
      ? [{ element, index }]
      : [],
  );
}
function eventPlaced(key: string, segment: 1 | 2, ratio: number) {
  return stretchEvents(segment).some(
    ({ element }) =>
      element.lib_key.trim() === key &&
      Math.abs(element.t_ratio - ratio) < 0.015,
  );
}
/** One step: place an event on a stretch, then set its key and position. */
function addEvent(key: string, segment: 1 | 2, ratio: number): TourStep {
  const between =
    segment === 1
      ? "Start and the translation target"
      : "the translation target and End";
  const eventIndex = (path: PathModel) =>
    stretchEvents(segment, path).at(-1)?.index ?? null;
  const eventCount = () =>
    currentPath()?.path_elements.filter(isEventTrigger).length ?? 0;
  const posHint = eventPosHint();
  return canvas({
    title: segment === 1 ? "Add the extend event" : "Add the retract event",
    task: `Add \`${key}\` at ${ratio} between ${between}`,
    why:
      segment === 1
        ? "`startIntake` is on the Show list you set up, so the intake extends there."
        : "`stopIntake` is on the Hide list, so the intake retracts before End.",
    target: "tool-event",
    visible: ["path-canvas", "element-properties"],
    interact: [
      "path-canvas",
      "tool-event",
      "tool-select",
      "inspector-panel",
      "element-properties",
    ],
    // The sidebar opens once the event is placed; closed, it can’t cover the
    // canvas in a narrow window.
    prepare: {
      inspector: "closed",
      inspectorTab: "elements",
      tool: "select",
      simulation: "start",
      clearSelection: true,
    },
    segment: (path) => stretch(path, segment),
    element: eventIndex,
    checks: [
      {
        label: "Place an event there",
        showMe: [
          {
            target: "tool-event",
            done: () => shown('[data-tour="tool-event"][aria-pressed="true"]'),
          },
          "lesson-segment",
        ],
        check: () =>
          feedback(
            stretchEvents(segment).length > 0,
            eventCount() > segment - 1 ? wrongStretchHint(between) : "",
            "",
          ),
      },
      {
        label: `Lib Key \`${key}\``,
        showMe: [...showProperties(eventIndex), "lesson-lib-key"],
        check: () => {
          const keys = stretchEvents(segment)
            .map(({ element }) => element.lib_key.trim())
            .filter(Boolean);
          const wrong = keys.find((typed) => typed !== key);
          return withEventKeyCaseHint(
            feedback(
              keys.includes(key),
              wrong
                ? `This one says “${wrong}”. Click \`${key}\` to fix it.`
                : "",
              "",
            ),
            keys,
            [key],
          );
        },
      },
      {
        label: `Event Pos ${ratio}`,
        showMe: [...showProperties(eventIndex), "lesson-event-pos"],
        check: () => {
          const placed = stretchEvents(segment).at(-1);
          return feedback(
            stretchEvents(segment).some(
              ({ element }) => Math.abs(element.t_ratio - ratio) < 0.015,
            ),
            posHint(placed?.index, placed?.element.t_ratio, ratio),
            "",
          );
        },
      },
    ],
    check: () =>
      feedback(
        eventPlaced(key, segment, ratio) &&
          (segment === 1 || eventPlaced("startIntake", 1, 0.3)),
        segment === 2 ? "Keep `startIntake` at 0.3 on the first stretch." : "",
        `${key} is ready.`,
      ),
  });
}

const practiceSettingsPath = () =>
  createPathModel({
    path_elements: [waypoint(3, 2), translation(7, 4), waypoint(11, 4, 90)],
  });
function openControl(selector: string) {
  const opened = observedTourCondition(() => shown(selector));
  return () => feedback(opened(), "", "");
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
      task: "Set the bumper size to 0.9 × 1.2 m",
      body: "Length and Width are the outside bumper size.",
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
      checks: [
        configCheck(
          "Length 0.9 m",
          "Robot Length (m)",
          (c) => closeTo(c.gui.robot.length_meters, 0.9),
          (c) =>
            closeTo(c.gui.robot.length_meters, 1.2) &&
            closeTo(c.gui.robot.width_meters, 0.9)
              ? "Swap them: Length 0.9, Width 1.2."
              : "",
        ),
        configCheck("Width 1.2 m", "Robot Width (m)", (c) =>
          closeTo(c.gui.robot.width_meters, 1.2),
        ),
      ],
    }),
    canvas({
      title: "See the bumper size",
      task: "Play the resized robot’s path",
      body: "The robot is now wider than it is long. Let it run to End.",
      why: "Bumper size helps you judge clearance; it doesn’t change the path’s coordinates.",
      target: "simulation-transport",
      showMe: [{ target: "transport-play" }],
      check: playedThrough("That’s the 0.9 × 1.2 m footprint."),
    }),
    settings({
      title: "Enable protrusions",
      task: "Turn on Enable Protrusions",
      body: "A protrusion is a mechanism that reaches past the bumpers, like an intake.",
      target: "settings-protrusions",
      settingsSection: "robot",
      showMe: [{ target: "label:Enable Protrusions" }],
      check: configTask((c) => c.gui.protrusions.enabled),
    }),
    settings({
      title: "Set up the extension",
      task: "Set 0.3 m, Front, and Hidden",
      body: "This intake reaches 0.3 m out the front and starts retracted.",
      why: "Distance is how far the mechanism reaches past the bumpers; Side is the robot edge it extends from.",
      target: "settings-protrusions",
      settingsSection: "robot",
      checks: [
        configCheck("Distance 0.3 m", "Protrusion Distance (m)", (c) =>
          closeTo(c.gui.protrusions.distance_meters, 0.3),
        ),
        configCheck(
          "Side: Front",
          "Protrusion Side",
          (c) => c.gui.protrusions.side === "front",
          (c) =>
            ["back", "left", "right"].includes(c.gui.protrusions.side)
              ? `That’s the ${c.gui.protrusions.side}. Choose Front.`
              : "",
        ),
        configCheck(
          "Starts Hidden",
          "Default Protrusion State",
          (c) => c.gui.protrusions.default_state === "hidden",
        ),
      ],
    }),
    settings({
      title: "Connect the event keys",
      task: "Connect `startIntake` and `stopIntake`",
      body: "Add `startIntake` to Show On Event Keys and `stopIntake` to Hide On Event Keys.",
      why: "These lists only drive the preview. Your robot code still decides what each event does. The ⋯ menu beside a key renames, duplicates, or removes it.",
      target: "settings-protrusions",
      settingsSection: "robot",
      checks: (
        [
          ["Show on `startIntake`", "show_on_event_keys", "startIntake"],
          ["Hide on `stopIntake`", "hide_on_event_keys", "stopIntake"],
        ] as const
      ).map(([label, list, key]) => ({
        label,
        showMe: [
          {
            target: `label:Add ${list === "show_on_event_keys" ? "show" : "hide"} event key`,
            done: () =>
              shown(
                `[aria-label="${list === "show_on_event_keys" ? "Show" : "Hide"} event key 1"]`,
              ),
          },
          `label:${list === "show_on_event_keys" ? "Show" : "Hide"} event key 1`,
        ],
        check: () => {
          const { protrusions } = config().gui;
          const other =
            list === "show_on_event_keys"
              ? protrusions.hide_on_event_keys
              : protrusions.show_on_event_keys;
          return withEventKeyCaseHint(
            feedback(
              protrusions[list].includes(key) && !other.includes(key),
              other.includes(key)
                ? `\`${key}\` is on the ${list === "show_on_event_keys" ? "Hide" : "Show"} list. Remove it there.`
                : "",
              "",
            ),
            protrusions[list],
            [key],
          );
        },
      })),
    }),
    addEvent("startIntake", 1, 0.3),
    addEvent("stopIntake", 2, 0.7),
    canvas({
      title: "Watch the intake extend and retract",
      task: "Play through both events",
      body: "Watch the front edge as the robot crosses each event.",
      target: "simulation-transport",
      showMe: [{ target: "transport-play" }],
      check: playedThrough(
        "It extended at `startIntake` and retracted at `stopIntake`.",
      ),
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
      task: "Try 4 m/s and 8 m/s²",
      body: "Paths use these wherever they set no limit of their own.",
      why: "Match your robot’s real limits. They also cap what Generate suggests. Default Handoff Distance fills any handoff radius a path leaves unset.",
      target: "settings-translation",
      settingsSection: "path-defaults",
      checks: [
        configCheck("Max Velocity 4 m/s", "Default Max Velocity (m/s)", (c) =>
          closeTo(
            c.kinematic_constraints.default_max_velocity_meters_per_sec,
            4,
          ),
        ),
        configCheck("Max Accel 8 m/s²", "Default Max Accel (m/s2)", (c) =>
          closeTo(
            c.kinematic_constraints.default_max_acceleration_meters_per_sec2,
            8,
          ),
        ),
      ],
    }),
    settings({
      title: "Rotation and end limits",
      body: "Rotation limits work the same way, in degrees. End tolerances set how close to End’s position and rotation the robot must finish.",
      why: "End tolerances apply only at End; points along the way use their handoff radii.",
      target: "settings-rotation",
      visible: ["settings-dialog"],
      showMe: ["settings-rotation", "settings-end-tolerance"],
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
      task: "Choose Reefscape 2025",
      body: "Field Image sets the background for a competition year.",
      why: "A new field image doesn’t move your path or check it against that year’s obstacles.",
      target: "settings-field-image",
      settingsSection: "field",
      showMe: [{ target: "settings-field-select" }],
      check: configTask(
        (c) => c.gui.field.selected_field_id === "frc2025-reefscape",
        "Only the background changes; your path stays where it was.",
      ),
    }),
    settings({
      title: "Try the blank grid",
      task: "Choose Blank Meter Grid",
      body: "A neutral grid with lines one meter apart.",
      target: "settings-field-image",
      settingsSection: "field",
      showMe: [{ target: "settings-field-select" }],
      check: configTask((c) => c.gui.field.selected_field_id === "blank-grid"),
    }),
    settings({
      title: "Resize the grid",
      task: "Make a 12 × 6 m practice space",
      body: "Length runs left to right; Width runs top to bottom.",
      why: "Resizing the grid doesn’t scale the robot or change path coordinates.",
      target: "settings-field-geometry",
      settingsSection: "field",
      checks: [
        configCheck(
          "Length 12 m",
          "Field Length (m)",
          (c) => closeTo(c.gui.field.grid_size_meters?.length_meters ?? 18, 12),
          (c) =>
            closeTo(c.gui.field.grid_size_meters?.length_meters ?? 18, 6) &&
            closeTo(c.gui.field.grid_size_meters?.width_meters ?? 9, 12)
              ? "Swap them: Length 12, Width 6."
              : "",
        ),
        configCheck("Width 6 m", "Field Width (m)", (c) =>
          closeTo(c.gui.field.grid_size_meters?.width_meters ?? 9, 6),
        ),
      ],
    }),
    settings({
      title: "Custom field images",
      body: "Upload Image adds your own background: name it and give its full size in meters. No need to upload one now.",
      why: "Padding X and Y are the margins between the image edges and the usable field.",
      target: "settings-field",
      settingsSection: "field",
    }),
  ],
};

const startingFactor = firstSeen<number>();
const syncTurnedOff = observedTourCondition(
  () => !autoVelocityStore.getState().autoSyncEnabled,
);

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
      task: "Set the velocity safety factor to 0.9",
      body: "1 lets Generate use your robot’s full speed limit; 0.9 uses 90% of it.",
      why: "Merge difference combines nearby generated speed limits within that many m/s, so a larger value gives fewer distinct limits.",
      target: "settings-generator",
      settingsSection: "optimizer",
      showMe: [{ target: "label:Velocity safety factor" }],
      check: () => {
        const factor =
          config().kinematic_constraints
            .default_auto_velocity_velocity_safety_factor;
        // 90 is clamped to 1; only flag it once the learner has typed.
        const typed = factor !== startingFactor("factor", factor);
        return feedback(
          closeTo(factor, 0.9),
          typed && closeTo(factor, 1)
            ? "Use a fraction: type 0.9, not 90."
            : "",
          "",
        );
      },
    }),
    settings({
      title: "Keep generation in sync",
      task: "Turn Keep in sync off, then on again",
      body: "While it’s off, generated values change only when you click Generate.",
      why: "Manual values are never changed by generation either way.",
      target: "settings-generator",
      settingsSection: "optimizer",
      autoGenerate: undefined,
      checks: [
        {
          label: "Turned off",
          showMe: ["label:Keep in sync"],
          check: () => feedback(syncTurnedOff(), "", ""),
        },
        {
          label: "Back on",
          showMe: ["label:Keep in sync"],
          check: () =>
            feedback(
              syncTurnedOff() && autoVelocityStore.getState().autoSyncEnabled,
              "",
              "",
            ),
        },
      ],
    }),
    settings({
      title: "Tune your robot",
      body: "For your real robot, use its bumper size and measured limits, then tune its controllers.",
      settingsSection: "optimizer",
      resource: {
        label: "Read Tune Your Robot",
        href: "https://bline-docs.pages.dev/getting-started/tuning/",
      },
    }),
  ],
};

const stopIntakeVariant = () => {
  const keys = config().gui.event_trigger_keys ?? [];
  return keys.includes("stopIntake")
    ? undefined
    : keys.find((key) => key.toLocaleLowerCase() === "stopintake");
};

export const eventTriggerSettingsTour: TourDefinition = {
  id: "settings-event-triggers",
  title: "Lib Keys",
  summary: "Register, find, and manage the event keys a project reuses",
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
      task: "Open Event Triggers",
      body: "Lib Keys belong to the project, so every path can reuse them.",
      target: "settings-nav-event-triggers",
      settingsSection: "event-triggers",
      autoGenerate: false,
      settingsNavigateFrom: "robot",
      visible: ["settings-dialog"],
      interact: ["settings-nav"],
      showMe: [{ target: "settings-nav-event-triggers" }],
      prepare: {
        inspector: "closed",
        simulation: "start",
        closeMenus: true,
      },
      check: openControl(
        '[data-tour="settings-nav-event-triggers"][aria-current="page"]',
      ),
    },
    {
      title: "Register a Lib Key",
      task: "Register `stopIntake`",
      body: "A registered key is suggested in every path, even before an event uses it.",
      why: "In your own project, click Save when you leave Settings. This lesson applies edits to its practice project as you go.",
      target: "settings-event-triggers",
      settingsSection: "event-triggers",
      autoGenerate: false,
      visible: ["settings-dialog"],
      interact: ["settings-event-triggers"],
      showMe: [
        {
          // A case variant must be renamed from its own ⋯ menu.
          target: () => {
            const variant = stopIntakeVariant();
            return variant
              ? `label:Event trigger actions for ${variant}`
              : "label:Add new";
          },
          done: () =>
            !stopIntakeVariant() && shown('[aria-label="New Lib Key"]'),
        },
        "label:New Lib Key",
      ],
      check: () => {
        const keys = config().gui.event_trigger_keys ?? [];
        // A case variant blocks adding the right key, so point at the fix.
        const variant = stopIntakeVariant();
        return !keys.includes("stopIntake") && variant
          ? {
              complete: false,
              message: `Keys are case-sensitive — you registered "${variant}". Open its ⋯ menu, choose Rename All, and change it to "stopIntake".`,
            }
          : feedback(keys.includes("stopIntake"), "", "");
      },
    },
    {
      title: "Find a registered key",
      task: "Search for stop",
      body: "Each row counts the events that use its key.",
      target: "settings-event-triggers",
      settingsSection: "event-triggers",
      autoGenerate: false,
      visible: ["settings-dialog"],
      interact: ["settings-event-triggers"],
      showMe: [{ target: "label:Search event triggers" }],
      check: () =>
        feedback(
          document
            .querySelector<HTMLInputElement>(
              '[aria-label="Search event triggers"]',
            )
            ?.value.trim()
            .toLowerCase() === "stop",
          "",
          "",
        ),
    },
    {
      title: "Manage registered keys",
      task: "Open the ⋯ menu beside `stopIntake`",
      body: "Rename All changes the key everywhere, Duplicate copies it, and Delete clears it from events.",
      why: "Every action can be undone. Delete leaves the event elements in place. In the inspector, type part of a key and press Tab to complete it.",
      target: "settings-event-triggers",
      settingsSection: "event-triggers",
      autoGenerate: false,
      visible: ["settings-dialog"],
      interact: ["settings-event-triggers"],
      showMe: [{ target: "label:Event trigger actions for stopIntake" }],
      check: openControl(
        '[aria-label="Event trigger actions for stopIntake"][aria-expanded="true"]',
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

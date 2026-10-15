import { isWaypoint } from "../../core/model/path";
import {
  detectEnvironmentCapabilities,
  type ShellKind,
} from "../../env/capabilities";
import { projectStore } from "../../state/projectStore";
import { feedback } from "./tourChecks";
import { observedTourCondition } from "./tourInteraction";
import {
  createLinkedElementGroups,
  createTransferPaths,
  organizationMarkers,
  scorePose,
} from "./supplementalScenarios";
import { practiceConfig } from "./tourScenario";
import { currentPracticeTransferError } from "./tourTransfer";
import { tourStore, type TourDefinition, type TourStep } from "./tourStore";

const fileMenus = [
  "export-menu-entry",
  "export-menu-panel",
  "top-menu-project-transfer",
];
const playback = ["simulation-transport", "transport-timeline"];
const hasAction = (action: "exportFolder" | "importFolder" | "play") =>
  (tourStore.getState().actions[action] ?? 0) > 0;
const activePath = () => {
  const state = projectStore.getState();
  return state.project?.paths.find(
    (path) => path.path_id === state.activePathId,
  );
};

const webSteps: TourStep[] = [
  {
    title: "Export an autos folder",
    task: "Export the practice autos to a spare folder",
    body: "Choose File → Export to Robot… and pick a spare folder, not your robot project. Safari, Firefox, and Brave download autos.zip instead; keep it for the next step.",
    why: "Outside lessons, Export to Robot saves into your robot project’s src/main/deploy/autos and remembers that folder. This practice export never uses or replaces it.",
    target: "export-menu-entry",
    visible: ["path-canvas", "robot-export-dialog"],
    interact: [...fileMenus, "export-to-robot", "robot-export-dialog"],
    showMe: ["export-menu-entry", "export-to-robot"],
    prepare: { navigator: "closed", inspector: "closed", simulation: "start" },
    check: () =>
      feedback(
        hasAction("exportFolder"),
        "Choose Export to Robot… in the File menu.",
        "Autos exported.",
      ),
  },
  {
    title: "Import the autos folder",
    task: "Import the autos folder you saved",
    body: "Choose File → Import / Export → Import Autos Folder and pick the autos folder you exported, or Import Autos ZIP for autos.zip. Either holds config.json, paths, and project.json.",
    why: "This lesson imports into its practice project, so your own work is untouched.",
    target: "export-menu-entry",
    interact: [...fileMenus, "lesson-import-folder", "lesson-import-zip"],
    check: () => {
      const failure = currentPracticeTransferError();
      return failure && !hasAction("importFolder")
        ? {
            complete: false,
            message: `That folder didn’t import: ${failure.replace(/\.?$/, ".")} Select the autos folder you exported.`,
          }
        : feedback(
            hasAction("importFolder"),
            "Select the autos folder or autos.zip you exported, not a single path.",
            "Autos folder imported.",
          );
    },
  },
  {
    title: "Check the imported paths",
    task: "Select Score to Pickup and press Play",
    body: "Importing a folder brings in all its paths and shared settings together.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: ["path-breadcrumb", "path-canvas", ...playback],
    prepare: { navigator: "closed", simulation: "start", closeMenus: true },
    check: () =>
      feedback(
        hasAction("importFolder") &&
          activePath()?.file_name === "score-to-pickup.json" &&
          hasAction("play"),
        "Select Score to Pickup and press Play.",
        "Imported path checked.",
      ),
  },
  {
    title: "Save changes for your robot",
    body: "Edits save in this browser only. To update the robot, use Export to Robot again, then deploy your robot code.",
    why: "An imported folder is a copy; it doesn’t stay in sync with the files on disk.",
    visible: ["path-canvas"],
    prepare: { closeMenus: true },
  },
];

function desktopSteps(): TourStep[] {
  const folderMenuOpened = observedTourCondition(
    () =>
      typeof document !== "undefined" &&
      !!document.querySelector('[data-testid="top-menu-project-folder"]'),
  );
  return [
    {
      title: "Open an autos folder on desktop",
      task: "Open File and expand Folder",
      body: "On desktop, Open Project Folder works directly in an existing autos folder, and Create Project Folder starts a new one.",
      target: "export-menu-entry",
      visible: ["path-canvas"],
      interact: [
        "export-menu-entry",
        "export-menu-panel",
        "top-menu-project-folder",
      ],
      prepare: { navigator: "closed", inspector: "closed" },
      check: () =>
        feedback(
          folderMenuOpened(),
          "Open File, then expand Folder.",
          "These commands open or create your autos folder.",
        ),
    },
    {
      title: "Edit a path in the folder",
      task: "Change End’s X position",
      body: "An open folder holds every path and shared setting. End on Start to Score is selected; change its X. Practice edits stay inside the lesson.",
      target: "element-properties",
      visible: ["path-canvas"],
      interact: ["inspector-panel", "element-properties", "path-canvas"],
      prepare: {
        inspector: "open",
        inspectorTab: "elements",
        selectElement: (path) => path.path_elements.length - 1,
        closeMenus: true,
      },
      check: () => {
        const end = activePath()?.path.path_elements.at(-1);
        return feedback(
          !!end &&
            isWaypoint(end) &&
            Math.abs(end.translation_target.x_meters - scorePose.x_meters) >
              0.05,
          "Change End’s X position by at least 0.1 m.",
          "Path edited.",
        );
      },
    },
    {
      title: "Preview before deploying",
      task: "Play the edited path",
      body: "In a desktop project, edits save straight to the open folder. Check the save status before you deploy; there’s no need to export.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      prepare: { inspector: "closed", simulation: "start" },
      check: () =>
        feedback(
          hasAction("play"),
          "Press Play to check the path.",
          "Path previewed.",
        ),
    },
    {
      title: "Use the folder in your robot project",
      body: "Keep the autos folder at src/main/deploy/autos in your robot project. To share it, copy the whole folder: config.json, paths, and project.json.",
      visible: ["path-canvas"],
    },
  ];
}

export function createImportExportTour(
  shell: ShellKind = detectEnvironmentCapabilities().shell,
): TourDefinition {
  return {
    id: "import-export",
    title: "Importing and Exporting",
    summary:
      shell === "tauri"
        ? "Open an autos folder and save edits directly on desktop"
        : "Move autos folders between your browser and robot project",
    durationMinutes: 3,
    recap:
      shell === "tauri"
        ? [
            "On desktop, open your autos folder and edit it in place.",
            "Keep it at src/main/deploy/autos so each deploy uses your latest paths.",
          ]
        : [
            "Export and import whole autos folders from File → Import / Export.",
            "Export into src/main/deploy/autos, then deploy, to update the robot.",
          ],
    markers: organizationMarkers,
    practicePath: () => createTransferPaths()[0].path,
    practicePaths: createTransferPaths,
    practiceGroups: createLinkedElementGroups,
    practiceConfig,
    steps: shell === "tauri" ? desktopSteps() : webSteps,
  };
}

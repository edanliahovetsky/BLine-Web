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
    body: "Open File, then Import / Export, and choose Export Autos Folder. Save this two-path practice auto in a spare folder. Your browser either asks for a destination or downloads autos.zip. Unzip it if needed.",
    target: "export-menu-entry",
    visible: ["path-canvas"],
    interact: fileMenus,
    task: "Export the practice autos folder",
    prepare: { navigator: "closed", inspector: "closed", simulation: "start" },
    check: () =>
      feedback(
        hasAction("exportFolder"),
        "Choose Export Autos Folder in the File menu.",
        "Autos folder exported.",
      ),
  },
  {
    title: "Import the autos folder",
    body: "Choose File, Import / Export, then Import Autos Folder. Select the autos folder you just saved or unzipped. It contains config.json, the paths folder, and project.json for names and groups. This lesson imports into your practice project.",
    target: "export-menu-entry",
    interact: [...fileMenus, "lesson-import-folder"],
    task: "Import the exported autos folder",
    check: () =>
      feedback(
        hasAction("importFolder"),
        "Select the autos folder, not its ZIP file or an individual path.",
        "Autos folder imported.",
      ),
  },
  {
    title: "Check the imported paths",
    body: "Use the path dropdown to select Score to Pickup, then press Play. Importing an autos folder brings in all its paths and shared settings together.",
    target: "path-breadcrumb",
    visible: ["path-canvas", "simulation-transport"],
    interact: ["path-breadcrumb", "path-canvas", ...playback],
    task: "Select Score to Pickup and play it",
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
    body: "The web app saves edits in this browser. To update files on disk, export the autos folder again. Put it in your robot project at src/main/deploy/autos, then deploy your robot code. Importing a folder does not keep it synced with the browser.",
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
      body: "On desktop, use File, Folder, then Open Project Folder to work with an existing autos folder. Create Project Folder starts a new one. For this practice lesson, just expand Folder to find these commands.",
      target: "export-menu-entry",
      visible: ["path-canvas"],
      interact: [
        "export-menu-entry",
        "export-menu-panel",
        "top-menu-project-folder",
      ],
      task: "Open File and expand Folder",
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
      body: "An open folder holds all your paths and shared settings. Select End on Start to Score and change its X position. These practice edits stay inside the lesson.",
      target: "element-properties",
      visible: ["path-canvas"],
      interact: ["inspector-panel", "element-properties", "path-canvas"],
      task: "Change End’s X position",
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
      body: "Press Play to check your edited path. In a normal desktop project, edits save directly to the open folder. Check the save status before deploying; you do not need to export the folder after every edit.",
      target: "transport-play",
      visible: ["path-canvas"],
      interact: playback,
      prepare: { inspector: "closed", simulation: "start" },
      task: "Play the edited path",
      check: () =>
        feedback(
          hasAction("play"),
          "Press Play to check the path.",
          "Path previewed.",
        ),
    },
    {
      title: "Use the folder in your robot project",
      body: "Keep your autos folder at src/main/deploy/autos in the robot project. Working in that folder keeps the files ready for your next robot-code deploy. To share or move the auto, copy the whole autos folder, including config.json, paths, and project.json.",
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
    completionMessage: "Lesson complete.",
    markers: organizationMarkers,
    practicePath: () => createTransferPaths()[0].path,
    practicePaths: createTransferPaths,
    practiceGroups: createLinkedElementGroups,
    practiceConfig,
    steps: shell === "tauri" ? desktopSteps() : webSteps,
  };
}
